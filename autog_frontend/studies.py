"""Read local study files without following links or opening writable handles.

Descriptor-relative O_NOFOLLOW traversal prevents a directory being replaced by
an escaping symlink between validation and open. Limits prevent a malformed local
file from exhausting the viewer. Report metadata is cached in memory only;
there is no index or derived-file write.
"""
import codecs
from collections import OrderedDict
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
from threading import Lock
from urllib.parse import unquote, urlsplit

from .geometry import parse_xyz, xyz_frame
from .inputs import parse_input
from .optimization import parse_optimization
from .monitor import validate_monitor
from .log_search import search_log, MAX_LOG_BYTES
from .vibrations import parse_log_modes
from .study_summary import parse_sections, energy_basis


# Directory and aggregate reference limits prevent a large/sparse local tree
# from exhausting memory or monopolizing a request. Truncation stays visible.
EVIDENCE_ENTRY_LIMIT = 10000
EVIDENCE_DEPTH_LIMIT = 8
EVIDENCE_REFERENCE_BYTES = 32 * 1024 * 1024


def evidence_type(parts):
    name, suffix = parts[-1], Path(parts[-1]).suffix.lower()
    if name == 'review.md': return 'review'
    if parts[0] in ('signoffs', 'signatures') or name.endswith('.signature.json') or (parts[0]=='analyses' and name.startswith('review-manifest-') and suffix=='.json'): return 'signature'
    if len(parts)>2 and parts[0]=='attempts' and parts[2] in ('inputs', 'outputs'): return 'input-log'
    if suffix in ('.xyz', '.sdf', '.mol', '.mol2', '.cif', '.cdx', '.cdxml'): return 'structure'
    if suffix in IMAGE_TYPES: return 'image'
    if suffix == '.html': return 'html'
    if suffix in ('.csv', '.tsv', '.xlsx'): return 'table'
    if suffix in ('.json', '.jsonl'): return 'json'
    return 'report'


def local_evidence_path(url, source):
    if not url or url.startswith(('#', '/', '\\')) or re.search(r'[\x00-\x1f\x7f]', url):
        return None
    try:
        split = urlsplit(url)
        if split.scheme or split.netloc: return None
        path = unquote(split.path, errors='strict')
    except (ValueError, UnicodeError):
        return None
    if not path or path.startswith('/') or '\\' in path or re.search(r'[\x00-\x1f\x7f]', path): return None
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', path): return None
    parts = source.split('/')[:-1]
    for part in path.split('/'):
        if part in ('', '.'): continue
        if part == '..':
            if not parts: return None
            parts.pop()
        else: parts.append(part)
    return '/'.join(parts) or None


def markdown_local_links(text, source):
    # Ignore fenced/indented code, inline code, HTML and raw URLs. Only explicit
    # Markdown links/images (including reference style) are citation sources.
    lines, fence = [], None
    for line in text.splitlines():
        mark = re.match(r'^ {0,3}(`{3,}|~{3,})', line)
        if fence:
            if mark and mark[1][0]==fence[0] and len(mark[1])>=len(fence): fence=None
            continue
        if mark: fence=mark[1]; continue
        if line.startswith(('    ', '\t')): continue
        lines.append(line)
    text = re.sub(r'<!--.*?-->', '', '\n'.join(lines), flags=re.S)
    text = re.sub(r'(`+)[^`]*?\1', '', text)
    normalize = lambda label: ' '.join(label.split()).casefold()
    definitions = {}
    for match in re.finditer(r'^ {0,3}\[([^][\n]+)\]:[ \t]*(<[^>\n]+>|[^\s]+)', text, re.M):
        definitions.setdefault(normalize(match[1]), match[2].strip('<>'))
    text = re.sub(r'^ {0,3}\[[^][\n]+\]:.*$', '', text, flags=re.M)
    links = set()
    # Balanced parentheses in destinations, such as image(1).png, are allowed.
    pattern = r'(?<!\\)\[([^][\n]*)\](?:\((<[^>\n]+>|(?:[^\s()]|\([^()]*\))+)(?:[ \t]+["\'][^\n]*?["\'])?\)|\[([^][\n]*)\])?'
    for match in re.finditer(pattern, text):
        url = match[2].strip('<>') if match[2] else definitions.get(normalize(match[3] or match[1]))
        target = local_evidence_path(url, source) if url else None
        if target: links.add(target)
    return tuple(sorted(links))


