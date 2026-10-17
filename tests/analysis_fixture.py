"""Small invented reports for T98 UI checks; not calculation results."""
import json
import os


def add_analysis_reports(study):
    reports = {
        'profile-demo.json': {'schema': 'ag-profile/1', 'units': 'kcal/mol', 'selectivity': [
            {'id': 'synthetic-branch', 'pairwise': [{'a': 'R', 'b': 'S', 'ddG_barrier_kcal': 1.2, 'ratio_a_over_b': 7.5}],
             'products': {'R': {'fraction': 0.88}, 'S': {'fraction': 0.12}}}]},
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
