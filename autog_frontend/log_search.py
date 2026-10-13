"""Literal UTF-8 search over bounded binary chunks; return line indexes only."""
MAX_LOG_BYTES = 32*1024*1024
CHUNK_BYTES = 64*1024


def search_log(stream, query, start=0, last=False):
    needle = query.encode('utf-8')
    if not needle or b'\n' in needle or b'\r' in needle or len(needle) > 1024:
        raise ValueError('请输入单行关键词（UTF-8 不超过 1024 字节）')
    pending, consumed, line_index, found, matches = b'', 0, 0, None, 0
    while True:
        chunk = stream.read(CHUNK_BYTES)
        consumed += len(chunk)
        if consumed > MAX_LOG_BYTES:
            raise ValueError('日志搜索仅支持不超过 32 MB 的文件')
        if not chunk:
            lines, pending = ([pending] if pending else []), b''
        else:
            parts = (pending+chunk).split(b'\n')
            lines, pending = parts[:-1], parts[-1]
        if len(pending) > 1024*1024:
            raise ValueError('日志单行超过显示上限')
        for line in lines:
            if len(line) > 1024*1024:
                raise ValueError('日志单行超过显示上限')
            if needle in line:
                matches += 1
                if last or (found is None and line_index >= start):
                    found = line_index
            line_index += 1
        if not chunk:
            break
    return {'line': found, 'matches': matches, 'total_lines': line_index}
