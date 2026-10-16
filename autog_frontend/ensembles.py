"""Bounded, read-only ag-ensemble/1 display adapter (T53 appendix A).

Validate before returning any geometry: stale/replaced XYZ files otherwise attach
energies to the wrong structures. All opens use Studies' no-follow descriptors;
JSON path fields are provenance only and are never dereferenced.
"""
import hashlib
import json
import math
import re

from .geometry import parse_xyz
from .studies import StudyError, component

MAX_MANIFEST = 4 * 1024 * 1024
MAX_XYZ = 32 * 1024 * 1024
MAX_FRAMES = 1000
MAX_ATOMS = 500
CREST_FILES = ('crest_conformers.xyz', 'crest_best.xyz', 'crest_ensemble.xyz')


def require(ok, field):
    if not ok:
        raise StudyError('Invalid ag-ensemble/1: ' + field)


def fields(obj, names, location):
    require(isinstance(obj, dict), location)
    for key in names.split():
        require(key in obj, location + '.' + key + ' required')


def strings(value, field):
    require(isinstance(value, list) and all(isinstance(v, str) for v in value), field)


def number(value, field, integer=False, nullable=True):
    try:
        valid = (value is None and nullable) or (type(value) in ((int,) if integer else (int, float)) and math.isfinite(value))
    except OverflowError:
        valid = False
    require(valid, field)


def digest(value, field):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None, field)


def load_json(raw):
    try:
        data = json.loads(raw.decode('utf-8'))
        # Preserve strict rejection outside T70 fields, including unknown fields.
        # A bad optional number must not hide otherwise usable energies/geometry.
        def finite(value, path=()):
            if path in (('descriptors',), ('bin_summary',)) or (
                    len(path) == 3 and path[0] == 'candidates' and path[2] == 'local'):
                return
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError('non-finite number')
            if isinstance(value, dict):
                for key, item in value.items():
                    finite(item, (*path, key))
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    finite(item, (*path, index))
        finite(data)
        return data
    except (UnicodeError, ValueError, RecursionError):
        raise StudyError('Invalid ensemble JSON: malformed text or non-finite number') from None


def validate_descriptors(data):
    """Validate saved T70 values; never infer angles, bins or lowest energies."""
    def finite_optional(value, field):
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            number(value, field, nullable=False)
        elif isinstance(value, dict):
            for key, item in value.items():
                finite_optional(item, field + '.' + key)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                finite_optional(item, f'{field}[{index}]')
    for key in ('descriptors', 'bin_summary'):
        finite_optional(data.get(key), key)
    for row in data['candidates']:
        finite_optional(row.get('local'), f"candidate {row['candidate']}.local")
    definitions = data.get('descriptors')
    fields(definitions, 'dihedral_bins distance_pairs', 'descriptors')
    dihedrals, pairs = definitions['dihedral_bins'], definitions['distance_pairs']
    require(isinstance(dihedrals, list), 'descriptors.dihedral_bins')
    require(isinstance(pairs, list), 'descriptors.distance_pairs')

    def atoms(values, size, field):
        require(isinstance(values, list) and len(values) == size, field)
        for value in values:
            number(value, field, integer=True, nullable=False)
            require(value >= 1, field)
        require(len(set(values)) == size, field)

    def numbers(values, size, field):
        require(isinstance(values, list) and len(values) == size, field + ' length')
        for value in values:
            number(value, field, nullable=False)

    def bins(values, field):
        strings(values, field)
        require(len(values) == len(dihedrals), field + ' length')
        for value, definition in zip(values, dihedrals):
            require(value in definition['names'], field + ' undefined group')

    for index, definition in enumerate(dihedrals):
        field = f'descriptors.dihedral_bins[{index}]'
        fields(definition, 'atoms boundaries names', field)
        atoms(definition['atoms'], 4, field + '.atoms')
        names, boundaries = definition['names'], definition['boundaries']
        strings(names, field + '.names')
        require(len(names) >= 1 and all(names) and len(set(names)) == len(names), field + '.names')
        numbers(boundaries, len(names), field + '.boundaries')
        require(all(-180 <= v <= 180 for v in boundaries) and boundaries[-1] - boundaries[0] < 360 and
                all(a < b for a, b in zip(boundaries, boundaries[1:])), field + '.boundaries')
    for index, pair in enumerate(pairs):
        atoms(pair, 2, f'descriptors.distance_pairs[{index}]')
    for row in data['candidates']:
        field = f"candidate {row['candidate']}.local"
        local = row.get('local')
        fields(local, 'dihedrals bins near_boundary distances', field)
        numbers(local['dihedrals'], len(dihedrals), field + '.dihedrals')
        require(all(-180 <= v < 180 for v in local['dihedrals']), field + '.dihedrals')
        bins(local['bins'], field + '.bins')
        require(type(local['near_boundary']) is bool, field + '.near_boundary')
        numbers(local['distances'], len(pairs), field + '.distances')
        require(all(v >= 0 for v in local['distances']), field + '.distances')
    # Summary is independently optional; its values are displayed, not recomputed.
    if 'bin_summary' in data:
        require(isinstance(data['bin_summary'], list), 'bin_summary')
        candidates = {row['candidate']: row for row in data['candidates']}
        for index, row in enumerate(data['bin_summary']):
            field = f'bin_summary[{index}]'
            fields(row, 'bins count lowest_candidate lowest_layer', field)
            bins(row['bins'], field + '.bins')
            number(row['count'], field + '.count', integer=True, nullable=False)
            require(row['count'] > 0, field + '.count')
            lowest, layer = row['lowest_candidate'], row['lowest_layer']
            number(lowest, field + '.lowest_candidate', integer=True)
            require(layer in (None, 'thermo', 'opt', 'sp', 'xtb'), field + '.lowest_layer')
            require((lowest is None) == (layer is None), field + ' lowest pair')
            if lowest is not None:
                require(lowest in candidates and candidates[lowest]['local']['bins'] == row['bins'],
                        field + '.lowest_candidate group')


