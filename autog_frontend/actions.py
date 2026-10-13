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
import tomllib

from .studies import StudyError, component

MAX_BODY = 1024 * 1024
TIMEOUT = 420


def read_local_settings():
    with (Path.home() / '.config/ag/config.toml').open('rb') as handle:
        config = tomllib.load(handle)
    return config['local']['studies_root'], config['resources']['tiers']


def resource_input(text, tier):
    # Use 80% of tier memory, below ag's 85% ceiling; ag uses decimal MB.
    body = '\n'.join(line for line in text.split('\n')
                     if not re.match(r'^\s*%(?:nprocshared|mem)\s*=', line, re.I))
    return f'%nprocshared={tier["cores"]}\n%mem={tier["mem_mb"]}MB\n' + body


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
        self.tiers = self.settings()
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()

    def settings(self):
        try:
            root, tiers = read_local_settings()
            if Path(root).expanduser().absolute() != self.store.root:
                raise ValueError('Viewer studies root must equal ag local.studies_root')
            result = {}
            for name in ('mini', 'simple', 'general', 'complex'):
                cores, memory = tiers[name]['cores'], tiers[name]['mem_gb']
                if type(cores) is not int or not 1 <= cores <= 44 or type(memory) is not int or not 1 <= memory <= 120:
                    raise ValueError('Invalid ag resource tier')
                result[name] = dict(cores=cores, mem_mb=memory * 800)
            return result
        except (OSError, KeyError, TypeError, tomllib.TOMLDecodeError) as exc:
            raise ValueError('Cannot read ag local study root and resource tiers') from exc

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
            monitor = self.store.monitor()
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
                    source=source, tiers=self.tiers, manifest=manifest)

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
            fields |= {'input', 'tier', 'walltime', 'label', 'relation', 'method_basis'}
        elif action not in ('status', 'fetch', 'submit', 'cancel'):
            raise StudyError('Unsupported action', 400)
        if set(payload) != fields or any(not isinstance(v, str) or '\x00' in v for v in payload.values()):
            raise StudyError('Only the fixed string fields for this action are accepted', 400)
        if not self.lock.acquire(blocking=False):
            raise StudyError('Another ag operation is still running', 409)
        try:
            if self.settings() != self.tiers:
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
                tier = self.tiers.get(payload['tier'])
                if not tier or not re.fullmatch(r'\d{1,3}:[0-5]\d:[0-5]\d', payload['walltime']) or not payload['method_basis'].strip():
                    raise StudyError('Invalid tier, walltime or method basis', 400)
                draft = self.draft(study, label, resource_input(payload['input'], tier))
                argv = [self.executable, 'prepare', '--json', '--study', str(self.store.root / study),
                        '--template', 'gaussian', '--input', str(draft), '--tier', payload['tier'],
                        '--walltime', payload['walltime'], '--label', label, '--parent', attempt,
                        '--relation', relation, '--method-basis', payload['method_basis']]
            else:
                argv = [self.executable, action, '--json', attempt]
            result = self.run(argv)
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
            self.lock.release()

    def run(self, argv):
        def decode(value):
            return (value or b'').decode('utf-8', errors='replace')
        try:
            result = subprocess.run(argv, shell=False, capture_output=True, timeout=TIMEOUT, check=False)
            return dict(stdout=decode(result.stdout), stderr=decode(result.stderr), exit_code=result.returncode, timed_out=False)
        except subprocess.TimeoutExpired as exc:
            return dict(stdout=decode(exc.stdout), stderr=decode(exc.stderr), exit_code=None, timed_out=True,
                        notice='ag exceeded 420 seconds. Result is uncertain; inspect with ag status. No automatic retry.')
        except OSError as exc:
            return dict(stdout='', stderr=str(exc), exit_code=None, timed_out=False,
                        notice='ag could not be started. No automatic retry.')
