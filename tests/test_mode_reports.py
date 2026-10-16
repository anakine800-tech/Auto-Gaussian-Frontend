"""Synthetic three-hydrogen coordinates only; no backend runtime dependency."""
from copy import deepcopy
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies
from autog_frontend.vibrations import parse_log_modes


def synthetic_log():
    # Unequal vector norms catch confusing raw amplitude with max displacement.
    return (' Entering Gaussian System\n Gaussian, Inc.\n -----\n # freq\n -----\n NAtoms=    3\n'
            ' Standard orientation:\n'
            ' ---------------------------------------------------------------------\n'
            ' Center     Atomic      Atomic             Coordinates (Angstroms)\n'
            ' Number     Number       Type             X           Y           Z\n'
            ' ---------------------------------------------------------------------\n'
            '      1          1           0        0.000000    0.000000    0.000000\n'
            '      2          1           0        4.000000    0.000000    0.000000\n'
            '      3          1           0        0.000000    3.000000    0.000000\n'
            ' ---------------------------------------------------------------------\n'
            ' Harmonic frequencies (cm**-1)\n'
            '                      1\n                      A\n'
            ' Frequencies --   -100.0000\n Red. masses --      1.0000\n'
            ' Frc consts  --      1.0000\n IR Inten    --      1.0000\n'
            '  Atom  AN      X      Y      Z\n'
            '     1   1     0.60   0.00   0.00\n'
            '     2   1    -0.80   0.00   0.00\n'
            '     3   1     0.00   0.00   0.00\n\n'
            ' Normal termination of Gaussian\n')


def example_report():
    # Independent scalar Python arithmetic, not the frontend implementation.
    a = .3
    pos = 4 - a - .6 / .8 * a
    neg = 4 + a + .6 / .8 * a
    transverse = math.sqrt(9 + (.6 / .8 * a) ** 2)
    rows = []
    for atoms, d, plus, minus, rate, rank in [([1, 2], 4., pos, neg, -1.4, 1),
                                            ([1, 3], 3., transverse, transverse, 0., 3)]:
        rows.append(dict(atoms=atoms, elements=['H', 'H'], distance=d, plus_distance=plus,
                         minus_distance=minus, plus_change=plus-d, minus_change=minus-d,
                         distance_change_rate=rate, absolute_rate_rank=rank))
    digest = sha256(synthetic_log().encode()).hexdigest()
    return dict(attempt='anti', mode=1, source_mode_index=1, frequency=-100., amplitude=a,
                orientation='standard', source=dict(log='attempts/anti/outputs/butane.log',
                log_sha256=digest, section_sha256=digest), pairs=rows,
                rate_definition='(v_i-v_j) dot (r_i-r_j) / |r_i-r_j|; raw cclib Cartesian vectors',
                note='模式整体正负号任意；有限振幅距离变化可能不同于线性导数。')


class ModeReportsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.study = self.root / 'butane-demo'
        self.analyses = self.study / 'analyses'; self.analyses.mkdir(parents=True)
        output = self.study / 'attempts/anti/outputs'; output.mkdir(parents=True)
        (output / 'butane.log').write_text(synthetic_log())
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('127.0.0.1', 50123))
        self.uri = '/api/studies/butane-demo/attempts/anti/mode-reports/butane.log'

    def write(self, name='report.json', report=None):
        path = self.analyses / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(example_report() if report is None else report))
        return path

    def read(self):
        response = self.client.get(self.uri)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_recognition_and_one_level_multiple_reports(self):
        for key in ('attempt', 'mode', 'pairs', 'rate_definition'):
            data = example_report(); del data[key]; self.write(key + '.json', data)
        data = example_report(); del data['source']['log_sha256']; self.write('nohash.json', data)
        data = example_report(); data['attempt'] = 'other'; self.write('other.json', data)
        self.write(); self.write('group/second.json'); self.write('group/deeper/ignored.json')
        result = self.read()
        self.assertEqual([r['name'] for r in result['reports']], ['report.json', 'group/second.json'])
        self.assertEqual(result['issues'], [])

    def test_hash_matching_and_never_read_report_paths(self):
        report = example_report(); report['source']['log'] = '../../outside-secret'
        self.write(report=report)
        report = deepcopy(report); report['source']['log_sha256'] = '0' * 64; self.write('stale.json', report)
        original = Studies.read
        reads = []
        def tracked(store, parts, *args):
            reads.append(parts)
            return original(store, parts, *args)
        with patch.object(Studies, 'read', tracked), patch('subprocess.Popen', side_effect=AssertionError('no processes')):
            result = self.read()
        self.assertEqual([r['log_matches'] for r in result['reports']], [True, False])
        self.assertTrue(all('outside-secret' not in '/'.join(parts) for parts in reads))

    def test_invalid_fields_nonfinite_and_out_of_range(self):
        changes = [('missing', lambda r: r.pop('amplitude')), ('nan', lambda r: r.update(frequency=float('nan'))),
                   ('infinity', lambda r: r['pairs'][0].update(plus_distance=float('inf'))),
                   ('bool', lambda r: r.update(amplitude=True)), ('zero', lambda r: r.update(amplitude=0)),
                   ('index', lambda r: r['pairs'][0].update(atoms=[1, 4])),
                   ('same', lambda r: r['pairs'][0].update(atoms=[2, 2])),
                   ('rank', lambda r: r['pairs'][0].update(absolute_rate_rank=4)),
                   ('mode', lambda r: r.update(source_mode_index=2)),
                   ('orientation', lambda r: r.update(orientation='unknown')),
                   ('missingpair', lambda r: r['pairs'][0].pop('minus_distance')),
                   ('huge', lambda r: r.update(amplitude=10**400))]
        for name, change in changes:
            report = example_report(); change(report); self.write(name + '.json', report)
        (self.analyses / 'broken.json').write_text('{')
        self.write('good.json')
        result = self.read()
        self.assertEqual(len(result['reports']), 1)
        self.assertEqual(len(result['issues']), len(changes) + 1)
        self.assertEqual(self.client.get(self.uri.replace('mode-reports', 'vibrations')).status_code, 200)

    def test_stale_log_is_not_validated_against_unrelated_geometry(self):
        report = example_report(); report['source']['log_sha256'] = '0' * 64
        report['mode'] = 9; report['source_mode_index'] = 9
        report['pairs'][0]['atoms'] = [1, 14]; report['pairs'][0]['absolute_rate_rank'] = 40
        self.write(report=report)
        result = self.read()
        self.assertFalse(result['reports'][0]['log_matches'])
        self.assertEqual(result['issues'], [])

    def test_unknown_metadata_is_not_returned_or_serialized(self):
        report = example_report(); report['source']['extra'] = float('nan'); report['pairs'][0]['extra'] = float('inf')
        self.write(report=report)
        result = self.read()['reports'][0]['report']
        self.assertNotIn('extra', result['source']); self.assertNotIn('extra', result['pairs'][0])

    def test_symlinks_and_directory_swap_rejected(self):
        outside = self.root / 'outside'; outside.mkdir(); (outside / 'report.json').write_text('PRIVATE')
        (self.analyses / 'link.json').symlink_to(outside / 'report.json')
        (self.analyses / 'linked').symlink_to(outside, target_is_directory=True)
        result = self.read()
        self.assertFalse(result['reports']); self.assertIn('symlink', str(result['issues']))
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.write('group/report.json')
        original = os.open; swapped = False
        def race(path, *args, **kwargs):
            nonlocal swapped
            if path == 'group' and not swapped:
                (self.analyses / 'group').rename(self.study / 'saved-group')
                (self.analyses / 'group').symlink_to(outside, target_is_directory=True); swapped = True
            return original(path, *args, **kwargs)
        with patch('os.open', side_effect=race):
            result = self.read()
        self.assertTrue(result['issues']); self.assertNotIn('PRIVATE', json.dumps(result)); self.assertFalse(result['reports'])

    def test_missing_analyses_immutable_reads_and_no_writes(self):
        self.analyses.rmdir(); self.assertEqual(self.read()['reports'], [])
        self.write()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        self.read()
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})
        for method in ('post', 'put', 'delete'):
            self.assertEqual(getattr(self.client, method)(self.uri).status_code, 405)

    def test_provenance_additions_leave_existing_modes_unchanged(self):
        raw = synthetic_log().encode(); packet = parse_log_modes(raw, 'butane.log')
        self.assertEqual(packet['log_sha256'], sha256(raw).hexdigest())
        self.assertEqual(packet['orientation'], 'standard')
        self.assertEqual(packet['modes'][0]['sorted_mode_index'], 1)
        self.assertEqual(packet['modes'][0]['source_mode_index'], 1)
        from tests.study_fixture import gaussian_log
        unsorted = parse_log_modes(gaussian_log().replace('-42.0 120.0 300.0', '300.0 -42.0 120.0').encode(), 'modes.log')
        self.assertEqual([m['sorted_mode_index'] for m in unsorted['modes']], [3, 1, 2])
        self.assertEqual([m['source_mode_index'] for m in unsorted['modes']], [1, 2, 3])
        self.assertEqual([m['frequency_cm1'] for m in unsorted['modes']], [300., -42., 120.])


if __name__ == '__main__':
    import sys
    if '--browser-data' in sys.argv:
        print(json.dumps(dict(packet=parse_log_modes(synthetic_log().encode(), 'butane.log'), report=example_report())))
    else:
        unittest.main()
