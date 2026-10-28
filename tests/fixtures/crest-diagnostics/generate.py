"""Explicit offline fixture regeneration using the selected T159 checkout.

Never imported by the viewer or test suite. PYTHONPATH must select the reviewed
backend source; the output records that checkout's full provenance commit.
"""
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from ag import facts

WATER = '3\n-5.0\nO 0 0 0\nH 0 0 1\nH 0 1 0\n'


def generate():
    result = {}
    for case in ('error', 'pbs', 'warning', 'unknown', 'missing', 'empty', 'incomplete'):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / 'attempts' / ('crest-' + case)
            outputs = path / 'outputs'
            outputs.mkdir(parents=True)
            manifest = dict(template='crest', scheduler='pbs' if case == 'pbs' else 'slurm',
                            attempt_id=path.name, study_id='crest-demo', label=path.name,
                            inputs=[{'name': 'water.xyz'}], parents=[],
                            template_params={'--mdopt': ''} if case == 'incomplete' else {},
                            science={'n_frames': 1})
            (path / 'manifest.json').write_text(json.dumps(manifest))
            (outputs / 'crest.out').write_text('CREST terminated normally.\n')
            if case != 'incomplete':
                for name, text in [('crest_conformers.xyz', WATER), ('crest_best.xyz', WATER),
                                   ('crest.energies', '1 0.0\n')]:
                    (outputs / name).write_text(text)
            stderr = ('\n' * 144 + 'Fortran runtime error: <script>window.crestExecuted=1</script>\n'
                      + '\n' * 115 if case == 'error' else
                      'PBS: job killed: walltime exceeded limit\n' if case == 'pbs' else
                      'WARNING: illustrative warning\n' if case == 'warning' else
                      'unclassified diagnostic text\n' if case == 'unknown' else '')
            if case == 'pbs':
                (outputs / 'job.pbs.out').write_text(stderr)
            else:
                (outputs / 'job.slurm.out').write_text('')
                if case != 'missing':
                    (outputs / 'job.slurm.err').write_text(stderr)
            with patch('ag.transport.SSHTransport', side_effect=AssertionError('offline only')):
                try:
                    parsed = facts.build_facts(path)
                except facts.CrestParseIncomplete as exc:
                    parsed = exc.facts
            result[case] = dict(manifest=manifest, facts=parsed,
                                outputs={p.name: p.read_text() for p in sorted(outputs.iterdir())},
                                geometries={p.name: p.read_text() for p in path.glob('*.xyz')})
    target = Path(__file__).with_name('generated.json')
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('Generated seven synthetic cases with backend provenance; no remote calls.')


if __name__ == '__main__':
    generate()
