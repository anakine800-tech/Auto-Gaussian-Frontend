"""Pure display parsing, adapted from Auto-Gaussian ag/src/ag/gaussian_input.py.

Keep validate's Cartesian grammar, Link0/route restrictions and resource checks.
The viewer additionally needs real elements/finite display coordinates and its
existing atom limit; it does not confer permission to submit an input.
"""
import math
import re
from collections import Counter

from .geometry import MAX_ATOMS, SYMBOLS, parse_xyz


def formula(atoms):
    counts = Counter(SYMBOLS[a['atomic_number']-1] for a in atoms)
    order = (['C'] + (['H'] if 'H' in counts else []) + sorted(set(counts)-{'C', 'H'})) if 'C' in counts else sorted(counts)
    return ''.join(symbol + (str(counts[symbol]) if counts[symbol] > 1 else '') for symbol in order)


def parse_gjf(text, manifest):
    lines, link, index = text.splitlines(), {}, 0
    while index < len(lines) and lines[index].startswith('%'):
        match = re.fullmatch(r'%([A-Za-z]+)\s*=\s*(.+)', lines[index])
        if not match:
            raise ValueError('Link0 格式不正确')
        key, value = match.group(1).lower(), match.group(2).strip()
        if key not in {'nprocshared', 'mem', 'chk'} or key in link:
            raise ValueError('不支持或重复的 Link0 指令')
        link[key] = value
        index += 1
    cores, mem_gb = manifest.get('cores'), manifest.get('mem_gb')
    if type(cores) is not int or cores < 1 or link.get('nprocshared') != str(cores):
        raise ValueError('%nprocshared 与 manifest 核数不一致或缺失')
    memory = re.fullmatch(r'(\d+)(GB|MB|MW|GW)', link.get('mem', ''), re.I)
    if not memory:
        raise ValueError('%mem 必须使用整数 GB、MB、GW 或 MW')
    factor = {'GB': 1, 'MB': .001, 'GW': 8, 'MW': .008}[memory[2].upper()]
    if type(mem_gb) not in (int, float) or not math.isfinite(mem_gb) or not 0 < int(memory[1])*factor <= mem_gb*.85:
        raise ValueError('%mem 超过资源档位的 85% 或 manifest 内存缺失')
    if 'chk' in link and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.chk', link['chk']):
        raise ValueError('%chk 必须是不带路径的文件名')
    sections = re.split(r'\n\s*\n', '\n'.join(lines[index:]).strip())
    if len(sections) < 3 or not sections[0].lstrip().startswith('#') or not sections[1].strip():
        raise ValueError('缺少 route、标题或电荷/多重度与 Cartesian 坐标')
    if re.search(r'\bexternal\b|\binclude\b|@', text, re.I) or '--link1--' in text.lower():
        raise ValueError('不支持 External、include 或 Link1')
    if len(sections) > 3:
        raise ValueError('不支持附加 Gaussian 输入段或内坐标变量段')
    geom = sections[2].splitlines()
    match = re.fullmatch(r'\s*(-?\d+)\s+(\d+)\s*', geom[0])
    if not match or int(match[2]) < 1 or len(geom) < 2:
        raise ValueError('电荷/多重度不正确或缺少坐标')
    if len(geom)-1 > MAX_ATOMS:
        raise ValueError(f'原子数超过 {MAX_ATOMS}')
    number = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
    atoms = []
    for i, row in enumerate(geom[1:], 1):
        if not re.fullmatch(rf'\s*(?:[A-Z][a-z]?|\d+)\s+{number}\s+{number}\s+{number}\s*', row):
            raise ValueError('仅支持 Cartesian 坐标，不支持内坐标或损坏的坐标行')
        symbol, *values = row.split()
        atomic_number = int(symbol) if symbol.isdigit() else SYMBOLS.index(symbol)+1 if symbol in SYMBOLS else 0
        coords = list(map(float, values))
        if not 1 <= atomic_number <= len(SYMBOLS) or not all(math.isfinite(v) and abs(v) < 1e8 for v in coords):
            raise ValueError('元素或坐标值无法显示')
        atoms.append(dict(center=i, atomic_number=atomic_number, **dict(zip(('x','y','z'), coords))))
    return dict(atoms=atoms, units='angstrom', orientation_kind='input-gjf',
                charge=int(match[1]), multiplicity=int(match[2]), route=' '.join(sections[0].split()),
                nprocshared=int(link['nprocshared']), mem=link['mem'], n_atoms=len(atoms), formula=formula(atoms))


def parse_input(text, name, manifest):
    if name.lower().endswith('.gjf'):
        return parse_gjf(text, manifest)
    result = parse_xyz(text)
    params = manifest.get('template_params', {})
    if not isinstance(params, dict):
        raise ValueError('template_params 格式不正确')
    try:
        charge_text, uhf_text = str(params.get('--chrg', 0)), str(params.get('--uhf', 0))
        if not re.fullmatch(r'-?\d+', charge_text) or not re.fullmatch(r'\d+', uhf_text):
            raise ValueError()
        charge, multiplicity = int(charge_text), int(uhf_text)+1
        if multiplicity < 1:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('xTB/CREST 电荷或未配对电子参数不正确') from None
    result.update(orientation_kind='input-xyz', charge=charge, multiplicity=multiplicity,
                  route=None, nprocshared=None, mem=None, n_atoms=len(result['atoms']), formula=formula(result['atoms']))
    return result
