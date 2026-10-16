"""T57: isolated synthetic studies for API and real-HTTP browser regression."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import shutil
import tempfile

from tests.results_fixture import create_results_studies, monitor_snapshot
from tests.ensemble_fixture import create_ensemble_study
from tests.test_mode_reports import synthetic_log, example_report


CASES = ('facts-missing', 'facts-broken', 'xyz-replaced', 'report-other-log',
         'log-truncated', 'size-limit', 'frame-limit', 'atom-limit', 'symlink')
FETCH_RESULT = dict(attempt_id='anti', state='fetched', files=['butane.log'],
                    facts=dict(status='written'))


def write_json(path, data):
    path.write_text(json.dumps(data), encoding='utf-8')


def create_integration_study(root):
    study = create_results_studies(root)
    ensemble = create_ensemble_study(root)
    for name in ('ensemble.json', 'frames.xyz'):
        shutil.copyfile(ensemble/'analyses'/name, study/'analyses'/name)
    manifest = json.loads((study/'analyses/ensemble.json').read_text())
    manifest['study_id'] = study.name
    manifest['candidates'][0]['opt']['attempts'] = ['opt-demo']
    write_json(study/'analyses/ensemble.json', manifest)
    shutil.copytree(ensemble/'attempts/crest-demo', study/'attempts/crest-demo')
    sp = study/'attempts/sp-demo'; sp.mkdir()
    write_json(sp/'manifest.json', dict(template='gaussian', parents=[], science=dict(route='# HF/STO-3G SP')))
    write_json(sp/'status.json', dict(state='fetched'))
    write_json(sp/'facts.json', dict(termination='normal', route='# HF/STO-3G SP', energies=dict(scf=-76.)))
    (study/'attempts/anti/outputs/butane.log').write_text(synthetic_log())
    (study/'attempts/anti/final.xyz').write_text('3\nSynthetic TS display only\nH 0 0 0\nH 4 0 0\nH 0 3 0\n')
    write_json(study/'analyses/mode-review.json', example_report())
    manifest_path = study/'attempts/anti/manifest.json'
    attempt_manifest = json.loads(manifest_path.read_text())
    attempt_manifest.update(study_id=study.name, label='Synthetic TS frequency')
    write_json(manifest_path, attempt_manifest)
    write_json(study/'attempts/anti/facts.json', dict(schema='ag-facts/1',
        route='# HF/STO-3G Freq', termination='normal', n_imag=1,
        frequencies_low=[-100.], energies=dict(scf=-1.)))
    for case in CASES:
        target = root/case
        shutil.copytree(study, target)
        mutate(target, case)
    for name in ('fresh', 'expired', 'failed'):
        snapshot = monitor_snapshot()
        snapshot['own'].update(cores_running=8, cores_queued=16, committed_cap=88, cores_in_use=24)
        if name == 'expired':
            snapshot['sampled_at'] = (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
        if name == 'failed':
            snapshot.update(ok=False, error='Synthetic sampling failure', last_ok_at=snapshot['sampled_at'])
        path = root/'.ag-monitor'/name/'latest.json'; path.parent.mkdir()
        write_json(path, snapshot)
    return study


def mutate(study, case):
    facts = study/'attempts/anti/facts.json'
    xyz = study/'analyses/frames.xyz'
    manifest = study/'analyses/ensemble.json'
    if case == 'facts-missing':
        facts.unlink()
    elif case == 'facts-broken':
        facts.write_text('{')
    elif case == 'xyz-replaced':
        xyz.write_bytes(xyz.read_bytes().replace(b'0.950000', b'1.950000'))
    elif case == 'report-other-log':
        report = example_report(); report['source']['log_sha256'] = '0'*64
        write_json(study/'analyses/mode-review.json', report)
    elif case == 'log-truncated':
        log = study/'attempts/anti/outputs/butane.log'
        log.write_text(synthetic_log().split('     2   1    -0.80')[0])
    elif case == 'size-limit':
        with xyz.open('wb') as stream:
            stream.truncate(32*1024*1024+1)
    elif case in ('frame-limit', 'atom-limit'):
        raw = b'1\nSynthetic\nH 0 0 0\n'*1001 if case == 'frame-limit' else b'501\nSynthetic\n'+b'H 0 0 0\n'*501
        xyz.write_bytes(raw)
        data = json.loads(manifest.read_text()); data['inputs']['xyz']['sha256'] = sha256(raw).hexdigest()
        write_json(manifest, data)
    elif case == 'symlink':
        # Target is outside this study; contents must never reach an HTTP response.
        sentinel = study.parent.parent/'sentinel.txt'; sentinel.write_text('OUTSIDE_STUDY_SENTINEL')
        xyz.unlink(); xyz.symlink_to(sentinel)


if __name__ == '__main__':
    import sys
    import uvicorn
    from autog_frontend.api import create_app
    from tests.fake_ag import make_fake
    with tempfile.TemporaryDirectory() as directory:
        home = Path(directory).resolve(); root = home/'studies'
        create_integration_study(root)
        actions = '--actions' in sys.argv
        if actions:
            fake = make_fake(home)
            write_json(home/'control.json', dict(stdout=json.dumps(FETCH_RESULT)+'\n'))
        app = create_app(root, Path(__file__).resolve().parents[1]/'web/dist',
                         enable_actions=actions, ag=fake if actions else None)
        uvicorn.run(app, host='127.0.0.1', port=18768 if actions else 18767,
                    access_log=False, proxy_headers=False)
