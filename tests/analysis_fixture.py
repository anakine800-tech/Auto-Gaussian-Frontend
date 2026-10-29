"""Small invented reports for T98 UI checks; not calculation results."""
import json
import os


def saved_profile():
    """T193 invented saved values, including deliberately incomplete legacy rows."""
    def conformer(attempt, spc=None):
        source = {'attempt_id': attempt, 'section_index': 0, 'start_line': 1,
                  'end_line': 20, 'route': '# HF/STO-3G Freq', 'protocol': {}}
        return {'attempt_id': attempt, 'spc_attempt_id': spc,
                'frequency_source': source,
                'electronic_energy_source': {**source, 'attempt_id': spc or attempt},
                'population': 0.5, 'degeneracy': 1, 'qh_G_hartree': -157.0}

    long_id = 'P-synthetic-long-name-' + 'saved-state-' * 8
    return {
        'schema': 'ag-profile/1', 'units': 'kcal/mol', 'reference': 'R-mixture',
        'temperature_K': 310.15, 'standard_state': '1M',
        'explicit_solvent_concentrations_M': {'solvent': 0.125},
        'states': [
            {'id': 'R-mixture', 'kind': 'minimum', 'species': {'substrate': 1, 'solvent': 2},
             'G_kcal': -987654.321, 'relative_G_kcal': 0},
            {'id': 'TS-mixed', 'kind': 'ts', 'species': {'transition': 1, 'solvent': 2},
             'G_kcal': -987650.0, 'relative_G_kcal': 12.3456789},
            {'id': long_id, 'kind': 'minimum', 'species': {'product': 1, 'solvent': 2},
             'G_kcal': -987640.0, 'relative_G_kcal': -4.125},
            {'id': 'missing-energy', 'kind': 'ts', 'species': {'missing-species': 1},
             'G_kcal': -987600.0},
            {'id': 'nonfinite-energy', 'kind': 'minimum', 'species': {'missing-species': 1},
             'G_kcal': -987580.0, 'relative_G_kcal': 'Infinity'},
        ],
        'species': {
            'substrate': {'conformers': [conformer('anti', 'opt-demo'), conformer('gauche')],
                          'settings': {'temperature_K': 310.15, 'concentration_mol_L': 1.0},
                          'warnings': ['Synthetic species warning']},
            'solvent': {'conformers': [conformer('anti')], 'warnings': []},
            'transition': {'conformers': [conformer('opt-demo', 'gauche')], 'warnings': []},
            'product': {'conformers': [conformer('anti')], 'warnings': []},
        },
        'warnings': [' \t=SUM(1,2)\n"synthetic warning"', '  +1', '  -1', '  @value',
                     '\x01control character'],
        'symmetry': {'warnings': ['Synthetic symmetry warning']},
        'note': 'Synthetic display only; no chemical conclusion.',
        'selectivity': [
            {'id': 'synthetic-branch',
             'pairwise': [{'a': 'R', 'b': 'S', 'ddG_barrier_kcal': 1.2, 'ratio_a_over_b': 7.5}],
             'products': {'R': {'fraction': 0.88}, 'S': {'fraction': 0.12}}}],
    }


