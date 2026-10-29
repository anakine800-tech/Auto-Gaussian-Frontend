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

    def test_old_and_whole_node_capabilities_start_and_bind_current_candidates(self):
        """Both CLI generations start; whole-node selection needs its capability."""
        for whole in (False, True):
            with self.subTest(whole=whole):
                _, targets = self.node_setup()
                config = settings(self.studies)
                row = config['clusters'][0]
                fractions = ['1/2', '1/4', '1'] if whole else ['1/2', '1/4']
                row['node_targeting'] = dict(default_fraction='1/2', fractions=fractions)
                row['resources']['tiers'].update(mini=dict(cores=12, mem_gb=24),
                    general=dict(cores=24, mem_gb=48), max=dict(cores=48, mem_gb=96))
                targets['nodes'][0]['options'] += [dict(fraction='1/4', cores=12, mem_gb=24, tier='mini')]
                if whole:
                    targets['nodes'][0]['options'] += [dict(fraction='1', cores=48, mem_gb=96, tier='max')]
                self.control(clusters_response=config, nodes_response=targets)
                actions = Actions(Studies(self.studies), self.fake)
                self.assertEqual(actions.clusters['default']['node_targeting'], row['node_targeting'])
                self.assertEqual(actions.node_targets()['default'], targets)
                payload = dict(action='prepare', study='butane-demo', attempt='prepared', cluster='default',
                    input=gjf(), tier='max', walltime='01:00:00', label='whole', relation='derived_from',
                    method_basis='Synthetic only', target_node='compute-a', node_fraction='1')
                if not whole:
                    with self.assertRaisesRegex(StudyError, 'not supported'):
                        actions.execute(payload)
                    self.assertFalse((self.study/'drafts').exists())
                else:
                    result = actions.execute(payload)
                    self.assertEqual(result['exit_code'], 0, result)
                    manifest = json.loads(result['stdout'])
                    self.assertEqual((manifest['cores'], manifest['mem_gb'], manifest['tier']), (48, 96, 'max'))
                    prepare = [args for args in self.calls() if args[0] == 'prepare']
                    self.assertEqual(len(prepare), 1)
                    self.assertEqual(prepare[0][-4:], ['--target-node', 'compute-a', '--node-fraction', '1'])
                    self.assertFalse(any(args[0] in ('submit', 'cancel', 'fetch') for args in self.calls()))

    def test_node_capability_rejects_unknown_missing_duplicate_or_changed_defaults(self):
        invalid = [None, {}, {'fractions': ['1/2', '1/4']},
                   dict(default_fraction='1', fractions=['1/2', '1/4', '1']),
                   dict(default_fraction='1/2', fractions=['1/2']),
                   dict(default_fraction='1/2', fractions=['1/2', '1/4', '1/8']),
                   dict(default_fraction='1/2', fractions=['1/2', '1/4', '1', '1']),
                   dict(default_fraction='1/2', fractions=['1/2', '1/4', 1]),
                   dict(default_fraction='1/2', fractions=['1/2', '1/4'], arbitrary=True)]
        for capability in invalid:
            with self.subTest(capability=capability):
                config = settings(self.studies)
                config['clusters'][0]['node_targeting'] = capability
                self.control(clusters_response=config)
                with self.assertRaisesRegex(ValueError, 'node targeting capability'):
                    Actions(Studies(self.studies), self.fake)

    def test_whole_node_candidates_cannot_expand_capabilities_or_resources(self):
        actions, targets = self.node_setup()
        tiers = actions.clusters['default']['tiers'] | {'max': dict(cores=48, mem_gb=96, mem_mb=76800)}
        targets['nodes'][0]['options'] = [dict(fraction='1', cores=48, mem_gb=96, tier='max')]
        with self.assertRaises(ValueError):
            validate_targets(targets, 'default', tiers)
        supported = ('1/2', '1/4', '1')
        self.assertEqual(validate_targets(targets, 'default', tiers, supported), targets)
        for options in ([dict(fraction='1/8', cores=48, mem_gb=96, tier='max')],
                        targets['nodes'][0]['options'] * 2,
                        [dict(fraction='1', cores=47, mem_gb=94, tier='max')],
                        [dict(fraction='1', cores=48, mem_gb=96, tier='missing')],
                        targets['nodes'][0]['options'] * 4):
            bad = json.loads(json.dumps(targets))
            bad['nodes'][0]['options'] = options
            with self.subTest(options=options), self.assertRaises(ValueError):
                validate_targets(bad, 'default', tiers, supported)

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
            node['options'][0]['selectable'] = False
            with self.assertRaisesRegex(StudyError, 'fraction is unavailable'): actions.execute(payload)
            node['options'][0]['selectable'] = True
            node['selectable'] = False
            with self.assertRaises(StudyError): actions.execute(payload)
            node['selectable'] = True
            targets['valid_until'] = '2000-01-01T00:00:00+00:00'
            with self.assertRaises(StudyError): actions.execute(payload)
            self.assertEqual(run.call_count, 1)
        for invalid in (None, 1, 'true'):
            node['selectable'] = True
            node['options'][0]['selectable'] = invalid
            with self.assertRaises(ValueError): validate_targets(targets, 'default', actions.clusters['default']['tiers'])
            node['options'][0]['selectable'] = True
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
            self.skipTest('Supply the isolated installed T154/T156/T157 backend source for the paired run')
        from ag import attempt, config, monitor, node_targeting, study
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
assert sys.argv[1] in ('--version', 'clusters', 'nodes', 'capacity', 'prepare'), 'Only local validation commands allowed'
with Path(__file__).with_name('paired-argv.jsonl').open('a') as stream:
    stream.write(json.dumps(sys.argv[1:])+'\\n')
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
            # Final T157 candidates and per-fraction admission, from the real
            # CLI and parser with synthetic PBS observations only.
            cfg['node_targeting'] = dict(allowed_nodes=['compute-b','compute-a','compute-fast'],
                denied_nodes=['login-a'], priority=[['compute-b','compute-a'],['compute-fast']],
                restricted_nodes=['compute-fast'])
            config.validate_cluster(cfg)
            (root/'config.json').write_text(json.dumps(cfg))
            actions = Actions(Studies(root/'studies'), wrapper)
            self.assertEqual(actions.clusters['default']['default_tier'], 'max')
            self.assertEqual(actions.clusters['default']['node_targeting'],
                             dict(default_fraction='1/2', fractions=['1/2','1/4']))
            raw_nodes = ''.join(f'{name}\n    state = free\n    np = 96\n    status = physmem=192gb\n'
                + ('    jobs = 0-79/7.fixture\n' if name == 'compute-b' else '')
                for name in ('compute-a','compute-b','compute-fast','login-a'))
            for verdict, memory in (('queue', '160gb'), ('unknown', None)):
                job = dict(job_id='7.fixture', job_state='R', exec_host='compute-b/0-79')
                if memory is not None:
                    job['Resource_List.mem'] = memory
                snapshot['cluster']['nodes'] = node_targeting.strict_nodes(raw_nodes, [job])
                snapshot['sampled_at'] = datetime.now(timezone.utc).isoformat()
                snap_file.write_text(json.dumps(snapshot))
                snap_before = (snap_file.read_bytes(), snap_file.stat().st_mtime_ns)
                targets = actions.node_targets()['default']
                self.assertEqual([r['name'] for r in targets['nodes']],
                                 ['compute-b','compute-a','compute-fast','login-a'])
                self.assertEqual([r['order'] for r in targets['nodes']], [1,2,3,4])
                self.assertEqual([r['priority_group'] for r in targets['nodes']], [1,1,2,None])
                busy, idle, restricted, denied = targets['nodes']
                self.assertEqual((busy['status'], busy['selectable']), ('occupied', True))
                self.assertEqual((idle['status'], idle['selectable']), ('available', True))
                self.assertFalse(restricted['selectable']); self.assertFalse(denied['selectable'])
                self.assertEqual([(o['fraction'],o['cores'],o['mem_gb'],o['tier'],o['selectable']) for o in busy['options']],
                                 [('1/2',48,96,'max',True),('1/4',24,48,'general',True)])
                self.assertEqual([o['capacity']['availability'] for o in busy['options']], [verdict,verdict])
                for fraction, tier, cores, memory_gb in (('1/2','max',48,96), ('1/4','general',24,48)):
                    advice = actions.capacity(dict(cluster='default',tier=tier,target_node='compute-b'))
                    self.assertEqual(advice['availability'], verdict)
                    result = actions.execute(dict(action='prepare', study='water-demo', attempt=parent['attempt_id'],
                        cluster='default', tier=tier, input=source_input.read_text(), walltime='01:00:00',
                        label=verdict+'-'+tier, relation='derived_from', method_basis='Synthetic only',
                        target_node='compute-b', node_fraction=fraction))
                    self.assertEqual(result['exit_code'], 0, result)
                    manifest = json.loads(result['stdout'])
                    self.assertEqual(manifest['node_target'],
                                     dict(name='compute-b', fraction=fraction, slots=96, queue='batch'))
                    self.assertEqual((manifest['cores'],manifest['mem_gb']), (cores,memory_gb))
                    created = root/'studies/water-demo/attempts'/manifest['attempt_id']
                    self.assertTrue(next((created/'inputs').glob('*.gjf')).read_bytes().startswith(
                        f'%nprocshared={cores}\n%mem={memory_gb*800}MB\n'.encode()))
                self.assertEqual((snap_file.read_bytes(),snap_file.stat().st_mtime_ns), snap_before)
            # Rounded display memory can retain a tier while exact total bytes
            # exclude only the half-node request. Respect the option flag.
            snapshot['cluster']['nodes'] = node_targeting.strict_nodes(
                'compute-a\n    state = free\n    np = 96\n    status = physmem=100663295kb\n', [])
            snap_file.write_text(json.dumps(snapshot))
            targets = actions.node_targets()['default']
            row = next(r for r in targets['nodes'] if r['name'] == 'compute-a')
            self.assertTrue(row['selectable'])
            self.assertEqual([(o['tier'],o['selectable']) for o in row['options']], [('max',False),('general',True)])
            payload = dict(action='prepare', study='water-demo', attempt=parent['attempt_id'], cluster='default',
                tier='max', input=source_input.read_text(), walltime='01:00:00', label='boundary',
                relation='derived_from', method_basis='Synthetic only', target_node='compute-a', node_fraction='1/2')
            draft_files = list((root/'studies').rglob('*.gjf'))
            with self.assertRaisesRegex(StudyError, 'fraction is unavailable'):
                actions.execute(payload)
            self.assertEqual(list((root/'studies').rglob('*.gjf')), draft_files)
            self.assertEqual(actions.capacity(dict(cluster='default',tier='max',target_node='compute-a'))['availability'], 'not_applicable')
            result = actions.execute(payload | dict(tier='general', node_fraction='1/4'))
            self.assertEqual(result['exit_code'], 0, result)
            commands = [json.loads(line)[0] for line in (root/'paired-argv.jsonl').read_text().splitlines()]
            self.assertEqual(set(commands), {'--version','clusters','nodes','capacity','prepare'})
            self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}, before)
            self.assertEqual(source_input.read_bytes(), original_input)
            self.assertEqual(source_input.stat().st_mtime_ns, original_mtime)
            self.assertFalse((root/'remote').exists())


