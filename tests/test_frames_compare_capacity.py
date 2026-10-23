"""T110 read boundaries and additive monitor fields, synthetic files only."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError
from autog_frontend.monitor import validate_monitor
from tests.study_fixture import create_studies
from tests.results_fixture import monitor_snapshot


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.study = create_studies(self.root)
        self.store = Studies(self.root)
        self.url = '/api/studies/butane-demo/attempts/anti/comparison-structure'
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('127.0.0.1', 50123))

    def test_only_fixed_facts_and_final_geometry_are_read_without_mutation(self):
        facts = self.study/'attempts/anti/facts.json'
        value = json.loads(facts.read_bytes())
        value['final_geometry'] = {'path': '../../private.xyz', 'sha256': 'a'*64}
        facts.write_text(json.dumps(value))
        before = {p: p.read_bytes() for p in self.study.rglob('*') if p.is_file()}
        with patch.object(self.store, 'read', wraps=self.store.read) as read, patch('subprocess.Popen', side_effect=AssertionError('process')):
            data = self.store.comparison_structure('butane-demo', 'anti')
            self.assertEqual([call.args[0][-1] for call in read.call_args_list], ['facts.json', 'final.xyz'])
        self.assertEqual(set(data), {'id', 'facts', 'geometry'})
        self.assertTrue(data['geometry']['data']['atoms'])
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertEqual(self.client.get(self.url).json(), data)
        self.assertEqual(self.client.post(self.url).status_code, 405)

    def test_links_oversize_and_corrupt_geometry_remain_unavailable(self):
        outside = self.root/'private.xyz';outside.write_text('PRIVATE_SENTINEL')
        for name in ['facts.json', 'final.xyz']:
            path = self.study/'attempts/anti'/name
            raw = path.read_bytes();path.unlink();path.symlink_to(outside)
            data = self.client.get(self.url)
            self.assertNotIn('PRIVATE_SENTINEL', data.text)
            key = 'facts' if name.endswith('json') else 'geometry'
            self.assertIsNone(data.json()[key]['data'])
            self.assertTrue(data.json()[key]['error'])
            path.unlink();path.write_bytes(raw)
        path = self.study/'attempts/anti/final.xyz'
        for raw in [b'bad', b'x'*(4*1024*1024+1)]:
            path.write_bytes(raw)
            self.assertIsNone(self.client.get(self.url).json()['geometry']['data'])
        for name in ['../anti', 'a/b', '..']:
            with self.assertRaises(StudyError):self.store.comparison_structure('butane-demo', name)
        linked = self.study/'attempts/linked';linked.symlink_to(self.study/'attempts/anti')
        self.assertEqual(self.client.get(self.url.replace('/anti/', '/linked/')).status_code, 403)


class MonitorFieldsTests(unittest.TestCase):
    def test_display_names_on_success_retained_and_first_failure_snapshots(self):
        for ok, previous_success in [(True, True), (False, True), (False, False)]:
            data = monitor_snapshot();data['ok'] = ok
            if not previous_success:
                data['last_ok_at'] = None
                data['own'] = None
                data['cluster'].update(cores_total=None, cores_used=None, nodes=[], queues=[])
            for name in ['scnet-初筛', '筛' * 32]:
                data['cluster']['display_name'] = name
                with self.subTest(ok=ok, previous_success=previous_success, name=name):
                    self.assertIs(validate_monitor(data), data)

    def test_invalid_display_names_are_rejected(self):
        for name in [None, 3, [], '', '筛' * 33, 'line\nbreak', 'tab\tname', 'bad\x00name', '\u200bhidden']:
            data = monitor_snapshot();data['cluster']['display_name'] = name
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '快照格式不正确'):
                validate_monitor(data)

    def test_old_success_and_failure_snapshots_accept_additive_fields(self):
        for ok in [True, False]:
            data = monitor_snapshot();data['ok'] = ok
            self.assertIs(validate_monitor(data), data)
            data['own'].update(max_queued_cores=64, scheduler_max_running_cores=32, max_cores=16,
                               tiers={'mini': {'cores': 4, 'mem_gb': 8}, 'complex': {'cores': 16, 'mem_gb': 32.5}})
            self.assertIs(validate_monitor(data), data)

    def test_malformed_optional_values_fail_before_reaching_ui(self):
        for field, values in {
            'max_queued_cores': [-1, True, None, '64', 1.5],
            'scheduler_max_running_cores': [0, -1, True, None],
            'max_cores': [0, -1, False, '32'],
            'tiers': [[], None, {'mini': None}, {'mini': {'cores': True, 'mem_gb': 8}},
                      {'mini': {'cores': 4, 'mem_gb': 0}}, {'mini': {'cores': 4, 'mem_gb': float('inf')}},
                      {'mini': {'cores': 4}}],
        }.items():
            for value in values:
                data = copy.deepcopy(monitor_snapshot());data['own'][field] = value
                with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, '快照格式不正确'):
                    validate_monitor(data)
