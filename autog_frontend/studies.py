"""Read local study files without following links or opening writable handles.

Descriptor-relative O_NOFOLLOW traversal prevents a directory being replaced by
an escaping symlink between validation and open. Limits prevent a malformed local
file from exhausting the viewer. There is no cache, index, or derived-file write.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import errno
import difflib
import hashlib
import itertools
import json
import math
import os
import re
from pathlib import Path
import stat

from .geometry import parse_xyz, xyz_frame
from .inputs import parse_input
from .optimization import parse_optimization
from .monitor import validate_monitor
from .log_search import search_log, MAX_LOG_BYTES
from .vibrations import parse_log_modes
from .study_summary import parse_sections


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
            if name.startswith('.'):
                continue
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

    def review_state(self, base):
        try:
            return 'present' if self.read((*base, 'review.md')).decode('utf-8').strip() else 'empty'
        except StudyError as exc:
            return 'missing' if exc.status == 404 else 'unreadable'
        except UnicodeError:
            return 'unreadable'

    def analysis_document(self, study, parts):
        path = (study, 'analyses', *parts)
        doc = self.document(path, parts[-1].endswith('.json'))
        updated = None
        try:
            with self.open_file(path) as stream:
                updated = datetime.fromtimestamp(os.fstat(stream.fileno()).st_mtime, timezone.utc).isoformat()
        except (StudyError, ValueError, OverflowError):
            pass
        return {'name': '/'.join(parts), **doc, 'updated_at': updated}

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
                             'state': s.get('state') if isinstance(s.get('state'), str) else 'unavailable', 'manifest': manifest, 'status': status,
                             'facts': self.document((*base, 'facts.json'), True), 'review_state': self.review_state(base)})
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
            elif name.endswith(('.json', '.md', '.csv', '.txt')):
                analyses.append(self.analysis_document(study, (name,)))
        # The same one-subdirectory depth already used by ensemble/IRC viewers.
        for folder, error in self.names((study, 'analyses'), directories=True):
            if error:
                continue  # Root symlinks were reported above; never follow them.
            try:
                for name, error in self.names((study, 'analyses', folder)):
                    if error:
                        issues.append({'path': f'analyses/{folder}/{name}', 'error': error})
                    elif name.endswith(('.json', '.md', '.csv', '.txt')):
                        analyses.append(self.analysis_document(study, (folder, name)))
            except StudyError as exc:
                issues.append({'path': f'analyses/{folder}', 'error': str(exc)})
        document = self.document((study, 'study.md'))
        return {'id': study, 'study': document, 'sections': parse_sections(document['data']), 'attempts': attempts,
                'graph': {'nodes': nodes, 'edges': edges}, 'analyses': analyses, 'structure_files': self.structure_files(study), 'issues': issues}

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
        try:
            input_files = [{'name': name, 'error': error} for name, error in self.names((*base, 'inputs'))]
        except StudyError as exc:
            input_files = []
            issues.append({'path': 'inputs', 'error': str(exc)})
        input_geometry = self.input_geometry(study, attempt, data['manifest'], input_files)
        return {'id': attempt, **data, 'geometry': geometry, 'input_geometry': input_geometry,
                'input_files': input_files, 'logs': logs, 'issues': issues}

    def crest_frames(self, study, attempt, name, frame=0):
        from .ensembles import crest_frames
        return crest_frames(self, study, attempt, name, frame)

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


    def input_file(self, study, attempt, name):
        raw = self.read((component(study), 'attempts', component(attempt), 'inputs', component(name)), 1024*1024)
        try:
            text = raw.decode('utf-8')
        except UnicodeError:
            raise StudyError('输入文件不是有效 UTF-8 文本') from None
        digest = hashlib.sha256(raw).hexdigest()
        manifest = self.document((study, 'attempts', attempt, 'manifest.json'), True)['data'] or {}
        records = manifest.get('inputs', [])
        expected = next((r.get('sha256') for r in records if isinstance(r, dict) and r.get('name') == name), None) if isinstance(records, list) else None
        return {'name': name, 'text': text, 'size_bytes': len(raw), 'sha256': digest,
                'manifest_sha256': expected, 'hash_matches': digest == expected if expected else None}

    def input_geometry(self, study, attempt, manifest, files):
        try:
            if manifest['data'] is None:
                raise ValueError('manifest 不可读')
            candidates = [f['name'] for f in files if f['name'].lower().endswith(('.gjf', '.xyz'))]
            if len(candidates) != 1:
                raise ValueError('inputs 中需要恰好一个 .gjf 或 .xyz 输入文件')
            source = self.input_file(study, attempt, candidates[0])
            geometry = parse_input(source['text'], candidates[0], manifest['data'])
            geometry.update({key: value for key, value in source.items() if key != 'text'})
            return {'data': geometry, 'error': None}
        except (StudyError, ValueError, TypeError, IndexError, OverflowError) as exc:
            return {'data': None, 'error': '无法预览：'+str(exc)}

    def input_diff(self, study, attempt, name, parent, parent_file):
        component(parent)
        manifest = self.document((component(study), 'attempts', component(attempt), 'manifest.json'), True)['data'] or {}
        parents = manifest.get('parents', [])
        if not isinstance(parents, list) or not any(isinstance(p, dict) and p.get('attempt_id') == parent for p in parents):
            raise StudyError('只能与 manifest 中记录的父 Attempt 对比', 400)
        before = self.input_file(study, parent, parent_file)
        after = self.input_file(study, attempt, name)
        a, b = before['text'].splitlines(keepends=True), after['text'].splitlines(keepends=True)
        # Avoid quadratic alignment and huge DOM output on pathological 1 MB inputs.
        if len(a)*len(b) > 4_000_000:
            diff = itertools.chain(('--- '+parent+'/'+parent_file, '+++ '+attempt+'/'+name),
                                   ('-'+line for line in a), ('+'+line for line in b)) if a != b else iter(())
            alignment = 'large-input-replacement'
        else:
            diff = difflib.unified_diff(a, b, fromfile=parent+'/'+parent_file, tofile=attempt+'/'+name, lineterm='')
            alignment = 'unified'
        lines = list(itertools.islice(diff, 2001))
        return {'lines': [line.rstrip('\r\n') for line in lines[:2000]], 'truncated': len(lines)>2000,
                'alignment': alignment, 'identical': before['sha256'] == after['sha256'],
                'parent_sha256': before['sha256'], 'input_sha256': after['sha256'],
                'parent_final_newline': before['text'].endswith('\n'), 'input_final_newline': after['text'].endswith('\n')}

    def structure_files(self, study):
        result = []
        for area in ('structures', 'analyses'):
            for group, error in self.names((study, area), directories=True):
                if error:
                    result.append({'parts': [area, group], 'error': error})
                    continue
                for name, error in self.names((study, area, group)):
                    if name.lower().endswith('.xyz'):
                        result.append({'parts': [area, group, name], 'error': error})
        for name, error in self.names((study, 'analyses')):
            if name.lower().endswith('.xyz'):
                result.append({'parts': ['analyses', name], 'error': error})
        return result

    def structure_frame(self, study, parts, frame):
        if not (len(parts) == 3 and parts[0] in ('structures', 'analyses') or len(parts) == 2 and parts[0] == 'analyses'):
            raise StudyError('Invalid structure location', 400)
        if not parts[-1].lower().endswith('.xyz'):
            raise StudyError('Only XYZ structures are readable', 400)
        try:
            with self.open_file((component(study), *(component(p) for p in parts))) as stream:
                if os.fstat(stream.fileno()).st_size > 32*1024*1024:
                    raise StudyError('XYZ 超过 32 MB', 413)
                return xyz_frame(stream, frame)
        except (ValueError, UnicodeError) as exc:
            raise StudyError('无法预览：'+str(exc)) from None

    def log_search(self, study, attempt, log, query, start, last):
        with self.open_file(self.log_parts(study, attempt, log)) as stream:
            if os.fstat(stream.fileno()).st_size > MAX_LOG_BYTES:
                raise StudyError('日志搜索仅支持不超过 32 MB 的文件', 413)
            try:
                return search_log(stream, query, start, last)
            except ValueError as exc:
                raise StudyError(str(exc)) from None

    def optimization(self, study, attempt, log):
        raw = self.read(self.log_parts(study, attempt, log), 32*1024*1024)
        try:
            return parse_optimization(raw, log)
        except (ValueError, UnicodeError):
            raise StudyError('无法解析优化过程：日志文本或数字无效') from None

    def monitor(self, cluster=None):
        try:
            parts = ('.ag-monitor', 'latest.json') if cluster is None else ('.ag-monitor', component(cluster), 'latest.json')
            raw = self.read(parts, 2*1024*1024)
        except StudyError as exc:
            if exc.status == 404:
                raise StudyError('请在终端运行 ag monitor --watch 120', 404) from None
            raise
        try:
            data = json.loads(raw.decode('utf-8'), parse_float=finite_float,
                              parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            return validate_monitor(data)
        except (UnicodeError, ValueError, RecursionError):
            raise StudyError('快照格式不正确') from None

    def monitors(self, configured=()):
        names = set(configured)
        names.update(name for name, _ in self.names(('.ag-monitor',), directories=True)
                     if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', name))
        legacy = any(name == 'latest.json' for name, _ in self.names(('.ag-monitor',)))
        if legacy or not names:
            names.add('default')
        rows = []
        named_dirs = {n for n, _ in self.names(('.ag-monitor',), directories=True)}
        for name in sorted(names):
            named = name in named_dirs
            sources = ['named'] if named or name != 'default' or not legacy else []
            if name == 'default' and legacy:
                sources.append('legacy')
            for source in sources:
                row = dict(name=name, source=source, snapshot=None, error=None,
                           ambiguous=len(sources) > 1)
                try:
                    row['snapshot'] = self.monitor(name if source == 'named' else None)
                    identity = (row['snapshot'].get('cluster') or {}).get('name')
                    if identity is not None and identity != name:
                        row['snapshot'] = None
                        raise StudyError('快照集群名称与目录不一致')
                except StudyError as exc:
                    row['error'] = str(exc)
                rows.append(row)
        return dict(clusters=rows)

    def monitor_for_cluster(self, name):
        rows = [row for row in self.monitors((name,))['clusters'] if row['name'] == name]
        # Conflicting default locations must not authorize cancellation using a
        # historical warning from another cache layout.
        if len(rows) != 1 or rows[0]['snapshot'] is None:
            raise StudyError('Cluster monitor unavailable or ambiguous', 409)
        return rows[0]['snapshot']
