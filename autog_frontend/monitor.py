"""Validate the supplied ag-monitor/1 snapshot before displaying local data.

Required fields/types are checked because a partial producer update must show a
format error, rather than crash the page or mislabel old values as current.
"""
from datetime import datetime, timedelta
import math


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

    try:
        require(isinstance(data, dict) and data['schema'] == 'ag-monitor/1')
        timestamp(data['sampled_at'])
        interval = data['interval_seconds']
        require(interval is None or type(interval) is int and 60 <= interval <= 600)
        require(type(data['ok']) is bool)
        string(data['error'], True)
        timestamp(data['last_ok_at'], True)
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
            for job in rows(own['jobs']):
                for key in ('job_id', 'name', 'state', 'queue'):
                    string(job[key])
                integer(job['cores'], True)
                for key in ('mem', 'walltime_used', 'walltime_limit', 'start_time', 'study', 'attempt'):
                    string(job.get(key), True)
        if cluster is not None:
            for key in ('name', 'scheduler', 'expires', 'expiry_warning'):
                if key in cluster:
                    string(cluster[key], True)
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
            for queue in rows(cluster['queues']):
                string(queue['name']); integer(queue['running']); integer(queue['queued'])
        for warning in rows(data['warnings']):
            string(warning['kind']); string(warning['detail'])
            for key in ('job_id', 'study', 'attempt'):
                string(warning[key], True)
        return data
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ValueError('快照格式不正确') from None
