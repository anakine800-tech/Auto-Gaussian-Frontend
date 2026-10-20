"""Read saved ag-irc-review/1 evidence; never derive scientific values.

Validate the whole report and both trajectories before exposing any content:
otherwise a replaced XYZ or invalid frame index can associate evidence with the
wrong structure. Structure comparisons read only explicitly hash-bound sources.
"""
import hashlib
import json
import math
import re

from .ensembles import MAX_MANIFEST, MAX_XYZ, MAX_FRAMES, xyz_frames
from .studies import StudyError, component
from .geometry import parse_xyz

DIRECTIONS = ('forward', 'reverse')
CRITERIA = ('continuity', 'energy_drop', 'midpoint', 'endpoint')
STATUSES = ('tool_checks_passed', 'met', 'met_by_endpoint_optimization', 'not_met', 'unknown')


def require(ok, field):
    if not ok:
        raise StudyError('IRC 报告不合规：' + field)


def fields(value, names, at):
    require(isinstance(value, dict), at + ' 必须为对象')
    for name in names.split():
        require(name in value, at + '.' + name + ' required')


def number(value, at, *, integer=False, nullable=True, minimum=None):
    if value is None and nullable:
        return
    try:
        ok = type(value) in ((int,) if integer else (int, float)) and math.isfinite(value)
    except OverflowError:
        ok = False
    require(ok and (minimum is None or value >= minimum), at + ' 数值不合规')


def text(value, at, nullable=False):
    require((nullable and value is None) or isinstance(value, str), at + ' 必须为字符串')


def strings(value, at):
    require(isinstance(value, list) and all(isinstance(v, str) for v in value), at + ' 必须为字符串数组')


def relative_path(value):
    text(value, 'path')
    # Preserve exact study-relative spelling for hash lookup; no basename match.
    for part in value.split('/'):
        component(part)
    require(':' not in value, 'path 必须为相对路径')
    return value


def reference(value, at, nullable=False):
    if value is None and nullable:
        return
    fields(value, 'path sha256', at)
    relative_path(value['path'])
    require(isinstance(value['sha256'], str) and re.fullmatch('[0-9a-f]{64}', value['sha256']) is not None,
            at + '.sha256')


def finite_tree(value):
    if type(value) in (int, float):
        number(value, 'JSON', nullable=False)
    elif isinstance(value, dict):
        for item in value.values():
            finite_tree(item)
    elif isinstance(value, list):
        for item in value:
            finite_tree(item)


def load_json(raw):
    try:
        data = json.loads(raw.decode('utf-8'))
        finite_tree(data)
        return data
    except (ValueError, UnicodeError, RecursionError):
        raise StudyError('IRC JSON 格式错误或包含非有限数值') from None


def lines(values, at, length=None):
    require(isinstance(values, list) and (length is None or len(values) == length), at)
    for value in values:
        number(value, at, integer=True, minimum=1)


