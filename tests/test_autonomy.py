from copy import deepcopy
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from autog_frontend.autonomy import (
    read_autonomy, manual_block, validate_status, JOURNAL_LIMIT, DISPLAY_EVENTS,
)
from autog_frontend.studies import Studies
from tests.autonomy_fixture import NOW, FAKE_TOKEN, create_autonomy, encoded, write_snapshot
from tests.study_fixture import create_studies


class AutonomyReaderTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve() / 'studies'
        self.study = create_studies(self.root)
        self.store = Studies(self.root)

    def read(self):
        return read_autonomy(self.store, 'butane-demo', now=NOW)

    def test_absent_preserves_manual_actions_without_processes(self):
        with patch('subprocess.Popen', side_effect=AssertionError('No subprocess')):
            data = self.read()
        self.assertEqual(data['status'], 'absent')
        self.assertIsNone(manual_block(data))
        self.assertFalse(data['manual_actions_blocked'])

    def test_three_phases_and_wake_gaps_never_end_a_round(self):
        for phase, lease, blocked in [('running', 'active', True), ('running', 'expired', True),
                                      ('running', 'none', True), ('paused', 'active', True),
                                      ('paused', 'expired', False), ('paused', 'none', False),
                                      ('ended', 'none', False)]:
            with self.subTest(phase=phase, lease=lease):
                create_autonomy(self.study, phase, lease=lease, now=NOW)
                data = self.read()
                self.assertEqual(data['status'], 'ok', data)
                self.assertEqual(data['phase'], phase)
                self.assertEqual(data['manual_actions_blocked'], blocked)
                self.assertEqual(data['totals']['attempt'], 1)
                self.assertEqual(data['current_round']['id'], 'round-demo')
                self.assertEqual(data['plans'][0]['spec']['attempt_limit'], 4)
                self.assertEqual(data['verification'], 'saved-files-only')
                self.assertEqual(data['integration'], 'pending-backend-action-boundary')

    def test_only_whitelisted_fields_leave_reader_and_status_adapter(self):
        snapshot = create_autonomy(self.study, now=NOW)
        before = {p: (p.stat().st_mtime_ns, p.read_bytes()) for p in self.study.rglob('*') if p.is_file()}
        with patch('subprocess.Popen', side_effect=AssertionError('No subprocess')):
            read = self.read()
            public = validate_status(snapshot, now=NOW)
        for data in (read, public):
            text = json.dumps(data)
            for forbidden in (FAKE_TOKEN, 'token_sha256', sha256(FAKE_TOKEN.encode()).hexdigest(),
                              'synthetic-session', 'arbitrary_reference', 'not-opened'):
                self.assertNotIn(forbidden, text)
            self.assertIsNone(data['reason'])
        self.assertEqual(before, {p: (p.stat().st_mtime_ns, p.read_bytes()) for p in self.study.rglob('*') if p.is_file()})
        self.assertEqual((read['seq'], read['journal_sha256']), (public['seq'], public['journal_sha256']))
        self.assertEqual(public['verification'], 'ag-status')

    def test_absent_is_distinct_from_incomplete_unsupported_and_corrupt(self):
        folder = self.study / 'autonomy'
        folder.mkdir()
        self.assertEqual(self.read()['status'], 'missing')
        snapshot = create_autonomy(self.study, now=NOW)
        snapshot['state']['schema'] = 'ag-autonomy/999'
        write_snapshot(self.study, snapshot)
        self.assertEqual(self.read()['status'], 'unsupported')
        (folder / 'state.json').write_bytes(b'{')
        self.assertEqual(self.read()['status'], 'invalid')
        self.assertTrue(self.read()['manual_actions_blocked'])

    def test_hash_chain_snapshot_and_immutable_plan_mismatches_fail_closed(self):
        for target in ('journal', 'snapshot', 'plan', 'truncated', 'duplicate-key'):
            with self.subTest(target=target):
                snapshot = create_autonomy(self.study, now=NOW)
                folder = self.study / 'autonomy'
                if target == 'journal':
                    path = folder / 'journal.jsonl'
                    path.write_bytes(path.read_bytes().replace(b'update', b'finish'))
                elif target == 'snapshot':
                    snapshot['journal_sha256'] = '0' * 64
                    write_snapshot(self.study, snapshot)
                elif target == 'plan':
                    (folder / 'plan-plan-demo.json').write_bytes(b'{}\n')
                elif target == 'truncated':
                    path = folder / 'journal.jsonl'
                    path.write_bytes(path.read_bytes()[:-1])
                else:
                    path = folder / 'state.json'
                    path.write_bytes(path.read_bytes().replace(b'"seq":2', b'"seq":2,"seq":2'))
                data = self.read()
                self.assertEqual(data['status'], 'invalid')
                self.assertTrue(data['manual_actions_blocked'])

    def test_symlinks_hardlinks_and_special_files_fail_closed(self):
        snapshot = create_autonomy(self.study, now=NOW)
        folder = self.study / 'autonomy'
        external = self.root.parent / 'untrusted.json'
        external.write_bytes(encoded(snapshot))
        path = folder / 'state.json'
        path.unlink()
        path.symlink_to(external)
        self.assertEqual(self.read()['status'], 'invalid')
        path.unlink()
        os.link(external, path)
        self.assertEqual(self.read()['status'], 'invalid')
        path.unlink()
        os.mkfifo(path)
        self.assertEqual(self.read()['status'], 'invalid')
        path.unlink()
        write_snapshot(self.study, snapshot)
        original = self.study / 'autonomy-saved'
        folder.rename(original)
        folder.symlink_to(original, target_is_directory=True)
        self.assertEqual(self.read()['status'], 'invalid')

    def test_busy_mutex_does_not_wait_or_guess_absence(self):
        create_autonomy(self.study, now=NOW)
        with (self.study / 'autonomy/store.lock').open('rb') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.read()['status'], 'invalid')
        self.assertEqual(self.read()['status'], 'ok')

    def test_long_log_and_string_are_bounded(self):
        snapshot = create_autonomy(self.study, now=NOW)
        with (self.study / 'autonomy/journal.jsonl').open('wb') as handle:
            handle.truncate(JOURNAL_LIMIT + 1)
        self.assertEqual(self.read()['status'], 'invalid')
        snapshot = create_autonomy(self.study, now=NOW)
        snapshot['state']['summary'] = 'x' * 8001
        write_snapshot(self.study, snapshot)
        self.assertEqual(self.read()['status'], 'invalid')

    def test_event_summary_contains_only_bounded_metadata(self):
        snapshot = create_autonomy(self.study, now=NOW)
        path = self.study / 'autonomy/journal.jsonl'
        raw = path.read_bytes()
        previous = snapshot['journal_sha256']
        for seq in range(3, DISPLAY_EVENTS + 6):
            line = encoded(dict(seq=seq, prev_sha256=previous, op='update', at=NOW - 1,
                                data=dict(token=FAKE_TOKEN)))
            previous = sha256(line).hexdigest()
            raw += line
        snapshot.update(seq=DISPLAY_EVENTS + 5, journal_sha256=previous)
        write_snapshot(self.study, snapshot)
        path.write_bytes(raw)
        data = self.read()
        self.assertEqual(data['status'], 'ok')
        self.assertTrue(data['events_truncated'])
        self.assertEqual(len(data['events']), DISPLAY_EVENTS)
        self.assertTrue(all(set(item) == {'seq', 'op', 'at'} for item in data['events']))

    def test_relaxed_inputs_only_reports_explicit_actual_marker(self):
        create_autonomy(self.study, now=NOW)
        path = self.study / 'attempts/anti/manifest.json'
        manifest = json.loads(path.read_text())
        manifest['input_validation'] = dict(mode='relaxed', skipped_checks=['method-route'], method_verified=False)
        path.write_text(json.dumps(manifest))
        data = self.read()
        self.assertEqual(data['relaxed_inputs'], [dict(attempt='anti', mode='relaxed',
                         skipped_checks=['method-route'], method_verified=False)])
        self.assertIsNone(data['relaxed_inputs_warning'])
        manifest['input_validation']['method_verified'] = True
        path.write_text(json.dumps(manifest))
        self.assertEqual(self.read()['relaxed_inputs'], [])
        self.assertIsNotNone(self.read()['relaxed_inputs_warning'])

    def test_absent_input_validation_marker_is_old_compatible_and_immutable(self):
        path = self.study / 'attempts/anti/manifest.json'
        self.assertNotIn('input_validation', json.loads(path.read_text()))
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns)
                  for p in (self.study / 'attempts').rglob('*') if p.is_file()}
        data = self.read()
        self.assertEqual(data['relaxed_inputs'], [])
        self.assertIsNone(data['relaxed_inputs_warning'])
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def test_present_unverifiable_input_markers_warn_instead_of_looking_ordinary(self):
        path = self.study / 'attempts/anti/manifest.json'
        manifest = json.loads(path.read_text())
        valid = dict(mode='relaxed', skipped_checks=['method-route'], method_verified=False)
        variants = [('null-marker', None), ('array-marker', []), ('empty-marker', {})]
        for field, values in (
                ('mode', ['unknown', 'strict', None]),
                ('skipped_checks', [[], None, 'method-route', [''], ['  '], [1], ['method-route', None]]),
                ('method_verified', [True, None, 0, 'false'])):
            for value in values:
                marker = dict(valid, **{field: value})
                variants.append((f'{field}={value!r}', marker))
            marker = dict(valid)
            del marker[field]
            variants.append((f'missing-{field}', marker))
        for name, marker in variants:
            with self.subTest(marker=name):
                manifest['input_validation'] = marker
                path.write_text(json.dumps(manifest))
                before = {p: (p.read_bytes(), p.stat().st_mtime_ns)
                          for p in (self.study / 'attempts').rglob('*') if p.is_file()}
                data = self.read()
                self.assertEqual(data['relaxed_inputs'], [])
                self.assertIn('无法核实', data['relaxed_inputs_warning'])
                self.assertIn('提醒不完整', data['relaxed_inputs_warning'])
                self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def policy(self):
        return dict(templates=['gaussian', 'crest', 'xtb', 'multiwfn'],
                    clusters={'entry-demo': dict(nodes=[], max_committed_cores=24,
                              max_queued_cores=12, max_jobs=3),
                              'named-demo': dict(nodes=['node-demo'], max_committed_cores=24,
                              max_queued_cores=12, max_jobs=3)},
                    max_cores_per_job=12, max_walltime='02:00:00', routing_sha256='b' * 64,
                    allow_relaxed=True,
                    methods={'gaussian': [dict(method='rb3lyp', basis='6-31g(d)',
                              basis_function_type='basis_default', dispersion='method_default',
                              solvent_model='none', solvent='none', integration_grid='ultrafine',
                              opt_convergence='tight', scf_convergence=8)],
                             'crest': [dict(parameters={'--gfn2': '', '--ewin': '6'})],
                             'xtb': [dict(parameters={'--gfn': '2', '--opt': 'tight'})],
                             'multiwfn': [dict(parameters={'--analysis': 'igmh', '--grid': 'medium'})]})

    def save_plan_spec(self, snapshot, **changes):
        plan = snapshot['state']['plans']['plan-demo']
        plan['body']['spec'].update(changes)
        plan['sha256'] = sha256(encoded(plan['body'])).hexdigest()
        plan['confirmation']['sha256'] = plan['sha256']
        (self.study / 'autonomy/plan-plan-demo.json').write_bytes(encoded(plan['body']))
        write_snapshot(self.study, snapshot)

    def test_submission_policy_preserves_every_saved_bound_without_inventing_legacy_defaults(self):
        snapshot = create_autonomy(self.study, now=NOW)
        self.assertNotIn('submission_policy', self.read()['plans'][0]['spec'])
        policy = self.policy()
        self.save_plan_spec(snapshot, submission_policy=policy)
        for data in (self.read(), validate_status(snapshot, now=NOW)):
            self.assertEqual(data['status'], 'ok')
            self.assertEqual(data['plans'][0]['spec']['submission_policy'], policy)
            self.assertEqual(data['plans'][0]['spec']['submission_policy']['clusters']['entry-demo']['nodes'], [])
            self.assertTrue(data['plans'][0]['spec']['submission_policy']['allow_relaxed'])
        self.assertTrue(self.read()['manual_actions_blocked'])

    def test_new_policy_bounds_and_template_parameters_are_unsupported_not_silently_dropped(self):
        for variant in ('policy-field', 'method-field', 'parameter', 'template', 'plan-field'):
            with self.subTest(variant=variant):
                snapshot = create_autonomy(self.study, now=NOW)
                policy = deepcopy(self.policy())
                changes = dict(submission_policy=policy)
                if variant == 'policy-field':
                    policy['new_hard_limit'] = 1
                elif variant == 'method-field':
                    policy['methods']['gaussian'][0]['new_method_limit'] = 'strict'
                elif variant == 'parameter':
                    policy['methods']['crest'][0]['parameters']['--unknown'] = FAKE_TOKEN
                elif variant == 'template':
                    policy['templates'].append('future-template')
                else:
                    changes['future_hard_limit'] = 1
                self.save_plan_spec(snapshot, **changes)
                data = self.read()
                self.assertEqual(data['status'], 'unsupported')
                self.assertTrue(data['manual_actions_blocked'])
                self.assertNotIn(FAKE_TOKEN, json.dumps(data))
                self.assertEqual(validate_status(snapshot, now=NOW)['status'], 'unsupported')

    def test_malformed_policy_does_not_look_like_a_text_only_plan(self):
        for field, value in (('allow_relaxed', 'true'), ('methods', {}), ('max_cores_per_job', True),
                             ('max_walltime', 'invalid'), ('routing_sha256', 'not-a-hash')):
            with self.subTest(field=field):
                snapshot = create_autonomy(self.study, now=NOW)
                policy = self.policy()
                policy[field] = value
                self.save_plan_spec(snapshot, submission_policy=policy)
                self.assertEqual(self.read()['status'], 'invalid')
                self.assertTrue(self.read()['manual_actions_blocked'])

    def test_observe_only_lease_is_shown_without_changing_manual_refusal(self):
        snapshot = create_autonomy(self.study, now=NOW)
        snapshot['state']['lease']['observe_only'] = True
        snapshot['state']['runs']['wake-demo']['observe_only'] = True
        write_snapshot(self.study, snapshot)
        data = self.read()
        self.assertTrue(data['lease']['observe_only'])
        self.assertTrue(data['current_run']['observe_only'])
        self.assertTrue(data['manual_actions_blocked'])

    def test_known_event_reason_and_summary_are_bounded_and_unknown_event_is_unsupported(self):
        snapshot = create_autonomy(self.study, now=NOW)
        path = self.study / 'autonomy/journal.jsonl'
        raw = path.read_bytes()
        previous = snapshot['journal_sha256']
        cases = [('pause', dict(reason='合成暂停原因', token=FAKE_TOKEN, owner=FAKE_TOKEN)),
                 ('start', dict(takeover_reason='合成接管原因', previous_lease={'token': FAKE_TOKEN})),
                 ('update', dict(summary='合成事件摘要', reason=FAKE_TOKEN, objects={'token': FAKE_TOKEN}))]
        for seq, (op, data) in enumerate(cases, 3):
            line = encoded(dict(seq=seq, prev_sha256=previous, op=op, at=NOW - 1, data=data))
            previous = sha256(line).hexdigest()
            raw += line
        snapshot.update(seq=5, journal_sha256=previous)
        path.write_bytes(raw)
        write_snapshot(self.study, snapshot)
        data = self.read()
        self.assertEqual(data['events'][-3:], [dict(seq=3, op='pause', at=NOW-1, reason='合成暂停原因'),
                          dict(seq=4, op='start', at=NOW-1, reason='合成接管原因'),
                          dict(seq=5, op='update', at=NOW-1, summary='合成事件摘要')])
        self.assertNotIn(FAKE_TOKEN, json.dumps(data))
        line = encoded(dict(seq=6, prev_sha256=previous, op='future-action', at=NOW - 1, data={}))
        snapshot.update(seq=6, journal_sha256=sha256(line).hexdigest())
        path.write_bytes(raw + line)
        write_snapshot(self.study, snapshot)
        self.assertEqual(self.read()['status'], 'unsupported')
        self.assertTrue(self.read()['manual_actions_blocked'])
        line = encoded(dict(seq=6, prev_sha256=previous, op='pause', at=NOW - 1, data={'reason': 'x' * 8001}))
        snapshot.update(seq=6, journal_sha256=sha256(line).hexdigest())
        path.write_bytes(raw + line)
        write_snapshot(self.study, snapshot)
        self.assertEqual(self.read()['status'], 'invalid')

    def add_snapshot_event(self, snapshot, index=0):
        path = self.study / 'autonomy/journal.jsonl'
        seq = snapshot['seq'] + 1
        reference = f'snapshots/20261029T1200{index:02d}000000Z'
        record = dict(binding=dict(study_id='butane-demo', attempt_id='anti',
                                   cluster='private-entry-omitted', scheduler='pbs', job_id='private-job-omitted',
                                   manifest_sha256='b' * 64, submission_sha256='c' * 64),
                      run_id='wake-demo', round_id='round-demo', snapshot=reference,
                      captured_at=NOW - 1, capture_started_at=NOW - 3, capture_finished_at=NOW - 1,
                      capture_started_seq=1, plan_sha256='d' * 64,
                      snapshot_sha256='e' * 64, log_sha256='f' * 64,
                      token_sha256=sha256(FAKE_TOKEN.encode()).hexdigest(), token=FAKE_TOKEN,
                      versions={'private': FAKE_TOKEN}, raw_details={'private': FAKE_TOKEN})
        line = encoded(dict(seq=seq, prev_sha256=snapshot['journal_sha256'], op='snapshot',
                            at=NOW - 1, data=record))
        path.write_bytes(path.read_bytes() + line)
        snapshot.update(seq=seq, journal_sha256=sha256(line).hexdigest())
        # Store mirrors the observation metadata; the viewer still whitelists
        # fields even if a damaged/forward record contains private additions.
        saved = deepcopy(record)
        saved['seq'] = seq
        snapshot['state'].setdefault('snapshots', {})['anti/' + reference] = saved
        write_snapshot(self.study, snapshot)
        return record

    def test_snapshot_event_and_saved_mapping_have_only_safe_provenance(self):
        snapshot = create_autonomy(self.study, now=NOW)
        self.assertNotIn('snapshots', self.read())
        record = self.add_snapshot_event(snapshot)
        safe = dict(attempt='anti', run_id='wake-demo', round_id='round-demo',
                    snapshot=record['snapshot'], captured_at=NOW - 1,
                    snapshot_sha256='e' * 64, log_sha256='f' * 64)
        with patch('subprocess.Popen', side_effect=AssertionError('No subprocess')):
            data = self.read()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['events'][-1], dict(seq=3, op='snapshot', at=NOW-1, snapshot=safe))
        self.assertEqual(data['snapshots'], [dict(safe, seq=3)])
        self.assertFalse(data['snapshots_truncated'])
        self.assertEqual(validate_status(encoded(snapshot), now=NOW)['snapshots'], [dict(safe, seq=3)])
        self.assertFalse((self.study / 'attempts/anti/snapshots').exists())
        for forbidden in (FAKE_TOKEN, 'token_sha256', sha256(FAKE_TOKEN.encode()).hexdigest(),
                          'private-entry-omitted', 'private-job-omitted', 'raw_details', 'versions'):
            # Plans legitimately contain versions; observation projection does not.
            text = json.dumps(dict(events=data['events'], snapshots=data['snapshots']))
            self.assertNotIn(forbidden, text)

    def test_registered_snapshot_display_is_bounded_and_references_never_followed(self):
        snapshot = create_autonomy(self.study, now=NOW)
        for index in range(DISPLAY_EVENTS + 1):
            self.add_snapshot_event(snapshot, index)
        data = self.read()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(len(data['snapshots']), DISPLAY_EVENTS)
        self.assertTrue(data['snapshots_truncated'])
        self.assertEqual(data['snapshots'][0]['seq'], 4)
        # A saved arbitrary path must neither be opened nor presented as a
        # formal capture. No file at this path is necessary for the test.
        row = next(iter(snapshot['state']['snapshots'].values()))
        row['snapshot'] = '../outside/private.json'
        write_snapshot(self.study, snapshot)
        self.assertEqual(self.read()['status'], 'invalid')

    def test_status_raw_json_rejects_duplicates_invalid_encoding_and_nonfinite_values(self):
        snapshot = create_autonomy(self.study, now=NOW)
        raw = encoded(snapshot)
        for payload in (raw, raw.decode('utf-8')):
            self.assertEqual(validate_status(payload, now=NOW)['status'], 'ok')
        bad_values = [raw.replace(b'"seq":2', b'"seq":2,"seq":2'),
                      b'{"ignored":"\xff",' + raw[1:], raw.decode('utf-8').encode('utf-16'),
                      b'{"ignored":NaN,' + raw[1:], b'{}' * (2 * 1024 * 1024 + 1)]
        for payload in bad_values:
            with self.subTest(prefix=repr(payload[:30])):
                self.assertEqual(validate_status(payload, now=NOW)['status'], 'invalid')
        snapshot['state']['summary'] = '\ud800'
        self.assertEqual(validate_status(json.dumps(snapshot).encode(), now=NOW)['status'], 'invalid')

    def test_backend_status_malformed_unknown_and_clock_reversal_refuse(self):
        for value in (None, {}, {'state': []}):
            self.assertEqual(validate_status(value, now=NOW)['status'], 'invalid')
        snapshot = create_autonomy(self.study, now=NOW)
        snapshot['state']['phase'] = 'unknown'
        self.assertEqual(validate_status(snapshot, now=NOW)['status'], 'invalid')
        snapshot = create_autonomy(self.study, now=NOW)
        self.assertEqual(validate_status(snapshot, now=NOW - 2)['status'], 'invalid')


if __name__ == '__main__':
    unittest.main()
