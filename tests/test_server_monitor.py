"""T115 additive monitor validation with invented scheduler data only."""
import copy
import unittest
from autog_frontend.monitor import validate_monitor
from tests.results_fixture import monitor_snapshot


def enriched_snapshot():
    data = monitor_snapshot()
    data.update(interval_seconds=30, sample_duration_ms=120)
    job = dict(data['own']['jobs'][0], user='userA', mine=True,
               cores_kind='allocated', mem_gb=12.5, elapsed_seconds=192,
               elapsed_source='walltime_used', walltime_limit_seconds=3600,
               start_time=None, qtime='2026-01-01T00:00:00Z')
    data['own'].update(jobs=[job], mem_running_gb=12.5, mem_queued_gb=None)
    data['cluster'].update(
        jobs=[job], jobs_omitted=12, display_order=-1,
        hardware=dict(cores_total=44, cores_allocated=8, cores_idle=36,
                      cores_other=0, mem_total_gb=64, mem_allocated_gb=12.5,
                      source='pbsnodes', error=None),
        job_summary=dict(running_jobs=1, running_cores=8, queued_jobs=0, queued_cores=0,
                         others_running_jobs=0, others_running_cores=0,
                         others_queued_jobs=0, others_queued_cores=None),
        storage_checked_at='2026-01-01T00:00:00Z', storage_sampled_at=None,
        storage_error='Synthetic storage failure')
    data['cluster']['nodes'][0].update(mem_total_gb=64, mem_assigned_gb=12.5, jobs=1)
    return data


