from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from autog_frontend.actions import Actions, resource_input
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError
from autog_frontend.inputs import parse_input
from tests.fake_ag import make_fake, settings, action_studies
from tests.study_fixture import gjf


class ActionsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.studies = self.root/'studies'
        self.study = action_studies(self.studies)
        self.fake = make_fake(self.root)
        local = patch('autog_frontend.actions.read_local_settings', return_value=settings(self.studies))
        local.start(); self.addCleanup(local.stop)
        ui = self.root/'ui'; (ui/'assets').mkdir(parents=True)
        (ui/'index.html').write_text('<html><head></head><body></body></html>')
        self.app = create_app(self.studies, ui, enable_actions=True, ag=self.fake)
        self.client = self.client_for(self.app)
        html = self.client.get('/').text
        self.token = re.search('name="ag-token" content="([^"]+)"', html)[1]

    def client_for(self, app):
        return TestClient(app, base_url='http://localhost', client=('127.0.0.1', 12345))

    def post(self, action='status', attempt='prepared', **extra):
        return self.client.post('/api/actions', headers={'X-AG-Token':self.token},
                                json=dict(action=action, study='butane-demo', attempt=attempt, **extra))

    def prepare(self, **extra):
        values = dict(input=gjf(), tier='general', walltime='02:00:00', label='modified',
                      relation='derived_from', method_basis='Fallback; $(touch injected) `echo nope` "quoted" & | < >')
        return self.post('prepare', **(values | extra))

    def calls(self):
        return [json.loads(line) for line in (self.root/'argv.jsonl').read_text().splitlines()]

    def control(self, **values):
        (self.root/'control.json').write_text(json.dumps(values))

    def test_startup_version_required_and_default_has_no_actions(self):
        self.assertEqual(self.calls(), [['--version']])
        with patch('subprocess.Popen', side_effect=AssertionError('read-only must not execute')):
            app = create_app(self.studies, ag=self.fake)
            self.assertFalse(any('POST' in (getattr(r,'methods',None) or ()) for r in app.routes))
            self.assertEqual(self.client_for(app).post('/api/actions').status_code, 405)
        self.control(version_code=2)
        with self.assertRaisesRegex(ValueError, 'version failed'):
            create_app(self.studies, enable_actions=True, ag=self.fake)
        with self.assertRaises(ValueError):
            create_app(self.studies, enable_actions=True, ag=self.root/'missing')
        self.control()
        with patch.dict(os.environ, {'PATH':str(self.root)}):
            # PATH discovery chooses exactly the same trusted local executable.
            (self.root/'ag').symlink_to(self.fake)
            self.assertEqual(Actions(Studies(self.studies)).executable, str(self.root/'ag'))

    def test_tokens_origin_host_and_fixed_fields(self):
        payload=dict(action='status',study='butane-demo',attempt='prepared')
        for headers in [{}, {'X-AG-Token':'wrong'}, {'X-AG-Token':self.token,'Origin':'https://untrusted.invalid'},
                        {'X-AG-Token':self.token,'Host':'untrusted.invalid'}, {'X-AG-Token':self.token,'Sec-Fetch-Site':'cross-site'}]:
            self.assertEqual(self.client.post('/api/actions',json=payload,headers=headers).status_code,403)
        for extra in [{'path':'arbitrary'}, {'ag':'other'}, {'argv':['anything']}]:
            self.assertEqual(self.post(**extra).status_code,400)
        for attempt in ['../prepared','/prepared','a\\b','--help']:
            self.assertEqual(self.post(attempt=attempt).status_code,400)
        self.assertEqual(self.client.post('/api/actions',content=b'x'* (1024*1024+1),headers={'X-AG-Token':self.token}).status_code,413)
        self.assertEqual(self.calls(),[['--version']])
        second=Actions(Studies(self.studies),self.fake)
        self.assertNotEqual(self.token,second.token)

    def test_exact_argv_raw_streams_and_state_restrictions(self):
        self.control(stdout='  raw output\n\n',stderr=' raw error\n',exit_code=3)
        for action in ('status','fetch','submit'):
            result=self.post(action).json()
            self.assertEqual(result,dict(stdout='  raw output\n\n',stderr=' raw error\n',exit_code=3,timed_out=False))
            self.assertEqual(self.calls()[-1],[action,'--json','prepared'])
        for state in ('unknown','failed_presubmit','submitted','running','fetched'):
            path=self.study/'attempts/prepared/status.json';path.write_text(json.dumps(dict(state=state)))
            self.assertEqual(self.post('submit').status_code,409)
            if state in ('unknown','failed_presubmit'):
                self.assertEqual(self.prepare().status_code,409)
                self.assertIsNone(self.client.get('/api/actions/butane-demo/prepared').json()['source'])
            if state in ('submitted','running'):
                self.assertEqual(self.post('cancel').status_code,200)
                self.assertEqual(self.calls()[-1],['cancel','--json','prepared'])
        # The synthetic snapshot marks opt-demo as scheduler-residue.
        self.assertEqual(self.post('cancel',attempt='opt-demo').status_code,200)
        self.assertEqual(self.post('cancel',attempt='waiting').status_code,409)

    def test_prepare_exact_args_draft_only_and_immutable_parent(self):
        def snapshot():
            return {str(p.relative_to(self.study)):hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in self.study.rglob('*') if p.is_file()}
        before=snapshot()
        response=self.prepare(); self.assertEqual(response.status_code,200,response.text)
        data=response.json(); self.assertEqual(data['new_attempt'],'butane-demo-001-modified')
        draft=next((self.study/'drafts').glob('*.gjf'))
        args=self.calls()[-1]
        self.assertEqual(args,['prepare','--json','--study',str(self.study),'--template','gaussian','--input',str(draft),
                               '--tier','general','--walltime','02:00:00','--label','modified','--parent','prepared',
                               '--relation','derived_from','--method-basis','Fallback; $(touch injected) `echo nope` "quoted" & | < >'])
        self.assertTrue(draft.read_text().startswith('%nprocshared=22\n%mem=40000MB\n'))
        self.assertEqual({k:snapshot()[k] for k in before},before)
        self.assertFalse((self.root/'injected').exists())
        # Full text, including shell metacharacters, is data in the single draft.
        self.assertEqual(draft.read_text(),resource_input(gjf(),dict(cores=22,mem_mb=40000)))

    def test_exclusive_drafts_symlinks_and_changed_config(self):
        actions=Actions(Studies(self.studies),self.fake)
        with patch('autog_frontend.actions.datetime') as clock:
            clock.now.return_value.strftime.return_value='fixed'
            path=actions.draft('butane-demo','demo','original')
            with self.assertRaises(StudyError):actions.draft('butane-demo','demo','overwrite')
            self.assertEqual(path.read_text(),'original')
        path.unlink();path.parent.rmdir()
        outside=self.root/'outside';outside.mkdir()
        path.parent.symlink_to(outside,target_is_directory=True)
        self.assertEqual(self.prepare().status_code,403)
        self.assertEqual(list(outside.iterdir()),[])
        with patch('autog_frontend.actions.read_local_settings',return_value=settings(self.root/'different')):
            with self.assertRaisesRegex(ValueError,'must equal'):Actions(Studies(self.studies),self.fake)
            self.assertEqual(self.post().status_code,400)

    def test_every_tier_input_is_previewable_and_special_id_is_one_argument(self):
        actions=Actions(Studies(self.studies),self.fake)
        for name,tier in actions.tiers.items():
            manifest=settings(self.studies)[1][name]
            preview=parse_input(resource_input(gjf(),tier),'draft.gjf',manifest)
            self.assertEqual(preview['n_atoms'],14)
        special='id;$(echo nope)`uname`&quoted'
        original=self.study/'attempts/prepared'
        target=self.study/'attempts'/special;target.mkdir()
        manifest=json.loads((original/'manifest.json').read_text());manifest['attempt_id']=special
        (target/'manifest.json').write_text(json.dumps(manifest))
        (target/'status.json').write_text('{"state":"prepared"}')
        self.control(stdout='{}')
        self.assertEqual(self.post(attempt=special).status_code,200)
        self.assertEqual(self.calls()[-1],['status','--json',special])
        (original/'inputs/butane.gjf').write_bytes(b'\xff')
        self.assertIsNone(self.client.get('/api/actions/butane-demo/prepared').json()['source'])
        self.assertEqual(self.post().status_code,200)
        self.assertEqual(self.prepare().status_code,409)

    def test_concurrent_request_gets_409(self):
        self.control(delay=.4,stdout='{}')
        with ThreadPoolExecutor() as pool:
            first=pool.submit(self.post)
            until=time.monotonic()+3
            while not (self.root/'started').exists() and time.monotonic()<until:time.sleep(.01)
            self.assertTrue((self.root/'started').exists())
            self.assertEqual(self.post().status_code,409)
            self.assertEqual(first.result().status_code,200)

    def test_timeout_420_no_retry_and_json_only(self):
        actions=Actions(Studies(self.studies),self.fake)
        release=threading.Event()
        process=Mock()
        def communicate(timeout=None):
            if timeout is not None:
                self.assertEqual(timeout,420)
                raise subprocess.TimeoutExpired('fake',420,output=b'partial\n',stderr=b'err\n')
            release.wait(5)
            return b'partial\nfinal\n',b'err\n'
        process.communicate.side_effect=communicate
        with patch('autog_frontend.actions.subprocess.Popen',return_value=process) as popen:
            try:
                data=actions.execute(dict(action='submit',study='butane-demo',attempt='prepared'))
                self.assertEqual(data['stdout'],'partial\n');self.assertEqual(data['stderr'],'err\n')
                self.assertTrue(data['timed_out']);self.assertIsNone(data['exit_code'])
                self.assertIn('ag 仍在运行，不要重复操作，结果以 ag status 为准',data['notice'])
                self.assertTrue(actions.lock.locked())
                self.assertEqual(popen.call_count,1);self.assertIs(popen.call_args.kwargs['shell'],False)
                process.kill.assert_not_called();process.terminate.assert_not_called()
            finally:
                release.set()
                self.assertTrue(actions.lock.acquire(timeout=5));actions.lock.release()
            process.wait.assert_called_once()
        self.control(stdout='Created butane-demo-001-made-up\n')
        response=self.prepare().json()
        self.assertNotIn('new_attempt',response);self.assertIn('no valid JSON',response['notice'])

    def test_all_timed_out_actions_keep_process_and_lock_until_exit(self):
        # Real fake-ag subprocesses exercise survival, pipe draining and lock
        # lifetime without waiting 420 seconds or invoking any real ag command.
        for action in ('submit','status','fetch','cancel','prepare'):
            with self.subTest(action=action):
                actions=Actions(Studies(self.studies),self.fake)
                (self.root/'release').unlink(missing_ok=True)
                (self.study/'attempts/prepared/status.json').write_text(json.dumps(
                    dict(state='submitted' if action=='cancel' else 'prepared')))
                self.control(wait_for_release=True,early_stdout='partial\n',early_stderr='early error\n',
                             stdout='x'*200000,stderr='y'*200000,exit_code=2)
                payload=dict(action=action,study='butane-demo',attempt='prepared')
                if action=='prepare':
                    payload.update(input=gjf(),tier='simple',walltime='01:00:00',label='delayed',
                                   relation='derived_from',method_basis='synthetic fallback')
                processes=[]
                original=subprocess.Popen
                def start(*args,**kwargs):
                    process=original(*args,**kwargs);processes.append(process);return process
                with patch('autog_frontend.actions.TIMEOUT',.2), patch('autog_frontend.actions.subprocess.Popen',side_effect=start):
                    try:
                        data=actions.execute(payload)
                        self.assertTrue(data['timed_out'])
                        self.assertEqual(len(processes),1)
                        self.assertIsNone(processes[0].poll())
                        for blocked in ('submit','status','fetch','cancel','prepare'):
                            blocked_payload=dict(action=blocked,study='butane-demo',attempt='prepared')
                            if blocked=='prepare':
                                blocked_payload.update(input=gjf(),tier='simple',walltime='01:00:00',label='blocked',
                                                       relation='derived_from',method_basis='synthetic fallback')
                            with self.assertRaises(StudyError) as caught:
                                actions.execute(blocked_payload)
                            self.assertEqual(caught.exception.status,409)
                        self.assertEqual(len(processes),1)
                    finally:
                        (self.root/'release').touch()
                        self.assertTrue(actions.lock.acquire(timeout=5))
                        actions.lock.release()
                        for process in processes:self.assertEqual(process.wait(timeout=5),2)
                self.control(stdout='done\n',stderr='end\n',exit_code=0)
                result=actions.execute(dict(action='status',study='butane-demo',attempt='prepared'))
                self.assertEqual(result['exit_code'],0)
                self.assertFalse(result['timed_out'])
