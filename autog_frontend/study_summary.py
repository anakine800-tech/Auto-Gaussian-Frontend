"""Read template sections in memory. Signature text is a record, not acceptance."""
import re

TITLES = ('当前阻塞', '待你决定', '里程碑签字', '进度日志')
PENDING = re.compile(r'待签|未签|待确认|待填写|<[^>]+>|TODO', re.I)


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
                if all(v == '不适用' for v in signature):
                    entry['state'] = 'not_applicable'
                elif any(not v or v in ('—', '-') or PENDING.search(v) for v in signature):
                    entry['state'] = 'pending'
                else:
                    entry['state'] = 'recorded'
            elif re.match(r'^[-*+]\s+', line) and re.search(r'[:：]', text):
                label, value = re.split(r'[:：]', text, maxsplit=1)
                entry.update(label=label.strip(), state='pending' if PENDING.search(value) else
                             'not_applicable' if value.strip() == '不适用' else 'unknown')
            else:
                # Template prose about how to sign is not itself a milestone.
                continue
        section['entries'].append(entry)
