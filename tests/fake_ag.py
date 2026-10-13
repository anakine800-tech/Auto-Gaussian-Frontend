"""Executable offline fixture; never imports ag, SSH, or a scheduler client."""
import hashlib
import json
from pathlib import Path
import sys
import time


def main():
    home = Path(sys.argv[0]).parent
    args = sys.argv[1:]
    with (home/'argv.jsonl').open('a') as stream:
        stream.write(json.dumps(args)+'\n')
    control = json.loads((home/'control.json').read_text()) if (home/'control.json').exists() else {}
    if args == ['--version']:
        print('fake-ag/1')
        return control.get('version_code', 0)
    (home/'started').touch()
    time.sleep(control.get('delay', 0))
    if 'stdout' in control:
        print(control['stdout'], end='')
        print(control.get('stderr', ''), end='', file=sys.stderr)
        return control.get('exit_code', 0)
    command = args[0]
    root = home/'studies'
    if command == 'prepare':
        def value(flag):
            return args[args.index(flag)+1]
        study = Path(value('--study'))
        label = value('--label')
        attempt_id = f'{study.name}-001-{label}'
        attempt = study/'attempts'/attempt_id
        (attempt/'inputs').mkdir(parents=True)
        source = Path(value('--input'))
        raw = source.read_bytes()
        (attempt/'inputs'/source.name).write_bytes(raw)
        tiers = {'mini':(4,10), 'simple':(8,12), 'general':(22,50), 'complex':(44,120)}
        tier = value('--tier')
        cores, memory = tiers[tier]
        manifest = dict(schema='ag-attempt/1', attempt_id=attempt_id, study_id=study.name,
                        label=label, template='gaussian', tier=tier, cores=cores, mem_gb=memory,
                        walltime=value('--walltime'), parents=[dict(attempt_id=value('--parent'), relation=value('--relation'))],
                        inputs=[dict(name=source.name, sha256=hashlib.sha256(raw).hexdigest(), size=len(raw))],
                        bundle_sha256=hashlib.sha256(raw).hexdigest(),
                        science=dict(charge=0, multiplicity=1, route=next(line for line in raw.decode().splitlines() if line.startswith('#')),
                                     method_basis=value('--method-basis'), stereochemistry_warning='Synthetic only'))
        (attempt/'manifest.json').write_text(json.dumps(manifest))
        (attempt/'status.json').write_text(json.dumps(dict(state='prepared')))
        print(json.dumps(manifest))
    else:
        attempt = next(root.glob('*/attempts/'+args[2]))
        if command in ('submit', 'cancel'):
            (attempt/'status.json').write_text(json.dumps(dict(state='submitted' if command == 'submit' else 'cancelled')))
        print(json.dumps(dict(action=command, attempt_id=args[2], synthetic=True)))
        print('Synthetic ag stderr: no real calculation executed.', file=sys.stderr)
    return 0


def make_fake(directory):
    import stat
    directory = Path(directory)
    executable = directory/'fake-ag'
    executable.write_text('#!'+sys.executable+'\n'+Path(__file__).read_text()+'\nraise SystemExit(main())\n')
    executable.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    return executable


def settings(root):
    return str(root), {name:dict(cores=c, mem_gb=m) for name,c,m in
                       [('mini',4,10),('simple',8,12),('general',22,50),('complex',44,120)]}


def action_studies(root):
    from tests.results_fixture import create_results_studies
    study = create_results_studies(root)
    for file in (study/'attempts').glob('*/manifest.json'):
        manifest = json.loads(file.read_text())
        manifest['study_id'] = study.name
        manifest['attempt_id'] = file.parent.name
        manifest['bundle_sha256'] = 'abcdef012345'*5+'abcd'
        file.write_text(json.dumps(manifest))
    snapshot = root/'.ag-monitor/latest.json'
    data = json.loads(snapshot.read_text())
    data['warnings'][0]['attempt'] = 'opt-demo'
    snapshot.write_text(json.dumps(data))
    return study
