"""Temporary HTTP fixture for T132; only synthetic water, never a live ag call."""
import hashlib
import json
from pathlib import Path
import tempfile


def create_catalog_studies(root):
    fixture = Path(__file__).parent / 'catalog-fixtures/t132'
    for name in ('val-ledger', 'val-six-statuses', 'val-withdrawn', 'val-no-coverage',
                 'val-expectations', 'val-invalid', 'val-future', 'val-bad-hash', 'val-v1'):
        study = root / name
        (study / 'catalog').mkdir(parents=True)
        (study / 'study.md').write_text('---\ntype: validation\n---\n# 合成水通道验证\n')
        source = fixture / ('six-statuses' if name == 'val-six-statuses' else 'two-channels')
        state = json.loads((source / 'state.json').read_bytes())
        journal = (source / 'journal.jsonl').read_bytes()
        obj = state['objects'][0]
        if name == 'val-withdrawn':
            obj['coverage']['statement'] = 'withdrawn'
        elif name == 'val-no-coverage':
            obj['coverage'] = None
        elif name == 'val-expectations':
            obj['expected'] = dict(formula=dict(state='unset', value=None), charge=dict(state='unknown', value=None))
            obj['multiplicity'] = None
        elif name == 'val-invalid':
            obj['channels'][0]['status'] = 'auto_verified'
        elif name == 'val-future':
            state['schema'] = 'ag-catalog-state/3'
        elif name == 'val-bad-hash':
            journal += b'changed\n'
        elif name == 'val-v1':
            state['schema'] = 'ag-catalog-state/1'
            for key in ('expected', 'channels', 'candidates', 'coverage', 'member_mismatches'):
                del obj[key]
        (study / 'catalog/state.json').write_text(json.dumps(state, ensure_ascii=False))
        (study / 'catalog/journal.jsonl').write_bytes(journal)
        attempt = study / 'attempts/water-ts-synthetic'
        attempt.mkdir(parents=True)
        manifest = dict(schema='ag-attempt/1', study_id=name, attempt_id=attempt.name,
                        label='合成水 TS', template='gaussian', parents=[],
                        science=dict(route='# HF/STO-3G Opt=(TS,CalcFC) Freq', charge=0, multiplicity=1))
        for filename, data in [('manifest.json', manifest), ('status.json', {'state': 'fetched'}),
                               ('facts.json', {'schema': 'ag-facts/1', 'n_imag': 1, 'termination': 'normal'})]:
            (attempt / filename).write_text(json.dumps(data))
    for name in ('_archive', '.ag-monitor'):
        (root / name).mkdir()


def snapshot(root):
    return {str(p.relative_to(root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
            for p in root.rglob('*') if p.is_file()}


if __name__ == '__main__':
    import signal
    import uvicorn
    from autog_frontend.api import create_app

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        create_catalog_studies(root)
        before = snapshot(root)
        app = create_app(root, Path(__file__).resolve().parents[1] / 'web/dist')
        # Uvicorn re-raises its captured SIGTERM after graceful shutdown. Let
        # control return here so byte/mtime verification and temp cleanup run.
        signal.signal(signal.SIGTERM, lambda *_: None)
        uvicorn.run(app, host='127.0.0.1', port=18769, access_log=False, proxy_headers=False)
        assert snapshot(root) == before, 'Viewer changed synthetic study bytes or mtimes'
