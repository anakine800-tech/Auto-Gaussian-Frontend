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
from autog_frontend.actions import Actions, resource_input, validate_targets
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError
from autog_frontend.inputs import parse_input
from tests.fake_ag import make_fake, settings, action_studies, capacity_response
from tests.study_fixture import gjf


class ActionsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.studies = self.root/'studies'
        self.study = action_studies(self.studies)
        self.fake = make_fake(self.root)
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
        values = dict(cluster='default', input=gjf(), tier='general', walltime='02:00:00', label='modified',
                      relation='derived_from', method_basis='Fallback; $(touch injected) `echo nope` "quoted" & | < >')
        return self.post('prepare', **(values | extra))

    def calls(self, queries=False):
        rows = [json.loads(line) for line in (self.root/'argv.jsonl').read_text().splitlines()]
        return rows if queries else [row for row in rows if row[0] != 'clusters']

    def control(self, **values):
        (self.root/'control.json').write_text(json.dumps(values))

    def node_setup(self):
        from datetime import datetime, timedelta, timezone
        data=settings(self.studies)
        row=data['clusters'][0]
        row['node_targeting']=dict(default_fraction='1/2',fractions=['1/2','1/4'])
        row['resources']['tiers']['general']=dict(cores=24,mem_gb=48)
        self.control(clusters_response=data)
        actions=Actions(Studies(self.studies),self.fake)
        targets=dict(schema='ag-node-targets/1',cluster='default',fresh=True,
                     sampled_at=datetime.now(timezone.utc).isoformat(),
                     valid_until=(datetime.now(timezone.utc)+timedelta(minutes=3)).isoformat(),
                     nodes=[dict(name='compute-a',priority_group=1,order=1,priority=1,status='available',reason='Synthetic candidate',
                                 options=[dict(fraction='1/2',cores=24,mem_gb=48,tier='general')])])
        return actions,targets

    def test_node_query_fixed_argv_and_contract(self):
        actions,targets=self.node_setup()
        with patch('subprocess.run',return_value=Mock(returncode=0,stdout=json.dumps(targets))) as run:
            self.assertEqual(actions.node_targets(),{'default':targets})
            self.assertEqual(run.call_args.args[0],[str(self.fake),'nodes','--cluster','default','--json'])
            self.assertFalse(run.call_args.kwargs['shell'])
        for change in ({'fresh':'true'},{'cluster':'other'},{'valid_until':'invalid'},{'nodes':[{}]}):
            with patch('subprocess.run',return_value=Mock(returncode=0,stdout=json.dumps(targets|change))):
                self.assertFalse(actions.node_targets()['default']['fresh'])
        bad=json.loads(json.dumps(targets));bad['nodes'][0]['options'][0]['cores']=999
        with self.assertRaises(ValueError):validate_targets(bad,'default',actions.clusters['default']['tiers'])

    def test_node_priority_groups_and_order_contract(self):
        actions,targets=self.node_setup()
        prototype=targets['nodes'][0]
        groups=[1,1,1,2,3,4,4,5,None]
        targets['nodes']=[prototype|dict(name=name,priority_group=groups[i],order=i+1,priority=i+1,
                         status='forbidden' if name=='I' else 'restricted' if name=='G' else 'available')
                         for i,name in enumerate('ABCDEFGHI')]
        tiers=actions.clusters['default']['tiers']
        self.assertEqual(validate_targets(targets,'default',tiers),targets)
        self.assertEqual([r['priority_group'] for r in targets['nodes']],groups)
        for change in ({'priority_group':None},{'priority_group':0},{'priority_group':True},
                       {'priority_group':'1'},{'order':2},{'order':True},{'priority':2}):
            bad=json.loads(json.dumps(targets));bad['nodes'][0].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):
                validate_targets(bad,'default',tiers)
        for missing in ('priority_group','order'):
            bad=json.loads(json.dumps(targets));del bad['nodes'][0][missing]
            with self.subTest(missing=missing),self.assertRaises(ValueError):
                validate_targets(bad,'default',tiers)

    def test_explicit_node_fields_validate_before_draft_and_bind_fixed_argv(self):
        actions,targets=self.node_setup()
        payload=dict(action='prepare',study='butane-demo',attempt='prepared',cluster='default',input=gjf(),
                     tier='general',walltime='01:00:00',label='target',relation='derived_from',method_basis='Synthetic only',
                     target_node='compute-a',node_fraction='1/2')
        before={p:p.read_bytes() for p in (self.study/'attempts').rglob('*') if p.is_file()}
        with patch.object(actions,'node_targets',return_value={'default':targets}):
            for change in ({'target_node':''},{'target_node':'compute-a:ppn=999'},{'node_fraction':'1/8'}, {'tier':'mini'}):
                with self.assertRaises(StudyError):actions.execute(payload|change)
                self.assertFalse((self.study/'drafts').exists())
            missing=dict(payload);del missing['target_node']
            with self.assertRaises(StudyError):actions.execute(missing)
            with patch.object(actions,'run',return_value=({'stdout':'{}','stderr':'','exit_code':1,'timed_out':False},None)) as run:
                actions.execute(payload)
                self.assertEqual(run.call_args.args[0][-4:],['--target-node','compute-a','--node-fraction','1/2'])
        self.assertEqual({p:p.read_bytes() for p in before},before)

    def test_target_occupation_expiry_and_special_restrictions_never_create_draft(self):
        actions,targets=self.node_setup()
        payload=dict(action='prepare',study='butane-demo',attempt='prepared',cluster='default',input=gjf(),
                     tier='general',walltime='01:00:00',label='target',relation='derived_from',method_basis='Synthetic only',
                     target_node='compute-a',node_fraction='1/2')
        for status in ('occupied','restricted','forbidden','unknown','insufficient','stale'):
            targets['nodes'][0]['status']=status
            with patch.object(actions,'node_targets',return_value={'default':targets}):
                with self.assertRaises(StudyError):actions.execute(payload)
        targets['nodes'][0]['status']='available';targets['valid_until']='2000-01-01T00:00:00+00:00'
        with patch.object(actions,'node_targets',return_value={'default':targets}):
            with self.assertRaises(StudyError):actions.execute(payload)
        self.assertFalse((self.study/'drafts').exists())
        # Opt-out entries reject even apparently valid extra selection fields.
        self.assertEqual(self.prepare(target_node='compute-a',node_fraction='1/2').status_code,400)

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
                               '--cluster','default','--tier','general','--walltime','02:00:00','--label','modified','--parent','prepared',
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
        self.control(root_matches=False)
        with self.assertRaisesRegex(ValueError,'must equal'):Actions(Studies(self.studies),self.fake)
        self.assertEqual(self.post().status_code,400)

    def test_every_tier_input_is_previewable_and_special_id_is_one_argument(self):
        actions=Actions(Studies(self.studies),self.fake)
        for name,tier in actions.clusters['default']['tiers'].items():
            manifest=settings(self.studies)['clusters'][0]['resources']['tiers'][name]
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
        with patch.object(actions, 'settings', return_value=actions.clusters), patch('autog_frontend.actions.subprocess.Popen',return_value=process) as popen:
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
                    payload.update(cluster='default',input=gjf(),tier='simple',walltime='01:00:00',label='delayed',
                                   relation='derived_from',method_basis='synthetic fallback')
                processes=[]
                original=subprocess.Popen
                def start(*args,**kwargs):
                    process=original(*args,**kwargs);processes.append(process);return process
                with patch.object(actions, 'settings', return_value=actions.clusters), patch('autog_frontend.actions.TIMEOUT',.2), patch('autog_frontend.actions.subprocess.Popen',side_effect=start):
                    try:
                        data=actions.execute(payload)
                        self.assertTrue(data['timed_out'])
                        self.assertEqual(len(processes),1)
                        self.assertIsNone(processes[0].poll())
                        for blocked in ('submit','status','fetch','cancel','prepare'):
                            blocked_payload=dict(action=blocked,study='butane-demo',attempt='prepared')
                            if blocked=='prepare':
                                blocked_payload.update(cluster='default',input=gjf(),tier='simple',walltime='01:00:00',label='blocked',
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

    def test_cluster_query_root_and_failures(self):
        self.assertEqual(self.calls(queries=True)[:2], [
            ['--version'], ['clusters','--json','--verify-studies-root',str(self.studies)]])
        for values in [dict(clusters_code=1),dict(clusters_code=2),dict(root_matches=False),
                       dict(clusters_response={'clusters':[]}),dict(clusters_response={'clusters':None})]:
            self.control(**values)
            with self.assertRaises(ValueError):Actions(Studies(self.studies),self.fake)
            before=len(self.calls())
            self.assertEqual(self.prepare().status_code,400)
            self.assertEqual(len(self.calls()),before)
            self.assertFalse((self.study/'drafts').exists())

    def test_clusters_legacy_named_disabled_changed_and_unknown(self):
        context=self.client.get('/api/actions/butane-demo/prepared').json()
        self.assertEqual(context['clusters']['batch']['tiers']['general'],dict(cores=64,mem_gb=160,mem_mb=128000))
        self.assertEqual(self.prepare(cluster='missing').status_code,400)
        self.assertEqual(self.prepare(cluster='../batch').status_code,400)
        response=self.prepare(cluster='batch')
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('--cluster',self.calls()[-1])
        path=self.study/'attempts'/response.json()['new_attempt']/'manifest.json'
        self.assertEqual(json.loads(path.read_text())['cluster'],'batch')
        draft=next((self.study/'drafts').glob('*.gjf'))
        self.assertTrue(draft.read_text().startswith('%nprocshared=64\n%mem=128000MB\n'))
        cfg=settings(self.studies)
        cfg['clusters'][1]['programs_enabled']['gaussian']=False
        self.control(clusters_response=cfg)
        # Changed execution settings require a restart before a draft is created.
        self.assertEqual(self.prepare(cluster='batch',label='changed').status_code,409)
        actions=Actions(Studies(self.studies),self.fake)
        with self.assertRaises(StudyError):
            actions.execute(dict(action='prepare',study='butane-demo',attempt='prepared',cluster='batch',
                                 input=gjf(),tier='general',walltime='01:00:00',label='disabled',
                                 relation='derived_from',method_basis='Synthetic'))
        cfg['clusters']=cfg['clusters'][:1]  # ag's normalized old single-cluster output
        self.control(clusters_response=cfg)
        self.assertEqual(list(Actions(Studies(self.studies),self.fake).clusters),['default'])
        cfg=settings(self.studies);cfg['clusters']=cfg['clusters'][1:]
        self.control(clusters_response=cfg)
        self.assertEqual(list(Actions(Studies(self.studies),self.fake).clusters),['batch'])

    def test_budget_change_does_not_invalidate_resource_settings(self):
        cfg=settings(self.studies);cfg['clusters'][1]['budget']['reserved']=40
        self.control(clusters_response=cfg)
        self.assertEqual(self.post().status_code,200)

    def test_optional_resource_tiers_and_walltime_keep_order_and_exact_argv(self):
        expected = ['mini', 'simple', 'general', 'complex', 'max', 'ultra']
        for count in (4, 5, 6):
            with self.subTest(count=count):
                cfg = settings(self.studies)
                cfg['clusters'][0]['resources'].update(
                    tiers={name: dict(cores=index + 1, mem_gb=(index + 1) * 4)
                           for index, name in reversed(list(enumerate(expected[:count])))},
                    max_walltime='1234:00:00')
                self.control(clusters_response=cfg, stdout=json.dumps(dict(
                    study_id='butane-demo', attempt_id=f'butane-demo-001-tiers-{count}')))
                actions = Actions(Studies(self.studies), self.fake)
                self.assertEqual(list(actions.clusters['default']['tiers']), expected[:count])
                self.assertEqual(actions.clusters['default']['max_walltime'], '1234:00:00')
                tier = expected[count - 1]
                result = actions.execute(dict(action='prepare', study='butane-demo', attempt='prepared',
                    cluster='default', input=gjf(), tier=tier, walltime='1234:00:00',
                    label=f'tiers-{count}', relation='derived_from', method_basis='Synthetic'))
                self.assertEqual(result['exit_code'], 0)
                argv = self.calls()[-1]
                self.assertEqual(argv[argv.index('--tier') + 1], tier)
                self.assertEqual(argv[argv.index('--walltime') + 1], '1234:00:00')
                self.assertTrue(Path(argv[argv.index('--input') + 1]).read_text().startswith(
                    f'%nprocshared={count}\n%mem={count * 4 * 800}MB\n'))

    def test_walltime_invalid_or_above_limit_and_missing_tier_have_no_draft_or_execution(self):
        cfg = settings(self.studies); cfg['clusters'][0]['resources']['max_walltime'] = '24:00:00'
        self.control(clusters_response=cfg)
        actions = Actions(Studies(self.studies), self.fake)
        before = len(self.calls())
        for tier, value in [('general', bad) for bad in ('00:00:00', '1:00:00', '12345:00:00',
                                                       '24:00:01', '24:60:00')] + [('max', '01:00:00')]:
            with self.subTest(tier=tier, walltime=value):
                with self.assertRaises(StudyError):
                    actions.execute(dict(action='prepare', study='butane-demo', attempt='prepared',
                        cluster='default', input=gjf(), tier=tier, walltime=value, label='rejected',
                        relation='derived_from', method_basis='Synthetic'))
                self.assertFalse((self.study/'drafts').exists())
                self.assertEqual(len(self.calls()), before)

    def test_resource_metadata_rejects_invalid_optional_values_and_detects_limit_change(self):
        for value in (None, True, False, 0, 3600, '00:00:00', '1:00:00', '12345:00:00',
                      '24:60:00', '24:00:60', '24:00:00\n', '２４:00:00'):
            with self.subTest(walltime=value):
                cfg = settings(self.studies); cfg['clusters'][0]['resources']['max_walltime'] = value
                self.control(clusters_response=cfg)
                with self.assertRaises(ValueError): Actions(Studies(self.studies), self.fake)
        for value in ({'cores':True,'mem_gb':20}, {'cores':2,'mem_gb':0},
                      {'cores':2,'mem_gb':1.5}, None):
            cfg = settings(self.studies); cfg['clusters'][0]['resources']['tiers']['max'] = value
            self.control(clusters_response=cfg)
            with self.assertRaises(ValueError): Actions(Studies(self.studies), self.fake)
        cfg = settings(self.studies); del cfg['clusters'][0]['resources']['tiers']['mini']
        self.control(clusters_response=cfg)
        with self.assertRaises(ValueError): Actions(Studies(self.studies), self.fake)
        cfg = settings(self.studies); cfg['clusters'][0]['resources']['tiers']['metadata'] = {'note':'Synthetic metadata'}
        self.control(clusters_response=cfg)
        self.assertNotIn('metadata', Actions(Studies(self.studies), self.fake).clusters['default']['tiers'])
        cfg = settings(self.studies); cfg['clusters'][0]['resources']['max_walltime'] = '24:00:00'
        self.control(clusters_response=cfg)
        self.assertEqual(self.prepare().status_code, 409)
        self.assertFalse((self.study/'drafts').exists())

    def test_residue_cancellation_is_scoped_to_attempt_cluster(self):
        default=self.studies/'.ag-monitor/latest.json'
        data=json.loads(default.read_text());data['warnings']=[]
        default.write_text(json.dumps(data))
        batch=self.studies/'.ag-monitor/batch/latest.json'
        data=json.loads(batch.read_text())
        data['warnings']=[dict(kind='scheduler-residue',study='butane-demo',attempt='opt-demo',
                               job_id='batch:1',detail='Synthetic residue')]
        batch.write_text(json.dumps(data))
        self.assertEqual(self.post('cancel',attempt='opt-demo').status_code,409)
        manifest=self.study/'attempts/opt-demo/manifest.json'
        data=json.loads(manifest.read_text());data['cluster']='batch';data['scheduler']='slurm'
        manifest.write_text(json.dumps(data))
        self.assertTrue(self.client.get('/api/actions/butane-demo/opt-demo').json()['can_cancel'])
        # A cache under the wrong cluster directory cannot supply the warning.
        data=json.loads(batch.read_text());data['cluster']['name']='other'
        batch.write_text(json.dumps(data))
        self.assertEqual(self.post('cancel',attempt='opt-demo').status_code,409)

    def test_query_timeout_or_malformed_json_has_no_action_side_effect(self):
        actions=Actions(Studies(self.studies),self.fake)
        for outcome in (subprocess.TimeoutExpired('clusters',15), None):
            kwargs={'side_effect':outcome} if outcome else {'return_value':Mock(returncode=0,stdout=b'not json')}
            with patch('autog_frontend.actions.subprocess.run',**kwargs):
                with self.assertRaises(ValueError):
                    actions.execute(dict(action='status',study='butane-demo',attempt='prepared'))
            self.assertFalse(actions.lock.locked())
        self.assertEqual(self.calls(),[['--version'],['--version']])


    def test_t158_default_resources_and_explicit_tier_preserve_parent_bytes(self):
        cfg = settings(self.studies)
        cfg['clusters'][0]['resources'].update(default_tier='max')
        cfg['clusters'][0]['resources']['tiers']['max'] = dict(cores=48, mem_gb=96)
        self.control(clusters_response=cfg)
        actions = Actions(Studies(self.studies), self.fake)
        self.assertEqual(actions.clusters['default']['default_tier'], 'max')
        self.assertNotIn('default_tier', actions.clusters['batch'])
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (self.study/'attempts').rglob('*') if p.is_file()}
        for tier, cores, memory in [('max', 48, 76800), ('simple', 8, 9600)]:
            result = actions.execute(dict(action='prepare', study='butane-demo', attempt='prepared',
                cluster='default', input=gjf(), tier=tier, walltime='01:00:00', label='default-'+tier,
                relation='derived_from', method_basis='Synthetic only'))
            self.assertEqual(result['exit_code'], 0, result)
            draft = next((self.study/'drafts').glob('*-default-'+tier+'.gjf'))
            self.assertTrue(draft.read_text().startswith(f'%nprocshared={cores}\n%mem={memory}MB\n'))
            self.assertEqual(draft.read_text().split('\n')[2:], resource_input(gjf(), dict(cores=1, mem_mb=1)).split('\n')[2:])
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}, before)
        cfg['clusters'][0]['resources']['default_tier'] = 'general'
        self.control(clusters_response=cfg)
        with self.assertRaises(StudyError):
            actions.execute(dict(action='status', study='butane-demo', attempt='prepared'))
        for invalid in (None, True, 1, 'missing', [], {}):
            cfg['clusters'][0]['resources']['default_tier'] = invalid
            self.control(clusters_response=cfg)
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                Actions(Studies(self.studies), self.fake)

    def test_t158_capacity_fixed_argv_request_binding_and_no_operation_lock(self):
        actions, targets = self.node_setup()
        reply = capacity_response(settings(self.studies), target='compute-a')
        reply.update(cores=24, mem_gb=48)
        actions.lock.acquire()
        before = {p: p.read_bytes() for p in self.studies.rglob('*') if p.is_file()}
        try:
            with patch.object(actions, 'settings', return_value=actions.clusters), patch('subprocess.run', return_value=Mock(returncode=0, stdout=json.dumps(reply))) as run:
                result = actions.capacity(dict(cluster='default', tier='general', target_node='compute-a'))
                self.assertEqual(result, reply)
                self.assertEqual(run.call_args.args[0], [str(self.fake), 'capacity', '--cluster', 'default', '--tier', 'general', '--target-node', 'compute-a', '--json'])
                self.assertEqual(run.call_args.kwargs, dict(shell=False, capture_output=True, timeout=15, check=False))
                self.assertTrue(actions.lock.locked())
        finally:
            actions.lock.release()
        self.assertEqual({p: p.read_bytes() for p in before}, before)
        self.assertFalse((self.study/'drafts').exists())

    def test_t158_capacity_validates_input_token_and_same_origin_before_invocation(self):
        payload = dict(cluster='default', tier='general')
        before = self.calls(queries=True)
        self.assertEqual(self.client.post('/api/attempt-capacity', json=payload).status_code, 403)
        headers = {'X-AG-Token': self.token}
        self.assertEqual(self.client.post('/api/attempt-capacity', json=payload, headers=headers|{'Origin':'https://example.org'}).status_code, 403)
        readonly = self.client_for(create_app(self.studies))
        self.assertEqual(readonly.post('/api/attempt-capacity', json=payload).status_code, 405)
        for invalid in ([], {}, payload|{'tier':True}, payload|{'tier':'--help'}, payload|{'cluster':'missing'},
                        payload|{'target_node':'compute-a'}, payload|{'executable':'other'}, payload|{'extra':0}):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.client.post('/api/attempt-capacity', json=invalid, headers=headers).status_code, 400)
        self.assertEqual(self.client.post('/api/attempt-capacity', content=b'x'*4097, headers=headers).status_code, 413)
        self.assertEqual(self.calls(queries=True), before)
        result = self.client.post('/api/attempt-capacity', json=payload, headers=headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['availability'], 'enough')
        self.assertEqual(self.calls()[-1], ['capacity', '--cluster', 'default', '--tier', 'general', '--json'])
        actions, _ = self.node_setup()
        for node in ('', '--help', 'compute-a;id', '../compute-a', 'compute-a.', 'a\x00b'):
            with self.assertRaises(StudyError):
                actions.capacity(payload|{'target_node':node})

    def test_t158_capacity_unavailable_once_and_unknown_does_not_block_prepare(self):
        self.control(capacity_supported=False)
        headers = {'X-AG-Token':self.token}
        for tier in ('general', 'mini', 'simple'):
            response = self.client.post('/api/attempt-capacity', headers=headers, json=dict(cluster='default', tier=tier))
            self.assertTrue(response.json()['capability_unavailable'])
            self.assertEqual(response.json()['availability'], 'unknown')
        self.assertEqual(sum(c[0] == 'capacity' for c in self.calls()), 1)
        self.assertEqual(self.prepare().json()['exit_code'], 0)

    def test_t158_capacity_exit_two_read_errors_recover_on_the_next_request(self):
        headers = {'X-AG-Token':self.token}
        payload = dict(cluster='default', tier='general')
        old_command = "ag: error: argument command: invalid choice: 'capacity' (choose from 'clusters')\n"
        for stdout, stderr in (
                (json.dumps({'error':'Synthetic local read failed', 'exit_code':2}), ''),
                (json.dumps({'error':'Synthetic local read failed', 'exit_code':2}), old_command),
                ('', 'ag: error: unrecognized arguments: --target-node compute-a\n'),
                ('', 'Synthetic local read failed\n')):
            with self.subTest(stdout=bool(stdout), stderr=bool(stderr)):
                before = sum(c[0] == 'capacity' for c in self.calls())
                self.control(capacity_code=2, capacity_stdout=stdout, capacity_stderr=stderr)
                failed = self.client.post('/api/attempt-capacity', headers=headers, json=payload).json()
                self.assertEqual(failed['availability'], 'unknown')
                self.assertNotIn('capability_unavailable', failed)
                self.control()
                recovered = self.client.post('/api/attempt-capacity', headers=headers, json=payload).json()
                self.assertEqual(recovered['availability'], 'enough')
                self.assertEqual(sum(c[0] == 'capacity' for c in self.calls()), before + 2)

    def test_t158_capacity_verdicts_and_bad_or_mismatched_responses(self):
        actions = Actions(Studies(self.studies), self.fake)
        payload = dict(cluster='default', tier='general')
        for verdict in ('enough', 'queue', 'unknown', 'not_applicable'):
            reply = capacity_response(settings(self.studies), availability=verdict)
            self.control(capacity_response=reply)
            self.assertEqual(actions.capacity(payload)['availability'], verdict)
        good = capacity_response(settings(self.studies))
        for change in ({'cluster':'batch'}, {'tier':'simple'}, {'target_node':'other'}, {'cores':True}, {'mem_gb':96},
                       {'snapshot_fresh':False}, {'snapshot_fresh':'true'}, {'valid_until':None}, {'sampled_at':'bad'},
                       {'fits_total':False}, {'availability':'invented'}, {'nodes':[{}]}, {'reasons':[1]}, {'cpu_source':[]}):
            self.control(capacity_response=good|change)
            with self.subTest(change=change):
                self.assertEqual(actions.capacity(payload)['availability'], 'unknown')
        self.control(capacity_stdout='not JSON')
        self.assertEqual(actions.capacity(payload)['availability'], 'unknown')
        self.control(capacity_code=1)
        self.assertEqual(actions.capacity(payload)['availability'], 'unknown')
        self.control(root_matches=False)
        before = sum(c[0] == 'capacity' for c in self.calls())
        self.assertEqual(actions.capacity(payload)['availability'], 'unknown')
        self.assertEqual(sum(c[0] == 'capacity' for c in self.calls()), before)
        with patch.object(actions, 'settings', return_value=actions.clusters), patch('subprocess.run', side_effect=subprocess.TimeoutExpired('synthetic', 15)) as run:
            self.assertEqual(actions.capacity(payload)['availability'], 'unknown')
            self.assertEqual(run.call_count, 1)
        self.assertFalse(actions.lock.locked())

    def test_t158_explicit_selectability_allows_occupied_and_retains_other_guards(self):
        actions, targets = self.node_setup()
        node = targets['nodes'][0]
        node.update(status='occupied', selectable=True)
        validate_targets(targets, 'default', actions.clusters['default']['tiers'])
        payload = dict(action='prepare', study='butane-demo', attempt='prepared', cluster='default', input=gjf(),
                       tier='general', walltime='01:00:00', label='shared', relation='derived_from', method_basis='Synthetic only',
                       target_node='compute-a', node_fraction='1/2')
        with patch.object(actions, 'node_targets', return_value={'default':targets}), patch.object(actions, 'run', return_value=({'stdout':'{}','exit_code':1}, None)) as run:
            actions.execute(payload)
            self.assertEqual(run.call_args.args[0][-4:], ['--target-node','compute-a','--node-fraction','1/2'])
            node['selectable'] = False
            with self.assertRaises(StudyError): actions.execute(payload)
            node['selectable'] = True
            targets['valid_until'] = '2000-01-01T00:00:00+00:00'
            with self.assertRaises(StudyError): actions.execute(payload)
            self.assertEqual(run.call_count, 1)
        for invalid in (None, 1, 'true'):
            node['selectable'] = invalid
            with self.assertRaises(ValueError): validate_targets(targets, 'default', actions.clusters['default']['tiers'])
        for status in ('forbidden', 'restricted'):
            node.update(status=status, selectable=True)
            with self.assertRaises(ValueError): validate_targets(targets, 'default', actions.clusters['default']['tiers'])