DOCUMENT_LIMIT = 4 * 1024 * 1024
IMAGE_LIMIT = 10 * 1024 * 1024
FILE_TYPES = {
    '.md': 'text/plain', '.txt': 'text/plain', '.csv': 'text/csv',
    '.json': 'application/json', '.xyz': 'text/plain', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.html': 'text/html',
}
IMAGE_TYPES = {'.png', '.jpg', '.jpeg', '.webp', '.svg'}
ANALYSIS_TYPES = set(FILE_TYPES) - {'.xyz'}
REPORT_KINDS = {'formal', 'energy', 'state-check', 'ensemble', 'irc', 'thermo',
                'coverage', 'ts', 'nci', 'stage-review', 'figure', 'other'}
SCHEMA_KINDS = {'ag-ensemble/1': 'ensemble', 'ag-irc-review/1': 'irc',
                'ag-thermo/1': 'thermo', 'ag-profile/1': 'thermo',
                'ag-channel-coverage/1': 'coverage', 'ag-nci/1': 'nci'}


def report_category(schema, declared, suffix, name=''):
    # Registration is applied to study metadata after the file-only cache.
    if isinstance(schema, str) and schema in SCHEMA_KINDS:
        return SCHEMA_KINDS[schema], '按 schema'
    if isinstance(declared, str) and declared in REPORT_KINDS:
        return declared, '按报告声明'
    if re.fullmatch(r'ts-labels/[^/]+/(labels\.json|labels\.md|channel-suggestions\.csv)', name):
        return 'ts', '按 TS 标签目录'
    return ('figure' if suffix in IMAGE_TYPES or suffix == '.html' else 'other'), '按文件类型'


def decode_document(raw, json_file=False):
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as exc:
        prefix = raw[:exc.start].decode('utf-8')
        line, column = prefix.count('\n') + 1, len(prefix.rsplit('\n', 1)[-1]) + 1
        return dict(data=None, error=f'解析失败：第 {line} 行第 {column} 列（UTF-8）')
    if not json_file:
        return dict(data=text, error=None)
    try:
        # JSON permits numbers larger than IEEE-754. Preserve those lexemes for
        # display instead of producing non-standard Infinity in an API response.
        def number(token):
            try:
                value = float(token) if any(c in token for c in '.eE') else int(token)
                return value if not isinstance(value, float) or math.isfinite(value) else token
            except ValueError:
                return token

        def constant(token):
            # Locate the invalid token outside JSON strings for an accurate line.
            tokens = re.finditer(r'"(?:[^"\\]|\\.)*"|NaN|-?Infinity', text)
            pos = next(m.start() for m in tokens if m.group() == token)
            raise json.JSONDecodeError('Invalid JSON constant', text, pos)

        return dict(data=json.loads(text, parse_float=number, parse_int=number, parse_constant=constant), error=None)
    except json.JSONDecodeError as exc:
        return dict(data=None, error=f'解析失败：第 {exc.lineno} 行第 {exc.colno} 列（JSON）')
    except RecursionError:
        return dict(data=None, error='JSON 嵌套超过显示能力；请查看原文')


