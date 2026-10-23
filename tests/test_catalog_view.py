"""Synthetic catalog bytes only; no ag invocation or study writes by the viewer."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

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
