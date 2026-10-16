"""Full HTTP adapter regression on the same synthetic study as the browser."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from tests.integration_fixture import create_integration_study, FETCH_RESULT, write_json
from tests.fake_ag import make_fake


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.home = Path(temp.name).resolve(); self.root = self.home/'studies'
        self.study = create_integration_study(self.root)
        self.app = create_app(self.root)
        self.client = self.client_for(self.app)

    def client_for(self, app):
        return TestClient(app, base_url='http://localhost', client=('127.0.0.1', 51234))

    def get(self, path, study='butane-demo'):
        return self.client.get('/api/studies/'+study+path)

    def healthy(self, study):
        data = self.get('', study).json()
        self.assertTrue(data['study']['data'])
        self.assertTrue(any(a['name']=='thermo-demo.json' and a['data']['schema']=='ag-thermo/1' for a in data['analyses']))
        self.assertEqual(self.get('/attempts/opt-demo/optimization/optimization.log', study).status_code, 200)
        self.assertEqual(self.get('/attempts/crest-demo/crest-frames/crest_conformers.xyz', study).status_code, 200)

    def test_complete_study_readonly_roundtrip_and_no_registered_posts(self):
        before = {p:(p.read_bytes(),p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        with patch('subprocess.Popen', side_effect=AssertionError('readonly launched a process')):
            self.assertFalse(any('POST' in (getattr(r,'methods',None) or ()) for r in self.app.routes))
            self.healthy('butane-demo')
            ensemble = self.get('/ensembles/ensemble.json').json()
            self.assertEqual(len(ensemble['frames']), 3)
            for attempt in ('sp-demo','opt-demo','crest-demo','anti'):
                self.assertEqual(self.get('/attempts/'+attempt).status_code, 200)
            report = self.get('/attempts/anti/mode-reports/butane.log').json()['reports'][0]
            self.assertTrue(report['log_matches'])
            self.assertEqual(self.get('/attempts/anti/vibrations/butane.log').json()['modes'][0]['frequency_cm1'], -100.)
            for route in self.app.routes:
                url = route.path.replace('{study}','butane-demo').replace('{attempt}','anti').replace('{log}','butane.log').replace('{name}','ensemble.json').replace('{group}','routes').replace('{asset:path}','')
                self.assertEqual(self.client.post(url).status_code, 405)
            self.assertEqual(self.client.post('/api/actions', json={'action':'fetch','study':'butane-demo','attempt':'anti'}).status_code, 405)
        self.assertEqual(before, {p:(p.read_bytes(),p.stat().st_mtime_ns) for p in before})

    def facts_error(self, case, reason):
        data = self.get('/attempts/anti', case).json()
        self.assertIsNone(data['facts']['data']); self.assertIn(reason, data['facts']['error'])
        self.assertIsNotNone(data['geometry']['data']); self.healthy(case)

    def test_missing_facts(self): self.facts_error('facts-missing', 'File not available')
    def test_broken_facts(self): self.facts_error('facts-broken', 'Malformed')

    def ensemble_error(self, case, status, reason):
        response = self.get('/ensembles/ensemble.json', case)
        self.assertEqual(response.status_code, status, response.text)
        self.assertIn(reason, response.json()['detail']); self.assertNotIn('frames', response.json())
        self.healthy(case)

    def test_replaced_xyz(self): self.ensemble_error('xyz-replaced', 422, 'sha256 mismatch')
    def test_size_limit(self): self.ensemble_error('size-limit', 413, 'size limit')
    def test_frame_limit(self): self.ensemble_error('frame-limit', 413, 'frame')
    def test_atom_limit(self): self.ensemble_error('atom-limit', 413, 'atom')
    def test_symlink(self):
        self.ensemble_error('symlink', 403, 'Unsafe or unreadable file')
        self.assertNotIn('OUTSIDE_STUDY_SENTINEL', self.get('', 'symlink').text)

    def test_report_from_another_log(self):
        data = self.get('/attempts/anti/mode-reports/butane.log', 'report-other-log').json()
        self.assertFalse(data['reports'][0]['log_matches'])
        self.assertEqual(self.get('/attempts/anti/vibrations/butane.log', 'report-other-log').status_code, 200)
        self.healthy('report-other-log')

    def test_truncated_log(self):
        response = self.get('/attempts/anti/vibrations/butane.log', 'log-truncated')
        self.assertEqual(response.status_code, 422)
        self.assertTrue(response.json()['detail'])
        self.assertEqual(self.get('/attempts/anti/logs/butane.log', 'log-truncated').status_code, 200)
        self.healthy('log-truncated')

    def test_expired_monitor(self):
        row = next(r for r in self.client.get('/api/monitor').json()['clusters'] if r['name']=='expired')
        self.assertIsNone(row['error']); self.assertEqual(row['snapshot']['own']['committed_cap'], 88)
        self.healthy('butane-demo')

    def test_failed_monitor(self):
        row = next(r for r in self.client.get('/api/monitor').json()['clusters'] if r['name']=='failed')
        self.assertFalse(row['snapshot']['ok']); self.assertEqual(row['snapshot']['error'], 'Synthetic sampling failure')
        self.assertIsNotNone(row['snapshot']['last_ok_at']); self.healthy('butane-demo')

    def test_fetch_with_t52_facts_preserves_output(self):
        fake = make_fake(self.home)
        output = json.dumps(FETCH_RESULT)+'\n'
        write_json(self.home/'control.json', dict(stdout=output))
        ui = self.home/'ui'; ui.mkdir(); (ui/'assets').mkdir(); (ui/'index.html').write_text('<head></head>')
        client = self.client_for(create_app(self.root, ui, enable_actions=True, ag=fake))
        import re
        token = re.search('name="ag-token" content="([^"]+)"', client.get('/').text)[1]
        result = client.post('/api/actions', headers={'X-AG-Token':token}, json=dict(action='fetch',study='butane-demo',attempt='anti'))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['stdout'], output); self.assertEqual(result.json()['exit_code'], 0)
        calls = [json.loads(line) for line in (self.home/'argv.jsonl').read_text().splitlines()]
        self.assertEqual(calls[-1], ['fetch','--json','anti'])