TS_LABEL_FILES = ('labels.json', 'labels.md', 'channel-suggestions.csv')


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
        self._analysis_cache = OrderedDict()
        self._evidence_cache = OrderedDict()
        self._evidence_cache_lock = Lock()
        self._analysis_cache_lock = Lock()
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

    def document(self, parts, json_file=False, *, object_only=True):
        try:
            result = decode_document(self.read(parts), json_file)
            if json_file and object_only and result['error'] and result['error'].startswith('解析失败'):
                result['error'] = 'Malformed UTF-8 or JSON: ' + result['error']
            # Fixed ag records still require objects; generic report JSON has no
            # such schema requirement. Shape errors are not syntax errors.
            if json_file and object_only and not result['error'] and not isinstance(result['data'], dict):
                return dict(data=None, error='记录格式需要 JSON 对象（JSON 语法有效）')
            return result
        except StudyError as exc:
            return {'data': None, 'error': str(exc)}

    def file(self, study, path):
        parts = tuple(component(p) for p in path.split('/'))
        suffix = Path(parts[-1]).suffix.lower()
        if suffix not in FILE_TYPES:
            raise StudyError('Unsupported file type', 400)
        raw = self.read((component(study), *parts), IMAGE_LIMIT if suffix in IMAGE_TYPES else DOCUMENT_LIMIT)
        return raw, FILE_TYPES[suffix]

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

    def catalog(self, study):
        """Read one bounded snapshot; stale or unsafe registration is never adopted."""
        result = {'state': None, 'journal_ok': False, 'warning': None}
        try:
            with self.open_dir((study, 'catalog')):
                pass
        except StudyError as exc:
            if exc.status != 404:
                result['warning'] = '登记记录无法安全读取，按没有登记处理'
            return result
        try:
            raw = self.read((study, 'catalog', 'state.json'))
            journal = self.read((study, 'catalog', 'journal.jsonl'), limit=16*1024*1024)
            state = json.loads(raw, parse_float=finite_float,
                               parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(state, dict) or state.get('schema') != 'ag-catalog-state/1':
                raise ValueError()
            if state.get('journal_sha256') != hashlib.sha256(journal).hexdigest():
                raise ValueError()
            objects = state.get('objects')
            if not isinstance(objects, list):
                raise ValueError()
            for obj in objects:
                if not isinstance(obj, dict) or obj.get('status') not in ('adopted', 'candidate', 'retired'):
                    raise ValueError()
                members, adopted = obj.get('members', []), obj.get('adopted', {})
                if not isinstance(members, list) or not isinstance(adopted, dict):
                    raise ValueError()
                for ref in [*members, *(adopted.get(role) for role in ('opt', 'freq', 'sp'))]:
                    if ref is not None:
                        if not isinstance(ref, dict):
                            raise ValueError()
                        component(ref.get('attempt'))
            kinds = state.get('report_kinds', {})
            if not isinstance(kinds, dict) or any(not isinstance(k, str) or not isinstance(v, str) or v not in REPORT_KINDS for k, v in kinds.items()):
                raise ValueError()
            return {'state': state, 'journal_ok': True, 'warning': None}
        except StudyError:
            result['warning'] = '登记记录缺失或无法安全读取，按没有登记处理'
        except (ValueError, UnicodeError, RecursionError):
            result['warning'] = '登记记录格式或日志哈希不一致，按没有登记处理'
        return result

    def catalog_review_scope(self, study, catalog=None):
        """Share the snapshot with chains so review counts cannot disagree."""
        catalog = self.catalog(study) if catalog is None else catalog
        attempts = set()
        if catalog['journal_ok']:
            for obj in catalog['state']['objects']:
                if obj['status'] == 'retired':
                    continue
                refs = obj.get('members', []) if obj['status'] == 'candidate' else [
                    obj.get('adopted', {}).get(role) for role in ('opt', 'freq', 'sp')]
                attempts.update(ref['attempt'] for ref in refs if ref is not None)
        return {'available': catalog['journal_ok'], 'attempts': sorted(attempts), 'warning': catalog['warning']}

    def analysis_document(self, study, parts):
        path = (study, 'analyses', *parts)
        doc = self.document(path, parts[-1].lower().endswith('.json'), object_only=False)
        updated = None
        try:
            with self.open_file(path) as stream:
                updated = datetime.fromtimestamp(os.fstat(stream.fileno()).st_mtime, timezone.utc).isoformat()
        except (StudyError, ValueError, OverflowError):
            pass
        return {'name': '/'.join(parts), **doc, 'updated_at': updated}

    def analysis_summary(self, study, parts):
        """Return metadata, never report rows, under the existing file limit.

        Read the complete bounded JSON so a late top-level schema still outranks
        a kind declaration. Reuse unchanged metadata without rereading bodies.
        """
        suffix = Path(parts[-1]).suffix.lower()
        result = dict(name='/'.join(parts), data=None, error=None, updated_at=None, schema=None)
        path = (study, 'analyses', *parts)
        fields = ('st_mtime_ns', 'st_size', 'st_dev', 'st_ino', 'st_ctime_ns')
        declared = None
        try:
            # Validate each path again even on cache hits. The identity fields
            # also invalidate replacements that preserve mtime and size.
            with self._analysis_cache_lock, self.open_file(path) as stream:
                info = os.fstat(stream.fileno())
                version = tuple(getattr(info, field) for field in fields)
                cached = self._analysis_cache.get(path)
                if cached and cached[0] == version:
                    self._analysis_cache.move_to_end(path)
                    return dict(cached[1])
                result['updated_at'] = datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat()
                limit = IMAGE_LIMIT if suffix in IMAGE_TYPES else DOCUMENT_LIMIT
                if info.st_size > limit:
                    raise StudyError('File exceeds display size limit', 413)
                if suffix in ('.json', '.md'):
                    raw = stream.read(limit + 1)
                    if len(raw) > limit:
                        raise StudyError('File exceeds display size limit', 413)
                    doc = decode_document(raw, suffix == '.json')
                    result['error'] = doc['error']
                    data = doc['data']
                    if suffix == '.json' and isinstance(data, dict):
                        result['schema'] = data.get('schema') if isinstance(data.get('schema'), str) else None
                        declared = data.get('kind')
                    elif suffix == '.md' and isinstance(data, str):
                        front = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', data, re.S)
                        if front:
                            kind = re.search(r"^kind:[ \t]*(['\"]?)([a-z-]+)\1[ \t]*(?:#.*)?$", front[1], re.M)
                            declared = kind[2] if kind else None
                result['kind'], result['category_basis'] = report_category(result['schema'], declared, suffix, result['name'])
                after = os.fstat(stream.fileno())
                # Do not retain metadata if the file changed during the read.
                if tuple(getattr(after, field) for field in fields) == version:
                    self._analysis_cache[path] = (version, dict(result))
                    self._analysis_cache.move_to_end(path)
                    # Browsing many studies must not retain metadata forever.
                    if len(self._analysis_cache) > 1024:
                        self._analysis_cache.popitem(last=False)
        except (ValueError, OverflowError):
            result['error'] = '无法读取报告元数据'
        except StudyError as exc:
            result['error'] = str(exc)
        result['kind'], result['category_basis'] = report_category(result['schema'], declared, suffix, result['name'])
        return result

    def report(self, study, parts):
        fixed_ts = len(parts) == 3 and parts[0] == 'ts-labels' and parts[2] in TS_LABEL_FILES
        if not fixed_ts and (len(parts) not in (1, 2) or not parts[-1].endswith(('.json', '.md', '.csv', '.txt'))):
            raise StudyError('Unsupported analysis document', 400)
        return self.analysis_document(component(study), tuple(component(p) for p in parts))

    def snapshots(self, study, attempt):
        base = (component(study), 'attempts', component(attempt))
        with self.open_dir(base):
            pass
        snapshots = []
        for name, error in self.names((*base, 'snapshots'), directories=True):
            doc = dict(data=None, error=error) if error else self.document((*base, 'snapshots', name, 'snapshot.json'), True)
            if doc['data'] is not None and (doc['data'].get('schema') != 'ag-log-snapshot/1'
                                           or doc['data'].get('attempt_id') != attempt):
                doc = dict(data=None, error='Snapshot schema or Attempt identity does not match')
            snapshots.append(dict(name=name, **doc))
        return dict(snapshots=snapshots)

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
            elif Path(name).suffix.lower() in ANALYSIS_TYPES:
                analyses.append(self.analysis_summary(study, (name,)))
        # The same one-subdirectory depth already used by ensemble/IRC viewers.
        for folder, error in self.names((study, 'analyses'), directories=True):
            if error:
                continue  # Root symlinks were reported above; never follow them.
            try:
                # T98: only T91's three fixed filenames get a second directory.
                # No recursion or discovery of arbitrary files inside each name.
                if folder == 'ts-labels':
                    for label, error in self.names((study, 'analyses', folder), directories=True):
                        if error:
                            issues.append({'path': f'analyses/{folder}/{label}', 'error': error})
                            continue
                        for filename in TS_LABEL_FILES:
                            parts = (folder, label, filename)
                            try:
                                with self.open_file((study, 'analyses', *parts)):
                                    pass
                            except StudyError as exc:
                                if exc.status == 404:
                                    continue
                            analyses.append(self.analysis_summary(study, parts))
                for name, error in self.names((study, 'analyses', folder)):
                    if error:
                        issues.append({'path': f'analyses/{folder}/{name}', 'error': error})
                    elif Path(name).suffix.lower() in ANALYSIS_TYPES:
                        analyses.append(self.analysis_summary(study, (folder, name)))
            except StudyError as exc:
                issues.append({'path': f'analyses/{folder}', 'error': str(exc)})
        document = self.document((study, 'study.md'))
        catalog = self.catalog(study)
        # Apply registration after the file metadata cache, so new registrations
        # take effect even when the report's own bytes/mtime have not changed.
        kinds = catalog['state'].get('report_kinds', {}) if catalog['journal_ok'] else {}
        for report in analyses:
            if report['name'] in kinds:
                report['catalog_kind'] = kinds[report['name']]
        return {'id': study, 'study': document, 'sections': parse_sections(document['data']), 'attempts': attempts,
                'catalog': catalog, 'energy_basis': energy_basis(document['data']),
                'catalog_review': self.catalog_review_scope(study, catalog),
                'graph': {'nodes': nodes, 'edges': edges}, 'analyses': analyses, 'structure_files': self.structure_files(study), 'issues': issues}

    def evidence_catalog(self, study):
        """Only adopted report fields are reference sources; never parse other JSON.

        T121 supplies the shared catalog reader after integration. Until then the
        same bounded state/journal hash check keeps this branch independently usable.
        """
        if hasattr(self, 'catalog'):
            return self.catalog(study)
        result = {'state': None, 'journal_ok': False, 'warning': None}
        try:
            with self.open_dir((study, 'catalog')):
                pass
        except StudyError as exc:
            if exc.status != 404:
                result['warning'] = '登记目录无法安全读取'
            return result
        try:
            state = json.loads(self.read((study, 'catalog', 'state.json')), parse_float=finite_float,
                               parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            journal = self.read((study, 'catalog', 'journal.jsonl'), 16*1024*1024)
            if (not isinstance(state, dict) or state.get('schema') != 'ag-catalog-state/1'
                    or state.get('journal_sha256') != hashlib.sha256(journal).hexdigest()
                    or not isinstance(state.get('objects'), list)):
                raise ValueError()
            ids = set()
            for obj in state['objects']:
                if (not isinstance(obj, dict) or obj.get('status') not in ('adopted', 'candidate', 'retired')
                        or not isinstance(obj.get('members'), list) or not isinstance(obj.get('adopted', {}), dict)):
                    raise ValueError()
                identity = component(obj.get('id'))
                if identity in ids:
                    raise ValueError()
                ids.add(identity)
                for ref in [*obj['members'], *[obj.get('adopted', {}).get(role) for role in ('opt', 'freq', 'sp')]]:
                    if ref is not None:
                        if not isinstance(ref, dict):
                            raise ValueError()
                        component(ref.get('attempt'))
            return {'state': state, 'journal_ok': True, 'warning': None}
        except (StudyError, ValueError, UnicodeError, RecursionError):
            result['warning'] = '登记记录缺失、格式异常或日志哈希不一致；未使用采用记录'
            return result

    def evidence_links(self, study, path, budget):
        """Cache only local Markdown link destinations, never document bodies."""
        parts = (study, *path.split('/'))
        fields = ('st_mtime_ns', 'st_size', 'st_dev', 'st_ino', 'st_ctime_ns')
        with self._evidence_cache_lock, self.open_file(parts) as stream:
            info = os.fstat(stream.fileno())
            version = tuple(getattr(info, field) for field in fields)
            cached = self._evidence_cache.get(parts)
            if cached and cached[0] == version:
                self._evidence_cache.move_to_end(parts)
                return cached[1]
            # Bound both individual files and the total bodies examined per scan.
            if info.st_size > DOCUMENT_LIMIT or info.st_size > budget[0]:
                raise StudyError('引用统计达到 Markdown 读取量上限', 413)
            raw = stream.read(min(DOCUMENT_LIMIT, budget[0])+1)
            budget[0] -= len(raw)
            if len(raw) > DOCUMENT_LIMIT or budget[0] < 0:
                raise StudyError('引用统计达到 Markdown 读取量上限', 413)
            try:
                links = markdown_local_links(raw.decode('utf-8'), path)
            except UnicodeError:
                raise StudyError('Markdown 引用无法解码', 422) from None
            if tuple(getattr(os.fstat(stream.fileno()), field) for field in fields) != version:
                raise StudyError('Markdown 在读取时变化，请刷新', 409)
            self._evidence_cache[parts] = (version, links)
            self._evidence_cache.move_to_end(parts)
            if len(self._evidence_cache) > 1024:
                self._evidence_cache.popitem(last=False)
            return links

    def evidence(self, study):
        """One row per regular file; descriptor-relative, bounded, read-only walk."""
        study = component(study)
        files, issues, count, truncated = [], [], 0, False
        def walk(parts):
            nonlocal count, truncated
            with self.open_dir((study, *parts)) as directory, os.scandir(directory) as entries:
                for entry in entries:
                    if count >= EVIDENCE_ENTRY_LIMIT:
                        truncated = True
                        return
                    count += 1
                    try:
                        component(entry.name)
                        info = entry.stat(follow_symlinks=False)
                        path = (*parts, entry.name)
                        if stat.S_ISLNK(info.st_mode):
                            issues.append({'path': '/'.join(path), 'error': '符号链接已拒绝'})
                        elif stat.S_ISDIR(info.st_mode):
                            if len(path) >= EVIDENCE_DEPTH_LIMIT:
                                truncated = True
                            else:
                                walk(path)
                        elif stat.S_ISREG(info.st_mode):
                            # Reopen rather than trusting scandir metadata: a
                            # replaced file or parent must pass O_NOFOLLOW again.
                            with self.open_file((study, *path)) as stream:
                                info = os.fstat(stream.fileno())
                            files.append({'path': '/'.join(path), 'type': evidence_type(path),
                                          'size_bytes': info.st_size,
                                          'updated_at': datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
                                          'attempts': [path[1]] if len(path)>2 and path[0]=='attempts' else [],
                                          'objects': [], 'referenced_by': []})
                        else:
                            issues.append({'path': '/'.join(path), 'error': '非普通文件已拒绝'})
                    except (OSError, StudyError, ValueError, OverflowError):
                        issues.append({'path': '/'.join((*parts, entry.name)), 'error': '条目变化或无法安全读取'})
        walk(())
        files.sort(key=lambda item: item['path'])
        by_path = {item['path']: item for item in files}
        catalog = self.evidence_catalog(study)
        objects = catalog['state']['objects'] if catalog['journal_ok'] else []
        for obj in objects:
            members = {ref['attempt'] for ref in obj['members']}
            members.update(ref['attempt'] for role, ref in obj.get('adopted', {}).items()
                           if role in ('opt', 'freq', 'sp') and isinstance(ref, dict))
            for item in files:
                if members.intersection(item['attempts']):
                    item['objects'].append(obj['id'])
            for role in ('opt', 'freq', 'sp'):
                ref = obj.get('adopted', {}).get(role)
                report = ref.get('report') if isinstance(ref, dict) else None
                # T119 report fields are relative to analyses/, not catalog/.
                target = local_evidence_path(report, 'analyses/_') if isinstance(report, str) else None
                if target and target.startswith('analyses/') and target in by_path:
                    item = by_path[target]
                    item['referenced_by'].append({'kind': 'adoption', 'object': obj['id'], 'role': role})
                    if obj['id'] not in item['objects']:
                        item['objects'].append(obj['id'])
                    if ref['attempt'] not in item['attempts']:
                        item['attempts'].append(ref['attempt'])
        budget = [EVIDENCE_REFERENCE_BYTES]
        for item in files:
            if not item['path'].startswith('analyses/') or not item['path'].lower().endswith('.md'):
                continue
            try:
                for target in self.evidence_links(study, item['path'], budget):
                    if target in by_path:
                        by_path[target]['referenced_by'].append({'kind': 'markdown', 'path': item['path']})
            except StudyError as exc:
                issues.append({'path': item['path'], 'error': str(exc)})
        return {'files': files, 'issues': issues, 'truncated': truncated, 'catalog': catalog,
                'limits': {'entries': EVIDENCE_ENTRY_LIMIT, 'depth': EVIDENCE_DEPTH_LIMIT,
                           'reference_bytes': EVIDENCE_REFERENCE_BYTES}}

    def comparison_structure(self, study, attempt):
        """Fixed final geometry and facts only; never expand the detail reader.

        Arbitrary comparison must not read inputs, logs, reviews or paths stored
        in facts. Reuse the same descriptor-relative reader and XYZ limits as
        Attempt detail. There is no manifest hash for a generated final.xyz.
        """
        base = (component(study), 'attempts', component(attempt))
        with self.open_dir(base):
            pass
        facts = self.document((*base, 'facts.json'), True)
        try:
            geometry = {'data': parse_xyz(self.read((*base, 'final.xyz')).decode('utf-8')), 'error': None}
        except (StudyError, UnicodeError, ValueError) as exc:
            geometry = {'data': None, 'error': str(exc) if isinstance(exc, StudyError) else 'Invalid final.xyz'}
        return {'id': attempt, 'facts': facts, 'geometry': geometry}

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
