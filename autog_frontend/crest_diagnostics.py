"""Read T159 source bindings, never diagnose CREST or write study files."""
import hashlib
import json
import os
import re

LOG_NAMES = ('crest.out', 'job.pbs.out', 'job.slurm.out', 'job.slurm.err')
MAX_LOG_BYTES = 256 * 1024 * 1024
MAX_LINE_BYTES = 1024 * 1024
MAX_EXCERPT_BYTES = 64 * 1024
MAX_EXCERPT_LINES = 120
STATUSES = ('identified', 'unresolved', 'none', 'unavailable')


def digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def source_error(source, *, lines=True):
    if not isinstance(source, dict):
        return 'invalid_source'
    if source.get('file') not in LOG_NAMES:
        return 'unsupported'
    if not digest(source.get('sha256')):
        return 'invalid_source'
    if lines:
        first, last = source.get('line_start'), source.get('line_end')
        if (type(first) is not int or type(last) is not int
                or not 1 <= first <= last <= MAX_LOG_BYTES):
            return 'invalid_range'
    elif type(source.get('size')) is not int or source['size'] < 0:
        return 'invalid_source'
    return None


def metadata(facts, study, attempt):
    """Small display adapter; malformed optional records cannot break detail."""
    if not isinstance(facts, dict) or 'crest_diagnostics' not in facts:
        return None
    raw = facts['crest_diagnostics']
    invalid = dict(available=False, error='结构化诊断格式无效；可在来源与哈希查看原 facts。')
    if not isinstance(raw, dict):
        return invalid
    if (raw.get('status') not in STATUSES or not isinstance(raw.get('summary'), str)
            or not 0 < len(raw['summary']) <= 300
            or not isinstance(raw.get('sources'), list) or len(raw['sources']) > 32):
        return invalid
    for field in ('scan_truncated', 'summary_truncated'):
        if field in raw and type(raw[field]) is not bool:
            return invalid
    if ('parse_status' in raw and raw['parse_status'] not in ('complete', 'incomplete')
            or raw.get('parse_error') is not None and
            (not isinstance(raw['parse_error'], str) or len(raw['parse_error']) > 300)):
        return invalid
    files, missing, findings = raw.get('files', []), raw.get('missing_sources', []), raw.get('findings', [])
    if (not isinstance(files, list) or len(files) > 4
            or not isinstance(missing, list) or len(missing) > 4
            or any(name not in LOG_NAMES for name in missing)
            or not isinstance(findings, list) or len(findings) > 32):
        return invalid
    labels = {}
    for finding in findings:
        if (not isinstance(finding, dict) or type(finding.get('source_index')) is not int
                or not 0 <= finding['source_index'] < len(raw['sources'])
                or finding.get('level') not in ('error', 'warning', 'info', 'unknown')
                or not isinstance(finding.get('message'), str) or len(finding['message']) > 300):
            return invalid
        labels.setdefault(finding['source_index'], []).append(
            dict(level=finding['level'], message=finding['message']))
    sources = []
    for index, source in enumerate(raw['sources']):
        error = source_error(source)
        sources.append(dict(index=index, error=error, findings=labels.get(index, []),
                            **({key: source[key] for key in ('file', 'sha256', 'line_start', 'line_end')}
                               if not error else {})))
    records = []
    for source in files:
        error = source_error(source, lines=False)
        records.append(dict(error=error, **({key: source[key] for key in ('file', 'sha256', 'size')}
                                           if not error else {})))
    token = hashlib.sha256(json.dumps([study, attempt, raw], sort_keys=True,
                                     ensure_ascii=False).encode()).hexdigest()
    return dict(available=True, token=token, status=raw['status'], summary=raw['summary'],
                sources=sources, files=records, missing_sources=missing,
                scan_truncated=raw.get('scan_truncated', False),
                summary_truncated=raw.get('summary_truncated', False),
                parse_status=raw.get('parse_status'), parse_error=raw.get('parse_error'))


class LogReadError(ValueError):
    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code, self.status = code, status


def signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def read_window(store, parts, name, start, limit, *, expected=None, byte_limit=None):
    """Same bounded local reader for full pages and verified source excerpts."""
    lines, total, size, kept = [], 0, 0, 0
    truncated = False
    sha = hashlib.sha256()
    with store.open_file(parts) as stream:
        before = signature(os.fstat(stream.fileno()))
        if before[2] > MAX_LOG_BYTES:
            raise LogReadError('too_large', 'Log exceeds 256 MiB display limit', 413)
        while line := stream.readline(MAX_LINE_BYTES + 1):
            size += len(line)
            if size > MAX_LOG_BYTES:
                raise LogReadError('too_large', 'Log exceeds 256 MiB display limit', 413)
            if len(line) > MAX_LINE_BYTES:
                raise LogReadError('line_too_long', 'Log line exceeds 1 MiB display limit', 413)
            sha.update(line)
            if start <= total < start + limit:
                text = line.decode('utf-8', errors='replace')
                display_bytes = len(text.encode('utf-8'))
                if not truncated and (byte_limit is None or kept + display_bytes <= byte_limit):
                    lines.append(text)
                    kept += display_bytes
                else:
                    truncated = True
            total += 1
        if signature(os.fstat(stream.fileno())) != before:
            raise LogReadError('changed', '日志读取期间发生变化；请重新核对来源。')
        # Reopen through the complete safe descriptor path: a directory/file
        # replaced during the read must not be mistaken for the same source.
        with store.open_file(parts) as current:
            if signature(os.fstat(current.fileno())) != before:
                raise LogReadError('changed', '日志读取期间发生替换；请重新核对来源。')
    actual = sha.hexdigest()
    if expected is not None and actual != expected:
        raise LogReadError('mismatch', 'SHA-256 不符；当前文件不是原诊断的命中证据。')
    return dict(name=name, start=start, limit=limit, total_lines=total, text=''.join(lines),
                sha256=actual, truncated=truncated, shown_lines=len(lines))


def excerpt(store, study, attempt, index, token):
    from .studies import StudyError, component
    base = (component(study), 'attempts', component(attempt))
    facts = store.document((*base, 'facts.json'), True)['data']
    record = metadata(facts, study, attempt)
    if not record or not record['available']:
        return dict(status='unavailable', text='')
    if record['token'] != token:
        return dict(status='stale', text='')
    if not 0 <= index < len(record['sources']):
        return dict(status='invalid_source', text='')
    source = record['sources'][index]
    if source['error']:
        return dict(status=source['error'], text='')
    first, last = source['line_start'], source['line_end']
    start = max(0, first - 4)
    limit = min(MAX_EXCERPT_LINES, last + 3 - start)
    try:
        page = read_window(store, (*base, 'outputs', source['file']), source['file'], start, limit,
                           expected=source['sha256'], byte_limit=MAX_EXCERPT_BYTES)
        if not page['total_lines']:
            return dict(status='empty', text='')
        if last > page['total_lines']:
            return dict(status='invalid_range', text='')
        # A changed facts record must not relabel a response already in flight.
        current = metadata(store.document((*base, 'facts.json'), True)['data'], study, attempt)
        if not current or current.get('token') != token:
            return dict(status='stale', text='')
        page['truncated'] |= last > start + page['shown_lines']
        return dict(status='matched', line_start=first, line_end=last, **page)
    except LogReadError as exc:
        return dict(status=exc.code, text='')
    except StudyError as exc:
        return dict(status='missing' if exc.status == 404 else 'unreadable', text='')