def validate(data):
    fields(data, 'schema created_at ag study_id label inputs charge hydrogens energy_basis units routes references warnings candidates unmatched_attempts', 'manifest')
    require(data['schema'] == 'ag-ensemble/1', 'schema')
    for key in ('created_at', 'study_id'):
        require(isinstance(data[key], str) and bool(data[key]), key)
    require(isinstance(data['ag'], dict), 'ag')
    require(data['label'] is None or isinstance(data['label'], str), 'label')
    number(data['charge'], 'charge', integer=True, nullable=False)
    require(data['hydrogens'] in ('heavy', 'polar', 'all'), 'hydrogens')
    require(data['energy_basis'] in ('shared_hartree', 'per_source_not_comparable'), 'energy_basis')
    require(data['units'] == dict(energy='Hartree', relative='kcal/mol', population='fraction'), 'units')
    fields(data['inputs'], 'merged xyz', 'inputs')
    for key in ('merged', 'xyz', 'thermo'):
        if key == 'thermo' and data['inputs'].get(key) is None:
            continue
        ref = data['inputs'][key]
        fields(ref, 'path sha256', 'inputs.' + key)
        require(isinstance(ref['path'], str), 'inputs.' + key + '.path')
        digest(ref['sha256'], 'inputs.' + key + '.sha256')
    xyz = data['inputs']['xyz']
    fields(xyz, 'file', 'inputs.xyz')
    component(xyz['file'])
    require('..' not in xyz['file'] and xyz['file'].endswith('.xyz'), 'inputs.xyz.file')
    strings(data['warnings'], 'warnings')
    require(isinstance(data['routes'], list), 'routes')
    labels = []
    for route in data['routes']:
        fields(route, 'label attempts', 'routes[]')
        require(isinstance(route['label'], str), 'routes[].label')
        strings(route['attempts'], 'routes[].attempts')
        for attempt in route['attempts']:
            component(attempt)
        labels.append(route['label'])
    require(len(labels) == len(set(labels)), 'duplicate routes')
    fields(data['references'], 'xtb sp opt', 'references')
    for key in ('xtb', 'sp', 'opt'):
        number(data['references'][key], 'references.' + key, integer=True)
    require(isinstance(data['candidates'], list) and len(data['candidates']) <= MAX_FRAMES, 'candidates limit 1000')
    ids = set()
    for row in data['candidates']:
        fields(row, 'candidate xyz_frame geometry_sha256 sources route_members xtb_relative_kcal sp opt thermo missing notes', 'candidate')
        for key in ('candidate', 'xyz_frame'):
            number(row[key], key, integer=True, nullable=False)
            require(row[key] >= 1, key)
        require(row['candidate'] not in ids, 'duplicate candidate')
        ids.add(row['candidate'])
        digest(row['geometry_sha256'], 'geometry_sha256')
        for key in ('sources', 'missing', 'notes'):
            strings(row[key], key)
        require(all(s in labels for s in row['sources']), 'sources')
        require(all(s in ('sp', 'opt_freq', 'thermo') for s in row['missing']), 'missing')
        number(row['xtb_relative_kcal'], 'xtb_relative_kcal')
        if data['energy_basis'] == 'per_source_not_comparable':
            require(row['xtb_relative_kcal'] is None, 'cross-route xtb_relative_kcal must be null')
        require(isinstance(row['route_members'], list), 'route_members')
        for member in row['route_members']:
            fields(member, 'route member relative_kcal_within_route', 'route_members[]')
            require(member['route'] in labels, 'route_members[].route')
            number(member['member'], 'route_members[].member', integer=True, nullable=False)
            number(member['relative_kcal_within_route'], 'relative_kcal_within_route')
        for key in ('sp', 'opt'):
            layer = row[key]
            if layer is None:
                continue
            fields(layer, 'attempts ambiguous energy_hartree relative_kcal', key)
            strings(layer['attempts'], key + '.attempts')
            require(type(layer['ambiguous']) is bool, key + '.ambiguous')
            for energy in ('energy_hartree', 'relative_kcal'):
                number(layer[energy], key + '.' + energy)
                require(not layer['ambiguous'] or layer[energy] is None, key + '.ambiguous energy must be null')
            if key == 'opt':
                fields(layer, 'termination n_imaginary', 'opt')
                require(layer['termination'] is None or isinstance(layer['termination'], str), 'opt.termination')
                number(layer['n_imaginary'], 'opt.n_imaginary', integer=True)
        thermo = row['thermo']
        if thermo is not None:
            fields(thermo, 'attempt qh_G relative_G_kcal population', 'thermo')
            require(thermo['attempt'] is None or isinstance(thermo['attempt'], str), 'thermo.attempt')
            for key in ('qh_G', 'relative_G_kcal', 'population'):
                number(thermo[key], 'thermo.' + key)
    require(all(data['references'][key] is None or data['references'][key] in ids for key in ('xtb', 'sp', 'opt')), 'references candidate')
    require(isinstance(data['unmatched_attempts'], list), 'unmatched_attempts')
    for row in data['unmatched_attempts']:
        fields(row, 'layer attempt reason', 'unmatched_attempts[]')
        require(row['layer'] in ('sp', 'opt', 'thermo') and isinstance(row['attempt'], str)
                and isinstance(row['reason'], str), 'unmatched_attempts[]')
    if any(key in data for key in ('descriptors', 'bin_summary')) or any('local' in row for row in data['candidates']):
        # Hide the optional block as a unit: partial arrays can label the wrong
        # candidate or make a summary link appear to refer to a different group.
        try:
            validate_descriptors(data)
        except StudyError as exc:
            data = {key: value for key, value in data.items() if key not in ('descriptors', 'bin_summary')}
            data['candidates'] = [{key: value for key, value in row.items() if key != 'local'}
                                  for row in data['candidates']]
            data['descriptor_error'] = str(exc)
    return data