def validate(data):
    fields(data, 'schema ag_version notice ts protocol pairs units thresholds inputs directions', 'report')
    require(data['schema'] == 'ag-irc-review/1', 'schema')
    for key in ('ag_version', 'notice', 'ts'):
        text(data[key], key)
    component(data['ts'])
    keys = 'method basis dispersion solvent_model solvent'
    fields(data['protocol'], keys, 'protocol')
    for key in keys.split():
        text(data['protocol'][key], 'protocol.' + key, nullable=True)
    require(data['units'] == dict(energy='hartree', relative_energy='kcal/mol', distance='angstrom'), 'units')
    keys = 'energy_drop_kcal_mol energy_noise_kcal_mol energy_jump_kcal_mol rmsd_jump_angstrom indistinguishable_pair_angstrom endpoint_input_angstrom endpoint_aligned_rmsd_angstrom'
    fields(data['thresholds'], keys, 'thresholds')
    for key, value in data['thresholds'].items():
        number(value, 'thresholds.' + key, nullable=False, minimum=0)
    require(isinstance(data['pairs'], list) and bool(data['pairs']), 'pairs')
    pair_names = []
    for pair in data['pairs']:
        require(isinstance(pair, list) and len(pair) == 2, 'pairs[]')
        for atom in pair:
            number(atom, 'pairs[]', integer=True, nullable=False, minimum=1)
        require(pair[0] < pair[1], 'pairs[] 顺序')
        pair_names.append('-'.join(map(str, pair)))
    require(len(set(pair_names)) == len(pair_names), 'pairs 重复')
    require(isinstance(data['inputs'], list), 'inputs')
    seen_inputs = set()
    for ref in data['inputs']:
        reference(ref, 'inputs[]')
        require(ref['path'] not in seen_inputs, 'inputs 路径重复')
        seen_inputs.add(ref['path'])
    fields(data['directions'], 'forward reverse', 'directions')
    for direction in DIRECTIONS:
        d = data['directions'][direction]
        fields(d, 'attempt log criteria summary unresolved warnings ts_reference stop_reason last_accepted_point path_geometry points', direction)
        component(d['attempt'])
        reference(d['log'], direction + '.log')
        require(d['summary'] in ('工具核对完成，待人工审阅', 'IRC 未完成'), direction + '.summary')
        for key in ('unresolved', 'warnings'):
            strings(d[key], direction + '.' + key)
        require(all(key in CRITERIA for key in d['unresolved']), direction + '.unresolved')
        require(d['stop_reason'] in ('completed', 'max_points', 'corrector_failed', 'truncated'), direction + '.stop_reason')
        number(d['last_accepted_point'], 'last_accepted_point', integer=True, minimum=1)
        t = d['ts_reference']
        fields(t, 'irc_point_zero_hartree ts_facts_hartree difference_hartree ts_facts', 'ts_reference')
        for key in ('irc_point_zero_hartree', 'ts_facts_hartree', 'difference_hartree'):
            number(t[key], 'ts_reference.' + key)
        reference(t['ts_facts'], 'ts_reference.ts_facts')
        g = d['path_geometry']
        fields(g, 'path frame_index_base frame_count', 'path_geometry')
        component(g['path'])
        require(g['path'].endswith('.xyz'), 'path_geometry.path')
        require(type(g['frame_index_base']) is int and g['frame_index_base'] == 0, 'frame_index_base 必须为 0')
        number(g['frame_count'], 'frame_count', integer=True, nullable=False, minimum=1)
        require(g['frame_count'] <= MAX_FRAMES, 'XYZ frame limit: 1000')
        points = d['points']
        require(isinstance(points, list) and 1 <= len(points) <= MAX_FRAMES, 'points limit: 1000')
        ids, frames = [], []
        for p in points:
            fields(p, 'point path point_line energy_hartree energy_line energy_kind geometry_line geometry_kind geometry_frame relative_energy_kcal_mol distances_angstrom', 'points[]')
            number(p['point'], 'point', integer=True, nullable=False, minimum=0)
            ids.append(p['point'])
            for key in ('path', 'point_line', 'energy_line', 'geometry_line'):
                number(p[key], 'points.' + key, integer=True, minimum=1)
            for key in ('energy_hartree', 'relative_energy_kcal_mol'):
                number(p[key], 'points.' + key)
            require(p['energy_kind'] in (None, 'scf', 'scf_from_checkpoint'), 'energy_kind')
            require(p['geometry_kind'] in (None, 'current_structure', 'preceding_orientation', 'irc_input'), 'geometry_kind')
            number(p['geometry_frame'], 'geometry_frame', integer=True, minimum=0)
            if p['geometry_frame'] is not None:
                frames.append(p['geometry_frame'])
            distances = p['distances_angstrom']
            if distances is not None:
                fields(distances, ' '.join(pair_names), 'distances_angstrom')
                for key, value in distances.items():
                    require(key in pair_names, 'distances_angstrom 未声明原子对')
                    number(value, 'distances_angstrom.' + key, minimum=0)
        require(ids[0] == 0 and all(a < b for a, b in zip(ids, ids[1:])), 'points 点号须唯一且递增，从 0 开始')
        require(frames == list(range(g['frame_count'])), 'geometry_frame 与 frame_count 不一致')
        require(d['last_accepted_point'] == (ids[-1] if len(ids) > 1 else None), 'last_accepted_point 与 points 不一致')
        fields(d['criteria'], ' '.join(CRITERIA), 'criteria')
        for key in CRITERIA:
            c = d['criteria'][key]
            fields(c, 'status', key)
            allowed = ('tool_checks_passed', 'not_met', 'unknown') if key == 'continuity' else STATUSES[1:] if key == 'energy_drop' else ('met', 'not_met', 'unknown')
            require(c['status'] in allowed, key + '.status')
        c = d['criteria']['continuity']
        fields(c, 'reasons manual_review steps evidence_lines corrector_failed path_complete_reported reached_max_points max_points', 'continuity')
        strings(c['reasons'], 'continuity.reasons')
        text(c['manual_review'], 'continuity.manual_review')
        for key in ('corrector_failed', 'path_complete_reported', 'reached_max_points'):
            require(c[key] is None or type(c[key]) is bool, 'continuity.' + key)
        number(c['max_points'], 'continuity.max_points', integer=True, minimum=1)
        require(isinstance(c['evidence_lines'], dict), 'continuity.evidence_lines')
        for values in c['evidence_lines'].values():
            lines(values, 'evidence_lines')
        require(isinstance(c['steps'], list), 'continuity.steps')
        for step in c['steps']:
            fields(step, 'points energy_change_kcal_mol rmsd_angstrom energy_lines geometry_lines', 'step')
            require(isinstance(step['points'], list) and len(step['points']) == 2, 'step.points')
            for point in step['points']:
                require(type(point) is int and point in ids, 'step.points')
            for key in ('energy_change_kcal_mol', 'rmsd_angstrom'):
                number(step[key], 'step.' + key)
            for key in ('energy_lines', 'geometry_lines'):
                lines(step[key], 'step.' + key, 2)
        c = d['criteria']['energy_drop']
        fields(c, 'drop_kcal_mol threshold_kcal_mol start_energy_hartree last_energy_hartree energy_lines log reason', 'energy_drop')
        for key in ('drop_kcal_mol', 'threshold_kcal_mol', 'start_energy_hartree', 'last_energy_hartree'):
            number(c[key], 'energy_drop.' + key)
        lines(c['energy_lines'], 'energy_drop.energy_lines', 2)
        reference(c['log'], 'energy_drop.log')
        text(c['reason'], 'energy_drop.reason')
        c = d['criteria']['midpoint']
        fields(c, 'pairs ts last_point_line log', 'midpoint')
        reference(c['ts'], 'midpoint.ts')
        reference(c['log'], 'midpoint.log')
        number(c['last_point_line'], 'midpoint.last_point_line', integer=True, minimum=1)
        require(isinstance(c['pairs'], list), 'midpoint.pairs')
        if 'reasons' in c:
            strings(c['reasons'], 'midpoint.reasons')
        if c['pairs']:
            reference(c.get('reference'), 'midpoint.reference')
            require(len(c['pairs']) == len(pair_names), 'midpoint.pairs 数量')
        used_pairs = set()
        for row in c['pairs']:
            fields(row, 'pair ts_angstrom last_angstrom reference_angstrom midpoint_angstrom change status reason', 'midpoint.pairs[]')
            require(row['pair'] in pair_names, 'midpoint.pair')
            require(row['pair'] not in used_pairs, 'midpoint.pair 重复')
            used_pairs.add(row['pair'])
            for key in ('ts_angstrom', 'last_angstrom', 'reference_angstrom', 'midpoint_angstrom'):
                number(row[key], 'midpoint.' + key, minimum=0)
            require(row['change'] in ('forming', 'breaking'), 'midpoint.change')
            require(row['status'] in ('met', 'not_met', 'unknown'), 'midpoint.status')
            text(row['reason'], 'midpoint.reason')
        c = d['criteria']['endpoint']
        fields(c, 'reasons', 'endpoint')
        strings(c['reasons'], 'endpoint.reasons')
        if c['status'] != 'unknown' or 'facts' in c:
            fields(c, 'facts failed_fields missing_fields identity log log_lines frequency_convergence fact_sources job_sections input_max_displacement_angstrom input_aligned_rmsd_angstrom provenance provenance_note manifest', 'endpoint')
            for key in ('failed_fields', 'missing_fields'):
                strings(c[key], 'endpoint.' + key)
            for key in ('input_max_displacement_angstrom', 'input_aligned_rmsd_angstrom'):
                number(c[key], 'endpoint.' + key, minimum=0)
            require(c['provenance'] in ('coordinates', 'endpoint_of_and_alignment'), 'endpoint.provenance')
            text(c['provenance_note'], 'endpoint.provenance_note')
            reference(c['manifest'], 'endpoint.manifest')
            reference(c['log'], 'endpoint.log', nullable=True)
            require(isinstance(c['log_lines'], dict), 'endpoint.log_lines')
            for value in c['log_lines'].values():
                lines(value, 'endpoint.log_lines')
            require(isinstance(c['facts'], list), 'endpoint.facts')
            fact_fields = ('termination', 'opt_converged', 'freq_step_converged',
                           'vibrational_modes_complete', 'n_vibrational_modes',
                           'expected_vibrational_modes', 'n_imag')
            require(all(isinstance(f, dict) for f in c['facts']), 'endpoint.facts[]')
            require(all(isinstance(f.get('field'), str) for f in c['facts']), 'endpoint.facts[].field')
            require(sorted(f.get('field', '') for f in c['facts']) == sorted(fact_fields), 'endpoint.facts fields')
            for fact in [*c['facts'], c['frequency_convergence']]:
                fields(fact, 'value source field line', 'fact')
                text(fact['field'], 'fact.field')
                reference(fact['source'], 'fact.source')
                number(fact['line'], 'fact.line', integer=True, minimum=1)
                if fact['field'] == 'termination':
                    text(fact['value'], 'fact.termination', nullable=True)
                elif fact['field'] in ('opt_converged', 'freq_step_converged', 'vibrational_modes_complete'):
                    require(fact['value'] is None or type(fact['value']) is bool, 'fact.' + fact['field'])
                elif fact['field'] in ('n_vibrational_modes', 'expected_vibrational_modes', 'n_imag'):
                    number(fact['value'], 'fact.' + fact['field'], integer=True, minimum=0)
            identity = c['identity']
            fields(identity, 'status', 'endpoint.identity')
            require(identity['status'] in ('met', 'not_met', 'unknown'), 'identity.status')
            if 'source' in identity:
                reference(identity['source'], 'identity.source')
                fields(identity, 'reported_status side field', 'identity')
                for key in ('reported_status', 'side', 'field'):
                    text(identity[key], 'identity.' + key, nullable=True)
    require(len({data['ts'], *(data['directions'][d]['attempt'] for d in DIRECTIONS)}) == 3, 'TS 与两个 IRC Attempt 须独立')
    require(data['directions']['forward']['path_geometry']['path'] != data['directions']['reverse']['path_geometry']['path'], '路径 XYZ 须独立')
    return data


