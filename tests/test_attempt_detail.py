"""T96 safe snapshot reads and metadata-only overview, synthetic data only."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies
from tests.results_fixture import create_results_studies


class DetailTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.study = create_results_studies(self.root)
        self.store = Studies(self.root)
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('localhost', 50000))
        self.url = '/api/studies/butane-demo'

    def fingerprint(self):
        return {str(p.relative_to(self.root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
                for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def test_snapshot_metadata_is_readonly_and_does_not_read_log(self):
        before = self.fingerprint()
        with patch('subprocess.Popen', side_effect=AssertionError('no process')):
            result = self.client.get(self.url+'/attempts/anti/snapshots').json()
        self.assertEqual(result['snapshots'][0]['data']['schema'], 'ag-log-snapshot/1')
        self.assertNotIn('RAW_SNAPSHOT_LOG_SENTINEL', json.dumps(result))
        self.assertEqual(self.fingerprint(), before)
        self.assertEqual(self.client.get(self.url+'/attempts/prepared/snapshots').json(), {'snapshots': []})

    def test_snapshot_symlinks_malformed_identity_and_size_are_rejected(self):
        area = self.study/'attempts/anti/snapshots'
        outside = self.root/'outside.json'; outside.write_text('{"secret":"OUTSIDE"}')
        (area/'link').symlink_to(self.root, target_is_directory=True)
        for name, raw in [('malformed', b'{bad'), ('large', b'x'*(4*1024*1024+1)),
                          ('identity', b'{"schema":"ag-log-snapshot/1","attempt_id":"other"}')]:
            (area/name).mkdir(); (area/name/'snapshot.json').write_bytes(raw)
        (area/'file-link').mkdir(); (area/'file-link/snapshot.json').symlink_to(outside)
        result = self.client.get(self.url+'/attempts/anti/snapshots').json()
        for row in result['snapshots']:
            if row['name'] != 'synthetic-capture':
                self.assertIsNone(row['data']); self.assertTrue(row['error'])
        self.assertNotIn('OUTSIDE', json.dumps(result))
        (self.study/'attempts/prepared/snapshots').symlink_to(area, target_is_directory=True)
        self.assertEqual(self.client.get(self.url+'/attempts/prepared/snapshots').status_code, 403)

    def test_metadata_omits_body_and_detail_retains_it_without_writes(self):
        folder = self.study/'analyses/large'; folder.mkdir()
        body = {'schema':'ag-thermo/1','padding':'SYNTHETIC_BODY'*200000}
        (folder/'report.json').write_text(json.dumps(body))
        before = self.fingerprint()
        result = self.client.get(self.url).json()
        row = next(r for r in result['analyses'] if r['name']=='large/report.json')
        self.assertEqual(row['schema'], 'ag-thermo/1'); self.assertIsNone(row['data'])
        self.assertNotIn('SYNTHETIC_BODY', json.dumps(result))
        self.assertEqual(self.client.get(self.url+'/reports/large/report.json').json()['data'], body)
        self.assertEqual(self.fingerprint(), before)
        # Prefixes never search nested text or pretend unknown headers are types.
        (folder/'report.json').write_text(json.dumps({'padding':'x'*70000,'schema':'ag-thermo/1'}))
        self.assertIsNone(self.store.analysis_summary('butane-demo', ('large','report.json'))['schema'])
        (folder/'report.json').write_text(json.dumps({'nested':{'schema':'wrong'},'padding':'x'*70000}))
        self.assertIsNone(self.store.analysis_summary('butane-demo', ('large','report.json'))['schema'])
        (folder/'report.json').unlink(); (folder/'report.json').symlink_to(self.root/'outside')
        self.assertIsNone(self.client.get(self.url+'/reports/large/report.json').json()['data'])
        self.assertEqual(self.client.get(self.url+'/reports/large/report.xyz').status_code, 400)
