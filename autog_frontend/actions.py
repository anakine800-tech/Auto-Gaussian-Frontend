"""Opt-in local ag adapter. Only drafts are written by this process.

The lock prevents overlapping clicks. Descriptor-relative exclusive creation
prevents a draft collision or symlink from overwriting an existing input. Reading
the same local settings as ag prevents acting on a different same-named study.
Submission claims, confirmation, hashes and scheduler limits remain owned by ag.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import threading

from .studies import StudyError, component
from .monitor import retry_timestamp

MAX_BODY = 1024 * 1024
TIMEOUT = 420
RESOURCE_TIERS = ('mini', 'simple', 'general', 'complex', 'max', 'ultra')


def walltime_seconds(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{2,4}:[0-5][0-9]:[0-5][0-9]', value):
        raise ValueError('Invalid ag walltime')
    hours, minutes, seconds = map(int, value.split(':'))
    total = hours * 3600 + minutes * 60 + seconds
    if total <= 0:
        raise ValueError('Invalid ag walltime')
    return total


def resource_input(text, tier):
    # Use 80% of tier memory, below ag's 85% ceiling; ag uses decimal MB.
    body = '\n'.join(line for line in text.split('\n')
                     if not re.match(r'^\s*%(?:nprocshared|mem)\s*=', line, re.I))
    return f'%nprocshared={tier["cores"]}\n%mem={tier["mem_mb"]}MB\n' + body



def validate_targets(data, cluster, tiers):
    statuses = {'available', 'occupied', 'insufficient', 'stale', 'restricted', 'forbidden', 'unknown'}
    if (not isinstance(data, dict) or data.get('schema') != 'ag-node-targets/1'
            or data.get('cluster') != cluster or type(data.get('fresh')) is not bool
            or not isinstance(data.get('nodes'), list) or len(data['nodes']) > 256):
        raise ValueError('Invalid node candidate response')
    if data['fresh']:
        stamp = datetime.fromisoformat(data['valid_until'])
        if stamp.tzinfo is None:
            raise ValueError('Node candidate expiry requires timezone')
    names = set()
    for i, row in enumerate(data['nodes']):
        if (not isinstance(row, dict) or not isinstance(row.get('name'), str)
                or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,62}', row['name'])
                or '..' in row['name'] or row['name'].endswith('.') or row['name'] in names
                or type(row.get('order')) is not int or row['order'] != i + 1
                or type(row.get('priority')) is not int or row['priority'] != row['order']
                or 'priority_group' not in row
                or (row['priority_group'] is None and row.get('status') != 'forbidden')
                or (row['priority_group'] is not None and
                    (type(row['priority_group']) is not int or row['priority_group'] < 1))
                or row.get('status') not in statuses or not isinstance(row.get('reason'), str)
                or len(row['reason']) > 400 or not isinstance(row.get('options'), list)
                or len(row['options']) > 2):
            raise ValueError('Invalid node candidate row')
        names.add(row['name']); fractions = set()
        if 'selectable' in row and (type(row['selectable']) is not bool or
                (row['selectable'] and row['status'] in ('forbidden', 'restricted'))):
            raise ValueError('Invalid node selectability')
        for option in row['options']:
            if (not isinstance(option, dict) or option.get('fraction') not in ('1/2', '1/4')
                    or option['fraction'] in fractions or type(option.get('cores')) is not int
                    or option['cores'] < 1 or type(option.get('mem_gb')) is not int
                    or option['mem_gb'] != option['cores'] * 2):
                raise ValueError('Invalid node candidate resources')
            fractions.add(option['fraction'])
            if 'selectable' in option and type(option['selectable']) is not bool:
                raise ValueError('Invalid node fraction selectability')
            if option.get('tier') is not None:
                tier = tiers.get(option['tier'])
                if not tier or (tier['cores'], tier['mem_mb']) != (option['cores'], option['mem_gb'] * 800):
                    raise ValueError('Node candidate tier does not match cluster resources')
    return data


def targets_fresh(data):
    return data.get('fresh') is True and datetime.now(timezone.utc) < datetime.fromisoformat(data['valid_until'])


def node_selectable(row):
    return row.get('selectable', row['status'] == 'available') is True


def validate_capacity(data, cluster, tier, target, resources):
    # Bind advice to the exact request and configured scheduler resources. Never
    # derive a capacity verdict from the partition totals in the viewer.
    if (not isinstance(data, dict) or data.get('cluster') != cluster or data.get('tier') != tier
            or data.get('target_node') != target
            or type(data.get('cores')) is not int or data['cores'] != resources['cores']
            or type(data.get('mem_gb')) is not int or data['mem_gb'] != resources['mem_gb']
            or type(data.get('snapshot_fresh')) is not bool
            or not isinstance(data.get('nodes'), list) or len(data['nodes']) > 256):
        raise ValueError('Capacity response does not match the request')
    for key in ('sampled_at', 'valid_until'):
        if data[key] is not None:
            retry_timestamp(data[key])
        elif data['snapshot_fresh']:
            raise ValueError('Fresh capacity requires observation and expiry times')
    clean = {key: data[key] for key in ('cluster', 'tier', 'target_node', 'cores', 'mem_gb',
                                       'sampled_at', 'valid_until', 'snapshot_fresh')}
    rows = []
    for row in [data, *data['nodes']]:
        if (not isinstance(row, dict) or row.get('availability') not in ('enough', 'queue', 'unknown', 'not_applicable')
                or (row.get('fits_total') is not None and type(row['fits_total']) is not bool)
                or not isinstance(row.get('reasons'), list) or len(row['reasons']) > 32
                or any(not isinstance(v, str) or len(v) > 400 for v in row['reasons'])
                or any(row.get(k) is not None and (not isinstance(row[k], str) or len(row[k]) > 400)
                       for k in ('cpu_source', 'memory_source'))):
            raise ValueError('Invalid capacity advice')
        if (row['availability'] in ('enough', 'queue') and
                (row.get('fits_total') is not True or not data['snapshot_fresh'])):
            raise ValueError('Capacity advice lacks current fit evidence')
        if row['availability'] == 'not_applicable' and row.get('fits_total') is not False:
            raise ValueError('Capacity advice lacks total specification evidence')
        value = {k: row.get(k) for k in ('availability', 'fits_total', 'reasons', 'cpu_source', 'memory_source')}
        if row is data:
            clean.update(value)
        else:
            if (not isinstance(row.get('name'), str) or not row['name'] or len(row['name']) > 256
                    or (target is not None and row['name'] != target)):
                raise ValueError('Invalid capacity node identity')
            rows.append(value | {'name': row['name']})
    return clean | {'nodes': rows}


class Actions:
    def __init__(self, store, executable=None):
        self.store = store
        resolved = (shutil.which(str(Path(executable).expanduser().absolute()))
                    if executable is not None else shutil.which('ag'))
        if not resolved:
            raise ValueError('ag executable not found; provide --ag or PATH')
        self.executable = str(Path(resolved).absolute())
        try:
            version = subprocess.run([self.executable, '--version'], shell=False,
                                     capture_output=True, timeout=15, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError('ag --version failed; actions disabled') from exc
        if version.returncode != 0:
            raise ValueError('ag --version failed; actions disabled')
        self.clusters = self.settings()
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        # Serialize discovery so rapid form changes cannot repeatedly invoke an
        # unsupported command. This never acquires/releases the operation lock.
        self.capacity_lock = threading.Lock()
        self.capacity_unavailable = False

    def settings(self):
        # ag owns configuration parsing. Root verification prevents actions on a
        # different same-named study without exposing ag's configured path.
        try:
            result = subprocess.run(
                [self.executable, 'clusters', '--json', '--verify-studies-root', str(self.store.root)],
                shell=False, capture_output=True, timeout=15, check=False)
            if result.returncode != 0:
                raise ValueError('ag clusters query failed; actions unavailable')
            data = json.loads(result.stdout)
            if data.get('studies_root_matches') is not True:
                raise ValueError('Viewer studies root must equal ag local.studies_root')
            rows = data['clusters']
            if not isinstance(rows, list) or not rows:
                raise ValueError('Invalid ag cluster list')
            clusters = {}
            for row in rows:
                name = row['name']
                if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', name)
                        or name in clusters or row['scheduler'] not in ('pbs', 'slurm')):
                    raise ValueError('Invalid ag cluster identity')
                tiers = {}
                resources = row['resources']
                configured = resources['tiers']
                if not isinstance(configured, dict) or not set(RESOURCE_TIERS[:4]) <= set(configured):
                    raise ValueError('Invalid ag resource tiers')
                for tier in RESOURCE_TIERS:
                    if tier not in configured:
                        continue
                    value = configured[tier]
                    cores, memory = value['cores'], value['mem_gb']
                    if type(cores) is not int or cores < 1 or type(memory) is not int or memory < 1:
                        raise ValueError('Invalid ag resource tier')
                    tiers[tier] = dict(cores=cores, mem_gb=memory, mem_mb=memory * 800)
                enabled = row['programs_enabled']
                if any(type(enabled[key]) is not bool for key in ('gaussian', 'xtb', 'crest')):
                    raise ValueError('Invalid ag program availability')
                clusters[name] = dict(scheduler=row['scheduler'], tiers=tiers,
                                      programs_enabled={key: enabled[key] for key in ('gaussian', 'xtb', 'crest')})
                if 'default_tier' in resources:
                    default = resources['default_tier']
                    if not isinstance(default, str) or default not in tiers:
                        raise ValueError('Invalid default resource tier')
                    clusters[name]['default_tier'] = default
                if 'node_targeting' in row:
                    if row['scheduler'] != 'pbs' or row['node_targeting'] != {'default_fraction':'1/2', 'fractions':['1/2','1/4']}:
                        raise ValueError('Invalid node targeting capability')
                    clusters[name]['node_targeting'] = row['node_targeting']
                if 'max_walltime' in resources:
                    walltime_seconds(resources['max_walltime'])
                    clusters[name]['max_walltime'] = resources['max_walltime']
            return clusters
        except (OSError, subprocess.TimeoutExpired, KeyError, TypeError, AttributeError,
                UnicodeError, json.JSONDecodeError, RecursionError) as exc:
            raise ValueError('Cannot query ag clusters and verify viewer study root') from exc

    def capacity(self, payload):
        fields = {'cluster', 'tier'}
        if isinstance(payload, dict) and 'target_node' in payload:
            fields.add('target_node')
        if (not isinstance(payload, dict) or set(payload) != fields
                or any(not isinstance(v, str) for v in payload.values())
                or payload['cluster'] not in self.clusters):
            raise StudyError('Expected a configured cluster, tier and optional target_node only', 400)
        name, tier, target = payload['cluster'], payload['tier'], payload.get('target_node')
        cluster = self.clusters[name]
        if (tier not in cluster['tiers'] or
                (target is not None and ('node_targeting' not in cluster or
                 not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,62}', target) or '..' in target or target.endswith('.')))):
            raise StudyError('Invalid capacity resource selection', 400)
        resources = cluster['tiers'][tier]
        unknown = dict(cluster=name, tier=tier, target_node=target, cores=resources['cores'],
                       mem_gb=resources['mem_gb'], fits_total=None, availability='unknown',
                       sampled_at=None, valid_until=None, snapshot_fresh=False,
                       cpu_source=None, memory_source=None, nodes=[])
        unavailable = unknown | dict(capability_unavailable=True,
                                    reasons=['容量能力不可用；需配套支持 capacity 命令的 ag，更新后重启前端。'])
        with self.capacity_lock:
            if self.capacity_unavailable:
                return unavailable
            try:
                if self.settings() != self.clusters:
                    return unknown | dict(reasons=['ag 资源设置已变化，请重启前端；当前容量无法判断。'])
                argv = [self.executable, 'capacity', '--cluster', name, '--tier', tier]
                if target is not None:
                    argv += ['--target-node', target]
                argv += ['--json']
                result = subprocess.run(argv, shell=False, capture_output=True, timeout=15, check=False)
                # argparse uses 2 for an unknown command, but ag also uses 2
                # with JSON for local OSError/KeyError. Only the former proves
                # this executable lacks capacity; transient errors stay retryable.
                if (result.returncode == 2 and not result.stdout.strip() and
                        re.search(rb"(?m)^ag: error: argument command: invalid choice: 'capacity' \(choose from [^\r\n]+\)\r?$",
                                  result.stderr)):
                    self.capacity_unavailable = True
                    return unavailable
                if result.returncode:
                    raise ValueError('Capacity query failed')
                return validate_capacity(json.loads(result.stdout), name, tier, target, resources)
            except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError, OverflowError, RecursionError):
                return unknown | dict(reasons=['容量读取失败或响应无法核对；未自动重试，可手动刷新容量。'])

    def retry_monitor(self, payload):
        # ag coalesces monitor requests; a long fetch must not block this local
        # registration, and registration must not take the calculation lock.
        if (not isinstance(payload, dict) or set(payload) != {'cluster', 'auth_fixed'}
                or not isinstance(payload['cluster'], str)
                or payload['cluster'] not in self.clusters
                or type(payload['auth_fixed']) is not bool):
            raise StudyError('Expected a configured cluster and boolean auth_fixed only', 400)
        cluster = payload['cluster']
        # Use the same descriptor-protected resolver as GET /api/monitor, rooted
        # at the Studies instance verified against the selected ag at startup.
        rows = [row for row in self.store.monitors(self.clusters)['clusters'] if row['name'] == cluster]
        track = len(rows) == 1 and rows[0]['retry_tracking_supported']
        if track:
            # A long-running viewer can outlive an ag configuration edit. Check
            # the root again before using a marker to select the new argv.
            try:
                self.settings()
            except ValueError:
                raise StudyError('无法核对 ag 与页面的监控根目录；未登记请求', 409) from None
        argv = [self.executable, 'monitor', '--retry', cluster, '--json']
        if track:
            argv.append('--track')
        if payload['auth_fixed']:
            argv.append('--auth-fixed')
        try:
            process = subprocess.run(argv, shell=False, capture_output=True, timeout=15, check=False)
        except subprocess.TimeoutExpired:
            raise StudyError('ag monitor 重试请求超时（15 秒）；未自动重试，结果尚未确认', 504) from None
        except OSError:
            raise StudyError('无法运行 ag monitor 重试请求；未自动重试', 502) from None
        try:
            data = json.loads(process.stdout)
            if (not isinstance(data, dict)
                    or not {'entry', 'result', 'reason', 'requested_at'} <= set(data)
                    or data['entry'] != cluster
                    or data['result'] not in ('queued', 'already_queued', 'in_progress', 'refused')
                    or data['reason'] not in (None, 'monitor_not_running', 'auth_confirmation_required', 'unknown_entry')):
                raise ValueError()
            refused = data['result'] == 'refused'
            if process.returncode != (1 if refused else 0) or refused != (data['reason'] is not None):
                raise ValueError()
            requested = data['requested_at']
            if requested is not None:
                retry_timestamp(requested)
            if track or 'request_id' in data:
                request_id = data['request_id']
                if (refused and request_id is not None or not refused and (
                        not isinstance(request_id, str) or re.fullmatch(r'[0-9a-f]{32}', request_id) is None
                        or requested is None)):
                    raise ValueError()
            keys = ('entry', 'result', 'reason', 'requested_at')
            return {key: data[key] for key in (*keys, 'request_id') if key in data}
        except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError):
            # Raw control output can contain internal IDs or local paths.
            raise StudyError('ag monitor 返回无效的重试 JSON；未自动重试，结果尚未确认', 502) from None

    def node_targets(self):
        result = {}
        for name, cluster in self.clusters.items():
            if 'node_targeting' not in cluster:
                continue
            try:
                response = subprocess.run([self.executable, 'nodes', '--cluster', name, '--json'],
                                          shell=False, capture_output=True, timeout=15, check=False)
                if response.returncode:
                    raise ValueError('Cannot read node candidates')
                result[name] = validate_targets(json.loads(response.stdout), name, cluster['tiers'])
            except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
                result[name] = dict(fresh=False, nodes=[], error='节点候选不可用，请刷新状态核对；不会自动重试。')
        return result

    def context(self, study, attempt):
        component(study); component(attempt)
        if study.startswith('-') or attempt.startswith('-'):
            raise StudyError('IDs cannot be command options', 400)
        data = self.store.attempt(study, attempt)
        manifest, status = data['manifest']['data'], data['status']['data']
        if not manifest or not status or manifest.get('attempt_id') != attempt or manifest.get('study_id') != study:
            raise StudyError('Attempt manifest identity or status is unavailable', 409)
        residue = False
        try:
            monitor = self.store.monitor_for_cluster(manifest.get('cluster', 'default'))
            residue = any(w['kind'] == 'scheduler-residue' and w['study'] == study and w['attempt'] == attempt
                          for w in monitor['warnings'])
        except StudyError:
            pass
        inputs = [f for f in data['input_files'] if f['name'].lower().endswith('.gjf')]
        source = None
        if (status.get('state') not in ('unknown', 'failed_presubmit')
                and manifest.get('template') == 'gaussian' and len(inputs) == 1 and not inputs[0]['error']):
            try:
                source = self.store.input_file(study, attempt, inputs[0]['name'])['text']
            except StudyError:
                # A damaged input disables editing, not status/fetch/cancel.
                pass
        return dict(state=status.get('state'), can_cancel=status.get('state') in ('submitted', 'running') or residue,
                    source=source, clusters=self.clusters, manifest=manifest, node_targets=self.node_targets())

    def draft(self, study, label, text):
        name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + label + '.gjf'
        with self.store.open_dir((study,)) as study_fd:
            try:
                os.mkdir('drafts', mode=0o700, dir_fd=study_fd)
            except FileExistsError:
                pass
        with self.store.open_dir((study, 'drafts')) as directory:
            try:
                fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
            except FileExistsError:
                raise StudyError('Draft already exists; nothing was overwritten', 409) from None
            with os.fdopen(fd, 'wb') as handle:
                handle.write(text.encode('utf-8'))
        return self.store.root / study / 'drafts' / name

    def execute(self, payload):
        if not isinstance(payload, dict):
            raise StudyError('Expected a JSON object', 400)
        action = payload.get('action')
        fields = {'action', 'study', 'attempt'}
        if action == 'prepare':
            fields |= {'cluster', 'input', 'tier', 'walltime', 'label', 'relation', 'method_basis'}
            selected = self.clusters.get(payload.get('cluster')) if isinstance(payload.get('cluster'), str) else None
            if selected and 'node_targeting' in selected:
                fields |= {'target_node', 'node_fraction'}
        elif action not in ('status', 'fetch', 'submit', 'cancel'):
            raise StudyError('Unsupported action', 400)
        if set(payload) != fields or any(not isinstance(v, str) or '\x00' in v for v in payload.values()):
            raise StudyError('Only the fixed string fields for this action are accepted', 400)
        if not self.lock.acquire(blocking=False):
            raise StudyError('Another ag operation is still running', 409)
        pending = None
        try:
            if self.settings() != self.clusters:
                raise StudyError('ag resource settings changed; restart the viewer', 409)
            study, attempt = payload['study'], payload['attempt']
            context = self.context(study, attempt)
            if action == 'submit' and context['state'] != 'prepared':
                raise StudyError('Only prepared Attempts can be submitted', 409)
            if action == 'cancel' and not context['can_cancel']:
                raise StudyError('Attempt is not submitted, running or scheduler-residue', 409)
            if action == 'prepare':
                if context['source'] is None:
                    raise StudyError('A unique Gaussian parent input is required; unknown/failed_presubmit cannot be retried here', 409)
                label, relation = payload['label'], payload['relation']
                if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', label) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', relation):
                    raise StudyError('Invalid label or parent relation', 400)
                cluster = self.clusters.get(payload['cluster'])
                if cluster is None or not cluster['programs_enabled']['gaussian']:
                    raise StudyError('Selected cluster is unavailable or Gaussian is disabled', 400)
                tier = cluster['tiers'].get(payload['tier'])
                try:
                    duration = walltime_seconds(payload['walltime'])
                except ValueError:
                    raise StudyError('Invalid tier, walltime or method basis', 400) from None
                if not tier or not payload['method_basis'].strip():
                    raise StudyError('Invalid tier, walltime or method basis', 400)
                if 'max_walltime' in cluster and duration > walltime_seconds(cluster['max_walltime']):
                    raise StudyError('walltime exceeds configured cluster maximum; ag remains the final resource guard', 400)
                target_args = []
                if 'node_targeting' in cluster:
                    candidates = context['node_targets'][payload['cluster']]
                    row = next((r for r in candidates['nodes'] if r['name'] == payload['target_node']), None)
                    if not targets_fresh(candidates) or row is None or not node_selectable(row):
                        raise StudyError('Target node is unavailable or stale; no draft created', 409)
                    option = next((o for o in row['options'] if o['fraction'] == payload['node_fraction']
                                   and o['tier'] == payload['tier']), None)
                    if option is None:
                        raise StudyError('Selected node fraction must match a configured tier', 400)
                    if option.get('selectable', True) is not True:
                        raise StudyError('Selected node fraction is unavailable; no draft created', 409)
                    target_args = ['--target-node', row['name'], '--node-fraction', option['fraction']]
                draft = self.draft(study, label, resource_input(payload['input'], tier))
                argv = [self.executable, 'prepare', '--json', '--study', str(self.store.root / study),
                        '--template', 'gaussian', '--input', str(draft), '--cluster', payload['cluster'], '--tier', payload['tier'],
                        '--walltime', payload['walltime'], '--label', label, '--parent', attempt,
                        '--relation', relation, '--method-basis', payload['method_basis']] + target_args
            else:
                argv = [self.executable, action, '--json', attempt]
            result, pending = self.run(argv)
            if action == 'prepare' and result['exit_code'] == 0:
                # Interpret only ag's JSON. Never infer an ID from human output.
                try:
                    manifest = json.loads(result['stdout'])
                    new_id = component(manifest['attempt_id'])
                    if manifest['study_id'] != study or new_id == attempt:
                        raise ValueError()
                    result['new_attempt'] = new_id
                except (ValueError, TypeError, KeyError, StudyError):
                    result['notice'] = 'ag prepare returned no valid JSON Attempt identity; inspect output manually. Do not retry automatically.'
            return result
        finally:
            if pending is None:
                self.lock.release()
            else:
                # Do not terminate a possible in-flight qsub or release its lock
                # just because the HTTP wait expired. Drain both pipes so ag can
                # finish even if it produces more output than a pipe can hold.
                waiter = threading.Thread(target=self.finish, args=(pending,), daemon=False)
                try:
                    waiter.start()
                except RuntimeError:
                    # If a thread cannot start, keep waiting in this request.
                    self.finish(pending)

    @staticmethod
    def drain(process):
        try:
            process.communicate()
        finally:
            process.wait()

    def finish(self, process):
        try:
            self.drain(process)
        finally:
            self.lock.release()

    def run(self, argv):
        def decode(value):
            return (value or b'').decode('utf-8', errors='replace')
        try:
            process = subprocess.Popen(argv, shell=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as exc:
            return (dict(stdout='', stderr=str(exc), exit_code=None, timed_out=False,
                         notice='ag could not be started. No automatic retry.'), None)
        try:
            stdout, stderr = process.communicate(timeout=TIMEOUT)
            return (dict(stdout=decode(stdout), stderr=decode(stderr), exit_code=process.returncode, timed_out=False), None)
        except subprocess.TimeoutExpired as exc:
            return (dict(stdout=decode(exc.stdout), stderr=decode(exc.stderr), exit_code=None, timed_out=True,
                         notice='ag 仍在运行，不要重复操作，结果以 ag status 为准。操作锁保持到 ag 自行退出；当前显示等待结束时的部分输出。'), process)
        except BaseException:
            # An unexpected read error must not unlock a still-running command.
            self.drain(process)
            raise