def structure_references(data, role):
    """Only sources for this role, not arbitrary nested report strings."""
    refs = list(data['inputs'])
    if role == 'ts':
        for side in data['directions'].values():
            refs.append(side['ts_reference']['ts_facts'])
            if 'ts' in side['criteria']['midpoint']:
                refs.append(side['criteria']['midpoint']['ts'])
    else:
        endpoint = data['directions'][role]['criteria']['endpoint']
        refs.extend([endpoint.get('manifest'),
                     *(f['source'] for f in endpoint.get('facts', []))])
    return [r for r in refs if r is not None]


def referenced_bytes(store, study, refs, path):
    """A missing/conflicting hash must never fall through to a live Attempt read."""
    relative_path(path)
    matches = [r for r in refs if r['path'] == path]
    require(bool(matches), path + ' 未提供报告哈希引用')
    for ref in matches:
        reference(ref, 'structure source')
    require(len({r['sha256'] for r in matches}) == 1, path + ' 报告哈希引用冲突')
    raw = store.read((component(study), *path.split('/')), MAX_MANIFEST)
    require(hashlib.sha256(raw).hexdigest() == matches[0]['sha256'], path + ' SHA-256 mismatch')
    return raw


def attempt_from_reference(ref, filename):
    reference(ref, 'structure source')
    parts = ref['path'].split('/')
    require(len(parts) == 3 and parts[0] == 'attempts' and parts[2] == filename,
            '结构来源须为 Attempt 的 ' + filename)
    return component(parts[1])


