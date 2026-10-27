"""Validate the supplied ag-monitor/1 snapshot before displaying local data.

Required fields/types are checked because a partial producer update must show a
format error, rather than crash the page or mislabel old values as current.
"""
from datetime import datetime, timedelta
import math
import re


def retry_timestamp(value):
    if not isinstance(value, str) or 'T' not in value:
        raise ValueError('请求状态时间格式不正确')
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.utcoffset() != timedelta(0):
        raise ValueError('请求状态时间必须为 UTC')
    return stamp


def validate_retry_status(data, entry):
    """Control results are independent of ag-monitor/1 sampling evidence."""
    keys = ('version', 'entry', 'request_id', 'requested_at', 'state', 'reason',
            'finished_at', 'sampled_at', 'ok')
    try:
        if (not isinstance(data, dict) or not all(key in data for key in keys)
                or type(data['version']) is not int or data['version'] != 1
                or data['entry'] != entry or not isinstance(data['request_id'], str)
                or re.fullmatch(r'[0-9a-f]{32}', data['request_id']) is None):
            raise ValueError()
        retry_timestamp(data['requested_at'])
        state = data['state']
        if state in ('queued', 'running'):
            valid = all(data[key] is None for key in ('reason', 'finished_at', 'sampled_at', 'ok'))
        elif state == 'finished':
            retry_timestamp(data['finished_at'])
            retry_timestamp(data['sampled_at'])
            valid = data['reason'] is None and type(data['ok']) is bool
        elif state == 'discarded':
            retry_timestamp(data['finished_at'])
            valid = (data['reason'] in ('auth_confirmation_required', 'entry_removed',
                                       'config_changed', 'monitor_restarted')
                     and data['sampled_at'] is None and data['ok'] is None)
        else:
            valid = False
        if not valid:
            raise ValueError()
        return {key: data[key] for key in keys}
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ValueError('请求状态格式、版本或入口不正确') from None


def validate_retry_watch(data):
    # A marker advertises capability only; ag still checks process/lock/liveness.
    if not isinstance(data, dict):
        raise ValueError('请求追踪能力标记损坏')
    if 'retry_tracking_version' not in data:
        return None
    if type(data['retry_tracking_version']) is not int or data['retry_tracking_version'] != 1:
        raise ValueError('请求追踪版本不受支持')
    if not isinstance(data.get('entries'), dict):
        raise ValueError('请求追踪能力标记损坏')
    retry_timestamp(data.get('heartbeat_at'))
    for name, row in data['entries'].items():
        if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', name)
                or not isinstance(row, dict) or row.get('source') not in ('legacy', 'named')
                or row['source'] == 'legacy' and name != 'default'
                or row.get('pause_reason') not in (None, 'auth', 'host_key')):
            raise ValueError('请求追踪来源不正确')
    return data