class ServerMonitorTests(unittest.TestCase):
    def test_t143_optional_tiers_and_walltime_are_additive_and_strict(self):
        for names in (('mini', 'simple', 'general', 'complex'),
                      ('mini', 'simple', 'general', 'complex', 'max'),
                      ('mini', 'simple', 'general', 'complex', 'max', 'ultra')):
            data = enriched_snapshot()
            data['own']['tiers'] = {name: dict(cores=i + 1, mem_gb=(i + 1) * 4)
                                    for i, name in enumerate(names)}
            self.assertIs(validate_monitor(data), data)
            self.assertNotIn('max_walltime', data['own'])
            for value in ('00:00:01', '24:00:00', '36:30:15', '1234:00:00', '9999:59:59'):
                data['own']['max_walltime'] = value
                self.assertIs(validate_monitor(data), data)
        for value in (None, True, False, 0, 3600, 1.5, '', '00:00:00', '0000:00:00',
                      '1:00:00', '12345:00:00', '24:60:00', '24:00:60', '-24:00:00',
                      '24:00:00\n', ' 24:00:00', '２４:00:00'):
            with self.subTest(value=value):
                data = enriched_snapshot(); data['own']['max_walltime'] = value
                with self.assertRaisesRegex(ValueError, '快照格式不正确'):
                    validate_monitor(data)

    def test_new_legacy_missing_null_and_unknown_fields(self):
        for data in (monitor_snapshot(), enriched_snapshot()):
            self.assertIs(validate_monitor(data), data)
        data = enriched_snapshot()
        data['future_field'] = {'ignored': True}
        data['cluster']['hardware'] = None
        data['cluster']['job_summary'] = None
        data['cluster']['display_order'] = None
        data['sample_duration_ms'] = None
        self.assertIs(validate_monitor(data), data)
        for interval in (30, 59, 60, 600, None):
            data['interval_seconds'] = interval
            self.assertIs(validate_monitor(data), data)
        data = enriched_snapshot()
        for key in ('mem_gb', 'elapsed_seconds', 'elapsed_source', 'walltime_limit_seconds', 'start_time', 'qtime'):
            data['cluster']['jobs'][0].pop(key, None)
        self.assertIs(validate_monitor(data), data)

    def test_new_fields_reject_wrong_types_and_ranges(self):
        invalid = [
            (('interval_seconds',), 29), (('interval_seconds',), True),
            (('sample_duration_ms',), -1), (('sample_duration_ms',), 1.5),
            (('cluster', 'display_order'), True), (('cluster', 'display_order'), 1.5),
            (('cluster', 'jobs_omitted'), -1), (('cluster', 'jobs'), [None]),
            (('cluster', 'storage_checked_at'), 'yesterday'),
            (('cluster', 'storage_sampled_at'), '2026-01-01'),
            (('cluster', 'storage_error'), 7),
            (('cluster', 'job_summary_error'), 7),
            (('cluster', 'job_summary_error'), False),
        ]
        for group in ('own', 'cluster'):
            for field, bad in [('cores_kind', 'estimated'), ('cores_kind', None),
                               ('user', 1), ('mine', 1), ('mem_gb', '12'),
                               ('mem_source', 'guessed'), ('mem_source', 1),
                               ('mem_gb', -1), ('mem_gb', float('inf')), ('mem_gb', True),
                               ('elapsed_seconds', -1), ('walltime_limit_seconds', 1.5),
                               ('elapsed_source', 'guess'), ('start_time', 'bad'),
                               ('qtime', '2026-02-30T01:00:00Z')]:
                invalid.append(((group, 'jobs', 0, field), bad))
        for field in ('mem_running_gb', 'mem_queued_gb'):
            invalid.append((('own', field), '1'))
        for field in ('mem_total_gb', 'mem_assigned_gb', 'jobs'):
            invalid.append((('cluster', 'nodes', 0, field), -1))
        for field in enriched_snapshot()['cluster']['job_summary']:
            invalid.append((('cluster', 'job_summary', field), -1))
        for field in ('cores_total', 'cores_allocated', 'cores_idle', 'cores_other'):
            invalid.append((('cluster', 'hardware', field), 1.5))
        for field in ('mem_total_gb', 'mem_allocated_gb'):
            invalid.append((('cluster', 'hardware', field), '1'))
        invalid += [(('cluster', 'hardware', 'source'), 'guess'),
                    (('cluster', 'hardware', 'error'), False)]
        for path, bad in invalid:
            with self.subTest(path=path, bad=bad):
                data = copy.deepcopy(enriched_snapshot())
                target = data
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = bad
                with self.assertRaisesRegex(ValueError, '快照格式不正确'):
                    validate_monitor(data)

    def test_t123_optional_sources_and_partial_failure_remain_compatible(self):
        for source in ('scheduler', 'manifest', None):
            data = enriched_snapshot()
            data['cluster']['job_summary_error'] = 'Synthetic partition sampling failure'
            data['cluster']['job_summary'] = None
            for group in ('own', 'cluster'):
                data[group]['jobs'][0]['mem_source'] = source
            self.assertIs(validate_monitor(data), data)
            self.assertTrue(data['ok'])
        data['cluster']['job_summary_error'] = None
        self.assertIs(validate_monitor(data), data)

    def test_legacy_start_time_remains_compatible(self):
        data = monitor_snapshot()
        data['own']['jobs'][0]['start_time'] = 'Thu Jan 1 00:00:00 2026'
        self.assertIs(validate_monitor(data), data)

    def test_t128_sampling_and_notes(self):
        sample = dict(state='normal', consecutive_failures=0, current_interval_seconds=30,
                      next_sample_at='2026-10-25T03:00:00Z', pause_reason=None,
                      trigger='scheduled', retry_pending=False)
        for state, reason in [('normal', None), ('backoff', None), ('paused', 'auth'), ('paused', 'host_key')]:
            for trigger in ('scheduled', 'manual', 'manual_auth_fixed'):
                data = enriched_snapshot()
                data['sampling'] = dict(sample, state=state, pause_reason=reason, trigger=trigger)
                data['cluster']['hardware']['notes'] = ['合成内存局限说明']
                self.assertIs(validate_monitor(data), data)
        for interval in (None, 30, 600):
            data['sampling'].update(current_interval_seconds=interval, next_sample_at=None)
            self.assertIs(validate_monitor(data), data)
        invalid = [('state', 'retry'), ('consecutive_failures', -1), ('consecutive_failures', True),
                   ('consecutive_failures', 1.5), ('current_interval_seconds', 29),
                   ('current_interval_seconds', 601), ('current_interval_seconds', True),
                   ('current_interval_seconds', 30.5), ('next_sample_at', '2026-10-25'),
                   ('next_sample_at', '2026-10-25T03:00:00+08:00'), ('next_sample_at', 1),
                   ('pause_reason', 'other'), ('pause_reason', 'auth'),
                   ('trigger', None), ('trigger', 'other'), ('retry_pending', 1)]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                data = enriched_snapshot(); data['sampling'] = dict(sample, **{key:value})
                with self.assertRaisesRegex(ValueError, '快照格式不正确'): validate_monitor(data)
        for bad in (None, [], 'normal'):
            data = enriched_snapshot(); data['sampling'] = bad
            with self.assertRaisesRegex(ValueError, '快照格式不正确'): validate_monitor(data)
        for bad in (None, 'note', [1], [None], {}):
            data = enriched_snapshot(); data['cluster']['hardware']['notes'] = bad
            with self.assertRaisesRegex(ValueError, '快照格式不正确'): validate_monitor(data)
        for key in sample:
            data = enriched_snapshot(); data['sampling'] = dict(sample); del data['sampling'][key]
            with self.assertRaisesRegex(ValueError, '快照格式不正确'): validate_monitor(data)