def add_analysis_reports(study):
    reports = {
        'profile-demo.json': saved_profile(),
        'coverage-demo.json': {'schema': 'ag-channel-coverage/1', 'channels': [
            {'channel_id': 'synthetic-a', 'imbalances': [{'metric': 'opt_count', 'count': 1}]}], 'product_branches': []},
        'nci-demo.json': {'schema': 'ag-nci/1', 'notice': '结果仅为相互作用的可视化与半定量分析，不是能量分解', 'frames': [
            {'frame': 1, 'fragment_pairs': [{'atom_pairs': [{'atoms': [1, 3], 'percent': 75, 'delta_g': .3},
                                                          {'atoms': [2, 3], 'percent': 25, 'delta_g': .1}]}]}]},
        'unknown-demo.json': {'schema': 'future-report/9', 'summary': 'Must not be promoted to a conclusion'},
    }
    for name, data in reports.items():
        path = study / 'analyses' / name
        path.write_text(json.dumps(data), encoding='utf-8')
        os.utime(path, (1767225600, 1767225600))

    labels = study/'analyses/ts-labels/synthetic'
    labels.mkdir(parents=True)
    (labels/'labels.json').write_text(json.dumps({'attempts': [
        {'attempt': 'anti', 'product_configuration': 'C1:R', 'product_centers': [{'label': 'R'}, {'label': 'unknown'}],
         'catalyst_check': {'status': 'unchanged'}}], 'channel_suggestions': [{'status': 'pending_confirmation'}]}))
    (labels/'labels.md').write_text('# Synthetic labels only\n')
    (labels/'channel-suggestions.csv').write_text('attempt,status\nanti,pending_confirmation\n')
    for path in labels.iterdir():
        os.utime(path, (1767139200, 1767139200))
    add_reading_reports(study)


def add_reading_reports(study):
    """T118 synthetic documents; no research identities or calculation outputs."""
    import base64
    area = study/'analyses/reading'; area.mkdir()
    files = {
        'overview.md': '''---
kind: energy
---
# 合成报告阅读示例

本页所有数值仅用于界面验证。

| Attempt | score | note |
| --- | ---: | --- |
| anti | 10 | 合成候选 A |
| gauche | 2 | 合成候选 B |
| anti-extra | -3 | 不是 Attempt 编号 |

[同目录 CSV](./quoted.csv) · [上级报告](../profile-demo.json) · [Attempt](../../attempts/anti) · [结构文件](../representatives.xyz) · [普通文件](../../notes/说明.txt) · [越界链接](../../../outside.txt) · [绝对链接](/etc/passwd) · [脚本链接](javascript:alert(1)) · [外部文档](https://example.org/reference)

![合成示意图](./diagram.svg)

![缺失图片](./missing.png)

<script>window.reportInjected=true</script>
''',
        'quoted.csv': 'Attempt,note,score\r\nanti,"quoted, comma",10\r\ngauche,"two\nlines",2\r\n',
        'bad.csv': 'a,b\n"unterminated,b\n',
        'objects.json': json.dumps([{'Attempt':'anti','score':10}, {'Attempt':'gauche','score':2,'extra':{'saved':True}}]),
        'scalars.json': '[1,"text",true,null]',
        'object.json': '{"label":"Synthetic object","nested":{"value":3}}',
        'scalar.json': '42',
        'null.json': 'null',
        'bad.json': '{\n  "broken": }',
        'wide.json': json.dumps([{f'column-{i}':i for i in range(35)}]),
        'large.csv': 'index,score\n'+''.join(f'{i},{5001-i}\n' for i in range(5001)),
        'diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 150"><rect width="480" height="150" fill="#f3f6fa"/><text x="24" y="30" font-size="18">Synthetic display only</text><rect x="24" y="50" width="320" height="28" fill="#45759c"/><rect x="24" y="90" width="180" height="28" fill="#78a6be"/><script>window.reportInjected=true;fetch("/should-not-run")</script></svg>',
        'demo.html': '<!doctype html><html><head><style>body{font-family:sans-serif;padding:20px}h1{color:#45759c}</style></head><body><h1>Synthetic HTML report</h1><p>Saved static content.</p><img src="tiny.png" alt="local pixel"><script>document.body.dataset.executed="yes";parent.reportInjected=true;fetch("/should-not-run")</script></body></html>',
    }
    for name,raw in files.items(): (area/name).write_text(raw,encoding='utf-8')
    (area/'tiny.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFioAAAAASUVORK5CYII='))
    # Keep existing overview recent-report fixtures stable.
    for path in area.iterdir(): os.utime(path, (1577836800,1577836800))
    notes=study/'notes'; notes.mkdir(); (notes/'说明.txt').write_text('只读本地文件示例',encoding='utf-8')
    with (study/'study.md').open('a') as stream: stream.write('\n[本地报告](analyses/reading/overview.md)\n')
