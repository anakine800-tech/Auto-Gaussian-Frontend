"""Bounded, read-only autonomy presentation; never an authorization engine.

Only ag can replay the journal and enforce its final action boundary. This
module checks saved file identities, hash links and presentation fields. Its
projection deliberately excludes run credentials and arbitrary event payloads.
"""
from collections import deque
from contextlib import contextmanager
import fcntl
from hashlib import sha256
import json
import math
import os
import re
import stat
import time

from .studies import StudyError, component

STATE_LIMIT = 2 * 1024 * 1024
JOURNAL_LIMIT = 8 * 1024 * 1024
PLAN_LIMIT = 512 * 1024
ENTRY_LIMIT = 10000
DISPLAY_EVENTS = 30
PLAN_COUNT_LIMIT = 64
ATTEMPT_LIMIT = 1000
COUNTERS = ('attempt', 'remedy', 'cancel', 'reroute')
EVENTS = {'init', 'plan', 'confirm', 'begin', 'start', 'pause', 'resume',
          'finish', 'end', 'update', 'count', 'recover', 'snapshot',
          'submission_consume', 'submission_dispatch', 'submission_abort',
          'submission_boundary_failure', 'waiting', 'manual_takeover'}
SUBMISSION_FIELDS = {'attempt_id', 'object_id', 'failure_class', 'ownership_sha256',
                     'round_id', 'run_id', 'plan_sha256', 'rule_sha256', 'max_attempts'}
WAITING_FIELDS = {'object_id', 'record_sha256', 'round_id', 'run_id', 'plan_sha256'}
POLICY_FIELDS = {'templates', 'clusters', 'max_cores_per_job', 'max_walltime',
                 'methods', 'routing_sha256', 'allow_relaxed'}
GAUSSIAN_METHOD_FIELDS = {'method', 'basis', 'basis_function_type', 'dispersion',
                          'solvent_model', 'solvent', 'integration_grid',
                          'opt_convergence', 'scf_convergence'}
PARAMETER_FIELDS = {
    'xtb': {'--verbose', '--input', '--gfn', '--opt', '--alpb', '--chrg', '--uhf'},
    'crest': {'--cinp', '--mdopt', '--gfn2', '--nci', '--gfnff', '--quick', '--squick',
              '--mquick', '--alpb', '--chrg', '--uhf', '--ewin'},
    'multiwfn': {'--analysis', '--grid'},
}


class UnsupportedAutonomy(ValueError):
    pass


def _require(condition):
    if not condition:
        raise ValueError('Invalid autonomy presentation data')


