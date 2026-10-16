"""Read mode-review reports without dereferencing their provenance paths.

Reuse descriptor-relative no-follow reads: a report or directory replaced with
an escaping link must not expose files outside the selected study. Malformed
reports remain local issues, never a reason to disable the vibration viewer.
"""
import json
import math
import re

from .studies import StudyError, component


def require(ok, field):
    if not ok:
        raise StudyError('mode-review 报告不合规：' + field)


def finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def validate(data, packet):
    def positive_integer(value, field, maximum):
        require(type(value) is int and finite(value) and 1 <= value <= maximum, field + ' 编号越界')

    n = len(packet['reference_geometry']['atoms'])
    # A different log may have another geometry/mode count. Its indices cannot
    # be bounded by this log; it is displayed as stale and never auto-applied.
    same_log = data['source']['log_sha256'] == packet['log_sha256']
    for key in ('mode', 'source_mode_index'):
        positive_integer(data.get(key), key, len(packet['modes']) if same_log else math.inf)
    for key in ('frequency', 'amplitude'):
        require(finite(data.get(key)), key + ' 必须为有限数')
    require(data['amplitude'] > 0, 'amplitude 必须为正数')
    require(data.get('orientation') in ('standard', 'input'), 'orientation')
    for key in ('rate_definition', 'note'):
        require(isinstance(data.get(key), str) and bool(data[key]), key + ' 缺失或类型错误')
    source = data['source']
    require(isinstance(source.get('log'), str), 'source.log 缺失或类型错误')
    for key in ('log_sha256', 'section_sha256'):
        require(isinstance(source.get(key), str) and re.fullmatch(r'[0-9a-f]{64}', source[key]), 'source.' + key)
    require(isinstance(data['pairs'], list) and bool(data['pairs']), 'pairs 必须为非空数组')
    for i, pair in enumerate(data['pairs']):
        field = f'pairs[{i}]'
        require(isinstance(pair, dict), field)
        atoms = pair.get('atoms')
        require(isinstance(atoms, list) and len(atoms) == 2, field + '.atoms')
        for atom in atoms:
            positive_integer(atom, field + '.atoms', n if same_log else math.inf)
        require(atoms[0] != atoms[1], field + '.atoms 必须不同')
        elements = pair.get('elements')
        require(isinstance(elements, list) and len(elements) == 2 and all(isinstance(e, str) and e for e in elements), field + '.elements')
        for key in ('distance', 'plus_distance', 'minus_distance', 'plus_change', 'minus_change', 'distance_change_rate'):
            require(finite(pair.get(key)), field + '.' + key + ' 缺失或不是有限数')
        require(all(pair[k] >= 0 for k in ('distance', 'plus_distance', 'minus_distance')), field + ' 距离不能为负')
        positive_integer(pair.get('absolute_rate_rank'), field + '.absolute_rate_rank', n * (n - 1) // 2 if same_log else math.inf)
    # Return only display fields, not unrelated metadata supplied by a report.
    result = {key: data[key] for key in ('attempt', 'mode', 'source_mode_index', 'frequency', 'amplitude',
                                      'orientation', 'source', 'pairs', 'rate_definition', 'note')}
    result['source'] = {key: source[key] for key in ('log', 'log_sha256', 'section_sha256')}
    result['pairs'] = [{key: pair[key] for key in ('atoms', 'elements', 'distance', 'plus_distance',
                       'minus_distance', 'plus_change', 'minus_change', 'distance_change_rate',
                       'absolute_rate_rank')} for pair in data['pairs']]
    return result


def list_reports(store, study, attempt, log):
    packet = store.vibrations(study, attempt, log)
    base = (component(study), 'analyses')
    component(attempt)
    reports, issues, locations = [], [], [()]
    try:
        for name, error in store.names(base, directories=True):
            if error:
                issues.append(dict(name=name, error=error))
            else:
                locations.append((name,))
        for group in locations:
            try:
                names = store.names((*base, *group))
            except StudyError as exc:
                issues.append(dict(name='/'.join(group), error=str(exc)))
                continue
            for name, error in names:
                if not name.endswith('.json'):
                    continue
                display_name = '/'.join((*group, name))
                try:
                    if error:
                        raise StudyError(error)
                    # Parse first to identify the Attempt. Validation below rejects
                    # NaN/Infinity in every displayed numeric field.
                    data = json.loads(store.read((*base, *group, name)).decode('utf-8'))
                    if (not isinstance(data, dict) or data.get('attempt') != attempt
                            or not all(k in data for k in ('mode', 'pairs', 'rate_definition'))
                            or not isinstance(data.get('source'), dict) or 'log_sha256' not in data['source']):
                        continue
                    report = validate(data, packet)
                    reports.append(dict(name=display_name, report=report,
                                        log_matches=data['source']['log_sha256'] == packet['log_sha256']))
                except (UnicodeError, ValueError, RecursionError):
                    issues.append(dict(name=display_name, error='JSON 不合规：无法解析'))
                except StudyError as exc:
                    issues.append(dict(name=display_name, error=str(exc)))
    except StudyError as exc:
        issues.append(dict(name='analyses', error=str(exc)))
    return dict(log_sha256=packet['log_sha256'], reports=reports, issues=issues)