class RetryControlTests(unittest.TestCase):
    """Read-only, synthetic control files; no ag process or real study access."""
    def setUp(self):
        import tempfile
        from pathlib import Path
        from autog_frontend.studies import Studies
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.store = Studies(self.root)
        self.cache = self.root / '.ag-monitor'
        self.cache.mkdir()

    def write(self, path, data):
        import json
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def marker(self, source='named', **extra):
        from datetime import datetime, timezone
        value = dict(pid=1, heartbeat_at=datetime.now(timezone.utc).isoformat(),
                     retry_tracking_version=1, entries={'default': dict(source=source, pause_reason=None)})
        value.update(extra)
        self.write(self.cache/'watch.json', value)
        return value

    @staticmethod
    def status(**extra):
        value = dict(version=1, entry='default', request_id='a'*32,
                     requested_at='2026-01-01T00:00:00Z', state='queued', reason=None,
                     finished_at=None, sampled_at=None, ok=None)
        return value | extra

    def test_states_without_snapshot_and_removed_terminal(self):
        from autog_frontend.monitor import validate_retry_status
        for source in ('legacy', 'named'):
            with self.subTest(source=source):
                self.marker(source)
                target = self.cache if source == 'legacy' else self.cache/'default'
                for state in ('queued', 'running', 'finished', 'discarded'):
                    status = self.status(state=state)
                    if state in ('finished', 'discarded'):
                        status['finished_at'] = '2026-01-01T00:00:02Z'
                        if state == 'finished':
                            status.update(sampled_at='2026-01-01T00:00:01Z', ok=False)
                        else:
                            status['reason'] = 'entry_removed'
                    self.write(target/'retry-status.json', status | dict(future='ignored'))
                    row = next(r for r in self.store.monitors()['clusters'] if r['source']==source)
                    self.assertIsNone(row['snapshot'])
                    self.assertEqual(row['retry_status'], status)
                    if source == 'legacy':
                        self.assertTrue(row['retry_tracking_supported'])
                self.marker(source, entries={})
                row = next(r for r in self.store.monitors()['clusters'] if r['source']==source)
                self.assertEqual(row['retry_status']['reason'], 'entry_removed')
                self.assertFalse(row['retry_tracking_supported'])
        for reason in ('auth_confirmation_required', 'entry_removed', 'config_changed', 'monitor_restarted'):
            value = self.status(state='discarded', reason=reason, finished_at='2026-01-01T00:00:02Z')
            self.assertEqual(validate_retry_status(value, 'default'), value)

    def test_capability_requires_fresh_exact_unique_source(self):
        from datetime import datetime, timedelta, timezone
        self.marker('legacy')
        row = self.store.monitors(('default',))['clusters'][0]
        self.assertEqual(row['source'], 'legacy'); self.assertTrue(row['retry_tracking_supported'])
        # An exited watcher can leave a fresh capability marker. Liveness is
        # checked by ag, not inferred by the frontend from process metadata.
        self.marker('legacy', pid=None)
        self.assertTrue(self.store.monitors()['clusters'][0]['retry_tracking_supported'])
        self.write(self.cache/'default/latest.json', monitor_snapshot())
        rows = self.store.monitors()['clusters']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['ambiguous'] and not r['retry_tracking_supported'] for r in rows))
        self.assertTrue(all(r['retry_status_error'] for r in rows))
        for extra in (dict(retry_tracking_version=True), dict(retry_tracking_version=2),
                      dict(heartbeat_at=(datetime.now(timezone.utc)-timedelta(seconds=91)).isoformat()),
                      dict(heartbeat_at=(datetime.now(timezone.utc)+timedelta(seconds=91)).isoformat()),
                      dict(entries={'default': dict(source='../escape')}), dict(entries=[])):
            with self.subTest(extra=extra):
                self.marker(**extra)
                rows = self.store.monitors()['clusters']
                self.assertTrue(all(not r['retry_tracking_supported'] for r in rows))
                self.assertTrue(all(r['retry_status_error'] for r in rows))
                self.assertIsNotNone(next(r for r in rows if r['source']=='named')['snapshot'])
        self.marker(retry_tracking_version=None)
        self.assertTrue(self.store.monitors()['clusters'][0]['retry_status_error'])
        self.write(self.cache/'watch.json', dict(pid=1, entries={}))
        self.assertFalse(self.store.monitors()['clusters'][0]['retry_tracking_supported'])

    def test_strict_known_fields_unknown_keys_and_no_snapshot_contamination(self):
        from autog_frontend.monitor import validate_retry_status
        good = self.status()
        invalid = [[], {}, dict(good, version=True), dict(good, version=2), dict(good, entry='batch'),
                   dict(good, request_id='A'*32), dict(good, request_id=7), dict(good, state='success'),
                   dict(good, requested_at='2026-01-01T00:00:00+08:00'), dict(good, requested_at=None),
                   dict(good, ok=False), dict(good, reason='entry_removed'), dict(good, finished_at='bad'),
                   dict(good, state='finished'), dict(good, state='discarded',reason=None),
                   dict(good, state='finished',finished_at='2026-01-01T00:00:02Z',sampled_at='2026-01-01T00:00:01Z',ok=1)]
        invalid += [{key:value for key,value in good.items() if key!=missing} for missing in good]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_retry_status(value, 'default')
        self.assertEqual(validate_retry_status(good|dict(extra='ignored'),'default'), good)
        self.marker()
        snap = monitor_snapshot(); snap['retry_status'] = good
        self.write(self.cache/'default/latest.json', snap)
        row = self.store.monitors()['clusters'][0]
        self.assertIsNone(row['retry_status'])
        self.assertEqual(row['snapshot'], snap)
        self.write(self.cache/'default/retry-status.json', good)
        (self.cache/'watch.json').unlink()
        row = self.store.monitors()['clusters'][0]
        self.assertTrue(row['retry_status_error'])
        self.assertFalse(row['retry_tracking_supported'])
        self.assertEqual(row['snapshot'], snap)

    def test_corrupt_oversized_and_symlink_control_preserve_snapshot(self):
        self.marker()
        snap = monitor_snapshot()
        self.write(self.cache/'default/latest.json', snap)
        target = self.cache/'default/retry-status.json'
        for raw in ('{', 'null', '[1]', ' '* (2*1024*1024+1), '\udcff'):
            target.write_bytes(raw.encode('utf-8', errors='surrogatepass'))
            row = self.store.monitors()['clusters'][0]
            self.assertIsNone(row['retry_status']); self.assertTrue(row['retry_status_error'])
            self.assertEqual(row['snapshot'], snap)
        target.unlink(); outside = self.root/'outside.json'; self.write(outside, self.status())
        target.symlink_to(outside)
        before = outside.read_bytes()
        row = self.store.monitors()['clusters'][0]
        self.assertTrue(row['retry_status_error']); self.assertEqual(row['snapshot'], snap)
        self.assertEqual(outside.read_bytes(), before)
        target.unlink(); target.mkdir()
        self.assertTrue(self.store.monitors()['clusters'][0]['retry_status_error'])
        watch = self.cache/'watch.json'; watch.unlink(); watch.symlink_to(outside)
        row = self.store.monitors()['clusters'][0]
        self.assertFalse(row['retry_tracking_supported']); self.assertEqual(row['snapshot'], snap)
        linked = self.cache/'batch'; linked.symlink_to(self.root, target_is_directory=True)
        row = next(r for r in self.store.monitors()['clusters'] if r['name']=='batch')
        self.assertIsNone(row['retry_status']); self.assertTrue(row['retry_status_error'])