class MonitorRetryTests(unittest.TestCase):
    setUp = ActionsTests.setUp
    client_for = ActionsTests.client_for
    post = ActionsTests.post
    calls = ActionsTests.calls
    control = ActionsTests.control
    # Inherit only fixture helpers, not the existing action test suite.
    def retry(self, payload=None, headers=None):
        return self.client.post('/api/monitor/retry',
            json=payload if payload is not None else dict(cluster='default', auth_fixed=False),
            headers=headers if headers is not None else {'X-AG-Token':self.token})

    def test_retry_fixed_argv_and_result_contract(self):
        for result, reason in [('queued', None), ('already_queued', None), ('in_progress', None),
                               ('refused', 'monitor_not_running'), ('refused', 'auth_confirmation_required'),
                               ('refused', 'unknown_entry')]:
            for auth_fixed in (False, True):
                with self.subTest(result=result, reason=reason, auth_fixed=auth_fixed):
                    self.control(retry_result=result, retry_reason=reason)
                    response = self.retry(dict(cluster='batch', auth_fixed=auth_fixed))
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json(), dict(entry='batch', result=result, reason=reason,
                        requested_at=None if result=='refused' else '2026-10-25T03:00:00Z'))
                    self.assertEqual(self.calls()[-1], ['monitor', '--retry', 'batch', '--json'] +
                                     (['--auth-fixed'] if auth_fixed else []))

    def test_retry_invalid_requests_and_access_do_not_run_ag(self):
        before = self.calls(queries=True)
        for body in ({}, [], {'cluster':'default'}, {'auth_fixed':False},
                     {'cluster':'default', 'auth_fixed':False, 'extra':1},
                     {'cluster':'missing', 'auth_fixed':False},
                     {'cluster':['default'], 'auth_fixed':False},
                     {'cluster':'--help', 'auth_fixed':False},
                     {'cluster':'default', 'auth_fixed':1}, {'cluster':'default', 'auth_fixed':'false'}):
            self.assertEqual(self.retry(body).status_code, 400)
        for headers in ({}, {'X-AG-Token':'wrong'},
                        {'X-AG-Token':self.token, 'Origin':'https://untrusted.invalid'},
                        {'X-AG-Token':self.token, 'Host':'untrusted.invalid'},
                        {'X-AG-Token':self.token, 'Sec-Fetch-Site':'cross-site'}):
            self.assertEqual(self.retry(headers=headers).status_code, 403)
        remote = TestClient(self.app, base_url='http://localhost', client=('untrusted.invalid',12345))
        self.assertEqual(remote.post('/api/monitor/retry', json=dict(cluster='default',auth_fixed=False),
                                    headers={'X-AG-Token':self.token}).status_code,403)
        self.assertEqual(self.client.post('/api/monitor/retry', content='not json',
                         headers={'X-AG-Token':self.token}).status_code,400)
        readonly = self.client_for(create_app(self.studies))
        self.assertEqual(readonly.post('/api/monitor/retry').status_code,405)
        self.assertEqual(self.calls(queries=True), before)

    def test_retry_invalid_output_timeout_no_automatic_retry(self):
        good = dict(entry='default', result='queued', reason=None, requested_at='2026-10-25T03:00:00Z')
        invalid = [[], {}, dict(good,entry='batch'), dict(good,result='success'),
                   dict(good,reason='auth'), dict(good,reason='monitor_not_running'),
                   dict(good,result='refused'), dict(good,requested_at=3),
                   dict(good,requested_at='2026-10-25T03:00:00+08:00')]
        for data in invalid:
            self.control(retry_response=data)
            before = len(self.calls()); response = self.retry()
            self.assertEqual(response.status_code,502,response.text)
            self.assertIn('无效的重试 JSON',response.json()['detail'])
            self.assertEqual(len(self.calls()),before+1)
        self.control(retry_stdout='not json', retry_stderr='Synthetic ag failure', retry_code=2)
        self.assertNotIn('Synthetic ag failure',self.retry().json()['detail'])
        actions = Actions(Studies(self.studies), self.fake)
        for error in (subprocess.TimeoutExpired('fake',15), OSError('synthetic')):
            with patch('autog_frontend.actions.subprocess.run',side_effect=error) as run:
                with self.assertRaises(StudyError) as caught:
                    actions.retry_monitor(dict(cluster='default',auth_fixed=False))
                self.assertEqual(caught.exception.status,504 if isinstance(error,subprocess.TimeoutExpired) else 502)
                run.assert_called_once_with([str(self.fake),'monitor','--retry','default','--json'],
                                           shell=False,capture_output=True,timeout=15,check=False)
                self.assertFalse(actions.lock.locked())

    def test_retry_and_fetch_do_not_block_each_other(self):
        self.control(wait_for_release=True)
        with ThreadPoolExecutor() as pool:
            fetch = pool.submit(self.post,'fetch')
            try:
                until=time.monotonic()+3
                while not (self.root/'started').exists() and time.monotonic()<until:time.sleep(.01)
                self.assertTrue((self.root/'started').exists())
                self.assertEqual(self.retry().json()['result'],'queued')
                self.assertFalse(fetch.done())
            finally:
                (self.root/'release').touch()
                self.assertEqual(fetch.result(timeout=5).status_code,200)
        self.control(retry_wait_for_release=True)
        with ThreadPoolExecutor() as pool:
            (self.root/'retry-started').unlink()
            retry = pool.submit(self.retry)
            try:
                until=time.monotonic()+3
                while not (self.root/'retry-started').exists() and time.monotonic()<until:time.sleep(.01)
                self.assertTrue((self.root/'retry-started').exists())
                self.assertEqual(self.post('fetch').status_code,200)
                self.assertFalse(retry.done())
            finally:
                (self.root/'retry-release').touch()
                self.assertEqual(retry.result(timeout=5).status_code,200)

    def tracking_marker(self, source='named', **extra):
        from datetime import datetime, timezone
        cache = self.studies/'.ag-monitor'; cache.mkdir(exist_ok=True)
        if source == 'named':
            (cache/'latest.json').unlink(missing_ok=True)  # Remove only the synthetic legacy fixture.
        value = dict(pid=1, heartbeat_at=datetime.now(timezone.utc).isoformat(),
                     retry_tracking_version=1, entries={'default': dict(source=source, pause_reason=None)}) | extra
        (cache/'watch.json').write_text(json.dumps(value))
        return cache

    def test_t151_tracking_argv_and_forward_fields(self):
        for source in ('legacy', 'named'):
            self.tracking_marker(source)
            for result in ('queued', 'already_queued', 'in_progress', 'refused'):
                for auth in (False, True):
                    good = dict(entry='default', result=result, reason='monitor_not_running' if result=='refused' else None,
                                requested_at=None if result=='refused' else '2026-01-01T00:00:00Z',
                                request_id=None if result=='refused' else 'a'*32)
                    self.control(retry_response=good | dict(extra='ignored'),retry_code=1 if result=='refused' else 0)
                    before=len(self.calls());response=self.retry(dict(cluster='default',auth_fixed=auth))
                    self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json(),good)
                    self.assertEqual(len(self.calls()),before+1)
                    self.assertEqual(self.calls()[-1],['monitor','--retry','default','--json','--track']+(['--auth-fixed'] if auth else []))
        (self.studies/'.ag-monitor/watch.json').unlink()
        old = {k:v for k,v in good.items() if k!='request_id'}
        self.control(retry_response=old|dict(extra='ignored'),retry_code=1)
        self.assertEqual(self.retry().json(),old)
        self.assertNotIn('--track',self.calls()[-1])

    def test_t151_invalid_tracking_never_falls_back(self):
        self.tracking_marker()
        good = dict(entry='default', result='queued', reason=None, requested_at='2026-01-01T00:00:00Z',request_id='a'*32)
        for invalid in ({k:v for k,v in good.items() if k!='request_id'},dict(good,request_id=None),
                        dict(good,request_id='A'*32),dict(good,request_id=3),dict(good,requested_at=None),
                        dict(good,result='refused',reason='monitor_not_running')):
            self.control(retry_response=invalid,retry_code=1 if invalid['result']=='refused' else 0)
            before=len(self.calls());self.assertEqual(self.retry().status_code,502)
            self.assertEqual(len(self.calls()),before+1);self.assertIn('--track',self.calls()[-1])
        self.control(retry_stdout='unsupported --track',retry_code=2)
        before=len(self.calls());self.assertEqual(self.retry().status_code,502);self.assertEqual(len(self.calls()),before+1)
        actions=Actions(Studies(self.studies),self.fake)
        with patch.object(actions,'settings',return_value=actions.clusters), patch('autog_frontend.actions.subprocess.run',side_effect=subprocess.TimeoutExpired('fake',15)) as run:
            with self.assertRaises(StudyError) as caught:actions.retry_monitor(dict(cluster='default',auth_fixed=False))
            self.assertEqual(caught.exception.status,504);self.assertEqual(run.call_count,1)
            self.assertIn('--track',run.call_args.args[0])

    def test_t151_invalid_stale_and_ambiguous_markers_use_one_legacy_call(self):
        for extra in (dict(retry_tracking_version=2), dict(retry_tracking_version=True),
                      dict(heartbeat_at='2026-01-01T00:00:00Z'), dict(entries={'default':dict(source='unsafe')})):
            self.tracking_marker(**extra)
            before=len(self.calls());self.assertEqual(self.retry().status_code,200)
            self.assertEqual(len(self.calls()),before+1);self.assertNotIn('--track',self.calls()[-1])
        cache=self.tracking_marker('legacy');(cache/'default').mkdir()
        before=len(self.calls());self.assertEqual(self.retry().status_code,200)
        self.assertEqual(len(self.calls()),before+1);self.assertNotIn('--track',self.calls()[-1])

    def test_t151_changed_ag_root_refuses_before_registration(self):
        self.tracking_marker()
        self.control(root_matches=False)
        before=len(self.calls());response=self.retry()
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(len(self.calls()),before)