class AutonomyActionTests(unittest.TestCase):
    setUp = ActionsTests.setUp
    client_for = ActionsTests.client_for
    post = ActionsTests.post
    prepare = ActionsTests.prepare
    calls = ActionsTests.calls
    control = ActionsTests.control

    def saved(self, phase='running', lease='active'):
        from tests.autonomy_fixture import create_autonomy
        snapshot = create_autonomy(self.study, phase, lease=lease)
        self.control(autonomy_response=snapshot)
        return snapshot

    def write_calls(self):
        return [row for row in self.calls() if row[0] in ('prepare', 'submit', 'cancel', 'fetch')]

    def all_writes_refused(self):
        for action in ('prepare', 'submit', 'cancel', 'fetch'):
            response = self.prepare() if action == 'prepare' else self.post(action)
            self.assertEqual(response.status_code, 409, (action, response.text))
        self.assertEqual(self.write_calls(), [])
        self.assertFalse((self.study/'drafts').exists())

    def test_running_including_wakeup_gaps_and_expired_lease_refuses_direct_http(self):
        for lease in ('active', 'none', 'expired'):
            with self.subTest(lease=lease):
                self.saved(lease=lease)
                context = self.client.get('/api/actions/butane-demo/prepared').json()
                self.assertTrue(context['autonomy']['manual_actions_blocked'])
                self.all_writes_refused()
                self.assertEqual(self.post('status').status_code, 200)
        self.assertFalse(any(row[0] == 'autonomy' for row in self.calls()))

    def test_paused_lease_blocks_then_released_and_ended_use_normal_rules(self):
        self.saved('paused')
        self.all_writes_refused()
        for phase in ('paused', 'ended'):
            self.saved(phase, lease='none')
            response = self.post('fetch')
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row[0] for row in self.write_calls()], ['fetch', 'fetch'])
        queries = [row for row in self.calls() if row[0] == 'autonomy']
        self.assertEqual(queries, [['autonomy', 'status', '--study', str(self.study), '--json']] * 2)

    def test_old_backend_absent_works_but_existing_unverifiable_state_refuses(self):
        self.control(autonomy_code=2, autonomy_stderr='unsupported command')
        self.assertEqual(self.post('fetch').status_code, 200)
        self.assertFalse(any(row[0] == 'autonomy' for row in self.calls()))
        self.saved('ended', lease='none')
        self.control(autonomy_code=2, autonomy_stderr='private backend error')
        response = self.post('fetch')
        self.assertEqual(response.status_code, 409)
        self.assertNotIn('private backend error', response.text)
        self.assertEqual(len(self.write_calls()), 1)

    def test_unknown_missing_and_corrupt_state_refuse_all_four_actions(self):
        from tests.autonomy_fixture import write_snapshot
        snapshot = self.saved('ended', lease='none')
        for variant in ('missing', 'truncated', 'unsupported', 'bad-hash'):
            path = self.study/'autonomy/state.json'
            write_snapshot(self.study, snapshot)
            if variant == 'missing':
                path.unlink()
            elif variant == 'truncated':
                path.write_text('{')
            else:
                changed = json.loads(json.dumps(snapshot))
                if variant == 'unsupported':
                    changed['state']['schema'] = 'ag-autonomy/999'
                else:
                    changed['journal_sha256'] = 'f' * 64
                write_snapshot(self.study, changed)
            with self.subTest(variant=variant):
                self.all_writes_refused()

    def test_stale_page_and_repeated_clicks_recheck_current_state(self):
        context = self.client.get('/api/actions/butane-demo/prepared').json()
        self.assertFalse(context['autonomy']['manual_actions_blocked'])
        self.saved()
        self.all_writes_refused()
        self.all_writes_refused()

    def test_change_during_draft_rejected_at_dispatch(self):
        from tests.autonomy_fixture import create_autonomy
        actions = Actions(Studies(self.studies), self.fake)
        original = actions.draft
        def changing_draft(*args):
            result = original(*args)
            create_autonomy(self.study, lease='none')
            return result
        payload = dict(action='prepare', study='butane-demo', attempt='prepared',
                       cluster='default', input=gjf(), tier='general', walltime='02:00:00',
                       label='changed', relation='derived_from', method_basis='Synthetic')
        with patch.object(actions, 'draft', side_effect=changing_draft), patch.object(actions, 'run') as run:
            with self.assertRaisesRegex(StudyError, '自主轮次仍在运行'):
                actions.execute(payload)
            run.assert_not_called()
        self.assertEqual(self.write_calls(), [])

    def test_backend_status_cannot_disagree_with_local_or_change_during_query(self):
        from tests.autonomy_fixture import create_autonomy
        actions = Actions(Studies(self.studies), self.fake)
        snapshot = self.saved('ended', lease='none')
        old_query = actions.autonomy_status
        def changing_query(argv):
            result = old_query(argv)
            create_autonomy(self.study, lease='none')
            return result
        with patch.object(actions, 'autonomy_status', side_effect=changing_query), patch.object(actions, 'run') as run:
            with self.assertRaises(StudyError):
                actions.execute(dict(action='fetch', study='butane-demo', attempt='prepared'))
            run.assert_not_called()
        self.saved('ended', lease='none')
        # A selected backend returning a different journal is not this snapshot.
        snapshot['journal_sha256'] = 'f' * 64
        self.control(autonomy_response=snapshot)
        self.assertEqual(self.post('fetch').status_code, 409)
        self.assertEqual(self.write_calls(), [])

    def test_private_records_and_status_errors_never_reach_http(self):
        from tests.autonomy_fixture import FAKE_TOKEN
        self.saved('ended', lease='none')
        for path in ('autonomy/state.json', 'Autonomy/state.json', 'AUTONOMY/state.json',
                     'autonomy/plan-plan-demo.json', 'autonomy/journal.jsonl'):
            response = self.client.get('/api/studies/butane-demo/files/' + path)
            self.assertEqual(response.status_code, 403)
        evidence = self.client.get('/api/studies/butane-demo/evidence').json()
        self.assertFalse(any(row['path'].startswith('autonomy/') for row in evidence['files']))
        for url in ('/api/studies/butane-demo/autonomy', '/api/actions/butane-demo/prepared'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn(FAKE_TOKEN, response.text)
            self.assertNotIn('token_sha256', response.text)
        self.control(autonomy_stdout=FAKE_TOKEN, autonomy_stderr=FAKE_TOKEN)
        response = self.post('fetch')
        self.assertEqual(response.status_code, 409)
        self.assertNotIn(FAKE_TOKEN, response.text)
        self.assertEqual(self.write_calls(), [])

    def test_private_status_output_limit_and_timeout_preserve_operation_lock(self):
        from tests.autonomy_fixture import FAKE_TOKEN
        self.saved('ended', lease='none')
        self.control(autonomy_stdout='x' * 2048, autonomy_stderr=FAKE_TOKEN)
        with patch('autog_frontend.actions.AUTONOMY_OUTPUT_LIMIT', 1024):
            self.assertEqual(self.post('fetch').status_code, 409)
        self.control(autonomy_wait_for_release=True, autonomy_stdout=FAKE_TOKEN + 'x' * (3 * 1024 * 1024),
                     autonomy_stderr=FAKE_TOKEN + 'e' * (3 * 1024 * 1024))
        with patch.object(Actions, 'drain', side_effect=AssertionError('Private output must use bounded discard')) as drain:
            try:
                with patch('autog_frontend.actions.AUTONOMY_TIMEOUT', .05):
                    response = self.post('fetch')
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()['timed_out'])
                self.assertNotIn(FAKE_TOKEN, response.text)
                self.assertEqual((response.json()['stdout'], response.json()['stderr']), ('', ''))
                self.assertEqual(self.post('status').status_code, 409)
                self.assertEqual(self.write_calls(), [])
            finally:
                (self.root/'release').touch()
            deadline = time.monotonic() + 3
            while self.post('status').status_code == 409 and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertEqual(self.post('status').status_code, 200)
            drain.assert_not_called()

    def test_readonly_endpoint_never_invokes_ag_or_mutates_records(self):
        self.saved()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        with patch('subprocess.Popen', side_effect=AssertionError('read-only must not invoke ag')):
            client = self.client_for(create_app(self.studies))
            self.assertEqual(client.get('/api/studies/butane-demo/autonomy').status_code, 200)
            self.assertEqual(client.post('/api/actions').status_code, 405)
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}, before)