def validate_monitor(data):
    def require(condition):
        if not condition:
            raise ValueError('快照格式不正确')

    def string(value, nullable=False):
        require(isinstance(value, str) or nullable and value is None)

    def integer(value, nullable=False):
        require(type(value) is int and value >= 0 or nullable and value is None)

    def timestamp(value, nullable=False):
        if nullable and value is None:
            return
        string(value)
        require('T' in value)
        require(datetime.fromisoformat(value.replace('Z', '+00:00')).utcoffset() == timedelta(0))

    def rows(value):
        require(isinstance(value, list))
        for row in value:
            require(isinstance(row, dict))
        return value

    def number(value, nullable=False):
        require(type(value) in (int, float) and math.isfinite(value) and value >= 0
                or nullable and value is None)

    def job_fields(job, new=False):
        for key in ('job_id', 'name', 'state', 'queue'):
            string(job[key])
        integer(job['cores'], True)
        for key in ('mem', 'walltime_used', 'walltime_limit', 'study', 'attempt'):
            string(job.get(key), True)
        if new or 'user' in job:
            string(job['user'])
        if new or 'mine' in job:
            require(type(job['mine']) is bool)
        if new or 'cores_kind' in job:
            require(job['cores_kind'] in ('allocated', 'requested'))
        if 'mem_source' in job:
            require(job['mem_source'] in ('scheduler', 'manifest', None))
        if 'mem_gb' in job:
            number(job['mem_gb'], True)
        for key in ('elapsed_seconds', 'walltime_limit_seconds'):
            if key in job:
                integer(job[key], True)
        if 'elapsed_source' in job:
            require(job['elapsed_source'] in ('start_time', 'walltime_used', None))
        for key in ('qtime', 'start_time'):
            if key in job:
                # Legacy own.jobs start_time was an unparsed scheduler string.
                if key == 'start_time' and not new and 'cores_kind' not in job:
                    string(job[key], True)
                else:
                    timestamp(job[key], True)

    try:
        require(isinstance(data, dict) and data['schema'] == 'ag-monitor/1')
        timestamp(data['sampled_at'])
        interval = data['interval_seconds']
        require(interval is None or type(interval) is int and 30 <= interval <= 600)
        require(type(data['ok']) is bool)
        string(data['error'], True)
        timestamp(data['last_ok_at'], True)
        if 'sample_duration_ms' in data:
            integer(data['sample_duration_ms'], True)
        if 'sampling' in data:
            sampling = data['sampling']
            require(isinstance(sampling, dict))
            require(sampling['state'] in ('normal', 'backoff', 'paused'))
            integer(sampling['consecutive_failures'])
            current = sampling['current_interval_seconds']
            require(current is None or type(current) is int and 30 <= current <= 600)
            timestamp(sampling['next_sample_at'], True)
            reason = sampling['pause_reason']
            require(reason in (None, 'auth', 'host_key'))
            require(reason is None or sampling['state'] == 'paused')
            require(sampling['trigger'] in ('scheduled', 'manual', 'manual_auth_fixed'))
            require(type(sampling['retry_pending']) is bool)
        own, cluster = data['own'], data['cluster']
        require(isinstance(own, dict) or not data['ok'] and own is None)
        require(isinstance(cluster, dict) or not data['ok'] and cluster is None)
        if own is not None:
            integer(own['cores_in_use'])
            for key in ('cores_running', 'cores_queued', 'committed_cap'):
                if key in own:
                    integer(own[key])
            require(type(own['core_cap']) is int and own['core_cap'] > 0)
            for key in ('max_queued_cores', 'scheduler_max_running_cores', 'max_cores'):
                if key in own:
                    integer(own[key])
                    if key != 'max_queued_cores':
                        require(own[key] > 0)
            if 'max_walltime' in own:
                value = own['max_walltime']
                string(value)
                require(re.fullmatch(r'[0-9]{2,4}:[0-5][0-9]:[0-5][0-9]', value) is not None)
                require(any(int(part) for part in value.split(':')))
            if 'tiers' in own:
                require(isinstance(own['tiers'], dict))
                for name, tier in own['tiers'].items():
                    string(name)
                    require(isinstance(tier, dict))
                    integer(tier['cores'])
                    require(tier['cores'] > 0)
                    memory = tier['mem_gb']
                    require(type(memory) in (int, float) and math.isfinite(memory) and memory > 0)
            if 'shared_with' in own:
                require(isinstance(own['shared_with'], list))
                for name in own['shared_with']:
                    string(name)
            for key in ('mem_running_gb', 'mem_queued_gb'):
                if key in own:
                    number(own[key], True)
            for job in rows(own['jobs']):
                job_fields(job)
        if cluster is not None:
            if 'display_name' in cluster:
                name = cluster['display_name']
                string(name)
                require(1 <= len(name) <= 32 and name.isprintable())
            for key in ('name', 'scheduler', 'expires', 'expiry_warning'):
                if key in cluster:
                    string(cluster[key], True)
            if 'display_order' in cluster:
                require(cluster['display_order'] is None or type(cluster['display_order']) is int)
            for key in ('storage_checked_at', 'storage_sampled_at'):
                if key in cluster:
                    timestamp(cluster[key], True)
            if 'storage_error' in cluster:
                string(cluster['storage_error'], True)
            if 'job_summary_error' in cluster:
                string(cluster['job_summary_error'], True)
            if 'jobs_omitted' in cluster:
                integer(cluster['jobs_omitted'], True)
            if 'jobs' in cluster:
                for job in rows(cluster['jobs']):
                    job_fields(job, new=True)
            summary = cluster.get('job_summary')
            if summary is not None:
                require(isinstance(summary, dict))
                for key in ('running_jobs', 'running_cores', 'queued_jobs', 'queued_cores',
                            'others_running_jobs', 'others_running_cores',
                            'others_queued_jobs', 'others_queued_cores'):
                    if key in summary:
                        integer(summary[key], True)
            hardware = cluster.get('hardware')
            if hardware is not None:
                require(isinstance(hardware, dict))
                for key in ('cores_total', 'cores_allocated', 'cores_idle', 'cores_other'):
                    if key in hardware:
                        integer(hardware[key], True)
                for key in ('mem_total_gb', 'mem_allocated_gb'):
                    if key in hardware:
                        number(hardware[key], True)
                if 'source' in hardware:
                    require(hardware['source'] in ('pbsnodes', 'sinfo'))
                if 'notes' in hardware:
                    require(isinstance(hardware['notes'], list))
                    for note in hardware['notes']:
                        string(note)
                if 'error' in hardware:
                    string(hardware['error'], True)
            if 'storage_kib' in cluster:
                integer(cluster['storage_kib'], True)
            if 'hardware_capacity_known' in cluster:
                require(type(cluster['hardware_capacity_known']) is bool)
            budget = cluster.get('budget')
            if budget is not None:
                require(isinstance(budget, dict))
                for key in ('core_hours', 'used', 'reserved'):
                    value = budget[key]
                    require(type(value) in (int, float) and math.isfinite(value) and value >= 0)
            integer(cluster['cores_total'], True)
            integer(cluster['cores_used'], True)
            for node in rows(cluster['nodes']):
                string(node['name']); string(node['state'])
                integer(node['cores_total'], True); integer(node['cores_used'], True)
                for key in ('mem_total_gb', 'mem_assigned_gb'):
                    if key in node:
                        number(node[key], True)
                if 'jobs' in node:
                    integer(node['jobs'], True)
            for queue in rows(cluster['queues']):
                string(queue['name']); integer(queue['running']); integer(queue['queued'])
        for warning in rows(data['warnings']):
            string(warning['kind']); string(warning['detail'])
            for key in ('job_id', 'study', 'attempt'):
                string(warning[key], True)
        return data
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ValueError('快照格式不正确') from None
