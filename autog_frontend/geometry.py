"""Small XYZ display reader; no chemistry inference or calculation."""
import math

SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
           'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd '
           'Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac '
           'Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split()


def parse_xyz(text):
    lines = text.splitlines()
    if not lines:
        raise ValueError("Empty XYZ")
    count = int(lines[0])
    if not 1 <= count <= 2000 or len(lines) < count+2 or any(s.strip() for s in lines[count+2:]):
        raise ValueError('Invalid XYZ atom count')
    atoms = []
    for i, line in enumerate(lines[2:count+2], 1):
        symbol, x, y, z = line.split()
        coords = [float(x), float(y), float(z)]
        if not all(math.isfinite(v) and abs(v) < 1e8 for v in coords):
            raise ValueError('Invalid XYZ coordinates')
        atoms.append(dict(center=i, atomic_number=SYMBOLS.index(symbol)+1, **dict(zip(('x', 'y', 'z'), coords))))
    return {'atoms': atoms, 'units': 'angstrom', 'orientation_kind': 'final.xyz'}