def read_manifest(store, study, refs, attempt):
    manifest = load_json(referenced_bytes(store, study, refs, f'attempts/{attempt}/manifest.json'))
    require(isinstance(manifest, dict) and manifest.get('attempt_id') == attempt,
            'manifest attempt_id 与报告引用不一致')
    return manifest


def endpoint_attempt(store, study, data, role, refs):
    endpoint = data['directions'][role]['criteria']['endpoint']
    explicit = []
    if endpoint.get('manifest') is not None:
        explicit.append(attempt_from_reference(endpoint['manifest'], 'manifest.json'))
    explicit.extend(attempt_from_reference(f['source'], 'facts.json') for f in endpoint.get('facts', []))
    if explicit:
        require(len(set(explicit)) == 1, '端点 manifest 与 facts 引用不同 Attempt')
        return explicit[0]
    # Fallback requires a hash-checked, explicit endpoint_of edge to this IRC.
    # Never infer the direction from filenames, numbering, or leftover Attempts.
    excluded = {data['ts'], *(s['attempt'] for s in data['directions'].values())}
    candidates = []
    for ref in data['inputs']:
        parts = ref['path'].split('/')
        if len(parts) != 3 or parts[0] != 'attempts' or parts[2] != 'manifest.json' or parts[1] in excluded:
            continue
        attempt = attempt_from_reference(ref, 'manifest.json')
        manifest = read_manifest(store, study, refs, attempt)
        parents = manifest.get('parents', [])
        require(isinstance(parents, list) and all(isinstance(p, dict) for p in parents), '端点 parents 格式错误')
        origins = {p.get('attempt_id') for p in parents if p.get('relation') == 'endpoint_of' and isinstance(p.get('attempt_id'), str)}
        if data['directions'][role]['attempt'] in origins:
            require(len(origins) == 1, '端点方向引用有歧义')
            candidates.append(attempt)
    require(len(candidates) <= 1, '报告引用多个端点 Attempt，无法唯一确定')
    return candidates[0] if candidates else None


