"""Small XYZ display reader; no chemistry inference or calculation."""
import math

MAX_ATOMS = 2000

SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
           'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd '
           'Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac '
           'Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split()


def parse_xyz(text):
    lines = text.splitlines()
    if not lines:
        raise ValueError("Empty XYZ")
    count = int(lines[0])
    if not 1 <= count <= MAX_ATOMS or len(lines) < count+2 or any(s.strip() for s in lines[count+2:]):
        raise ValueError('Invalid XYZ atom count')
    atoms = []
    for i, line in enumerate(lines[2:count+2], 1):
        symbol, x, y, z = line.split()
        coords = [float(x), float(y), float(z)]
        if not all(math.isfinite(v) and abs(v) < 1e8 for v in coords):
            raise ValueError('Invalid XYZ coordinates')
        atoms.append(dict(center=i, atomic_number=SYMBOLS.index(symbol)+1, **dict(zip(('x', 'y', 'z'), coords))))
    return {'atoms': atoms, 'units': 'angstrom', 'orientation_kind': 'final.xyz'}


def xyz_frame(stream, frame):
    """Validate a bounded trajectory, retaining only one frame in memory."""
    consumed, count, selected = 0, 0, None

    def line():
        nonlocal consumed
        value = stream.readline(1024*1024+1)
        consumed += len(value)
        if consumed > 32*1024*1024 or len(value) > 1024*1024:
            raise ValueError('XYZ 超过 32 MB 或单行过长')
        return value.decode('utf-8')

    while True:
        first = line()
        if not first:
            break
        if not first.strip():
            continue
        try:
            n_atoms = int(first.strip())
        except ValueError:
            raise ValueError('XYZ 帧原子数格式不正确') from None
        if not 1 <= n_atoms <= MAX_ATOMS:
            raise ValueError(f'每帧原子数必须在 1–{MAX_ATOMS} 之间')
        count += 1
        if count > 5000:
            raise ValueError('XYZ 超过 5000 帧')
        comment = line()
        if not comment:
            raise ValueError('XYZ 缺少帧注释行')
        atoms = []
        for i in range(n_atoms):
            # Validate every frame so damaged later frames cannot look complete.
            row = line()
            if not row:
                raise ValueError('XYZ 帧坐标不完整')
            atom = parse_xyz('1\n\n'+row)['atoms'][0]
            if count-1 == frame:
                atom['center'] = i+1
                atoms.append(atom)
        if count-1 == frame:
            selected = dict(atoms=atoms, units='angstrom', orientation_kind='xyz-frame', comment=comment.rstrip('\r\n'))
    if not count:
        raise ValueError('XYZ 文件为空')
    if selected is None:
        raise ValueError('帧号超出范围')
    return {'frame': frame, 'frame_count': count, 'geometry': selected, 'comment': selected['comment']}