def xyz_frames(raw):
    if len(raw) > MAX_XYZ:
        raise StudyError('XYZ exceeds 32 MiB', 413)
    try:
        lines = iter(raw.decode('utf-8').splitlines(keepends=True))
        frames = []
        for first in lines:
            if not first.strip():
                continue
            count = int(first)
            if not 1 <= count <= MAX_ATOMS:
                raise StudyError('XYZ atom limit: 500 per frame', 413)
            if len(frames) >= MAX_FRAMES:
                raise StudyError('XYZ frame limit: 1000', 413)
            comment = next(lines)
            rows = [next(lines) for _ in range(count)]
            geometry = parse_xyz(str(count) + '\n' + comment + ''.join(rows))
            geometry['orientation_kind'] = 'xyz-frame'
            frames.append(dict(geometry=geometry, comment=comment.rstrip('\r\n'),
                               geometry_sha256=hashlib.sha256(''.join(rows).encode('utf-8')).hexdigest()))
        if not frames:
            raise ValueError('empty XYZ')
        return frames
    except (ValueError, UnicodeError, StopIteration):
        raise StudyError('Invalid or incomplete XYZ frame') from None


def list_ensembles(store, study):
    base = (component(study), 'analyses')
    locations = [()]
    issues = []
    for name, error in store.names(base, directories=True):
        if error:
            issues.append(dict(name=name, error=error))
        else:
            locations.append((name,))
    result = []
    for group in locations:
        for name, error in store.names((*base, *group)):
            if not name.endswith('.json'):
                continue
            try:
                if error:
                    raise StudyError(error)
                data = load_json(store.read((*base, *group, name), MAX_MANIFEST))
                if not isinstance(data, dict) or data.get('schema') != 'ag-ensemble/1':
                    continue
                validate(data)
                result.append(dict(name=name, group=group[0] if group else None, label=data['label'],
                                   candidate_count=len(data['candidates']), created_at=data['created_at']))
            except StudyError as exc:
                issues.append(dict(name='/'.join((*group, name)), error=str(exc)))
    return dict(ensembles=result, issues=issues)


