"""Read local study files without following links or opening writable handles.

Descriptor-relative O_NOFOLLOW traversal prevents a directory being replaced by
an escaping symlink between validation and open. Limits prevent a malformed local
file from exhausting the viewer. There is no cache, index, or derived-file write.
"""
from contextlib import contextmanager
import errno
import json
import math
import os
from pathlib import Path
import stat

from .geometry import parse_xyz
from .vibrations import parse_log_modes


class StudyError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def component(value):
    if not isinstance(value, str) or not value or value in ('.', '..') or any(c in value for c in ('/', '\\', '\x00')):
        raise StudyError('Invalid path component', 400)
    return value


def finite_float(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('Non-finite JSON number')
    return result


class Studies:
    def __init__(self, root):
        self.root = Path(os.path.abspath(root))
        # Check every component, including the configured root's ancestors.
        with self.open_dir(()):
            pass

    @contextmanager
    def open_dir(self, parts):
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in (*self.root.parts[1:], *parts):
                component(part)
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            yield fd
        except OSError as exc:
            if exc.errno == errno.ENOENT:
                raise StudyError('File or directory not available', 404) from None
            raise StudyError('Unsafe or unreadable file or directory', 403) from None
        finally:
            os.close(fd)

    @contextmanager
    def open_file(self, parts):
        with self.open_dir(parts[:-1]) as directory:
            try:
                fd = os.open(component(parts[-1]), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            except FileNotFoundError:
                raise StudyError('File not available', 404) from None
            except OSError:
                raise StudyError('Unsafe or unreadable file', 403) from None
            with os.fdopen(fd, 'rb') as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise StudyError('Only regular files are readable', 403)
                yield stream

    def names(self, parts, directories=False):
        try:
            with self.open_dir(parts) as fd:
                result = []
                for name in sorted(os.listdir(fd)):
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISLNK(info.st_mode):
                        result.append((name, 'symlink rejected'))
                    elif (stat.S_ISDIR if directories else stat.S_ISREG)(info.st_mode):
                        result.append((name, None))
                return result
        except StudyError as exc:
            if exc.status == 404:
                return []
            raise

    def read(self, parts, limit=4*1024*1024):
        with self.open_file(parts) as stream:
            data = stream.read(limit+1)
        if len(data) > limit:
            raise StudyError('File exceeds display size limit', 413)
        return data

    def document(self, parts, json_file=False):
        try:
            raw = self.read(parts).decode('utf-8')
            if json_file:
                raw = json.loads(raw, parse_float=finite_float, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                if not isinstance(raw, dict):
                    raise ValueError()
            return {'data': raw, 'error': None}
        except (UnicodeError, ValueError):
            return {'data': None, 'error': 'Malformed UTF-8 or JSON object'}
        except StudyError as exc:
            return {'data': None, 'error': str(exc)}

    def list_studies(self):
        result, issues = [], []
        for name, error in self.names((), directories=True):
            if error:
                issues.append({'path': name, 'error': error})
                continue
            doc = self.document((name, 'study.md'))
            if doc['data'] is None:
                issues.append({'path': name, 'error': doc['error']})
                continue
            title = next((s.lstrip('# ').strip() for s in doc['data'].splitlines() if s.startswith('# ')), name)
            result.append({'id': name, 'title': title})
        return {'studies': result, 'issues': issues}

    def study(self, study):
        component(study)
        with self.open_dir((study,)):
            pass
        attempts, issues, edges = [], [], []
        for name, error in self.names((study, 'attempts'), directories=True):
            if error:
                issues.append({'path': f'attempts/{name}', 'error': error})
                continue
            base = (study, 'attempts', name)
            manifest = self.document((*base, 'manifest.json'), True)
            status = self.document((*base, 'status.json'), True)
            m, s = manifest['data'] or {}, status['data'] or {}
            attempts.append({'id': name, 'label': m.get('label') if isinstance(m.get('label'), str) else None,
                             'template': m.get('template') if isinstance(m.get('template'), str) else None,
                             'state': s.get('state') if isinstance(s.get('state'), str) else 'unavailable', 'manifest': manifest, 'status': status})
            if m.get('attempt_id', name) != name:
                issues.append({'path': f'attempts/{name}', 'error': 'manifest attempt_id differs from directory; graph uses directory ID'})
            parents = m.get('parents', [])
            if not isinstance(parents, list):
                issues.append({'path': f'attempts/{name}/manifest.json', 'error': 'Invalid parents'})
                continue
            for parent in parents:
                if not isinstance(parent, dict) or not isinstance(parent.get('attempt_id'), str) or not isinstance(parent.get('relation', ''), str):
                    issues.append({'path': f'attempts/{name}/manifest.json', 'error': 'Invalid parent relation'})
                    continue
                edges.append({'parent': parent['attempt_id'], 'child': name, 'relation': parent.get('relation', '')})
        nodes = [{'id': a['id'], 'state': a['state'], 'missing': False} for a in attempts]
        known = {n['id'] for n in nodes}
        for edge in edges:
            if edge['parent'] not in known:
                nodes.append({'id': edge['parent'], 'state': 'missing', 'missing': True})
                known.add(edge['parent'])
        analyses = []
        for name, error in self.names((study, 'analyses')):
            if error:
                issues.append({'path': f'analyses/{name}', 'error': error})
            elif name.endswith(('.json', '.md', '.csv', '.xyz', '.txt')):
                analyses.append({'name': name, **self.document((study, 'analyses', name), name.endswith('.json'))})
        return {'id': study, 'study': self.document((study, 'study.md')), 'attempts': attempts,
                'graph': {'nodes': nodes, 'edges': edges}, 'analyses': analyses, 'issues': issues}

    def attempt(self, study, attempt):
        base = (component(study), 'attempts', component(attempt))
        with self.open_dir(base):
            pass
        data = {key: self.document((*base, filename), filename.endswith('.json')) for key, filename in
                [('manifest', 'manifest.json'), ('status', 'status.json'), ('facts', 'facts.json'), ('review', 'review.md')]}
        try:
            geometry = {'data': parse_xyz(self.read((*base, 'final.xyz')).decode('utf-8')), 'error': None}
        except (StudyError, UnicodeError, ValueError) as exc:
            geometry = {'data': None, 'error': str(exc) if isinstance(exc, StudyError) else 'Invalid final.xyz'}
        # Never dereference arbitrary paths supplied inside facts or manifest.
        logs, issues = [], []
        for name, error in self.names((*base, 'outputs')):
            if error:
                issues.append({'path': name, 'error': error})
            elif name.lower().endswith(('.log', '.out')):
                logs.append(name)
        return {'id': attempt, **data, 'geometry': geometry, 'logs': logs, 'issues': issues}

    def log_parts(self, study, attempt, log):
        parts = (component(study), 'attempts', component(attempt), 'outputs', component(log))
        if not log.lower().endswith(('.log', '.out')):
            raise StudyError('Only output logs are readable', 400)
        return parts

    def log_page(self, study, attempt, log, start, limit):
        lines, total = [], 0
        with self.open_file(self.log_parts(study, attempt, log)) as stream:
            if os.fstat(stream.fileno()).st_size > 256*1024*1024:
                raise StudyError('Log exceeds 256 MiB display limit', 413)
            while True:
                line = stream.readline(1024*1024+1)
                if not line:
                    break
                if len(line) > 1024*1024:
                    raise StudyError('Log line exceeds display limit', 413)
                if start <= total < start+limit:
                    lines.append(line.decode('utf-8', errors='replace'))
                total += 1
        return {'name': log, 'start': start, 'limit': limit, 'total_lines': total, 'text': ''.join(lines)}

    def vibrations(self, study, attempt, log):
        raw = self.read(self.log_parts(study, attempt, log), 32*1024*1024)
        try:
            return parse_log_modes(raw, log)
        except (ValueError, UnicodeError, IndexError, KeyError):
            raise StudyError('No unambiguous supported Gaussian Cartesian vibration table') from None
