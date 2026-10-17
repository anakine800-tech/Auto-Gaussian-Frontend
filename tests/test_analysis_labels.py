"""T98's approved fixed T91 report paths; all data is synthetic."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError
from tests.study_fixture import create_studies


class TSLabelsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.study = create_studies(self.root)
        self.folder = self.study/'analyses/ts-labels/synthetic'
        self.folder.mkdir(parents=True)
        self.body = {'attempts': [{'attempt': 'anti', 'product_configuration': 'C1:R',
                                  'product_centers': [{'label': 'R'}], 'catalyst_check': {'status': 'unchanged'}}],
                     'channel_suggestions': [{'status': 'pending_confirmation'}]}
        (self.folder/'labels.json').write_text(json.dumps(self.body))
        (self.folder/'labels.md').write_text('# Synthetic labels\n')
        (self.folder/'channel-suggestions.csv').write_text('attempt,status\nanti,pending_confirmation\n')
        self.store = Studies(self.root)
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('localhost', 50000))
        self.url = '/api/studies/butane-demo'

    def fingerprint(self):
        return {str(p.relative_to(self.root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
                for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def test_fixed_three_files_list_metadata_only_and_details_do_not_mutate(self):
        (self.folder/'ignored.json').write_text('{"schema":"ag-thermo/1","secret":"IGNORED"}')
        nested=self.folder/'deeper'; nested.mkdir(); (nested/'labels.json').write_text('{"secret":"DEEPER"}')
        before=self.fingerprint()
        with patch('subprocess.Popen', side_effect=AssertionError('no process')):
            listing=self.client.get(self.url).json()
            rows=[r for r in listing['analyses'] if r['name'].startswith('ts-labels/')]
            self.assertEqual({r['name'] for r in rows}, {'ts-labels/synthetic/'+name for name in ('labels.json','labels.md','channel-suggestions.csv')})
            self.assertTrue(all(r['data'] is None and r['schema'] is None and r['updated_at'] for r in rows))
            self.assertNotIn('product_configuration', json.dumps(listing))
            self.assertEqual(self.client.get(self.url+'/reports/ts-labels/synthetic/labels.json').json()['data'], self.body)
            for name in ('labels.md','channel-suggestions.csv'):
                self.assertEqual(self.client.get(self.url+'/reports/ts-labels/synthetic/'+name).json()['data'], (self.folder/name).read_text())
        self.assertEqual(before,self.fingerprint())

    def test_unapproved_deeper_paths_and_filenames_are_rejected(self):
        for path in ('/reports/ts-labels/synthetic/ignored.json', '/reports/other/synthetic/labels.json', '/reports/ts-labels/synthetic/deeper/labels.json'):
            self.assertIn(self.client.get(self.url+path).status_code,(400,404))
        for parts in [('other','synthetic','labels.json'),('ts-labels','synthetic','ignored.json'),('ts-labels','synthetic','deeper','labels.json')]:
            with self.assertRaises(StudyError): self.store.report('butane-demo',parts)
        self.assertEqual(self.client.get(self.url+'/reports/ts-labels/%2e%2e/labels.json').status_code,400)

    def test_root_name_and_file_symlinks_rejected(self):
        area=self.study/'analyses/ts-labels'
        outside=self.root/'outside'; outside.mkdir(); (outside/'labels.json').write_text('{"secret":"OUTSIDE"}')
        (area/'linked').symlink_to(outside, target_is_directory=True)
        (self.folder/'labels.json').unlink(); (self.folder/'labels.json').symlink_to(outside/'labels.json')
        listing=self.client.get(self.url).json()
        self.assertTrue(any(i['path']=='analyses/ts-labels/linked' for i in listing['issues']))
        for name in ('synthetic','linked'):
            body=self.client.get(self.url+'/reports/ts-labels/'+name+'/labels.json').json()
            self.assertIsNone(body['data']); self.assertTrue(body['error']); self.assertNotIn('OUTSIDE',str(body))
        second=create_studies(self.root/'root-link')
        (second/'analyses/ts-labels').symlink_to(outside,target_is_directory=True)
        store=Studies(self.root/'root-link')
        self.assertTrue(any(i['path']=='analyses/ts-labels' for i in store.study('butane-demo')['issues']))
        self.assertIsNone(store.report('butane-demo',('ts-labels','anything','labels.json'))['data'])

    def test_malformed_and_size_limit_are_errors_and_large_metadata_stays_bounded(self):
        path=self.folder/'labels.json'
        for raw in ('{bad', 'x'*(4*1024*1024+1)):
            path.write_text(raw)
            before=self.fingerprint()
            listing=self.client.get(self.url).json()
            row=next(r for r in listing['analyses'] if r['name']=='ts-labels/synthetic/labels.json')
            self.assertIsNone(row['data']); self.assertTrue(row['error'])
            detail=self.client.get(self.url+'/reports/ts-labels/synthetic/labels.json').json()
            self.assertIsNone(detail['data']); self.assertTrue(detail['error'])
            self.assertEqual(before,self.fingerprint())
        path.write_text(json.dumps({'padding':'SYNTHETIC_BODY'*12000, **self.body}))
        listing=self.client.get(self.url).json()
        self.assertNotIn('SYNTHETIC_BODY',json.dumps(listing))
        self.assertEqual(self.client.get(self.url+'/reports/ts-labels/synthetic/labels.json').json()['data']['attempts'],self.body['attempts'])