class PairedAutonomyTests(unittest.TestCase):
    def test_saved_t184_records_and_status_projection(self):
        """Real local bookkeeping only, not T186 action-boundary or CLI proof."""
        import sys
        source = os.environ.get('T196_BACKEND_SOURCE')
        if not source:
            self.skipTest('Supply the isolated T184 backend source for the paired run')
        source = Path(source).resolve()
        original_modules = {name: value for name, value in sys.modules.items()
                            if name == 'ag' or name.startswith('ag.')}
        def restore_modules():
            for name in list(sys.modules):
                if name == 'ag' or name.startswith('ag.'):
                    sys.modules.pop(name)
            sys.modules.update(original_modules)
        self.addCleanup(restore_modules)
        with patch.object(sys, 'path', [str(source), *sys.path]):
            from ag import autonomy as backend, study as backend_study
        self.assertEqual(Path(backend.__file__).resolve(), source/'ag/autonomy.py')
        self.assertEqual(Path(backend.disk.__file__).resolve(), source/'ag/_autonomy_store.py')
        from autog_frontend.autonomy import read_autonomy, validate_status
        at = 1800000000
        versions = dict(ag_version='synthetic-pairing', git_commit='a' * 40, dirty=False,
                        rdkit='synthetic', goodvibes='synthetic')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            cfg = dict(local=dict(studies_root=str(root/'studies')))
            name = 'autonomy-pairing-demo'
            with patch.object(backend, 'versions', return_value=versions), \
                    patch.object(backend, 'now', side_effect=lambda: at), \
                    patch('subprocess.Popen', side_effect=AssertionError('Subprocesses forbidden')), \
                    patch('socket.socket', side_effect=AssertionError('Network forbidden')):
                backend_study.init(cfg, name)
                path = root/'studies'/name
                store = Studies(root/'studies')

                def check(phase, blocked, lease_status=None):
                    before = {p: (p.read_bytes(), p.stat().st_mtime_ns)
                              for p in path.rglob('*') if p.is_file()}
                    saved = read_autonomy(store, name, now=at)
                    public = validate_status(backend.status(cfg, name), now=at)
                    self.assertEqual((saved['status'], public['status']), ('ok', 'ok'))
                    self.assertEqual((saved['phase'], saved['manual_actions_blocked']), (phase, blocked))
                    self.assertEqual(saved['lease']['status'] if saved['lease'] else None, lease_status)
                    for key in ('phase', 'seq', 'journal_sha256', 'current_plan', 'current_round',
                                'current_run', 'lease', 'totals', 'summary', 'pending', 'plans'):
                        self.assertEqual(saved[key], public[key], key)
                    self.assertEqual(public['verification'], 'ag-status')
                    self.assertEqual(saved['integration'], 'pending-backend-action-boundary')
                    self.assertNotIn('token', json.dumps(saved))
                    self.assertNotIn('token', json.dumps(public))
                    self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}, before)
                    return saved

                backend.initialize(cfg, name)
                initial = check('ended', False)
                self.assertIsNone(initial['current_plan'])
                self.assertIsNone(initial['current_round'])
                at += 1
                plan = backend.create_plan(cfg, name, dict(goal='Synthetic local projection check',
                    comparison_groups=['synthetic'], method_policy='Synthetic method only',
                    mechanism_scope='No scientific conclusion',
                    system_rules=dict(main='Synthetic main', small='Synthetic small'),
                    estimated_hours=1, attempt_limit=3, valid_until=at + 20000))
                self.assertIsNone(check('ended', False)['plans'][0]['confirmation'])
                at += 1
                backend.confirm(cfg, name, plan['plan_id'], plan['sha256'], 'Synthetic confirmation')
                self.assertEqual(check('ended', False)['plans'][0]['confirmation']['sha256'], plan['sha256'])
                at += 1
                backend.begin(cfg, name, plan['plan_id'], 'Synthetic authorization round')
                running = check('running', True)
                round_id = running['current_round']['id']
                self.assertIsNone(running['current_run'])
                at += 1
                first = backend.start(cfg, name, plan['plan_id'], 'synthetic-session')
                awake = check('running', True, 'active')
                self.assertEqual(awake['current_run']['id'], first['run_id'])
                expired = read_autonomy(store, name, now=at + backend.LEASE_SECONDS + 1)
                self.assertEqual(expired['lease']['status'], 'expired')
                self.assertTrue(expired['manual_actions_blocked'])
                at += 1
                backend.change(cfg, name, 'count', first['run_id'], first['token'],
                    kind='attempt', request_id='synthetic-intent', object_id='synthetic-object',
                    failure_class='none', evidence='Synthetic intent only')
                at += 1
                backend.change(cfg, name, 'update', first['run_id'], first['token'],
                    summary='Synthetic saved summary', pending=['Synthetic pending decision'], objects={})
                counted = check('running', True, 'active')
                self.assertEqual(counted['totals']['attempt'], 1)
                self.assertEqual(counted['current_round']['totals']['attempt'], 1)
                self.assertEqual(counted['current_run']['totals']['attempt'], 1)
                self.assertEqual(counted['pending'], ['Synthetic pending decision'])
                at += 1
                backend.change(cfg, name, 'finish', first['run_id'], first['token'], reason='Synthetic wake finished')
                gap = check('running', True)
                self.assertEqual(gap['current_round']['id'], round_id)
                self.assertIsNone(gap['current_run'])
                at += 1
                second = backend.start(cfg, name, plan['plan_id'], 'synthetic-next-session')
                next_wake = check('running', True, 'active')
                self.assertEqual(next_wake['current_round']['id'], round_id)
                self.assertNotEqual(second['run_id'], first['run_id'])
                self.assertEqual(next_wake['current_run']['totals']['attempt'], 0)
                self.assertEqual(next_wake['current_round']['totals']['attempt'], 1)
                at += 1
                backend.pause(cfg, name, 'Synthetic pause')
                check('paused', True, 'active')
                at += 1
                backend.change(cfg, name, 'finish', second['run_id'], second['token'], reason='Synthetic lease release')
                check('paused', False)
                at += 1
                backend.change(cfg, name, 'end', None, None, round_id=round_id, reason='Synthetic round ended')
                ended = check('ended', False)
                self.assertEqual(ended['current_plan'], plan['plan_id'])
                self.assertEqual(ended['current_round']['id'], round_id)
                self.assertEqual(ended['current_round']['ended_at'], at)
                self.assertEqual(ended['current_round']['totals']['attempt'], 1)
                self.assertIsNone(ended['lease'])
                self.assertIsNone(ended['current_run'])