def read_structure(store, study, data, role, atom_order):
    result = dict(attempt=None, geometry=None, energy_hartree=None, n_imag=None, error=None)
    try:
        refs = structure_references(data, role)
        attempt = data['ts'] if role == 'ts' else endpoint_attempt(store, study, data, role, refs)
        if attempt is None:
            return result
        result['attempt'] = attempt
        if role != 'ts':
            require(attempt not in {data['ts'], *(s['attempt'] for s in data['directions'].values())},
                    '端点须为独立 Attempt')
        read_manifest(store, study, refs, attempt)
        base = f'attempts/{attempt}'
        facts = load_json(referenced_bytes(store, study, refs, base + '/facts.json'))
        require(isinstance(facts, dict), 'facts 必须为对象')
        # Same fixed final.xyz and parser as Attempt.geometry; no arbitrary facts paths.
        require(facts.get('final_geometry', 'final.xyz') == 'final.xyz', 'facts 最终几何不是 final.xyz')
        raw = referenced_bytes(store, study, refs, base + '/final.xyz')
        try:
            geometry = parse_xyz(raw.decode('utf-8'))
        except (ValueError, UnicodeError):
            raise StudyError('最终几何 XYZ 格式错误') from None
        require([a['atomic_number'] for a in geometry['atoms']] == atom_order,
                '最终几何与 IRC 原子数或元素行序不一致')
        energies = facts.get('energies') or {}
        require(isinstance(energies, dict), 'facts.energies 必须为对象')
        energy, n_imag = energies.get('scf'), facts.get('n_imag')
        number(energy, 'facts.energies.scf')
        number(n_imag, 'facts.n_imag', integer=True, minimum=0)
        result.update(geometry=geometry, energy_hartree=energy, n_imag=n_imag)
    except StudyError as exc:
        result['error'] = str(exc)
    return result


def read_review(store, study, name, group=None):
    base = (component(study), 'analyses', *((component(group),) if group is not None else ()))
    component(name)
    require(name.endswith('.json'), '报告文件名')
    data = validate(load_json(store.read((*base, name), MAX_MANIFEST)))
    hashes = {r['path']: r['sha256'] for r in data['inputs']}
    trajectories, atom_order = {}, None
    for direction in DIRECTIONS:
        g = data['directions'][direction]['path_geometry']
        raw = store.read((*base, g['path']), MAX_XYZ)
        expected = hashes.get('/'.join((*base[1:], g['path'])))
        if expected is not None:
            require(hashlib.sha256(raw).hexdigest() == expected, direction + ' XYZ SHA-256 mismatch')
        frames = xyz_frames(raw)
        require(len(frames) == g['frame_count'], direction + ' XYZ frame_count mismatch')
        for frame in frames:
            atoms = [a['atomic_number'] for a in frame['geometry']['atoms']]
            if atom_order is None:
                atom_order = atoms
            require(atoms == atom_order, direction + ' XYZ 原子数或元素行序不一致')
            require(all(b <= len(atoms) for a, b in data['pairs']), 'pairs 原子编号越界')
        trajectories[direction] = dict(frames=frames, hash_status='已核对 SHA-256' if expected else '未核对哈希')
    structures = {role: read_structure(store, study, data, role, atom_order)
                  for role in ('reverse', 'ts', 'forward')}
    return dict(report=data, trajectories=trajectories, structures=structures)


def list_reviews(store, study):
    base = (component(study), 'analyses')
    groups, issues, reports = [()], [], []
    for name, error in store.names(base, directories=True):
        if error:
            issues.append(dict(name=name, error=error))
        else:
            groups.append((name,))
    for group in groups:
        for name, error in store.names((*base, *group)):
            if not name.endswith('.json'):
                continue
            try:
                if error:
                    raise StudyError(error)
                data = load_json(store.read((*base, *group, name), MAX_MANIFEST))
                if not isinstance(data, dict) or data.get('schema') != 'ag-irc-review/1':
                    continue
                # No partial scientific content in the listing if either XYZ fails.
                read_review(store, study, name, group[0] if group else None)
                reports.append(dict(name=name, group=group[0] if group else None))
            except StudyError as exc:
                issues.append(dict(name='/'.join((*group, name)), error=str(exc)))
    return dict(reports=reports, issues=issues)