class PairedResourceTests(unittest.TestCase):
    def test_t158_installed_backend_clusters_capacity_and_local_prepare(self):
        """Explicit isolated installation only; no default config, SSH or submit."""
        import sys
        from datetime import datetime, timezone
        source = os.environ.get('T158_BACKEND_SOURCE')
        if not source:
            self.skipTest('Supply the isolated installed T154/T156 backend source for the paired run')
        from ag import attempt, config, monitor, study
        self.assertEqual(Path(config.__file__).resolve(), Path(source).resolve()/'ag/config.py')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            ssh = root/'synthetic-config'; ssh.touch()
            cfg = dict(ssh=dict(config_file=str(ssh), host='fixture'),
                remote=dict(allowed_root=str(root/'remote'), ag_root=str(root/'remote/ag')),
                scheduler=dict(queue='batch'), programs=dict(gaussian=dict(g16root=str(root/'g16')), xtb=dict(root=str(root/'chem'))),
                resources=dict(max_cores=48, max_committed_cores=96, default_tier='max', tiers={
                    'mini':dict(cores=4,mem_gb=8),'simple':dict(cores=8,mem_gb=16),
                    'general':dict(cores=24,mem_gb=48),'complex':dict(cores=32,mem_gb=64),'max':dict(cores=48,mem_gb=96)}),
                local=dict(studies_root=str(root/'studies')), _config_dir=str(root))
            config.validate_cluster(cfg)
            study.init(cfg, 'water-demo')
            source_input = root/'water.gjf'
            source_input.write_text('%nprocshared=8\n%mem=12800MB\n%chk=water.chk\n# HF/STO-3G SP\n\nSynthetic water\n\n0 1\nO 0 0 0\nH 0 0 1\nH 0 1 0\n\n')
            with patch('ag.transport.SSHTransport', side_effect=AssertionError('Remote transport forbidden')):
                parent = attempt.prepare(cfg, study_name='water-demo', template='gaussian', input_path=source_input,
                                         tier='simple', walltime='01:00:00', label='parent', method_basis='Synthetic only')
            parent_path = root/'studies/water-demo/attempts'/parent['attempt_id']
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in parent_path.rglob('*') if p.is_file()}
            original_input = source_input.read_bytes()
            original_mtime = source_input.stat().st_mtime_ns
            snapshot = monitor.empty_snapshot(cfg, 60)
            snapshot.update(sampled_at=datetime.now(timezone.utc).isoformat(), ok=True)
            snapshot['cluster']['nodes'] = [dict(name='compute-a', state='free', cores_total=48, cores_used=0,
                mem_total_gb=96, mem_assigned_gb=0, mem_total_bytes=96*1024**3, mem_assigned_bytes=0, capacity_cpu_consistent=True)]
            cache = root/'studies/.ag-monitor'; cache.mkdir()
            snap_file = cache/'latest.json'; snap_file.write_text(json.dumps(snapshot))
            (root/'config.json').write_text(json.dumps(cfg))
            wrapper = root/'paired-ag'
            wrapper.write_text('#!'+sys.executable+'\n'+'''import json, sys
from pathlib import Path
from unittest.mock import patch
from ag import cli, capacity
assert sys.argv[1] in ('--version', 'clusters', 'capacity', 'prepare'), 'Only local validation commands allowed'
cfg = json.loads(Path(__file__).with_name('config.json').read_text())
with patch.object(cli, 'load_config', return_value=cfg), patch.object(capacity, 'load_config', return_value=cfg), patch('ag.transport.SSHTransport', side_effect=AssertionError('Remote transport forbidden')):
    raise SystemExit(cli.main())
''')
            wrapper.chmod(0o700)
            actions = Actions(Studies(root/'studies'), wrapper)
            self.assertEqual(actions.clusters['default']['default_tier'], 'max')
            self.assertEqual(actions.clusters['default']['tiers']['max'], dict(cores=48,mem_gb=96,mem_mb=76800))
            for used, state, verdict in [(0,'free','enough'),(8,'free','queue'),(0,'down','unknown')]:
                snapshot['cluster']['nodes'][0].update(cores_used=used, state=state)
                snap_file.write_text(json.dumps(snapshot)); raw = snap_file.read_bytes()
                self.assertEqual(actions.capacity(dict(cluster='default',tier='max'))['availability'], verdict)
                self.assertEqual(snap_file.read_bytes(), raw)
            result = actions.execute(dict(action='prepare', study='water-demo', attempt=parent['attempt_id'],
                cluster='default', tier='max', input=source_input.read_text(), walltime='01:00:00', label='derived',
                relation='derived_from', method_basis='Synthetic only'))
            self.assertEqual(result['exit_code'], 0, result)
            manifest = json.loads(result['stdout'])
            self.assertEqual((manifest['cores'], manifest['mem_gb']), (48,96))
            new_path = root/'studies/water-demo/attempts'/manifest['attempt_id']
            new_input = next((new_path/'inputs').glob('*.gjf')).read_bytes()
            self.assertTrue(new_input.startswith(b'%nprocshared=48\n%mem=76800MB\n'))
            self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}, before)
            self.assertEqual(source_input.read_bytes(), original_input)
            self.assertEqual(source_input.stat().st_mtime_ns, original_mtime)
            self.assertFalse((root/'remote').exists())
