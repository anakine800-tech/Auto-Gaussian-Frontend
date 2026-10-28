"""T160 local source binding and viewer boundaries; synthetic files only."""
from contextlib import contextmanager
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend import crest_diagnostics as cd
from autog_frontend.studies import Studies, StudyError
from tests.study_fixture import create_crest_study


class CrestDiagnosticTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.study = create_crest_study(self.root)
        self.base = self.study/'attempts/crest-error'
        self.store = Studies(self.root)
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('localhost',50000))
        self.url = '/api/studies/crest-demo/attempts/crest-error'

    def fingerprint(self):
        return {str(p.relative_to(self.root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
                for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def record(self):
        return self.store.attempt('crest-demo', 'crest-error')['crest_diagnostics']

    def source(self, record=None):
        record = record or self.record()
        return next(s for s in record['sources'] if s.get('file') == 'job.slurm.err')

    def excerpt(self, record=None, index=None):
        record = record or self.record()
        index = self.source(record)['index'] if index is None else index
        return self.store.crest_excerpt('crest-demo', 'crest-error', index, record['token'])

    def mutate_facts(self, mutate):
        path = self.base/'facts.json'
        raw = json.loads(path.read_text())
        mutate(raw['crest_diagnostics'])
        path.write_text(json.dumps(raw))

    def test_t159_generated_states_metadata_and_readonly_api(self):
        before = self.fingerprint()
        with patch('subprocess.Popen', side_effect=AssertionError('no process')):
            for case, expected in [('error','identified'),('pbs','identified'),('warning','none'),
                                   ('unknown','unresolved'),('missing','unavailable'),('empty','none'),
                                   ('incomplete','unresolved')]:
                data = self.client.get(self.url.replace('crest-error','crest-'+case)).json()
                self.assertEqual(data['crest_diagnostics']['status'], expected)
                self.assertEqual(data['facts']['data']['ag_provenance']['git_commit'],
                                 'ebf711cafc934b15c6b045582e69511752117e53')
                self.assertNotIn('window.crestExecuted', json.dumps(data))
            record = self.record(); source = self.source(record)
            response = self.client.get(self.url+f"/crest-diagnostics/{source['index']}", params={'token':record['token']})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data['status'], 'matched')
            self.assertEqual(data['line_start'], 145)
            self.assertIn('<script>', data['text'])
            self.assertEqual(data['sha256'], source['sha256'])
            other = self.client.get(self.url.replace('crest-error','crest-empty')+'/crest-diagnostics/0',
                                    params={'token':record['token']}).json()
            self.assertEqual(other, dict(status='stale',text=''))
            self.assertLessEqual(len(data['text'].encode()), cd.MAX_EXCERPT_BYTES)
        self.assertEqual(before, self.fingerprint())
        self.assertFalse(any(name == 'ag' or name.startswith('ag.') for name in sys.modules))

    def test_old_malformed_and_illegal_types_do_not_break_detail(self):
        path = self.base/'facts.json'; original = json.loads(path.read_text())
        for value in [None, [], 'x', {}, {'status':'identified','summary':'x','sources':None},
                      dict(original['crest_diagnostics'], status=[]),
                      dict(original['crest_diagnostics'], summary='x'*301),
                      dict(original['crest_diagnostics'], scan_truncated=1),
                      dict(original['crest_diagnostics'], parse_error=[]),
                      dict(original['crest_diagnostics'], files='bad'),
                      dict(original['crest_diagnostics'], findings=[{'source_index':True}])]:
            with self.subTest(value=type(value).__name__):
                path.write_text(json.dumps(dict(original, crest_diagnostics=value)))
                before = self.fingerprint()
                self.assertFalse(self.record()['available'])
                self.assertEqual(before, self.fingerprint())
        del original['crest_diagnostics']; path.write_text(json.dumps(original))
        self.assertIsNone(self.record())

    def test_whitelist_traversal_cross_attempt_and_invalid_ranges(self):
        original = json.loads((self.base/'facts.json').read_text())
        source_index = self.source()['index']
        variants = [('file','../job.slurm.err','unsupported'),('file','outputs/job.slurm.err','unsupported'),
                    ('file','/etc/passwd','unsupported'),('file','../../crest-empty/outputs/job.slurm.err','unsupported'),
                    ('file','other.err','unsupported'),('file',[], 'unsupported'),('sha256','bad','invalid_source'),
                    ('line_start',True,'invalid_range'),('line_start',0,'invalid_range'),
                    ('line_end',144,'invalid_range'),('line_end',1.5,'invalid_range'),
                    ('line_end',cd.MAX_LOG_BYTES+1,'invalid_range')]
        for key, value, expected in variants:
            with self.subTest(key=key, value=value):
                raw=copy.deepcopy(original);raw['crest_diagnostics']['sources'][source_index][key]=value
                (self.base/'facts.json').write_text(json.dumps(raw)); before=self.fingerprint()
                record=self.record()
                with patch.object(self.store,'open_file', wraps=self.store.open_file) as opened:
                    result=self.excerpt(record,index=source_index)
                self.assertEqual(result, {'status':expected,'text':''})
                self.assertFalse(any('outputs' in call.args[0] for call in opened.call_args_list))
                self.assertEqual(before,self.fingerprint())

    def test_stale_token_range_missing_empty_and_hash_mismatch(self):
        record=self.record()
        self.mutate_facts(lambda d:d.update(summary='新的合成摘要'))
        self.assertEqual(self.excerpt(record)['status'],'stale')
        self.assertEqual(self.excerpt(index=-1)['status'],'invalid_source')
        log=self.base/'outputs/job.slurm.err'
        for raw, expected in [(b'changed\n','mismatch'),(None,'missing'),(b'','mismatch')]:
            if raw is None: log.unlink()
            else: log.write_bytes(raw)
            before=self.fingerprint(); result=self.excerpt()
            self.assertEqual(result,dict(status=expected,text=''));self.assertEqual(before,self.fingerprint())
        self.mutate_facts(lambda d:d['sources'][1].update(sha256=hashlib.sha256(b'').hexdigest()))
        self.assertEqual(self.excerpt()['status'],'empty')
        log.write_bytes(b'a\n')
        self.mutate_facts(lambda d:d['sources'][1].update(sha256=hashlib.sha256(b'a\n').hexdigest()))
        self.assertEqual(self.excerpt()['status'],'invalid_range')

    def test_symlinks_directories_fifo_permissions_and_swaps(self):
        log=self.base/'outputs/job.slurm.err';raw=log.read_bytes();log.unlink()
        outside=self.root/'outside';outside.write_text('OUTSIDE_SECRET')
        for mode in ('link','directory','fifo'):
            with self.subTest(mode=mode):
                if mode=='link':log.symlink_to(outside)
                elif mode=='directory':log.mkdir()
                else:os.mkfifo(log)
                self.assertEqual(self.excerpt(),{'status':'unreadable','text':''})
                if mode=='directory':log.rmdir()
                else:log.unlink()
        log.write_bytes(raw)
        original=self.store.open_file
        for location in ('file','directory'):
            with self.subTest(swap=location):
                @contextmanager
                def swapped(parts):
                    with original(parts) as stream:
                        if parts[-1]=='job.slurm.err':
                            target=log if location=='file' else log.parent
                            backup=target.with_name(target.name+'-saved')
                            target.rename(backup);target.symlink_to(outside if location=='file' else self.root)
                            try:yield stream
                            finally:target.unlink();backup.rename(target)
                        else:yield stream
                with patch.object(self.store,'open_file',swapped):
                    self.assertEqual(self.excerpt(),{'status':'unreadable','text':''})
        @contextmanager
        def denied(parts):
            if parts[-1]=='job.slurm.err':raise StudyError('denied',403)
            with original(parts) as stream:yield stream
        with patch.object(self.store,'open_file',denied):
            self.assertEqual(self.excerpt()['status'],'unreadable')

    def test_in_place_change_and_facts_change_do_not_return_evidence(self):
        original=cd.signature;count=0
        def changed(info):
            nonlocal count
            count+=1
            if count==2:
                return (*original(info)[:-1],info.st_ctime_ns+1)
            return original(info)
        with patch.object(cd,'signature',changed):
            self.assertEqual(self.excerpt(),{'status':'changed','text':''})
        read=cd.read_window
        def replace_facts(*args,**kwargs):
            value=read(*args,**kwargs)
            self.mutate_facts(lambda d:d.update(summary='changed'))
            return value
        with patch.object(cd,'read_window',replace_facts):
            self.assertEqual(self.excerpt(),{'status':'stale','text':''})

    def test_size_line_and_excerpt_limits_and_pagination(self):
        log=self.base/'outputs/job.slurm.err'
        with log.open('wb') as stream:stream.truncate(cd.MAX_LOG_BYTES+1)
        self.assertEqual(self.excerpt()['status'],'too_large')
        self.assertEqual(self.client.get(self.url+'/logs/job.slurm.err').status_code,413)
        log.write_bytes(b'x'*(cd.MAX_LINE_BYTES+1))
        self.assertEqual(self.excerpt()['status'],'line_too_long')
        raw=b'a'*40000+b'\n'+b'b'*40000+b'\n'+b'c\n'*200
        log.write_bytes(raw)
        self.mutate_facts(lambda d:d['sources'][1].update(sha256=hashlib.sha256(raw).hexdigest(),line_start=1,line_end=202))
        before=self.fingerprint();result=self.excerpt()
        self.assertEqual(result['status'],'matched');self.assertTrue(result['truncated'])
        self.assertLessEqual(len(result['text'].encode()),cd.MAX_EXCERPT_BYTES)
        self.assertEqual(result['shown_lines'],1)
        first=self.store.log_page('crest-demo','crest-error','job.slurm.err',0,120)
        second=self.store.log_page('crest-demo','crest-error','job.slurm.err',120,120)
        self.assertEqual((first['text']+second['text']).encode(),raw)
        self.assertEqual(before,self.fingerprint())
        # Invalid UTF-8 replacement characters count toward the display budget.
        raw=b'\xff'*30000+b'\n'
        log.write_bytes(raw)
        self.mutate_facts(lambda d:d['sources'][1].update(sha256=hashlib.sha256(raw).hexdigest(),line_start=1,line_end=1))
        result=self.excerpt()
        self.assertEqual(result['status'],'matched');self.assertTrue(result['truncated'])
        self.assertEqual(result['shown_lines'],0);self.assertEqual(result['text'],'')

    def test_fixed_stderr_only_and_analysis_isolation(self):
        (self.base/'outputs/other.err').write_text('not allowed')
        logs=self.store.attempt('crest-demo','crest-error')['logs']
        self.assertIn('job.slurm.err',logs);self.assertNotIn('other.err',logs)
        self.assertEqual(self.client.get(self.url+'/logs/other.err').status_code,400)
        for name in cd.LOG_NAMES:
            for reader in ('vibrations','optimization'):
                with (patch('autog_frontend.studies.parse_log_modes',side_effect=AssertionError('no parser')),
                      patch('autog_frontend.studies.parse_optimization',side_effect=AssertionError('no parser'))):
                    self.assertEqual(self.client.get(self.url+f'/{reader}/{name}').status_code,400)
        before=self.fingerprint()
        result=self.client.get(self.url+'/log-search/job.slurm.err',params={'query':'Fortran'}).json()
        self.assertEqual(result['line'],144);self.assertEqual(before,self.fingerprint())
        self.assertEqual(self.client.get(self.url+'/crest-diagnostics/0',params={'token':'bad'}).status_code,422)


def serve():
    """Dedicated random-port browser fixture; fake ag only in actions mode."""
    import uvicorn
    from tests.fake_ag import make_fake
    from tests.results_fixture import create_results_studies
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory).resolve();studies=root/'studies';studies.mkdir()
        create_crest_study(studies);create_results_studies(studies)
        actions='--actions' in sys.argv
        app=create_app(studies,Path(__file__).resolve().parents[1]/'web/dist',
                       enable_actions=actions,ag=make_fake(root) if actions else None)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            print(f'http://127.0.0.1:{sock.getsockname()[1]}',flush=True)
            uvicorn.Server(uvicorn.Config(app,access_log=False,proxy_headers=False,log_level='warning')).run(sockets=[sock])


if __name__ == '__main__':
    if '--serve' in sys.argv:serve()
    else:unittest.main()