def read_ensemble(store, study, name, group=None):
    base = (component(study), 'analyses', *((component(group),) if group is not None else ()))
    component(name)
    require(name.endswith('.json'), 'manifest filename')
    data = validate(load_json(store.read((*base, name), MAX_MANIFEST)))
    ref = data['inputs']['xyz']
    raw = store.read((*base, ref['file']), MAX_XYZ)
    require(hashlib.sha256(raw).hexdigest() == ref['sha256'], 'inputs.xyz.sha256 mismatch')
    frames = xyz_frames(raw)
    for row in data['candidates']:
        index = row['xyz_frame'] - 1
        require(index < len(frames), f"candidate {row['candidate']} xyz_frame out of range")
        require(frames[index]['geometry_sha256'] == row['geometry_sha256'],
                f"candidate {row['candidate']} geometry_sha256 mismatch")
    return dict(manifest=data, frames=frames)


def crest_frames(store, study, attempt, name, frame):
    require(name in CREST_FILES, 'CREST filename not allowed')
    base = (component(study), 'attempts', component(attempt))
    manifest = store.document((*base, 'manifest.json'), True)
    require(manifest['data'] is not None and manifest['data'].get('template') == 'crest', 'Attempt template must be crest')
    frames = xyz_frames(store.read((*base, 'outputs', name), MAX_XYZ))
    energies = []
    for entry in frames:
        energy = None
        for token in entry['comment'].split():
            try:
                value = float(token)
            except ValueError:
                continue
            if not math.isfinite(value):
                raise StudyError('Non-finite CREST comment energy')
            energy = value
            break
        entry['energy_hartree'] = energy
        if energy is not None:
            energies.append(energy)
    minimum = min(energies) if energies else None
    for entry in frames:
        energy = entry['energy_hartree']
        relative = (energy - minimum) * 627.5094740631 if energy is not None else None
        if relative is not None and not math.isfinite(relative):
            raise StudyError('Non-finite CREST relative display energy')
        entry['relative_kcal'] = relative
    require(0 <= frame < len(frames), 'CREST frame out of range')
    selected = frames[frame]
    # Also expose the existing frame-viewer shape, without changing its controls.
    energy_text = '未知' if selected['energy_hartree'] is None else str(selected['energy_hartree'])
    relative_text = '未知' if selected['relative_kcal'] is None else f"{selected['relative_kcal']:.6f}"
    return dict(frames=frames, frame=frame, frame_count=len(frames), geometry=selected['geometry'],
                comment=f"{selected['comment']} · 能量 {energy_text} Hartree · 相对能 {relative_text} kcal/mol · 仅供显示，以 facts 和后端分析为准")
