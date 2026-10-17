"""Invented small-molecule and scheduler records; never live cluster data."""
from datetime import datetime, timezone
import json
import os
from tests.study_fixture import ATOMS, create_preview_studies


def orientation(kind='Standard', shift=0):
    lines=[f' {kind} orientation:', ' ---------------------------------------------------------------------',
           ' Center Atomic Atomic Coordinates (Angstroms)', ' Number Number Type X Y Z',
           ' ---------------------------------------------------------------------']
    lines += [f' {i} {6 if a[0]=="C" else 1} 0 {a[1]+shift:.6f} {a[2]:.6f} {a[3]:.6f}' for i,a in enumerate(ATOMS,1)]
    return '\n'.join(lines+[' ---------------------------------------------------------------------'])+'\n'


def opt_log(converged=True):
    text=' Synthetic butane optimization; invented values, not a calculation.\n # HF/STO-3G Opt Freq\n ------------------\n'
    for step,energy in enumerate([-157.,-157.002,-157.0025],1):
        text+=orientation('Input',step*.1+1)
        if step!=2:
            text+=orientation('Standard',step*.1)
        text+=f' SCF Done: E(RHF) = {energy:.8f} A.U. after 10 cycles\n Step number {step} out of a maximum of 20\n'
        text+=' Item Value Threshold Converged?\n'
        for label,threshold in [('Maximum Force',.00045),('RMS Force',.00030),('Maximum Displacement',.0018),('RMS Displacement',.0012)]:
            yes=converged and step==3
            text+=f' {label} {threshold*(.5 if yes else 2):.8f} {threshold:.8f} {"YES" if yes else "NO"}\n'
    if converged:
        text+=' Optimization completed.\n Stationary point found.\n'+orientation('Standard',99)
        text+=' SCF Done: E(RHF) = -156.9 A.U. after 10 cycles\n Harmonic frequencies (cm**-1)\n Frequencies -- 100 200 300\n Normal termination of Gaussian (synthetic).\n'
    else:
        text+=' Optimization stopped.\n Number of steps exceeded\n Error termination (synthetic).\n'
    return text


def monitor_snapshot():
    return {'schema':'ag-monitor/1','sampled_at':datetime.now(timezone.utc).isoformat(),
            'interval_seconds':120,'ok':True,'error':None,'last_ok_at':None,
            'own':{'cores_in_use':8,'core_cap':44,'jobs':[
                {'job_id':'synthetic-001','name':'synthetic-opt','state':'R','queue':'demo','cores':8,'mem':'12gb',
                 'walltime_used':'00:03:12','walltime_limit':'01:00:00','start_time':None,'study':'butane-demo','attempt':'opt-demo'}]},
            'cluster':{'nodes':[{'name':'synthetic-node','state':'free','cores_total':44,'cores_used':8}],
                       'queues':[{'name':'demo','running':1,'queued':0}],'cores_total':44,'cores_used':8},
            'warnings':[{'kind':'scheduler-residue','job_id':'synthetic-002','study':'butane-demo','attempt':'waiting','detail':'需人工确认后 ag cancel'},
                        {'kind':'future-kind','job_id':None,'study':None,'attempt':None,'detail':'运行 ag status 核对'}]}


def create_results_studies(root):
    study=create_preview_studies(root)
    with (study/'study.md').open('a') as f:
        f.write('\n## 待你决定\n- 合成示例：是否进入下一轮人工审阅。\n\n## 里程碑签字\n| 里程碑 | 展示并确认的对象 | 日期 | 签字人 | 人的确认原意 |\n|---|---|---|---|---|\n| 结构 | 合成正丁烷 | 2026-01-01 | Synthetic reviewer | 仅为查看器演示 |\n| 代表构象集合 | 合成集合 | 待签 | 待签 | 待确认 |\n| 最终结果 | 虚构能量 | 待签 | 待签 | 待确认 |\n\n## 进度日志\n- 2026-01-02：准备合成数据，等待人工审阅演示。\n')
        f.write('\n## 安全检查\n**Markdown 正常渲染**\n\n[当前阻塞](#当前阻塞) [外部链接](https://example.invalid) [脚本链接](javascript:alert(1))\n\n<script>window.syntheticXss=1</script>\n<img src="x" onerror="window.syntheticXss=1">\n\n![外部图片](https://example.invalid/image.png)\n')
    for name,converged in [('opt-demo',True),('opt-failed',False)]:
        base=study/'attempts'/name
        (base/'outputs').mkdir(parents=True)
        (base/'outputs'/'optimization.log').write_text(opt_log(converged))
        (base/'manifest.json').write_text(json.dumps({'label':'Synthetic optimization','template':'gaussian','parents':[], 'cluster':'default', 'cores':8, 'science':{'method_basis':'HF/STO-3G'}}))
        (base/'status.json').write_text(json.dumps({'state':'fetched','elapsed':'00:03:12'}))
        (base/'facts.json').write_text(json.dumps({'schema':'ag-facts/1','route':'# HF/STO-3G Opt Freq','opt_converged':converged,'termination':'normal' if converged else 'error','energies':{'scf':-157.0025,'g':-156.91} if converged else {'scf':-157.0025},'n_imag':0 if converged else None,'frequencies_low':[100,200,300] if converged else []}))
    folder=study/'analyses'/'cluster-demo';folder.mkdir()
    (folder/'representatives.xyz').write_bytes((study/'analyses'/'representatives.xyz').read_bytes())
    for i, report in enumerate(sorted((study/'analyses').glob('*.json'))):
        os.utime(report, (1767312000+i*3600, 1767312000+i*3600))
    monitor=root/'.ag-monitor';monitor.mkdir()
    (monitor/'latest.json').write_text(json.dumps(monitor_snapshot()))
    return study
