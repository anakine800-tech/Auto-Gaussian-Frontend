"""Synthetic butane only. These invented energies/modes are not research results.

Create outside the repository for tests/demo. The application never calls this
writer. Three printed modes exercise decoding, not a complete 36-mode analysis.
"""
import json
from pathlib import Path

ATOMS = [
    ('C', -1.92, -.20, 0.), ('C', -.64, .64, 0.),
    ('C', .64, -.20, 0.), ('C', 1.92, .64, 0.),
    ('H', -2.81, .42, 0.), ('H', -1.97, -.84, .88), ('H', -1.97, -.84, -.88),
    ('H', -.64, 1.28, .88), ('H', -.64, 1.28, -.88),
    ('H', .64, -.84, .88), ('H', .64, -.84, -.88),
    ('H', 2.81, .02, 0.), ('H', 1.97, 1.28, .88), ('H', 1.97, 1.28, -.88),
]


def gaussian_log():
    lines = [' Synthetic butane parser fixture; invented modes, not a calculation.',
             ' Standard orientation:', ' ---------------------------------------------------------------------',
             ' Center Atomic Atomic Coordinates (Angstroms)', ' Number Number Type X Y Z',
             ' ---------------------------------------------------------------------']
    lines += [f' {i} {6 if a[0] == "C" else 1} 0 {a[1]:.6f} {a[2]:.6f} {a[3]:.6f}' for i, a in enumerate(ATOMS, 1)]
    lines += [' ---------------------------------------------------------------------', ' Harmonic frequencies (cm**-1)',
              ' 1 2 3', ' A A A', ' Frequencies -- -42.0 120.0 300.0',
              ' Red. masses -- 1.0 1.0 1.0', ' Frc consts -- 1.0 1.0 1.0',
              ' IR Inten -- 1.0 1.0 1.0', ' Atom AN X Y Z X Y Z X Y Z']
    for i, a in enumerate(ATOMS, 1):
        # Unit vectors on different atoms, intentionally illustrative only.
        values = [1.0 if i == mode+1 and axis == mode else 0.0 for mode in range(3) for axis in range(3)]
        lines.append(f' {i} {6 if a[0] == "C" else 1} ' + ' '.join(f'{v:.2f}' for v in values))
    lines += ['', ' Normal termination of Gaussian (synthetic marker).']
    lines += [f' Synthetic pagination line {i}' for i in range(260)]
    return '\n'.join(lines)+'\n'


def create_studies(root):
    study = Path(root) / 'butane-demo'
    study.mkdir(parents=True)
    (study/'study.md').write_text('# 合成正丁烷 study\n\n仅用于查看器测试；能量与振动数据为虚构，不是研究结果。\n\n## 当前阻塞\n科学审阅：合成数据不用于科学验收。\n', encoding='utf-8')
    for name, state, parents in [('anti', 'fetched', []), ('gauche', 'fetched', [{'attempt_id':'anti','relation':'conformer_of'}]), ('waiting', 'unknown', [{'attempt_id':'missing-seed','relation':'derived_from'}])]:
        base = study/'attempts'/name
        (base/'outputs').mkdir(parents=True)
        documents = {'manifest.json': {'schema':'ag-attempt/1','attempt_id':name,'study_id':'butane-demo','label':name,'template':'gaussian','parents':parents},
                     'status.json':{'state':state,'job_id':None,'note':'Synthetic local fixture'},
                     'facts.json':{'schema':'ag-facts/1','n_atoms':14,'charge':0,'multiplicity':1,'final_geometry':'final.xyz','termination':'incomplete','n_imag':1,'energies':{'g':-157.0}}}
        for filename, data in documents.items():
            (base/filename).write_text(json.dumps(data), encoding='utf-8')
        if name == 'waiting':
            (base/'facts.json').unlink()
            continue
        (base/'review.md').write_text('Synthetic only; no human scientific acceptance.\n', encoding='utf-8')
        (base/'final.xyz').write_text('14\nSynthetic butane display fixture\n'+'\n'.join(' '.join(map(str,a)) for a in ATOMS)+'\n', encoding='utf-8')
        (base/'outputs'/'butane.log').write_text(gaussian_log(), encoding='utf-8')
    analyses=study/'analyses'; analyses.mkdir()
    for name, data in {
        'dedup-demo.json': {'kept':[{'index':0,'energy':-10.0}], 'rejected':[]},
        'cluster-demo.json': {'representatives':[{'index':0,'degeneracy':1},{'index':1,'degeneracy':2}]},
        'thermo-demo.json': {'schema':'ag-thermo/1','settings':{'temperature_K':298.15},'units':{'energy':'Hartree','population':'fraction'},
                             'rows':[{'attempt_id':'anti','degeneracy':1,'E':-157.1,'ZPE':.1,'H':-157.0,'qh_H':-157.0,'qh_G':-157.0,'relative_G_kcal':0.0,'population':.5},
                                     {'attempt_id':'gauche','degeneracy':2,'E':-157.09934554,'ZPE':.1,'H':-156.99934554,'qh_H':-156.99934554,'qh_G':-156.99934554,'relative_G_kcal':.41067927,'population':.5}],
                             'ensemble_G':-157.00065446,'weighted_mean_G':-156.99967277,'note':'Invented demonstration numbers; not computed results.'}
    }.items():
        (analyses/name).write_text(json.dumps(data), encoding='utf-8')
    return study


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args=parser.parse_args()
    create_studies(args.destination)
