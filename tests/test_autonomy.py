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

    def submission_record(self, snapshot, index=0, **changes):
        record = dict(attempt_id=f'attempt-{index}', object_id=f'object-{index}',
                      failure_class=None, ownership_sha256=f'{index + 10:064x}',
                      round_id='round-demo', run_id='wake-demo',
                      plan_sha256=snapshot['state']['plans']['plan-demo']['sha256'],
                      rule_sha256='b' * 64, max_attempts=10, plan_id='plan-demo', at=NOW - 20,
                      owner_token_sha256=sha256(FAKE_TOKEN.encode()).hexdigest(),
                      dispatch_started=None, aborted_before_dispatch=None)
        record.update(changes)
        return record

    def submission_identity(self, record):
        fields = ('attempt_id', 'object_id', 'failure_class', 'ownership_sha256',
                  'round_id', 'run_id', 'plan_sha256', 'rule_sha256', 'max_attempts')
        return {key: record[key] for key in fields}

    def waiting_record(self, snapshot, index=0):
        return dict(object_id=f'object-{index}', record_sha256=f'{index + 100:064x}',
                    round_id='round-demo', run_id='wake-demo',
                    plan_sha256=snapshot['state']['plans']['plan-demo']['sha256'],
                    plan_id='plan-demo', at=NOW - 10)

    def append_event(self, snapshot, op, data):
        path = self.study / 'autonomy/journal.jsonl'
        seq = snapshot['seq'] + 1
        line = encoded(dict(seq=seq, prev_sha256=snapshot['journal_sha256'], op=op,
                            at=NOW - 1, data=data))
        path.write_bytes(path.read_bytes() + line)
        snapshot.update(seq=seq, journal_sha256=sha256(line).hexdigest())
        write_snapshot(self.study, snapshot)

    def new_submission_events(self, snapshot):
        record = self.submission_record(snapshot)
        private = dict(token_sha256=record['owner_token_sha256'],
                       versions=deepcopy(snapshot['state']['plans']['plan-demo']['body']['versions']))
        reference = {key: record[key] for key in (
            'attempt_id', 'ownership_sha256', 'round_id', 'run_id', 'plan_sha256')}
        waiting = self.waiting_record(snapshot)
        previous = dict(run_id='wake-demo', round_id='round-demo', owner=FAKE_TOKEN,
                        token_sha256=record['owner_token_sha256'], started_at=NOW - 6000,
                        run_until=NOW - 2400, expires_at=NOW - 600, observe_only=True)
        return [
            ('submission_consume', dict(record=self.submission_identity(record), **private)),
            ('submission_dispatch', dict(reference, **private)),
            ('submission_abort', dict(reference, reason='合成派发前停止', **private)),
            ('submission_boundary_failure', dict(attempt_id=record['attempt_id'],
                ownership_sha256=record['ownership_sha256'], run_id=record['run_id'],
                token_sha256=private['token_sha256'], dispatched=False, reason='合成迟到失败')),
            ('waiting', dict({key: waiting[key] for key in (
                'object_id', 'record_sha256', 'round_id', 'run_id', 'plan_sha256')}, **private)),
            ('manual_takeover', dict(previous_lease=previous, writer_id='1234567890abcdef' * 2,
                study_key='f0' * 32, reason='合成过期接管')),
        ]

    def test_missing_consumption_is_unknown_and_explicit_empty_is_saved_zero(self):
        snapshot = create_autonomy(self.study, now=NOW)
        for data in (self.read(), validate_status(snapshot, now=NOW)):
            for key in ('submissions', 'submissions_count', 'current_round_submission_count',
                        'submissions_truncated', 'submission_pause', 'waiting', 'waiting_count',
                        'waiting_truncated'):
                self.assertNotIn(key, data)
        snapshot['state'].update(submissions={}, waiting=[])
        write_snapshot(self.study, snapshot)
        for data in (self.read(), validate_status(snapshot, now=NOW)):
            self.assertEqual(data['submissions'], [])
            self.assertEqual(data['submissions_count'], 0)
            self.assertEqual(data['current_round_submission_count'], 0)
            self.assertFalse(data['submissions_truncated'])
            self.assertEqual(data['waiting'], [])
            self.assertEqual(data['waiting_count'], 0)
            self.assertFalse(data['waiting_truncated'])
            self.assertNotIn('submission_pause', data)
            self.assertNotIn('submission_counts_verified', data)
            self.assertTrue(data['manual_actions_blocked'])
        snapshot = create_autonomy(self.study, 'ended', lease='none', now=NOW)
        snapshot['state'].update(current_round=None, current_plan=None, submissions={})
        write_snapshot(self.study, snapshot)
        self.assertIsNone(self.read()['current_round_submission_count'])

    def test_consumption_abort_pause_and_late_failure_are_saved_evidence_only(self):
        snapshot = create_autonomy(self.study, 'paused', lease='none', now=NOW)
        aborted = self.submission_record(snapshot, aborted_before_dispatch=dict(at=NOW - 12, reason='先前停止'),
            boundary_failure=dict(at=NOW - 2, dispatched=False, reason='后来核验失败'))
        dispatched = self.submission_record(snapshot, 1, dispatch_started=dict(at=NOW - 10),
            boundary_failure=dict(at=NOW - 1, dispatched=True, reason='响应未明'))
        old = self.submission_record(snapshot, 2, round_id='round-old', run_id='wake-old')
        snapshot['state']['rounds']['round-old'] = dict(started_at=NOW - 100, ended_at=NOW - 30,
            plan_ids=['plan-demo'], totals=dict(attempt=1, remedy=0, cancel=0, reroute=0))
        snapshot['state']['runs']['wake-old'] = dict(round_id='round-old', plan_id='plan-demo',
            started_at=NOW - 90, ended_at=NOW - 30, outcome='finished', totals=snapshot['state']['totals'])
        old.update(at=NOW - 50, boundary_failure=dict(at=NOW - 1, dispatched=False, reason='旧轮次迟到失败'),
                   aborted_before_dispatch=dict(at=NOW - 1, reason='旧轮次迟到失败'))
        snapshot['state'].update(submissions={row['attempt_id']: row for row in (aborted, dispatched, old)},
            waiting=[self.waiting_record(snapshot)],
            submission_pause=dict(at=NOW - 20, attempt_id=aborted['attempt_id'], round_id='round-demo',
                                  reason='Actual round submission count reached 90%'))
        write_snapshot(self.study, snapshot)
        public = deepcopy(snapshot)
        for record in public['state']['submissions'].values():
            del record['owner_token_sha256']
        public.update(submission_counts_verified=False, integration='not authority')
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        with patch('subprocess.Popen', side_effect=AssertionError('No subprocess')):
            saved = self.read()
            checked = validate_status(encoded(public), now=NOW)
        for data, verification in ((saved, 'saved-files-only'), (checked, 'ag-status')):
            self.assertEqual(data['status'], 'ok', data)
            self.assertEqual(data['verification'], verification)
            self.assertEqual(data['integration'], 'pending-backend-action-boundary')
            self.assertEqual(data['submissions_count'], 3)
            self.assertEqual(data['current_round_submission_count'], 2)
            self.assertEqual(data['totals']['attempt'], 1)  # Historical intent count stays separate.
            self.assertEqual(data['submission_pause'], snapshot['state']['submission_pause'])
            self.assertIsNone(manual_block(data))  # Final writer exclusion stays in ag.
            rows = {row['attempt_id']: row for row in data['submissions']}
            self.assertEqual(rows['attempt-0']['aborted_before_dispatch']['reason'], '先前停止')
            self.assertEqual(rows['attempt-0']['boundary_failure']['reason'], '后来核验失败')
            self.assertEqual(rows['attempt-2']['round_id'], 'round-old')
            for forbidden in (FAKE_TOKEN, 'owner_token_sha256', 'token_sha256',
                              sha256(FAKE_TOKEN.encode()).hexdigest(), 'submission_counts_verified',
                              'remaining_capacity', 'remaining_attempts'):
                self.assertNotIn(forbidden, json.dumps(data))
        for field in ('submissions', 'submissions_count', 'current_round_submission_count',
                      'submission_pause', 'waiting'):
            self.assertEqual(saved[field], checked[field])
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def test_consumption_and_waiting_rows_are_bounded_but_count_and_validate_all(self):
        snapshot = create_autonomy(self.study, now=NOW)
        records = [self.submission_record(snapshot, index) for index in range(DISPLAY_EVENTS + 3)]
        snapshot['state'].update(submissions={row['attempt_id']: row for row in records},
            waiting=[self.waiting_record(snapshot, index) for index in range(DISPLAY_EVENTS + 3)])
        write_snapshot(self.study, snapshot)
        data = self.read()
        self.assertEqual(data['status'], 'ok')
        for field in ('submissions', 'waiting'):
            self.assertEqual(len(data[field]), DISPLAY_EVENTS)
            self.assertEqual(data[field + '_count'], DISPLAY_EVENTS + 3)
            self.assertTrue(data[field + '_truncated'])
        self.assertEqual(data['current_round_submission_count'], DISPLAY_EVENTS + 3)
        # Validation covers rows outside the displayed tail too.
        self.assertNotIn('object-0', [row['object_id'] for row in data['waiting']])
        snapshot['state']['waiting'][0]['record_sha256'] = 'bad'
        write_snapshot(self.study, snapshot)
        self.assertEqual(self.read()['status'], 'invalid')
        snapshot['state']['waiting'][0]['record_sha256'] = 'c' * 64
        snapshot['state']['submissions']['attempt-0']['owner_token_sha256'] = 'bad'
        self.assertEqual(validate_status(snapshot, now=NOW)['status'], 'invalid')
        snapshot['state']['submissions'] = {}
        snapshot['state']['waiting'] = [self.waiting_record(snapshot)] * 10001
        self.assertEqual(validate_status(snapshot, now=NOW)['status'], 'invalid')

    def test_contradictory_saved_submission_outcomes_fail_closed(self):
        dispatch = dict(at=NOW - 10)
        abort = dict(at=NOW - 10, reason='合成停止')
        failure = dict(at=NOW - 1, dispatched=False, reason='合成迟到失败')
        for outcomes in (
                dict(dispatch_started=dispatch, aborted_before_dispatch=abort),
                dict(dispatch_started=dispatch, boundary_failure=failure),
                dict(aborted_before_dispatch=abort, boundary_failure=dict(failure, dispatched=True)),
                dict(boundary_failure=dict(failure, dispatched=True)),
                dict(boundary_failure=failure)):
            with self.subTest(outcomes=outcomes):
                snapshot = create_autonomy(self.study, 'paused', lease='none', now=NOW)
                record = self.submission_record(snapshot, **outcomes)
                snapshot['state']['submissions'] = {record['attempt_id']: record}
                write_snapshot(self.study, snapshot)
                for data in (self.read(), validate_status(snapshot, now=NOW)):
                    self.assertEqual(data['status'], 'invalid', data)
                    self.assertTrue(data['manual_actions_blocked'])

    def test_malformed_new_saved_records_fail_closed_and_never_echo_unknown_fields(self):
        variants = []
        for field, values in (
                ('max_attempts', [0, True, None]), ('failure_class', ['', ' spaced ']),
                ('owner_token_sha256', [None, 'bad']), ('at', [NOW + 1]),
                ('dispatch_started', [{}, {'at': NOW + 1}]),
                ('aborted_before_dispatch', [{'at': NOW - 10, 'reason': ''}]),
                ('boundary_failure', [None, {'at': NOW - 10, 'dispatched': 0, 'reason': 'failure'}])):
            for value in values:
                variants.append(('record', field, value, 'invalid'))
        variants.extend([
            ('record', 'raw_secret', FAKE_TOKEN, 'unsupported'),
            ('record', 'missing:max_attempts', None, 'invalid'),
            ('state', 'submissions', None, 'invalid'), ('state', 'submissions', [], 'invalid'),
            ('state', 'submissions', {'attempt-0': None}, 'invalid'),
            ('state', 'submission_pause', None, 'invalid'),
            ('state', 'submission_pause', {'at': NOW - 1, 'attempt_id': 'attempt-0',
                'round_id': 'round-demo', 'reason': 'saved', 'token': FAKE_TOKEN}, 'unsupported'),
            ('state', 'waiting', None, 'invalid'), ('state', 'waiting', {}, 'invalid'),
            ('waiting', 'raw_secret', FAKE_TOKEN, 'unsupported'),
            ('waiting', 'missing:record_sha256', None, 'invalid'),
            ('waiting', 'at', NOW + 1, 'invalid'),
        ])
        for target, field, value, status in variants:
            with self.subTest(target=target, field=field, value=value):
                snapshot = create_autonomy(self.study, 'paused', lease='none', now=NOW)
                record = self.submission_record(snapshot)
                waiting = self.waiting_record(snapshot)
                snapshot['state'].update(submissions={record['attempt_id']: record}, waiting=[waiting])
                dest = {'record': record, 'waiting': waiting, 'state': snapshot['state']}[target]
                if field.startswith('missing:'):
                    del dest[field.split(':', 1)[1]]
                else:
                    dest[field] = value
                write_snapshot(self.study, snapshot)
                for data in (self.read(), validate_status(snapshot, now=NOW)):
                    self.assertEqual(data['status'], status, data)
                    self.assertTrue(data['manual_actions_blocked'])
                    self.assertNotIn(FAKE_TOKEN, json.dumps(data))
                    self.assertNotIn('raw_secret', json.dumps(data))

    def test_new_event_projection_preserves_only_safe_identity_and_saved_reason(self):
        snapshot = create_autonomy(self.study, 'paused', lease='none', now=NOW)
        events = self.new_submission_events(snapshot)
        for op, payload in events:
            self.append_event(snapshot, op, payload)
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        with patch('subprocess.Popen', side_effect=AssertionError('No subprocess')):
            data = self.read()
        self.assertEqual(data['status'], 'ok', data)
        projected = data['events'][-6:]
        expected = [dict(submission=events[0][1]['record']),
                    dict(attempt_id='attempt-0', round_id='round-demo', run_id='wake-demo'),
                    dict(attempt_id='attempt-0', round_id='round-demo', run_id='wake-demo', reason='合成派发前停止'),
                    dict(attempt_id='attempt-0', run_id='wake-demo', dispatched=False, reason='合成迟到失败'),
                    dict(object_id='object-0', round_id='round-demo', run_id='wake-demo', record_sha256=f'{100:064x}'),
                    dict(reason='合成过期接管')]
        for seq, (row, (op, _), safe) in enumerate(zip(projected, events, expected), 3):
            self.assertEqual(row, dict(seq=seq, op=op, at=NOW - 1, **safe))
        self.assertEqual(data['phase'], 'paused')
        self.assertIsNone(data['lease'])
        self.assertIsNone(manual_block(data))
        text = json.dumps(projected)
        for forbidden in (FAKE_TOKEN, sha256(FAKE_TOKEN.encode()).hexdigest(), 'token_sha256',
                          'versions', 'writer_id', 'study_key', 'previous_lease',
                          '1234567890abcdef' * 2, 'f0' * 32):
            self.assertNotIn(forbidden, text)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def test_raw_submission_events_require_private_evidence_and_known_exact_fields(self):
        seed = create_autonomy(self.study, now=NOW)
        cases = []
        for op, source in self.new_submission_events(seed):
            unknown = deepcopy(source)
            unknown['future_constraint'] = FAKE_TOKEN
            cases.append((op, unknown, 'unsupported'))
            if op == 'manual_takeover':
                missing = deepcopy(source)
                del missing['previous_lease']['token_sha256']
                cases.append((op, missing, 'invalid'))
                bad = deepcopy(source)
                bad['previous_lease']['token_sha256'] = None
                cases.append((op, bad, 'invalid'))
                continue
            for field in ('token_sha256', 'versions'):
                if field in source:
                    missing = deepcopy(source)
                    del missing[field]
                    cases.append((op, missing, 'invalid'))
                    bad = deepcopy(source)
                    bad[field] = None
                    cases.append((op, bad, 'invalid'))
            if op == 'submission_boundary_failure':
                extra = deepcopy(source)
                extra['versions'] = seed['state']['plans']['plan-demo']['body']['versions']
                cases.append((op, extra, 'unsupported'))
        for op, payload, expected in cases:
            with self.subTest(op=op, fields=list(payload), expected=expected):
                snapshot = create_autonomy(self.study, 'paused', lease='none', now=NOW)
                self.append_event(snapshot, op, payload)
                data = self.read()
                self.assertEqual(data['status'], expected, data)
                self.assertTrue(data['manual_actions_blocked'])
                self.assertNotIn(FAKE_TOKEN, json.dumps(data))
                self.assertNotIn('future_constraint', json.dumps(data))

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
