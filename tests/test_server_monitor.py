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
