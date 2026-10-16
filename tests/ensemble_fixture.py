"""Handwritten T53 appendix A records; synthetic water, no research data."""
import hashlib
import json


def make_ensemble(count=3, per_source=False):
    frames, candidates = [], []
    for index in range(count):
        # Slightly different invented water coordinates, not optimized structures.
        rows = f'O 0 0 0\nH {0.95 + index * 0.001:.6f} 0 0\nH -0.24 0.93 0\n'
        frames.append(f'3\nsynthetic {-76.0 + index * 0.001:.6f}\n' + rows)
        layer = dict(attempts=['sp-demo'], ambiguous=False, energy_hartree=-76.0 + index*.01, relative_kcal=float(count-index))
        candidates.append(dict(candidate=index+1, xyz_frame=index+1,
            geometry_sha256=hashlib.sha256(rows.encode()).hexdigest(), sources=['route-a', 'route-b'],
            route_members=[dict(route='route-a', member=index+1, relative_kcal_within_route=index*.1),
                           dict(route='route-b', member=index+1, relative_kcal_within_route=index*.2)],
            xtb_relative_kcal=None if per_source else float(index), sp=layer if index != 1 else None,
            opt=dict(**layer, termination='normal', n_imaginary=0) if index == 0 else None,
            thermo=dict(attempt='opt-demo', qh_G=-75.9, relative_G_kcal=0., population=.42) if index == 0 else None,
            missing=[] if index == 0 else ['opt_freq', 'thermo'] + (['sp'] if index == 1 else []),
            notes=['Synthetic missing calculation'] if index == 1 else []))
    raw = ''.join(frames).encode()
    data = dict(schema='ag-ensemble/1', created_at='2026-10-16T00:00:00Z', ag={'version':'synthetic'},
        study_id='ensemble-demo', label='合成水集合' if not per_source else '分路线集合',
        inputs=dict(merged=dict(path='analyses/synthetic.json', sha256='0'*64),
                    xyz=dict(path='analyses/frames.xyz', file='frames.xyz', sha256=hashlib.sha256(raw).hexdigest())),
        charge=0, hydrogens='all', energy_basis='per_source_not_comparable' if per_source else 'shared_hartree',
        units=dict(energy='Hartree', relative='kcal/mol', population='fraction'),
        routes=[dict(label='route-a', attempts=['crest-demo']),dict(label='route-b', attempts=[])],
        references=dict(xtb=None if per_source else 1, sp=count if count>2 else 1, opt=1),
        warnings=['各路线 xTB 能量不可直接比较'] if per_source else [], candidates=candidates,
        unmatched_attempts=[dict(layer='sp', attempt='unmatched-demo', reason='未匹配候选')])
    return data, raw


def create_ensemble_study(root):
    study=root/'ensemble-demo';(study/'analyses'/'routes').mkdir(parents=True)
    (study/'study.md').write_text('# Synthetic ensemble study\n')
    for group, name, count, per_source in [('', 'ensemble.json',3,False),('routes','separate.json',3,True),('many','many.json',55,False)]:
        directory=study/'analyses'/group;directory.mkdir(exist_ok=True)
        data, raw=make_ensemble(count,per_source)
        if group=='many':data['label']='分页集合'
        if not group:
            data['candidates'][2]['sp'].update(attempts=['sp-a','sp-b'],ambiguous=True,energy_hartree=None,relative_kcal=None)
            data['references']['sp']=1
        (directory/name).write_text(json.dumps(data))
        (directory/'frames.xyz').write_bytes(raw)
    (study/'analyses'/'unrelated.json').write_text('{"schema":"other/1"}')
    for template in ('crest','gaussian'):
        base=study/'attempts'/(template+'-demo');(base/'outputs').mkdir(parents=True);(base/'inputs').mkdir()
        (base/'manifest.json').write_text(json.dumps(dict(template=template,parents=[])))
        (base/'status.json').write_text('{"state":"fetched"}')
        for name in ('crest_conformers.xyz','crest_best.xyz','crest_ensemble.xyz'):
            data, raw=make_ensemble()
            raw=raw.replace(b'synthetic -75.998000',b'no energy here')
            (base/'outputs'/name).write_bytes(raw)
    return study