class PairedBackendTests(unittest.TestCase):
    def test_t151_merged_backend_local_pair(self):
        """Opt-in dependency source; never reads default config or constructs SSH."""
        import contextlib
        import io
        import json
        import os
        from pathlib import Path
        import subprocess
        import sys
        import tempfile
        from unittest.mock import patch
        backend = os.environ.get('T151_BACKEND_SOURCE')
        if not backend:
            self.skipTest('Paired T149 source not supplied; run separately against the recorded merge SHA')
        sys.path.insert(0, backend)
        self.addCleanup(lambda: sys.path.remove(backend))
        from ag import cli, monitor
        self.assertEqual(Path(monitor.__file__).resolve(), Path(backend).resolve()/'ag/monitor.py')
        from ag.transport import Result
        from autog_frontend.actions import Actions
        from autog_frontend.studies import Studies
        from datetime import datetime, timezone

        class FakeTransport:
            def __init__(self): self.calls = []
            def run(self, command):
                self.calls.append(command.operation)
                if command.operation == 'jobs': return Result(stdout='')
                if command.operation == 'queues': return Result(stdout='Queue Max Tot Ena Str Que Run Hld Wat Trn Ext T\n----- --- --- --- --- --- --- --- --- --- --- -\n')
                if command.operation == 'nodes': return Result(stdout='node-a\n     state = free\n     np = 8\n')
                raise AssertionError('Unexpected transport operation')

        for source in ('legacy', 'named'):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve(); studies = root/'studies'; studies.mkdir()
                cfg = dict(local=dict(studies_root=str(studies)), _config_dir=str(root),
                           ssh=dict(host='fixture',config_file=str(root/'synthetic-config')),
                           resources=dict(max_cores=8,max_committed_cores=8,tiers={
                               name:dict(cores=4,mem_gb=8) for name in ('mini','simple','general','complex')}))
                if source == 'named': cfg['_cluster']='default'
                calls=[]
                def local_cli(argv, **kwargs):
                    self.assertFalse(kwargs['shell']); self.assertEqual(kwargs['timeout'],15)
                    args=argv[1:];calls.append(args)
                    self.assertTrue(args==['--version'] or args[:2]==['monitor','--retry'] or args[:2]==['clusters','--json'])
                    out=io.StringIO()
                    with contextlib.redirect_stdout(out), patch.object(cli,'load_config',return_value=cfg):
                        try: code=cli.main(args)
                        except SystemExit as exc: code=exc.code
                    return subprocess.CompletedProcess(argv,code,out.getvalue().encode(),b'')
                fixed=datetime.now(timezone.utc)
                with patch.object(monitor,'login_user',return_value='fixture'), patch.object(monitor,'utc_now',return_value=fixed), \
                     patch('autog_frontend.actions.subprocess.run',side_effect=local_cli):
                    store=Studies(studies); actions=Actions(store,sys.executable)
                    with monitor.WatchControl(cfg) as control:
                        schedule=monitor.Sampling(30);control.configure({'default':cfg},{'default':schedule})
                        row=lambda:store.monitors()['clusters'][0]
                        self.assertTrue(row()['retry_tracking_supported']);self.assertIsNone(row()['snapshot'])
                        accepted=actions.retry_monitor(dict(cluster='default',auth_fixed=False))
                        self.assertEqual(row()['retry_status']['request_id'],accepted['request_id'])
                        again=actions.retry_monitor(dict(cluster='default',auth_fixed=False))
                        self.assertEqual(again['result'],'already_queued');self.assertEqual(again['request_id'],accepted['request_id'])
                        self.assertEqual(control.begin('default',cfg,schedule),'manual')
                        running=actions.retry_monitor(dict(cluster='default',auth_fixed=False))
                        self.assertEqual(running['result'],'in_progress');self.assertEqual(running['request_id'],accepted['request_id'])
                        fake=FakeTransport();snapshot=monitor.sample(cfg,fake,30,schedule=schedule,trigger='manual')
                        self.assertTrue(snapshot['ok'],snapshot['error']);control.finish('default',schedule,snapshot)
                        self.assertEqual(row()['retry_status']['state'],'finished');self.assertTrue(row()['retry_status']['ok'])
                        before=(monitor.cache_dir(cfg)/'latest.json').read_bytes()
                        for reason in ('auth_confirmation_required','config_changed','entry_removed','monitor_restarted'):
                            accepted=actions.retry_monitor(dict(cluster='default',auth_fixed=False))
                            with monitor.control_lock(cfg):control.discard('default',cfg,reason)
                            self.assertEqual(row()['retry_status']['reason'],reason)
                            self.assertEqual(row()['retry_status']['request_id'],accepted['request_id'])
                            self.assertEqual((monitor.cache_dir(cfg)/'latest.json').read_bytes(),before)
                        control.reconfigure({},set())
                        self.assertEqual(row()['retry_status']['state'],'discarded')
                        self.assertFalse(row()['retry_tracking_supported'])
                        control.reconfigure({'default':cfg},set())
                        # Old frontend argv against the real new producer remains exactly four fields.
                        out=io.StringIO()
                        with contextlib.redirect_stdout(out):
                            self.assertEqual(monitor.retry(cfg,'default',json_output=True),0)
                        self.assertEqual(set(json.loads(out.getvalue())),{'entry','result','reason','requested_at'})
                        self.assertEqual(fake.calls,['jobs','queues','nodes'])
                    refused=actions.retry_monitor(dict(cluster='default',auth_fixed=False))
                    self.assertEqual(refused['result'],'refused')
                    self.assertEqual(refused['reason'],'monitor_not_running')
                    self.assertIsNone(refused['request_id'])
                    self.assertTrue(all('--track' in a for a in calls if a[:2]==['monitor','--retry']))
