"""Read template sections in memory. Signature text is a record, not acceptance."""
import re

TITLES = ('当前阻塞', '待你决定', '里程碑签字', '进度日志')
PENDING = re.compile(r'待签|未签')
PLACEHOLDER = re.compile(r'待确认|待填写|<[^>]+>|TODO', re.I)


def study_type(name, markdown):
    """Only the initial front matter can override the conservative name fallback."""
    lines = (markdown or '').lstrip('\ufeff').splitlines()
    end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() in ('---', '...')), None)
    if lines and lines[0].strip() == '---' and end is not None:
        for line in lines[1:end]:
            match = re.fullmatch(r'\s*(type|类型)\s*:\s*([^#]+?)(?:\s+#.*)?', line)
            if match:
                value = match[2].strip().strip('\"\'')
                kind = {'research': 'research', 'validation': 'validation', 'test': 'test',
                        '研究': 'research', '验证': 'validation', '测试': 'test'}.get(value)
                if kind:
                    return kind
    return 'validation' if name.startswith('val-') else 'test' if name.startswith(('test-', 'demo-')) else 'research'


def milestone_state(values, table=False):
    text = ' '.join(values).strip()
    if values and all(v == '不适用' for v in values):
        return 'not_applicable'
    if PENDING.search(text):
        return 'pending'
    if '未开始' in text or not text or all(not v or v in ('—', '-') or PLACEHOLDER.fullmatch(v) for v in values):
        return 'not_started'
    if table and len(values) == 3 and re.fullmatch(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', values[0]) and all(v and v not in ('—', '-') and not PLACEHOLDER.search(v) for v in values):
        return 'recorded'
    if not table and re.match(r'^已签(?:字)?(?:\s|[：:（(]|$)', text):
        return 'recorded'
    return 'unknown'


def cells(line):
    return [cell.strip() for cell in re.split(r'(?<!\\)\|', line.strip().strip('|'))]


def parse_sections(markdown):
    sections = {title: {'present': False, 'text': '', 'entries': []} for title in TITLES}
    active, fence, lines = None, None, []
    for number, line in enumerate((markdown or '').splitlines(), 1):
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})', line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            if active:
                lines.append((number, line, True))
            continue
        heading = None if fence else re.match(r'^ {0,3}(#{1,2})\s+(.+?)\s*#*\s*$', line)
        if heading:
            if active:
                _fill(sections[active], lines, active)
            active = heading[2] if len(heading[1]) == 2 and heading[2] in sections else None
            lines = []
            if active:
                sections[active]['present'] = True
        elif active:
            lines.append((number, line, fence is not None))
    if active:
        _fill(sections[active], lines, active)
    return sections


def _fill(section, lines, title):
    # Keep duplicate sections visible in source order rather than silently losing one.
    section['text'] += ('\n\n' if section['text'] else '') + '\n'.join(line for _, line, _ in lines).strip()
    headers = None
    for i, (number, raw, fenced) in enumerate(lines):
        line = raw.strip()
        if fenced or not line or line.startswith(('#', '<!--')):
            continue
        row = cells(line) if line.startswith('|') else None
        if row and all(re.fullmatch(r':?-{3,}:?', cell) for cell in row):
            continue
        if row and i + 1 < len(lines):
            following = cells(lines[i + 1][1])
            if all(re.fullmatch(r':?-{3,}:?', cell) for cell in following):
                headers = row
                continue
        text = re.sub(r'^(?:[-*+]\s+|\d+[.)]\s+)', '', line)
        entry = {'text': ' · '.join(row) if row else text, 'line': number}
        if title == '里程碑签字':
            if row and headers and '里程碑' in headers:
                values = dict(zip(headers, row))
                entry['label'] = values.get('里程碑', '')
                signature = [values.get(k, '') for k in ('日期', '签字人', '人的确认原意')]
                entry['state'] = milestone_state([values['状态']]) if values.get('状态') else milestone_state(signature, table=True)
            elif re.match(r'^[-*+]\s+', line) and re.search(r'[:：]', text):
                label, value = re.split(r'[:：]', text, maxsplit=1)
                entry.update(label=label.strip(), state=milestone_state([value.strip()]))
            elif row or re.match(r'^[-*+]\s+', line):
                entry.update(label=text, state='unknown')
            else:
                # Template prose about how to sign is not itself a milestone.
                continue
        section['entries'].append(entry)
