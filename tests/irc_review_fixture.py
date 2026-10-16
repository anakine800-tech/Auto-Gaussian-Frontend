"""Invented water paths and evidence, never real calculations or research data."""
import hashlib
import json
from pathlib import Path
import tempfile


def ref(path):
    return dict(path=path, sha256='a'*64)


def make_review(*, hashed=True):
    pairs=[[1,2],[1,3]]
    report=dict(schema='ag-irc-review/1',ag_version='synthetic',notice='工具只核对和汇总；仍需人工审阅 SCF/电子态连续性和逐点几何，以及端点化学身份。',
                ts='synthetic-ts',protocol=dict(method='synthetic',basis='synthetic',dispersion=None,solvent_model=None,solvent=None),
                pairs=pairs,units=dict(energy='hartree',relative_energy='kcal/mol',distance='angstrom'),
                thresholds=dict(energy_drop_kcal_mol=3,energy_noise_kcal_mol=.01,energy_jump_kcal_mol=20,rmsd_jump_angstrom=.5,
                                indistinguishable_pair_angstrom=.05,endpoint_input_angstrom=.0001,endpoint_aligned_rmsd_angstrom=.001),inputs=[],directions={})
    files={}
    for direction,count in [('forward',4),('reverse',2)]:
        attempt='synthetic-'+direction
        log=ref(f'attempts/{attempt}/outputs/water.log')
        points=[];xyz=[]
        for i in range(count+1):
            distances={'1-2':1.2-.02*i,'1-3':1.1+.02*i}
            points.append(dict(point=i,path=1,point_line=100+20*i,energy_hartree=-76-.001*i,energy_line=90+20*i,energy_kind='scf',
                               geometry_line=101+20*i,geometry_kind='current_structure',geometry_frame=i,relative_energy_kcal_mol=-.2*i,
                               distances_angstrom=distances))
            xyz.append(f'3\nSynthetic {direction} point {i}\nO 0 0 0\nH {1+.05*i} 0 0\nH 0 1 0\n')
        continuity=dict(status='tool_checks_passed',reasons=[],manual_review=report['notice'],steps=[dict(points=[i,i+1],energy_change_kcal_mol=-.2,rmsd_angstrom=.01,energy_lines=[90+20*i,110+20*i],geometry_lines=[101+20*i,121+20*i]) for i in range(count)],
                        evidence_lines=dict(normal_termination=[200],error_termination=[],path_complete=[190],corrector_failed=[],max_points=[]),
                        corrector_failed=False,path_complete_reported=True,reached_max_points=False,max_points=20)
        energy=dict(status='met' if direction=='forward' else 'met_by_endpoint_optimization',drop_kcal_mol=4.2 if direction=='forward' else .4,threshold_kcal_mol=3,
                    start_energy_hartree=-76,last_energy_hartree=-76.001,energy_lines=[90,90+20*count],log=log,reason='由端点优化补证；阈值未调低')
        midpoint=dict(status='met',pairs=[dict(pair=p,ts_angstrom=1.2,last_angstrom=1.1,reference_angstrom=.8,midpoint_angstrom=1.,change='forming',status='met',reason='合成保存值') for p in ('1-2','1-3')],
                      reference=ref('structures/reference/water.xyz'),ts=ref('attempts/synthetic-ts/final.xyz'),last_point_line=101+20*count,log=log)
        facts=[dict(field=k,value=v,source=ref(f'attempts/endpoint-{direction}/facts.json'),line=10+i) for i,(k,v) in enumerate(dict(termination='normal',opt_converged=True,freq_step_converged=True,vibrational_modes_complete=True,n_vibrational_modes=3,expected_vibrational_modes=3,n_imag=0).items())]
        endpoint=dict(status='met',reasons=[],facts=facts,failed_fields=[],missing_fields=[],identity=dict(status='met',reported_status='synthetic match',side='product',source=ref('analyses/identity.json'),field=f'comparisons.{direction}.product.status'),
                      log=log,log_lines=dict(termination=[200]),frequency_convergence=dict(field='freq_step_convergence',value=None,source=facts[0]['source'],line=None),fact_sources=None,job_sections=None,
                      input_max_displacement_angstrom=0,input_aligned_rmsd_angstrom=0,provenance='coordinates',provenance_note='坐标一致',manifest=ref(f'attempts/endpoint-{direction}/manifest.json'))
        filename=f'review.{direction}.xyz';raw=''.join(xyz).encode();files[filename]=raw
        if hashed:report['inputs'].append(dict(path='analyses/'+filename,sha256=hashlib.sha256(raw).hexdigest()))
        report['directions'][direction]=dict(attempt=attempt,log=log,criteria=dict(continuity=continuity,energy_drop=energy,midpoint=midpoint,endpoint=endpoint),summary='工具核对完成，待人工审阅',unresolved=[],warnings=[],stop_reason='completed' if direction=='forward' else 'max_points',last_accepted_point=count,
                                            ts_reference=dict(irc_point_zero_hartree=-76,ts_facts_hartree=-76,difference_hartree=0,ts_facts=ref('attempts/synthetic-ts/facts.json')),path_geometry=dict(path=filename,frame_index_base=0,frame_count=count+1),points=points)
    return report,files


def create_study(root, name='irc-demo', hashed=True):
    study=root/name;analyses=study/'analyses';analyses.mkdir(parents=True)
    (study/'study.md').write_text('# Synthetic IRC water\n')
    report,files=make_review(hashed=hashed)
    for filename,raw in files.items():(analyses/filename).write_bytes(raw)
    (analyses/'review.json').write_text(json.dumps(report,ensure_ascii=False))
    return study


def create_cases(root):
    create_study(root);create_study(root,'unhashed',False)
    study=create_study(root,'gaps',False)
    path=study/'analyses/review.json';data=json.loads(path.read_text());d=data['directions']['forward']
    d['points'][1]['energy_hartree']=None;d['points'][1]['relative_energy_kcal_mol']=None;d['points'][1]['geometry_frame']=None;d['points'][1]['distances_angstrom']=None
    for p in d['points'][2:]:p['geometry_frame']-=1
    d['path_geometry']['frame_count']-=1
    xyz=study/'analyses/review.forward.xyz';rows=xyz.read_text().splitlines(keepends=True);xyz.write_text(''.join(rows[:5]+rows[10:]))
    path.write_text(json.dumps(data))
    study=create_study(root,'incomplete',False)
    path=study/'analyses/review.json';data=json.loads(path.read_text());d=data['directions']['reverse']
    d['criteria']['continuity']['status']='not_met';d['criteria']['continuity']['reasons']=['合成校正失败']
    d['criteria']['endpoint']={'status':'unknown','reasons':['未提供末点 Opt+Freq Attempt']}
    d['criteria']['energy_drop']['status']='not_met';d['summary']='IRC 未完成';d['unresolved']=['continuity','energy_drop','endpoint'];d['stop_reason']='corrector_failed'
    path.write_text(json.dumps(data))
    study=create_study(root,'invalid');path=study/'analyses/review.reverse.xyz';path.write_bytes(path.read_bytes().replace(b'H 1.0',b'H 2.0'))


if __name__=='__main__':
    import uvicorn
    from autog_frontend.api import create_app
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory).resolve();create_cases(root)
        uvicorn.run(create_app(root,Path(__file__).resolve().parents[1]/'web/dist'),host='127.0.0.1',port=18769,access_log=False,proxy_headers=False)