class PairedSubmissionAutonomyTests(unittest.TestCase):
    def test_actual_t186_events_and_http_projection_are_readonly(self):
        """Real local event writers, not a CLI/remote or ownership-reconciliation test."""
        import sys
        source = os.environ.get('T196_SUBMISSION_BACKEND_SOURCE')
        if not source:
            self.skipTest('Supply the isolated T186 source for actual-event projection pairing')
        source = Path(source).resolve()
        original_modules = {name: value for name, value in sys.modules.items()
                            if name == 'ag' or name.startswith('ag.')}
        for name in original_modules:
            sys.modules.pop(name)

        def restore_modules():
            for name in list(sys.modules):
                if name == 'ag' or name.startswith('ag.'):
                    sys.modules.pop(name)
            sys.modules.update(original_modules)

        self.addCleanup(restore_modules)
        with patch.object(sys, 'path', [str(source), *sys.path]):
            from ag import autonomy as backend, autonomy_submission as submission
            from ag import study as backend_study, config as backend_config, transport
        for module in (backend, backend.disk, submission, backend_study, backend_config, transport):
            self.assertEqual(Path(module.__file__).resolve(), source.joinpath(*module.__name__.split('.')).with_suffix('.py'))
        from autog_frontend.autonomy import read_autonomy, validate_status
        versions = dict(ag_version='synthetic-event-pairing', git_commit='b' * 40, dirty=False,
                        rdkit='synthetic', goodvibes='synthetic')
        at = 1800000000
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            synthetic_home = root/'synthetic-home'
            synthetic_home.mkdir()
            cfg = dict(local=dict(studies_root=str(root/'studies')))
            name = 'submission-projection-demo'
            directory_calls = []
            original_directory = backend.disk.directory

            def isolated_directory(path):
                path = Path(path).absolute()
                if not path.is_relative_to(root) or '..' in path.parts:
                    raise AssertionError('Backend directory access escaped the isolated temporary root')
                directory_calls.append(path)
                return original_directory(path)

            def file_image():
                # Include the complete study and isolated machine registry.
                return {p: (p.read_bytes(), p.stat().st_mtime_ns)
                        for p in root.rglob('*') if p.is_file()}

            with patch.object(Path, 'home', return_value=synthetic_home), \
                    patch.object(backend.disk, 'directory', side_effect=isolated_directory), \
                    patch.object(backend, 'versions', return_value=versions), \
                    patch.object(backend, 'now', side_effect=lambda: at), \
                    patch('autog_frontend.autonomy.time.time', side_effect=lambda: at), \
                    patch.object(backend_config, 'load_config', side_effect=AssertionError('Default config forbidden')), \
                    patch.object(transport, 'SSHTransport', side_effect=AssertionError('Transport forbidden')), \
                    patch('subprocess.Popen', side_effect=AssertionError('Subprocesses forbidden')), \
                    patch('socket.create_connection', side_effect=AssertionError('Network forbidden')), \
                    patch('socket.socket.connect', side_effect=AssertionError('Network forbidden')), \
                    patch('socket.socket.connect_ex', side_effect=AssertionError('Network forbidden')):
                # Exercise the actual fixed-root helper before any study event
                # write. Path.home and the directory guard isolate all machine
                # registries, including manual-writers, without changing HOME.
                self.assertEqual(Path.home(), synthetic_home)
                with submission._machine_directory(create=True) as registry:
                    actual = os.fstat(registry.fd)
                    expected = (synthetic_home/'.config/ag').stat()
                    self.assertEqual((actual.st_dev, actual.st_ino), (expected.st_dev, expected.st_ino))
                backend_study.init(cfg, name)
                path = root/'studies'/name
                identity = submission.study_identity(path)
                with submission.machine_lock(), backend.disk.manual_writers(identity['study_key'], create=True) as writers:
                    actual = os.fstat(writers.fd)
                    expected = (synthetic_home/'.config/ag/manual-writers'/identity['study_key']).stat()
                    self.assertEqual((actual.st_dev, actual.st_ino), (expected.st_dev, expected.st_ino))
                self.assertTrue(directory_calls)
                self.assertTrue(all(value.is_relative_to(root) for value in directory_calls))
                store = Studies(root/'studies')
                with TestClient(create_app(root/'studies'), base_url='http://localhost',
                                client=('127.0.0.1', 12345)) as client:
                    secrets = []

                    def check(phase, consumed=None):
                        before = file_image()
                        public = backend.status(cfg, name)
                        self.assertIs(public['submission_counts_verified'], False)
                        raw = json.loads((path/'autonomy/state.json').read_text())
                        saved = read_autonomy(store, name, now=at)
                        projected = validate_status(public, now=at)
                        raw_projected = validate_status(raw, now=at)
                        response = client.get(f'/api/studies/{name}/autonomy')
                        self.assertEqual(response.status_code, 200, response.text)
                        http = response.json()
                        self.assertEqual(file_image(), before)
                        for value in (saved, projected, raw_projected, http):
                            self.assertEqual((value['status'], value['phase']), ('ok', phase), value)
                            self.assertEqual(value['integration'], 'pending-backend-action-boundary')
                            if consumed is None:
                                self.assertNotIn('submissions', value)
                                self.assertNotIn('submissions_count', value)
                            else:
                                self.assertEqual(value['submissions_count'], consumed)
                                self.assertEqual(value['current_round_submission_count'], consumed)
                                self.assertEqual(len(value['submissions']), consumed)
                            text = json.dumps(value)
                            for forbidden in ('token_sha256', 'owner_token_sha256', 'previous_lease',
                                              'writer_id', 'study_key', 'submission_counts_verified', *secrets):
                                self.assertNotIn(forbidden, text)
                        fields = ('phase', 'seq', 'journal_sha256', 'current_plan', 'current_round', 'current_run',
                                  'lease', 'totals', 'manual_actions_blocked', 'submissions', 'submissions_count',
                                  'current_round_submission_count', 'submissions_truncated', 'submission_pause',
                                  'waiting', 'waiting_count', 'waiting_truncated')
                        for field in fields:
                            self.assertEqual(saved.get(field), projected.get(field), field)
                            self.assertEqual(saved.get(field), raw_projected.get(field), field)
                            self.assertEqual(saved.get(field), http.get(field), field)
                        self.assertEqual(saved['events'], http['events'])
                        return saved

                    backend.initialize(cfg, name)
                    check('ended')
                    at += 1
                    plan = backend.create_plan(cfg, name, dict(goal='Synthetic submission projection',
                        comparison_groups=['synthetic'], method_policy='Synthetic method only',
                        mechanism_scope='No scientific conclusion',
                        system_rules=dict(main='Synthetic main', small='Synthetic small'),
                        estimated_hours=1, attempt_limit=10, valid_until=at + 20000))
                    backend.confirm(cfg, name, plan['plan_id'], plan['sha256'], 'Synthetic confirmation')
                    backend.begin(cfg, name, plan['plan_id'], 'Synthetic round authorization')
                    run = backend.start(cfg, name, plan['plan_id'], 'synthetic-session')
                    round_id = run['state']['current_round']
                    secrets.extend((run['token'], hashlib.sha256(run['token'].encode()).hexdigest()))
                    check('running')
                    at += 1
                    backend.change(cfg, name, 'count', run['run_id'], run['token'], kind='attempt',
                        request_id='intent-one', object_id='synthetic-object', failure_class='none',
                        evidence='Synthetic intent only')

                    def record(index):
                        attempt_id = f'synthetic-{index:03d}'
                        return dict(attempt_id=attempt_id, object_id=f'object-{index}', failure_class=None,
                            ownership_sha256=hashlib.sha256(attempt_id.encode()).hexdigest(), round_id=round_id,
                            run_id=run['run_id'], plan_sha256=plan['sha256'], rule_sha256='c' * 64, max_attempts=10)

                    # Synthetic API input records; every persisted state and
                    # journal byte is produced by the actual backend writers.
                    for index in range(1, 9):
                        at += 1
                        with submission.machine_lock(), backend.submission_guard(cfg, name, run['run_id'], run['token'],
                                                                                 plan_sha256=plan['sha256']) as guard:
                            guard.consume(record(index))
                            if index == 1:
                                guard.dispatch_started(record(index)['attempt_id'])
                            elif index == 2:
                                guard.abort_before_dispatch(record(index)['attempt_id'], 'Synthetic early abort')
                        check('running', index)
                    at += 1
                    with submission.machine_lock(), backend.submission_guard(cfg, name, run['run_id'], run['token'],
                                                                             plan_sha256=plan['sha256']) as guard:
                        guard.waiting('waiting-object', 'd' * 64)
                    self.assertEqual(check('running', 8)['waiting_count'], 1)
                    at += 1
                    with submission.machine_lock(), backend.submission_guard(cfg, name, run['run_id'], run['token'],
                                                                             plan_sha256=plan['sha256']) as guard:
                        guard.consume(record(9))
                        self.assertEqual(guard.snapshot['phase'], 'paused')
                        with self.assertRaisesRegex(ValueError, 'paused'):
                            guard.dispatch_started(record(9)['attempt_id'])
                        guard.abort_before_dispatch(record(9)['attempt_id'], 'Synthetic threshold abort')
                    paused = check('paused', 9)
                    self.assertEqual(paused['totals']['attempt'], 1)
                    self.assertIn('90%', paused['submission_pause']['reason'])
                    self.assertTrue(paused['manual_actions_blocked'])
                    at += backend.LEASE_SECONDS + 1
                    for index, dispatched in ((1, True), (2, False)):
                        with submission.machine_lock():
                            backend.boundary_failure(cfg, name, record(index)['attempt_id'], record(index)['ownership_sha256'],
                                run_id=run['run_id'], token=run['token'], dispatched=dispatched,
                                reason='Synthetic late boundary failure')
                    failed = check('paused', 9)
                    rows = {row['attempt_id']: row for row in failed['submissions']}
                    self.assertTrue(rows['synthetic-001']['boundary_failure']['dispatched'])
                    self.assertIsNone(rows['synthetic-001']['aborted_before_dispatch'])
                    self.assertEqual(rows['synthetic-002']['aborted_before_dispatch']['reason'], 'Synthetic early abort')
                    self.assertEqual(rows['synthetic-002']['boundary_failure']['reason'], 'Synthetic late boundary failure')
                    self.assertEqual(failed['lease']['status'], 'expired')
                    at += 1
                    with backend.manual_write_guard(cfg, name, action='prepare') as writer:
                        self.assertTrue(writer['manual_takeover'])
                        secrets.extend((writer['writer_id'], writer['study_key']))
                        taken = check('paused', 9)
                        self.assertIsNone(taken['lease'])
                        self.assertEqual(taken['current_round']['id'], round_id)
                        self.assertEqual(taken['totals']['attempt'], 1)
                        self.assertFalse(taken['manual_actions_blocked'])  # Local projection is not writer permission.
                    final = check('paused', 9)
                    event_kinds = {row['op'] for row in final['events']}
                    self.assertTrue({'submission_consume', 'submission_dispatch', 'submission_abort',
                                     'submission_boundary_failure', 'waiting', 'manual_takeover'} <= event_kinds)
                    self.assertTrue((synthetic_home/'.config/ag/autonomy-submit.lock').is_file())
                    registry = synthetic_home/'.config/ag/manual-writers'/identity['study_key']
                    self.assertEqual(len(list(registry.glob('*.claim.json'))), 1)
                    self.assertEqual(len(list(registry.glob('*.complete.json'))), 1)
                    self.assertTrue(all(value.is_relative_to(root) for value in directory_calls))
