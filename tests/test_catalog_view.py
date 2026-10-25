"""Synthetic catalog bytes only; no ag invocation or study writes by the viewer."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from copy import deepcopy
from unittest.mock import patch

from fastapi.testclient import TestClient
from autog_frontend.api import create_app

from autog_frontend.studies import Studies, report_category
from autog_frontend.study_summary import energy_basis, study_type
from tests.study_fixture import create_studies


def save_catalog(study, objects=None, kinds=None, journal=b'{"synthetic":true}\r\n'):
    folder = study / 'catalog'
    folder.mkdir(exist_ok=True)
    (folder / 'journal.jsonl').write_bytes(journal)
    state = {'schema': 'ag-catalog-state/1', 'journal_sha256': hashlib.sha256(journal).hexdigest(),
             'objects': objects or [], 'report_kinds': kinds or {}}
    (folder / 'state.json').write_text(json.dumps(state))
    return state


class CatalogViewTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.study = create_studies(self.root)
        self.store = Studies(self.root)

    def read(self):
        return self.store.study(self.study.name)

    def test_registered_raw_byte_hash_and_immutable_reads(self):
        obj = {'id': 'water-a', 'name': 'Synthetic water', 'status': 'adopted',
               'members': [{'attempt': 'anti', 'role': 'sp'}],
               'adopted': {'sp': {'attempt': 'anti', 'report': 'thermo-demo.json'}},
               'values': {'scf_h': -75, 'freq_scf_h': None, 'zpe_h': None, 'g_h': None}}
        state = save_catalog(self.study, [obj], {'thermo-demo.json': 'formal'})
        files = [p for p in self.root.rglob('*') if p.is_file()]
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files}
        result = self.read()
        self.assertEqual(result['catalog'], {'state': state, 'journal_ok': True, 'warning': None})
        self.assertEqual(result['catalog_review']['attempts'], ['anti'])
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files})
        self.assertEqual(set(files), {p for p in self.root.rglob('*') if p.is_file()})

    def test_hash_mismatch_disables_registration_and_categories(self):
        save_catalog(self.study, kinds={'thermo-demo.json': 'formal'})
        (self.study / 'catalog/journal.jsonl').write_bytes(b'changed\n')
        result = self.read()
        self.assertFalse(result['catalog']['journal_ok'])
        self.assertIn('哈希', result['catalog']['warning'])
        self.assertFalse(result['catalog_review']['available'])
        self.assertTrue(all('catalog_kind' not in r for r in result['analyses']))

    def test_missing_catalog_and_partial_catalog(self):
        self.assertEqual(self.read()['catalog'], {'state': None, 'journal_ok': False, 'warning': None})
        save_catalog(self.study)
        for name in ('state.json', 'journal.jsonl'):
            save_catalog(self.study)
            (self.study / 'catalog' / name).unlink()
            result = self.read()['catalog']
            self.assertFalse(result['journal_ok'])
            self.assertIn('缺失', result['warning'])

    def test_links_and_nonregular_files_fail_closed(self):
        save_catalog(self.study)
        target = self.root / 'outside'
        target.write_text('OUTSIDE_SENTINEL')
        for filename in ('state.json', 'journal.jsonl'):
            save_catalog(self.study)
            path = self.study / 'catalog' / filename
            path.unlink()
            path.symlink_to(target)
            result = self.read()['catalog']
            self.assertFalse(result['journal_ok'])
            self.assertIn('安全', result['warning'])
            self.assertNotIn('OUTSIDE_SENTINEL', json.dumps(result))
            path.unlink()

    def test_catalog_directory_symlink_rejected(self):
        (self.study / 'catalog').symlink_to(self.root, target_is_directory=True)
        self.assertIn('安全', self.read()['catalog']['warning'])

    def test_invalid_records_and_nonfinite_values(self):
        invalid = [[], {'schema': 'other'}, {'schema': 'ag-catalog-state/1', 'objects': {}},
                   {'objects': [{'status': 'candidate', 'members': [{'attempt': '../escape'}]}]},
                   {'objects': [{'status': 'adopted', 'members': [], 'adopted': []}]},
                   {'objects': [], 'report_kinds': {'x': ['formal']}}, {'values': float('nan')}]
        for fields in invalid:
            with self.subTest(fields=fields):
                state = save_catalog(self.study)
                value = {**state, **fields} if isinstance(fields, dict) else fields
                (self.study / 'catalog/state.json').write_text(json.dumps(value))
                self.assertFalse(self.read()['catalog']['journal_ok'])

    def test_size_limits_preserved(self):
        save_catalog(self.study)
        (self.study / 'catalog/state.json').write_bytes(b' ' * (4 * 1024 * 1024 + 1))
        self.assertFalse(self.read()['catalog']['journal_ok'])

    def test_report_registration_not_stale_in_metadata_cache(self):
        save_catalog(self.study, kinds={'thermo-demo.json': 'formal'})
        first = next(r for r in self.read()['analyses'] if r['name'] == 'thermo-demo.json')
        self.assertEqual(first['schema'], 'ag-thermo/1')
        self.assertEqual(first['catalog_kind'], 'formal')
        save_catalog(self.study, kinds={'thermo-demo.json': 'energy'})
        second = next(r for r in self.read()['analyses'] if r['name'] == 'thermo-demo.json')
        self.assertEqual(second['catalog_kind'], 'energy')
        self.assertEqual(first['updated_at'], second['updated_at'])

    def test_schema_and_declaration_precede_legacy_ts_layout(self):
        name = 'ts-labels/synthetic/labels.json'
        self.assertEqual(report_category('ag-nci/1', 'formal', '.json', name), ('nci', '按 schema'))
        self.assertEqual(report_category(None, 'formal', '.json', name), ('formal', '按报告声明'))
        self.assertEqual(report_category(None, None, '.json', name), ('ts', '按 TS 标签目录'))

    def test_energy_basis_and_validation_prefix(self):
        for basis in ('E', 'E+ZPE', 'G'):
            text = f'---\nenergy_basis: "{basis}" # explicit\n---\n# Synthetic water\n'
            (self.study / 'study.md').write_text(text)
            self.assertEqual(self.read()['energy_basis'], basis)
        for text in ('', '# Synthetic\nenergy_basis: G', '---\nenergy_basis: H\n---\n', '---\nenergy_basis: G'):
            self.assertEqual(energy_basis(text), 'E+ZPE')
        self.assertEqual(study_type('val-water', '# Synthetic water'), 'validation')

    def save_v2(self, name='two-channels'):
        folder = self.study / 'catalog'
        folder.mkdir(exist_ok=True)
        fixture = Path(__file__).parent / 'catalog-fixtures/t132' / name
        for filename in ('state.json', 'journal.jsonl'):
            (folder / filename).write_bytes((fixture / filename).read_bytes())
        return json.loads((folder / 'state.json').read_bytes())

    def test_v1_api_bytes_match_existing_snapshot_and_ignore_unknown_fields(self):
        state = save_catalog(self.study, [{'id': 'water', 'name': 'Water', 'status': 'candidate',
                                           'members': [], 'future_object': {'x': 1}}])
        state['future_top_level'] = [1, 2]
        (self.study / 'catalog/state.json').write_text(json.dumps(state))
        expected = {'state': state, 'journal_ok': True, 'warning': None}
        with TestClient(create_app(self.root), base_url='http://localhost', client=('127.0.0.1', 50123)) as client:
            with patch.object(Studies, 'catalog', return_value=expected):
                previous = client.get('/api/studies/' + self.study.name).content
            self.assertEqual(client.get('/api/studies/' + self.study.name).content, previous)

    def test_v2_producer_fixtures_preserve_all_fields_and_read_only_bytes(self):
        for fixture in ('two-channels', 'six-statuses'):
            state = self.save_v2(fixture)
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
            with patch('subprocess.Popen', side_effect=AssertionError('No subprocess')):
                result = self.read()
            self.assertEqual(result['catalog'], {'state': state, 'journal_ok': True, 'warning': None})
            self.assertEqual(result['catalog_review']['attempts'], ['water-ts-synthetic'])
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()})

    def test_v2_optional_values_unknown_fields_and_status_are_not_rederived(self):
        state = self.save_v2()
        obj = state['objects'][0]
        obj['future_field'] = {'unknown': True}
        state['future_field'] = ['unknown']
        # Display the saved status, even if candidate history could suggest another.
        obj['channels'][0]['status'] = 'untried'
        obj['channels'][0]['product_branch'] = ''
        obj['candidates'][0]['note'] = ''
        obj['candidates'][2]['literature']['si_location'] = ''
        for formula, charge, multiplicity, coverage in [
            ('unset', 'unknown', None, None), ('unknown', 'set', 1, 'withdrawn'), ('set', 'unset', 3, 'stable')]:
            obj['expected'] = {'formula': {'state': formula, 'value': 'H2O' if formula == 'set' else None},
                               'charge': {'state': charge, 'value': 0 if charge == 'set' else None}}
            obj['multiplicity'] = multiplicity
            obj['coverage'] = None if coverage is None else dict(statement=coverage, scope='Synthetic scope',
                budget='Synthetic budget', at='2026-01-01T00:00:00+00:00', quote='  Synthetic declaration\n  ')
            (self.study / 'catalog/state.json').write_text(json.dumps(state))
            self.assertEqual(self.read()['catalog']['state'], state)

    def test_v2_invalid_nested_fields_fall_back_without_crashing(self):
        state = self.save_v2('six-statuses')
        prefix = ('objects', 0)
        cases = [
            (('generated_at',), 'yesterday'),
            (('generated_at',), '2026-01-01T00:00:00'),
            (('objects',), {}),
            (prefix + ('expected',), []),
            (prefix + ('expected', 'formula', 'state'), 'missing'),
            (prefix + ('expected', 'formula', 'value'), 'OH2'),
            (prefix + ('expected', 'charge', 'value'), True),
            (prefix + ('multiplicity',), 0),
            (prefix + ('channels',), {}),
            (prefix + ('channels', 0, 'status'), 'auto_verified'),
            (prefix + ('channels', 0, 'status'), {}),
            (prefix + ('channels', 0, 'discovered'), 1),
            (prefix + ('channels', 0, 'confirmed'), 'yes'),
            (prefix + ('channels', 0, 'definition'), []),
            (prefix + ('channels', 0, 'product_branch'), 5),
            (prefix + ('channels', 0, 'candidate_ids'), ['missing']),
            (prefix + ('channels', 0, 'candidate_ids'), ['guess-scan', 'guess-scan']),
            (prefix + ('channels', 0, 'outcome_counts'), {'unknown': 1}),
            (prefix + ('channels', 0, 'outcome_counts'), {'diagnosed': True}),
            (prefix + ('channels', 0, 'outcome_counts'), {'diagnosed': -1}),
            (prefix + ('channels', 4, 'declaration'), None),
            (prefix + ('channels', 4, 'declaration', 'quote'), ''),
            (prefix + ('channels', 4, 'declaration', 'status'), 'cleared'),
            (prefix + ('channels', 5, 'declaration', 'reason'), None),
            (prefix + ('candidates',), {}),
            (prefix + ('candidates', 0, 'origin'), 'automatic'),
            (prefix + ('candidates', 0, 'sha256'), 'bad'),
            (prefix + ('candidates', 0, 'file'), '../water.xyz'),
            (prefix + ('candidates', 0, 'n_atoms'), True),
            (prefix + ('candidates', 0, 'formula'), 'Xx2'),
            (prefix + ('candidates', 0, 'parent'), []),
            (prefix + ('candidates', 0, 'parent', 'attempt'), '../escape'),
            (prefix + ('candidates', 1, 'parent', 'file', 'sha256'), False),
            (prefix + ('candidates', 0, 'transform'), []),
            (prefix + ('candidates', 0, 'target_channel'), ['a']),
            (prefix + ('candidates', 0, 'target_channel'), 'missing'),
            (prefix + ('candidates', 2, 'literature'), None),
            (prefix + ('candidates', 2, 'literature', 'doi'), 'not-a-doi'),
            (prefix + ('candidates', 0, 'registered_at'), False),
            (prefix + ('candidates', 0, 'results'), {}),
            (prefix + ('candidates', 0, 'results', 0, 'schema'), 'ag-catalog/1'),
            (prefix + ('candidates', 0, 'results', 0, 'seq'), True),
            (prefix + ('candidates', 0, 'results', 0, 'prev_sha256'), 'bad'),
            (prefix + ('candidates', 0, 'results', 0, 'object'), 'other'),
            (prefix + ('candidates', 0, 'results', 0, 'candidate'), 'other'),
            (prefix + ('candidates', 0, 'results', 0, 'outcome'), 'success'),
            (prefix + ('candidates', 0, 'results', 0, 'diagnosis'), ['bad']),
            (prefix + ('candidates', 0, 'results', 0, 'assignment'), {'status': 'none', 'channels': ['a']}),
            (prefix + ('candidates', 0, 'results', 0, 'assignment'), {'status': 'tentative', 'channels': []}),
            (prefix + ('candidates', 0, 'results', 0, 'assignment'), {'status': 'undetermined', 'channels': ['a']}),
            (prefix + ('candidates', 0, 'results', 0, 'assignment'), {'status': 'unknown', 'channels': []}),
            (prefix + ('candidates', 0, 'latest_assignment'), None),
            (prefix + ('candidates', 2, 'results', 0, 'checks', 'n_imag'), True),
            (prefix + ('candidates', 2, 'results', 0, 'checks', 'fetched'), False),
            (prefix + ('candidates', 2, 'results', 0, 'quote'), None),
            (prefix + ('coverage', 'statement'), 'complete'),
            (prefix + ('coverage', 'budget'), []),
            (prefix + ('coverage', 'quote'), ' '),
            (prefix + ('member_mismatches',), {}),
            (prefix + ('member_mismatches', 0, 'field'), 'energy'),
            (prefix + ('member_mismatches', 0, 'actual'), False),
        ]
        for path, value in cases:
            with self.subTest(path=path, value=value):
                changed = deepcopy(state)
                cursor = changed
                for part in path[:-1]:
                    cursor = cursor[part]
                cursor[path[-1]] = value
                (self.study / 'catalog/state.json').write_text(json.dumps(changed))
                result = self.read()['catalog']
                self.assertIsNone(result['state'])
                self.assertFalse(result['journal_ok'])
                self.assertIn('格式', result['warning'])

    def test_v2_missing_required_fields_fail_closed(self):
        state = self.save_v2('six-statuses')
        paths = [('objects', 0), ('objects', 0, 'expected'), ('objects', 0, 'expected', 'formula'),
                 ('objects', 0, 'channels', 4), ('objects', 0, 'channels', 4, 'declaration'),
                 ('objects', 0, 'candidates', 2), ('objects', 0, 'candidates', 2, 'parent'),
                 ('objects', 0, 'candidates', 2, 'literature'),
                 ('objects', 0, 'candidates', 2, 'results', 0),
                 ('objects', 0, 'candidates', 2, 'results', 0, 'assignment'),
                 ('objects', 0, 'candidates', 2, 'results', 0, 'checks'),
                 ('objects', 0, 'coverage'), ('objects', 0, 'member_mismatches', 0)]
        for path in paths:
            source = state
            for key in path:
                source = source[key]
            keys = source if len(path) > 2 else ('id', 'multiplicity', 'expected', 'channels', 'candidates', 'coverage', 'member_mismatches')
            for key in keys:
                with self.subTest(path=path, key=key):
                    changed = deepcopy(state)
                    cursor = changed
                    for part in path:
                        cursor = cursor[part]
                    del cursor[key]
                    (self.study / 'catalog/state.json').write_text(json.dumps(changed))
                    self.assertFalse(self.read()['catalog']['journal_ok'])

    def test_v2_hash_mismatch_and_unsupported_version_are_explicit(self):
        self.save_v2()
        (self.study / 'catalog/journal.jsonl').write_bytes(b'changed\n')
        self.assertIn('哈希', self.read()['catalog']['warning'])
        state = self.save_v2()
        state['schema'] = 'ag-catalog-state/3'
        (self.study / 'catalog/state.json').write_text(json.dumps(state))
        self.assertIn('不支持的 catalog 版本', self.read()['catalog']['warning'])