def _decode(raw):
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode('utf-8')

    def pairs(items):
        out = {}
        for key, value in items:
            _require(key not in out)
            out[key] = value
        return out

    def constant(_):
        raise ValueError('Non-finite JSON value')

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def _encode(data):
    return (json.dumps(data, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode()


def _text(value, *, limit=8000, empty=False):
    _require(isinstance(value, str) and len(value) <= limit and (empty or bool(value.strip())))
    value.encode('utf-8')  # Reject lone surrogates before an HTTP encoder sees them.
    return value


def _identifier(value):
    _require(isinstance(value, str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', value))
    return value


def _digest(value):
    _require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value))
    return value


def _number(value):
    _require(type(value) in (int, float) and math.isfinite(value) and value >= 0)
    return value


def _integer(value, minimum=0):
    _require(type(value) is int and minimum <= value <= 2**53 - 1)
    return value


def _mapping(value, limit=ENTRY_LIMIT):
    _require(isinstance(value, dict) and len(value) <= limit)
    return value


def _texts(value, limit=100):
    _require(isinstance(value, list) and len(value) <= limit)
    return [_text(item) for item in value]


def _totals(value):
    _require(isinstance(value, dict) and set(value) == set(COUNTERS))
    return {name: _integer(value[name]) for name in COUNTERS}


def _fields(value, fields):
    _mapping(value)
    if set(value) - fields:
        raise UnsupportedAutonomy('Unknown autonomy policy field')
    _require(set(value) == fields)


def _submission_policy(value):
    """Project known policy fields, without verifying methods or granting rights.

    These are saved ceilings. Chemistry, route matching and final enforcement
    stay in ag; this display adapter does not import or reproduce those checks.
    Unknown keys are unsupported instead of silently hiding a new constraint.
    """
    _fields(value, POLICY_FIELDS)
    templates = _texts(value['templates'], limit=5)
    _require(bool(templates) and len(set(templates)) == len(templates))
    if set(templates) - {'gaussian', 'gaussian-cp', *PARAMETER_FIELDS}:
        raise UnsupportedAutonomy('Unknown autonomy method template')
    _require(type(value['allow_relaxed']) is bool)
    walltime = _text(value['max_walltime'], limit=40)
    _require(re.fullmatch(r'[0-9]+:[0-5][0-9]:[0-5][0-9]', walltime))
    clusters = _mapping(value['clusters'], limit=100)
    _require(bool(clusters))
    public_clusters = {}
    for name, limits in clusters.items():
        _text(name, limit=80)
        _fields(limits, {'nodes', 'max_committed_cores', 'max_queued_cores', 'max_jobs'})
        nodes = _texts(limits['nodes'], limit=100)
        _require(len(set(nodes)) == len(nodes))
        for node in nodes:
            _text(node, limit=255)
        public_clusters[name] = dict(nodes=nodes, **{
            key: _integer(limits[key], 1)
            for key in ('max_committed_cores', 'max_queued_cores', 'max_jobs')})
    _fields(value['methods'], set(templates))
    public_methods = {}
    for template in templates:
        methods = value['methods'][template]
        _require(isinstance(methods, list) and 0 < len(methods) <= 100)
        public_methods[template] = []
        for method in methods:
            if template in ('gaussian', 'gaussian-cp'):
                _fields(method, GAUSSIAN_METHOD_FIELDS)
                item = {key: _text(method[key], limit=1000)
                        for key in GAUSSIAN_METHOD_FIELDS - {'scf_convergence'}}
                _require(item['opt_convergence'] in ('normal', 'tight', 'verytight'))
                item['scf_convergence'] = _integer(method['scf_convergence'], 8)
                _require(item['scf_convergence'] <= 12)
            else:
                _fields(method, {'parameters'})
                parameters = _mapping(method['parameters'], limit=30)
                if set(parameters) - PARAMETER_FIELDS[template]:
                    raise UnsupportedAutonomy('Unknown autonomy template parameter')
                item = dict(parameters={key: _text(value, limit=1000, empty=True)
                                        for key, value in parameters.items()})
            public_methods[template].append(item)
    return dict(templates=templates, clusters=public_clusters,
                max_cores_per_job=_integer(value['max_cores_per_job'], 1),
                max_walltime=walltime, methods=public_methods,
                routing_sha256=_digest(value['routing_sha256']), allow_relaxed=value['allow_relaxed'])


def _optional_fields(value, required, optional=()):
    _mapping(value)
    if set(value) - required - set(optional):
        raise UnsupportedAutonomy('Unknown autonomy record field')
    _require(required <= set(value))


def _private_event_fields(value, required, *, versions=True):
    # This path only reads raw journal events; public() sanitizes state, not
    # journal data. Require private evidence fields, validate, then omit them.
    _fields(value, required | {'token_sha256'} | ({'versions'} if versions else set()))
    _digest(value['token_sha256'])
    if versions:
        version = value['versions']
        _fields(version, {'ag_version', 'git_commit', 'dirty', 'rdkit', 'goodvibes'})
        _require(type(version['dirty']) is bool and isinstance(version['git_commit'], str)
                 and re.fullmatch(r'[0-9a-f]{40,64}', version['git_commit']))
        for key in ('ag_version', 'rdkit', 'goodvibes'):
            _text(version[key], limit=200)


def _submission_identity(value):
    result = {key: _identifier(value[key]) for key in ('attempt_id', 'object_id', 'round_id', 'run_id')}
    result.update({key: _digest(value[key]) for key in ('ownership_sha256', 'plan_sha256', 'rule_sha256')})
    failure = value['failure_class']
    if failure is not None:
        _text(failure)
        _require(failure == failure.strip())
    result.update(failure_class=failure, max_attempts=_integer(value['max_attempts'], 1))
    return result


def _outcome(value, fields):
    if value is None:
        return None
    _fields(value, fields)
    result = dict(at=_number(value['at']))
    if 'reason' in fields:
        result['reason'] = _text(value['reason'])
    if 'dispatched' in fields:
        _require(type(value['dispatched']) is bool)
        result['dispatched'] = value['dispatched']
    return result


def _submission(value):
    _optional_fields(value, SUBMISSION_FIELDS | {'plan_id', 'at', 'dispatch_started', 'aborted_before_dispatch'},
                     {'owner_token_sha256', 'boundary_failure'})
    if 'owner_token_sha256' in value:
        _digest(value['owner_token_sha256'])
    result = _submission_identity(value)
    result.update(plan_id=_identifier(value['plan_id']), at=_number(value['at']),
                  dispatch_started=_outcome(value['dispatch_started'], {'at'}),
                  aborted_before_dispatch=_outcome(value['aborted_before_dispatch'], {'at', 'reason'}))
    dispatched = result['dispatch_started'] is not None
    aborted = result['aborted_before_dispatch'] is not None
    _require(not (dispatched and aborted))
    if 'boundary_failure' in value:
        _require(value['boundary_failure'] is not None)
        result['boundary_failure'] = _outcome(value['boundary_failure'], {'at', 'dispatched', 'reason'})
        _require(result['boundary_failure']['dispatched'] == dispatched)
        _require(dispatched or aborted)
    return result


def _waiting(value, *, saved):
    _fields(value, WAITING_FIELDS | ({'plan_id', 'at'} if saved else set()))
    result = {key: _identifier(value[key]) for key in ('object_id', 'round_id', 'run_id')}
    result.update({key: _digest(value[key]) for key in ('record_sha256', 'plan_sha256')})
    if saved:
        result.update(plan_id=_identifier(value['plan_id']), at=_number(value['at']))
    return result


def _consumption_views(state, view):
    """Count only structurally valid saved rows, not successes or free capacity.

    Missing fields remain missing for old records. Cross-store reconciliation,
    reservation consumption and action eligibility belong exclusively to ag.
    """
    if 'submissions' in state:
        records = _mapping(state['submissions'])
        projected = []
        for key, value in records.items():
            row = _submission(value)
            _require(key == row['attempt_id'] and row['at'] <= view['updated_at'])
            for field in ('dispatch_started', 'aborted_before_dispatch', 'boundary_failure'):
                item = row.get(field)
                if item is not None:
                    _require(row['at'] <= item['at'] <= view['updated_at'])
            projected.append(row)
        current_round = state['current_round']
        view.update(submissions=sorted(projected, key=lambda row: (row['at'], row['attempt_id']))[-DISPLAY_EVENTS:],
                    submissions_count=len(projected),
                    current_round_submission_count=(sum(row['round_id'] == current_round for row in projected)
                                                    if current_round is not None else None),
                    submissions_truncated=len(projected) > DISPLAY_EVENTS)
    if 'submission_pause' in state:
        value = state['submission_pause']
        _fields(value, {'at', 'attempt_id', 'round_id', 'reason'})
        pause = dict(at=_number(value['at']), attempt_id=_identifier(value['attempt_id']),
                     round_id=_identifier(value['round_id']), reason=_text(value['reason']))
        _require(pause['at'] <= view['updated_at'])
        view['submission_pause'] = pause
    if 'waiting' in state:
        values = state['waiting']
        _require(isinstance(values, list) and len(values) <= ENTRY_LIMIT)
        projected = [_waiting(value, saved=True) for value in values]
        _require(all(row['at'] <= view['updated_at'] for row in projected))
        view.update(waiting=sorted(projected, key=lambda row: row['at'])[-DISPLAY_EVENTS:],
                    waiting_count=len(projected), waiting_truncated=len(projected) > DISPLAY_EVENTS)


def _submission_event(op, data):
    if op == 'submission_consume':
        _private_event_fields(data, {'record'})
        _fields(data['record'], SUBMISSION_FIELDS)
        return dict(submission=_submission_identity(data['record']))
    if op in ('submission_dispatch', 'submission_abort'):
        required = {'attempt_id', 'ownership_sha256', 'round_id', 'run_id', 'plan_sha256'}
        if op == 'submission_abort':
            required.add('reason')
        _private_event_fields(data, required)
        _digest(data['ownership_sha256'])
        _digest(data['plan_sha256'])
        result = {key: _identifier(data[key]) for key in ('attempt_id', 'round_id', 'run_id')}
        if op == 'submission_abort':
            result['reason'] = _text(data['reason'])
        return result
    if op == 'submission_boundary_failure':
        _private_event_fields(data, {'attempt_id', 'ownership_sha256', 'run_id', 'dispatched', 'reason'},
                              versions=False)
        _digest(data['ownership_sha256'])
        _require(type(data['dispatched']) is bool)
        return dict(attempt_id=_identifier(data['attempt_id']), run_id=_identifier(data['run_id']),
                    dispatched=data['dispatched'], reason=_text(data['reason']))
    if op == 'waiting':
        _private_event_fields(data, WAITING_FIELDS)
        row = _waiting({key: data[key] for key in WAITING_FIELDS}, saved=False)
        return {key: row[key] for key in ('object_id', 'round_id', 'run_id', 'record_sha256')}
    if op == 'manual_takeover':
        _fields(data, {'previous_lease', 'writer_id', 'study_key', 'reason'})
        previous = data['previous_lease']
        _optional_fields(previous, {'run_id', 'round_id', 'owner', 'token_sha256',
                                    'started_at', 'run_until', 'expires_at'}, {'observe_only'})
        _digest(previous['token_sha256'])
        _identifier(previous['run_id'])
        _identifier(previous['round_id'])
        _text(previous['owner'])
        started, run_until, expires = [_number(previous[key])
                                       for key in ('started_at', 'run_until', 'expires_at')]
        _require(started <= run_until <= expires)
        if 'observe_only' in previous:
            _require(type(previous['observe_only']) is bool)
        _require(isinstance(data['writer_id'], str) and re.fullmatch('[0-9a-f]{32}', data['writer_id']))
        _digest(data['study_key'])
        return dict(reason=_text(data['reason']))
    return {}


def _snapshot_summary(value):
    """Display capture provenance only; never open the referenced snapshot."""
    _mapping(value)
    binding = _mapping(value['binding'])
    reference = value['snapshot']
    _require(isinstance(reference, str) and re.fullmatch(r'snapshots/[0-9]{8}T[0-9]{12}Z', reference))
    return dict(attempt=_identifier(binding['attempt_id']), run_id=_identifier(value['run_id']),
                round_id=_identifier(value['round_id']), snapshot=reference,
                captured_at=_number(value['captured_at']),
                snapshot_sha256=_digest(value['snapshot_sha256']), log_sha256=_digest(value['log_sha256']))


def _base(status, reason, at):
    return dict(status=status, reason=reason, phase=None, manual_actions_blocked=status != 'absent',
                manual_block_reason=reason if status != 'absent' else None,
                verification='saved-files-only', integration='pending-backend-action-boundary',
                checked_at=at, seq=None, journal_sha256=None, plans=[], current_plan=None,
                current_round=None, current_run=None, lease=None, totals=None, updated_at=None,
                summary=None, pending=[], events=[], events_truncated=False,
                relaxed_inputs=[], relaxed_inputs_warning=None)


def manual_block(view):
    """A refusal reason, not permission to bypass ag's action boundary."""
    if view['status'] == 'absent':
        return None
    if view['status'] != 'ok':
        return view['reason'] or '自主运行状态无法核验，手动操作已阻止。'
    if view['phase'] == 'running':
        return '自主轮次仍在运行；请先由负责人暂停。唤醒间隙或租约过期不代表轮次结束。'
    if view['lease'] is not None and view['lease']['status'] == 'active':
        return '自主轮次已暂停，但当前唤醒仍持有有效租约；请等待持锁会话释放后再操作。'
    return None


def _project(snapshot, at):
    _mapping(snapshot)
    seq = _integer(snapshot['seq'], 1)
    digest = _digest(snapshot['journal_sha256'])
    state = _mapping(snapshot['state'])
    if state.get('schema') != 'ag-autonomy/1':
        return _base('unsupported', '不支持的自主运行记录版本；手动操作已阻止。', at)
    phase = state['phase']
    _require(phase in ('running', 'paused', 'ended') and type(state['paused']) is bool)
    _require(phase == 'ended' or state['paused'] == (phase == 'paused'))
    updated_at = _number(state['updated_at'])
    _require(at >= updated_at)
    plans = _mapping(state['plans'], PLAN_COUNT_LIMIT)
    rounds = _mapping(state['rounds'])
    runs = _mapping(state['runs'])
    _mapping(state['counts'])
    _mapping(state['objects'])
    view = _base('ok', None, at)
    view.update(seq=seq, journal_sha256=digest, phase=phase, updated_at=updated_at,
                totals=_totals(state['totals']), summary=_text(state['summary'], empty=True),
                pending=_texts(state['pending']))
    for plan_id, plan in plans.items():
        _identifier(plan_id)
        _mapping(plan)
        body = _mapping(plan['body'])
        _require(body['id'] == plan_id)
        spec = _mapping(body['spec'])
        required_spec = {'goal', 'comparison_groups', 'method_policy', 'mechanism_scope',
                         'system_rules', 'estimated_hours', 'attempt_limit', 'valid_until'}
        if set(spec) - required_spec - {'submission_policy'}:
            raise UnsupportedAutonomy('Unknown autonomy plan constraint')
        _require(required_spec <= set(spec))
        versions = _mapping(body['versions'])
        _require(type(versions['dirty']) is bool)
        _require(isinstance(versions['git_commit'], str)
                 and re.fullmatch(r'[0-9a-f]{40,64}', versions['git_commit']))
        public_versions = {key: _text(versions[key], limit=200)
                           for key in ('ag_version', 'rdkit', 'goodvibes')}
        public_versions.update(git_commit=versions['git_commit'], dirty=versions['dirty'])
        rules = _mapping(spec['system_rules'])
        created = _number(body['created_at'])
        valid_until = _number(spec['valid_until'])
        _require(valid_until > created and _number(spec['estimated_hours']) > 0)
        groups = _texts(spec['comparison_groups'])
        _require(bool(groups))
        public_spec = dict(goal=_text(spec['goal']), comparison_groups=groups,
                           method_policy=_text(spec['method_policy']),
                           mechanism_scope=_text(spec['mechanism_scope']),
                           system_rules={key: _text(rules[key]) for key in ('main', 'small')},
                           estimated_hours=spec['estimated_hours'],
                           attempt_limit=_integer(spec['attempt_limit'], 1), valid_until=valid_until)
        if 'submission_policy' in spec:
            public_spec['submission_policy'] = _submission_policy(spec['submission_policy'])
        plan_digest = _digest(plan['sha256'])
        _require(sha256(_encode(body)).hexdigest() == plan_digest)
        confirmation = plan['confirmation']
        if confirmation is not None:
            _mapping(confirmation)
            _require(confirmation['sha256'] == plan_digest)
            confirmation = dict(at=_number(confirmation['at']), quote=_text(confirmation['quote']),
                                sha256=plan_digest)
        view['plans'].append(dict(id=plan_id, sha256=plan_digest, created_at=created,
                                  versions=public_versions, spec=public_spec, confirmation=confirmation))
    current_plan, current_round = state['current_plan'], state['current_round']
    if current_plan is not None:
        _require(_identifier(current_plan) in plans)
    view['current_plan'] = current_plan
    if current_round is not None:
        row = _mapping(rounds[_identifier(current_round)])
        ids = row['plan_ids']
        _require(isinstance(ids, list) and 0 < len(ids) <= PLAN_COUNT_LIMIT)
        _require(all(_identifier(item) in plans for item in ids))
        ended = row['ended_at']
        if ended is not None:
            _number(ended)
        view['current_round'] = dict(id=current_round, started_at=_number(row['started_at']),
                                     ended_at=ended, plan_ids=ids, totals=_totals(row['totals']))
        _require((phase == 'ended') == (ended is not None))
    if phase != 'ended':
        _require(current_plan is not None and current_round is not None)
        _require(plans[current_plan]['confirmation'] is not None)
    _consumption_views(state, view)
    if 'snapshots' in state:
        saved_snapshots = _mapping(state['snapshots'])
        projected = []
        for key, row in saved_snapshots.items():
            item = _snapshot_summary(row)
            _require(key == item['attempt'] + '/' + item['snapshot'])
            item['seq'] = _integer(row['seq'], 1)
            _require(item['seq'] <= seq and item['captured_at'] <= updated_at)
            projected.append(item)
        _require(len({item['seq'] for item in projected}) == len(projected))
        view['snapshots'] = sorted(projected, key=lambda item: item['seq'])[-DISPLAY_EVENTS:]
        view['snapshots_truncated'] = len(projected) > DISPLAY_EVENTS
    lease = state['lease']
    if lease is not None:
        _mapping(lease)
        run_id = _identifier(lease['run_id'])
        _require(phase != 'ended' and lease['round_id'] == current_round)
        started, run_until, expires = [_number(lease[key]) for key in ('started_at', 'run_until', 'expires_at')]
        _require(started <= run_until <= expires and started <= at)
        row = _mapping(runs[run_id])
        _require(row['round_id'] == current_round and row['started_at'] == started and row['ended_at'] is None)
        view['lease'] = dict(run_id=run_id, round_id=current_round, started_at=started,
                             run_until=run_until, expires_at=expires,
                             status='active' if at < expires else 'expired')
        view['current_run'] = dict(id=run_id, started_at=started, ended_at=None,
                                   outcome=row['outcome'], totals=_totals(row['totals']))
        _require(row['outcome'] is None)
        for source, target in ((lease, view['lease']), (row, view['current_run'])):
            if 'observe_only' in source:
                _require(type(source['observe_only']) is bool)
                target['observe_only'] = source['observe_only']
        _require(lease.get('observe_only', False) == row.get('observe_only', False))
    view['manual_block_reason'] = manual_block(view)
    view['manual_actions_blocked'] = view['manual_block_reason'] is not None
    return view


def validate_status(payload, now=None):
    """Whitelist an ag status response; never forward subprocess output blindly."""
    at = time.time() if now is None else now
    try:
        if isinstance(payload, (bytes, bytearray, str)):
            _require(len(payload) <= 4 * 1024 * 1024)
            payload = _decode(payload)
        result = _project(payload, at)
        result['verification'] = 'ag-status'
        return result
    except UnsupportedAutonomy:
        return _base('unsupported', '自主计划或日志包含尚不支持的约束或事件；手动操作已阻止。', at)
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        return _base('invalid', 'ag 返回的自主运行状态无法核验；手动操作已阻止。', at)


@contextmanager
def _record(directory, name):
    fd = os.open(component(name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        info = os.fstat(fd)
        _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
        yield fd
    finally:
        os.close(fd)


def _read(directory, name, limit):
    with _record(directory, name) as fd:
        with os.fdopen(os.dup(fd), 'rb') as handle:
            raw = handle.read(limit + 1)
        _require(len(raw) <= limit)
        return raw


def _journal(raw, snapshot):
    _require(raw and raw.endswith(b'\n'))
    lines = raw.splitlines(keepends=True)
    _require(len(lines) <= ENTRY_LIMIT)
    previous, previous_at, events = None, None, deque(maxlen=DISPLAY_EVENTS)
    for seq, line in enumerate(lines, 1):
        event = _decode(line)
        _require(isinstance(event, dict) and set(event) == {'seq', 'prev_sha256', 'op', 'at', 'data'})
        _require(type(event['seq']) is int and event['seq'] == seq and event['prev_sha256'] == previous)
        _require(isinstance(event['op'], str) and isinstance(event['data'], dict) and _encode(event) == line)
        if event['op'] not in EVENTS:
            raise UnsupportedAutonomy('Unknown autonomy journal event')
        at = _number(event['at'])
        _require(previous_at is None or at >= previous_at)
        if seq == 1:
            _require(event['op'] == 'init' and event['data'] == {})
        else:
            _require(event['op'] != 'init')
        item = dict(seq=seq, op=event['op'], at=at)
        data = event['data']
        item.update(_submission_event(event['op'], data))
        if event['op'] in ('pause', 'resume', 'finish', 'end', 'recover') and 'reason' in data:
            item['reason'] = _text(data['reason'])
        elif event['op'] == 'start' and data.get('takeover_reason') is not None:
            item['reason'] = _text(data['takeover_reason'])
        elif event['op'] == 'update' and 'summary' in data:
            item['summary'] = _text(data['summary'], empty=True)
        elif event['op'] == 'snapshot':
            item['snapshot'] = _snapshot_summary(data)
            _require(item['snapshot']['captured_at'] <= at)
        events.append(item)
        previous_at = at
        previous = sha256(line).hexdigest()
    _require(snapshot['seq'] == len(lines) and snapshot['journal_sha256'] == previous)
    _require(snapshot['state']['updated_at'] == events[-1]['at'])
    return list(events), len(lines) > DISPLAY_EVENTS


def _relaxed_inputs(store, study):
    result, warning, remaining = [], None, 8 * 1024 * 1024
    try:
        with store.open_dir((study, 'attempts')) as fd:
            with os.scandir(fd) as entries:
                names = []
                for entry in entries:
                    if len(names) >= ATTEMPT_LIMIT:
                        warning = 'Attempt 数量超过提醒扫描上限；放宽输入提醒不完整。'
                        break
                    names.append(entry.name)
            for name in sorted(names):
                try:
                    # Only fixed manifests are read, never a path inside metadata.
                    with store.open_file((study, 'attempts', name, 'manifest.json')) as handle:
                        raw = handle.read(min(256 * 1024, remaining) + 1)
                    remaining -= len(raw)
                    if remaining < 0:
                        warning = 'Attempt 提醒扫描超过总读取上限；放宽输入提醒不完整。'
                        break
                    _require(len(raw) <= 256 * 1024)
                    manifest = _decode(raw)
                    _require(isinstance(manifest, dict))
                    if 'input_validation' not in manifest:
                        continue  # Only genuinely absent markers are old-compatible.
                    value = manifest['input_validation']
                    _require(isinstance(value, dict) and value.get('mode') == 'relaxed')
                    _require(value.get('method_verified') is False)
                    skipped = _texts(value['skipped_checks'])
                    _require(bool(skipped))
                    result.append(dict(attempt=name, mode='relaxed', skipped_checks=skipped,
                                       method_verified=False))
                except (StudyError, OSError, ValueError, TypeError, KeyError, RecursionError):
                    warning = '部分 Attempt 输入检查标记无法核实或无法安全读取；放宽输入提醒不完整。'
    except (StudyError, OSError):
        warning = 'Attempt 清单无法安全读取；放宽输入提醒不完整。'
    return result, warning


def read_autonomy(store, study, now=None, *, include_relaxed=True):
    """Read one saved snapshot under its existing mutex, without writing files."""
    at = time.time() if now is None else now
    component(study)
    # Validate the study boundary before deciding that autonomy is absent.
    with store.open_dir((study,)) as study_fd:
        try:
            info = os.stat('autonomy', dir_fd=study_fd, follow_symlinks=False)
        except FileNotFoundError:
            result = _base('absent', '未启用自主运行（没有自主目录）。', at)
        except OSError:
            result = _base('invalid', '自主运行目录无法安全读取；手动操作已阻止。', at)
        else:
            try:
                _require(stat.S_ISDIR(info.st_mode))
                directory = os.open('autonomy', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=study_fd)
                try:
                    with _record(directory, 'store.lock') as lock:
                        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                        held = os.fstat(lock)
                        current = os.stat('store.lock', dir_fd=directory, follow_symlinks=False)
                        _require((held.st_dev, held.st_ino) == (current.st_dev, current.st_ino))
                        snapshot = _decode(_read(directory, 'state.json', STATE_LIMIT))
                        result = _project(snapshot, at)
                        if result['status'] == 'ok':
                            events, truncated = _journal(_read(directory, 'journal.jsonl', JOURNAL_LIMIT), snapshot)
                            for plan in snapshot['state']['plans'].values():
                                raw = _read(directory, 'plan-' + plan['body']['id'] + '.json', PLAN_LIMIT)
                                _require(raw == _encode(plan['body']) and sha256(raw).hexdigest() == plan['sha256'])
                            result.update(events=events, events_truncated=truncated)
                        current = os.stat('store.lock', dir_fd=directory, follow_symlinks=False)
                        _require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1
                                 and (held.st_dev, held.st_ino) == (current.st_dev, current.st_ino))
                finally:
                    os.close(directory)
            except UnsupportedAutonomy:
                result = _base('unsupported', '自主计划或日志包含尚不支持的约束或事件；手动操作已阻止。', at)
            except FileNotFoundError:
                result = _base('missing', '自主运行目录已存在，但必要记录缺失；手动操作已阻止。', at)
            except (OSError, ValueError, TypeError, KeyError, UnicodeError, OverflowError, RecursionError):
                result = _base('invalid', '自主运行记录损坏、忙碌、超限或无法安全核验；手动操作已阻止。', at)
    if include_relaxed:
        result['relaxed_inputs'], result['relaxed_inputs_warning'] = _relaxed_inputs(store, study)
    return result
