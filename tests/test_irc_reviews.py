import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.irc_reviews import MAX_MANIFEST,MAX_XYZ
from tests.irc_review_fixture import create_study, bind_source
from autog_frontend.studies import Studies


class IRCReviewsTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name).resolve();self.study=create_study(self.root)
        self.path=self.study/'analyses/review.json';self.original=json.loads(self.path.read_text())
        self.client=TestClient(create_app(self.root),base_url='http://localhost',client=('127.0.0.1',51234))
        self.base='/api/studies/irc-demo/irc-reviews';self.url=self.base+'/review.json'

    def save(self, data):self.path.write_text(json.dumps(data))

    def test_report_reads_saved_values_and_preserves_all_files(self):
        before={p:(p.read_bytes(),p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        response=self.client.get(self.url);self.assertEqual(response.status_code,200,response.text)
        data=response.json();self.assertEqual(data['report'],self.original)
        self.assertEqual(data['trajectories']['forward']['hash_status'],'已核对 SHA-256')
        self.assertEqual(len(data['trajectories']['reverse']['frames']),3)
        self.assertEqual(self.client.get(self.base).json()['reports'],[dict(name='review.json',group=None)])
        self.assertEqual(before,{p:(p.read_bytes(),p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()})
        self.assertEqual(self.client.post(self.url,json={}).status_code,405)

    def test_missing_hash_is_explicit_not_basename_matching(self):
        data=copy.deepcopy(self.original)
        data['inputs'][0]['path']='analyses/elsewhere/review.forward.xyz'
        data['inputs'][0]['sha256']='0'*64
        self.save(data);result=self.client.get(self.url).json()
        self.assertEqual(result['trajectories']['forward']['hash_status'],'未核对哈希')
        data['inputs']=[];self.save(data)
        self.assertEqual(self.client.get(self.url).json()['trajectories']['reverse']['hash_status'],'未核对哈希')

    def test_nested_report_hash_lookup(self):
        nested=self.study/'analyses/group';nested.mkdir()
        data=copy.deepcopy(self.original)
        for ref in data['inputs']:ref['path']=ref['path'].replace('analyses/','analyses/group/')
        for name in ('review.forward.xyz','review.reverse.xyz'):(nested/name).write_bytes((self.study/'analyses'/name).read_bytes())
        (nested/'review.json').write_text(json.dumps(data))
        self.assertEqual(self.client.get(self.base+'/group/review.json').status_code,200)
        self.assertEqual(len(self.client.get(self.base).json()['reports']),2)

    def test_missing_fields_types_nonfinite_and_invalid_mapping(self):
        cases=[(('notice',),None),(('protocol','method'),[]),(('thresholds','energy_drop_kcal_mol'),True),
               (('directions','forward','points',0,'point'),True),(('directions','forward','points',1,'point'),0),
               (('directions','forward','points',1,'geometry_frame'),4),
               (('directions','reverse','path_geometry','frame_count'),4),
               (('directions','reverse','last_accepted_point'),1),
               (('directions','forward','criteria','energy_drop','drop_kcal_mol'),'0.4'),
               (('directions','forward','criteria','continuity','status'),'met'),
               (('pairs',0,1),500), (('inputs',0,'sha256'),'bad')]
        for path,value in cases:
            with self.subTest(path=path):
                data=copy.deepcopy(self.original);target=data
                for key in path[:-1]:target=target[key]
                target[path[-1]]=value;self.save(data)
                response=self.client.get(self.url);self.assertGreaterEqual(response.status_code,400,response.text)
                self.assertNotIn('report',response.json())
        for key in self.original:
            data=copy.deepcopy(self.original);del data[key];self.save(data)
            self.assertGreaterEqual(self.client.get(self.url).status_code,400,key)
        for n in (float('nan'),float('inf'),float('-inf'),10**400):
            data=copy.deepcopy(self.original);data['extra']={'nested':[n]};self.save(data)
            self.assertEqual(self.client.get(self.url).status_code,422)

    def test_geometry_frame_mapping_with_missing_point_geometry(self):
        data=copy.deepcopy(self.original);data['inputs']=[];d=data['directions']['forward']
        d['points'][1]['geometry_frame']=None;d['points'][1]['distances_angstrom']=None
        d['points'][1]['relative_energy_kcal_mol']=None
        for point in d['points'][2:]:point['geometry_frame']-=1
        d['path_geometry']['frame_count']-=1
        xyz=self.study/'analyses/review.forward.xyz';rows=xyz.read_text().splitlines(keepends=True);xyz.write_text(''.join(rows[:5]+rows[10:]));self.save(data)
        result=self.client.get(self.url);self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['report']['directions']['forward']['points'][2]['geometry_frame'],1)

    def test_xyz_mutation_rejects_whole_report_and_listing(self):
        path=self.study/'analyses/review.reverse.xyz';path.write_bytes(path.read_bytes().replace(b'H 1.0',b'H 9.0'))
        response=self.client.get(self.url);self.assertEqual(response.status_code,422)
        self.assertIn('SHA-256 mismatch',response.json()['detail']);self.assertNotIn('report',response.json())
        listing=self.client.get(self.base).json();self.assertEqual(listing['reports'],[]);self.assertEqual(len(listing['issues']),1)

    def test_xyz_frame_count_order_and_truncation(self):
        for raw in (b'3\nSynthetic\nO 0 0 0\nH 1 0 0\nH 0 1 0\n',b'3\ntruncated\nO 0 0 0\n'):
            data=copy.deepcopy(self.original);data['inputs']=[];self.save(data)
            (self.study/'analyses/review.reverse.xyz').write_bytes(raw)
            self.assertEqual(self.client.get(self.url).status_code,422)

    def test_symlink_report_xyz_and_parent(self):
        for path in (self.path,self.study/'analyses/review.forward.xyz',self.study/'analyses',self.study):
            saved=path.with_name(path.name+'-saved');path.rename(saved);path.symlink_to(saved,target_is_directory=saved.is_dir())
            self.assertEqual(self.client.get(self.url).status_code,403)
            path.unlink();saved.rename(path)

    def test_path_escape_and_nonregular_file(self):
        for name in ('../outside.xyz','/outside.xyz','x/y.xyz','x\\y.xyz','..'):
            data=copy.deepcopy(self.original);data['directions']['forward']['path_geometry']['path']=name;self.save(data)
            self.assertIn(self.client.get(self.url).status_code,(400,422))
        self.save(self.original);path=self.study/'analyses/review.forward.xyz';path.unlink();path.mkdir()
        self.assertEqual(self.client.get(self.url).status_code,403)

    def test_file_and_frame_size_limits(self):
        for path,limit in ((self.path,MAX_MANIFEST),(self.study/'analyses/review.forward.xyz',MAX_XYZ)):
            self.save(self.original)
            with path.open('wb') as stream:stream.truncate(limit+1)
            self.assertEqual(self.client.get(self.url).status_code,413)
        data=copy.deepcopy(self.original);data['directions']['forward']['path_geometry']['frame_count']=1001;self.save(data)
        self.assertEqual(self.client.get(self.url).status_code,422)

    def test_three_final_structures_facts_and_atom_order(self):
        structures=self.client.get(self.url).json()['structures']
        for role,attempt,distance,energy,n_imag in [
            ('reverse','endpoint-reverse',1.5,-76.23456789,0),
            ('ts','synthetic-ts',1.25,-76.12345678,1),
            ('forward','endpoint-forward',1.0,-76.34567891,0)]:
            with self.subTest(role=role):
                s=structures[role];self.assertIsNone(s['error']);self.assertEqual(s['attempt'],attempt)
                self.assertEqual(s['energy_hartree'],energy);self.assertEqual(s['n_imag'],n_imag)
                self.assertEqual([a['center'] for a in s['geometry']['atoms']],[1,2,3])
                self.assertEqual(s['geometry']['atoms'][1]['x'],distance)

    def test_xyz_reference_does_not_guess_from_existing_attempt_names(self):
        data=copy.deepcopy(self.original)
        data['directions']['reverse']['criteria']['endpoint']={'status':'unknown','reasons':['XYZ reference']}
        data['inputs']=[r for r in data['inputs'] if not r['path'].startswith('attempts/endpoint-reverse/')]
        self.save(data)
        result=self.client.get(self.url).json()['structures']['reverse']
        self.assertIsNone(result['attempt']);self.assertIsNone(result['geometry']);self.assertIsNone(result['error'])

    def test_fallback_requires_unique_hash_bound_endpoint_of_relation(self):
        data=copy.deepcopy(self.original)
        data['directions']['forward']['criteria']['endpoint']={'status':'unknown','reasons':[]}
        self.save(data)
        self.assertEqual(self.client.get(self.url).json()['structures']['forward']['attempt'],'endpoint-forward')
        path='attempts/endpoint-forward/manifest.json'
        manifest=json.loads((self.study/path).read_text());manifest['parents']=[]
        (self.study/path).write_text(json.dumps(manifest));bind_source(self.study,data,path);self.save(data)
        self.assertIsNone(self.client.get(self.url).json()['structures']['forward']['attempt'])
        for attempt in ('endpoint-forward','endpoint-reverse'):
            path=f'attempts/{attempt}/manifest.json';manifest=json.loads((self.study/path).read_text())
            manifest['parents']=[dict(attempt_id='synthetic-forward',relation='endpoint_of')]
            (self.study/path).write_text(json.dumps(manifest));bind_source(self.study,data,path)
        self.save(data);s=self.client.get(self.url).json()['structures']['forward']
        self.assertIn('多个端点',s['error']);self.assertIsNone(s['geometry'])

    def test_changed_structure_sources_fail_only_that_card(self):
        for filename in ('manifest.json','facts.json','final.xyz'):
            path=self.study/'attempts/endpoint-forward'/filename;raw=path.read_bytes()
            with self.subTest(filename=filename):
                path.write_bytes(raw+b' ')
                response=self.client.get(self.url);self.assertEqual(response.status_code,200)
                result=response.json();s=result['structures']['forward']
                self.assertIn('SHA-256 mismatch',s['error']);self.assertIsNone(s['geometry']);self.assertIsNone(s['energy_hartree'])
                self.assertIsNotNone(result['structures']['ts']['geometry']);self.assertEqual(result['report'],self.original)
                self.assertEqual(len(self.client.get(self.base).json()['reports']),1)
            path.write_bytes(raw)

    def test_structure_manifest_identity_conflicting_references_and_atom_order(self):
        for filename,raw,expected in [
            ('manifest.json',json.dumps(dict(attempt_id='another-attempt')),'attempt_id'),
            ('final.xyz','3\nwrong order\nH 0 0 0\nO 1 0 0\nH 0 1 0\n','元素行序'),
            ('facts.json',json.dumps(dict(final_geometry='../outside.xyz')),'final.xyz')]:
            path=f'attempts/endpoint-forward/{filename}';original=(self.study/path).read_bytes()
            data=copy.deepcopy(self.original);(self.study/path).write_text(raw);bind_source(self.study,data,path);self.save(data)
            s=self.client.get(self.url).json()['structures']['forward'];self.assertIn(expected,s['error']);self.assertIsNone(s['geometry'])
            (self.study/path).write_bytes(original)
        data=copy.deepcopy(self.original);data['directions']['forward']['criteria']['endpoint']['manifest']['sha256']='0'*64;self.save(data)
        self.assertIn('引用冲突',self.client.get(self.url).json()['structures']['forward']['error'])
        data=copy.deepcopy(self.original);data['directions']['forward']['criteria']['endpoint']['facts'][0]['source']=data['directions']['reverse']['criteria']['endpoint']['facts'][0]['source'];self.save(data)
        self.assertIn('不同 Attempt',self.client.get(self.url).json()['structures']['forward']['error'])

    def test_structure_missing_values_remain_unknown(self):
        data=copy.deepcopy(self.original);path='attempts/endpoint-forward/facts.json'
        (self.study/path).write_text('{}');bind_source(self.study,data,path);self.save(data)
        s=self.client.get(self.url).json()['structures']['forward']
        self.assertIsNone(s['energy_hartree']);self.assertIsNone(s['n_imag']);self.assertIsNone(s['error']);self.assertIsNotNone(s['geometry'])

    def test_unreferenced_final_file_is_never_opened(self):
        data=copy.deepcopy(self.original);omitted='attempts/endpoint-forward/final.xyz'
        data['inputs']=[r for r in data['inputs'] if r['path']!=omitted];self.save(data)
        opened=[];read=Studies.read
        def tracked(store,parts,*args,**kwargs):
            opened.append('/'.join(parts[1:]));return read(store,parts,*args,**kwargs)
        with patch.object(Studies,'read',tracked):result=self.client.get(self.url).json()
        self.assertNotIn(omitted,opened)
        self.assertIsNone(result['structures']['forward']['geometry']);self.assertIn('未提供报告哈希',result['structures']['forward']['error'])
        allowed={r['path'] for r in data['inputs']}|{'analyses/review.json'}
        self.assertTrue(set(opened)<=allowed)

    def test_structure_symlinks_nonregular_oversize_and_malformed_are_card_errors(self):
        for name in ('manifest.json','facts.json','final.xyz','.'):
            path=self.study/'attempts/endpoint-forward'/name
            saved=path.with_name(path.name+'-saved');path.rename(saved);path.symlink_to(saved,target_is_directory=saved.is_dir())
            s=self.client.get(self.url).json()['structures']['forward'];self.assertIsNone(s['geometry']);self.assertIn('Unsafe',s['error'])
            path.unlink();saved.rename(path)
        path=self.study/'attempts/endpoint-forward/final.xyz';path.unlink();path.mkdir()
        self.assertRegex(self.client.get(self.url).json()['structures']['forward']['error'],'regular|Unsafe');path.rmdir()
        with path.open('wb') as stream:stream.truncate(MAX_MANIFEST+1)
        self.assertIn('size limit',self.client.get(self.url).json()['structures']['forward']['error'])
        data=copy.deepcopy(self.original);path.write_bytes(b'not xyz');bind_source(self.study,data,'attempts/endpoint-forward/final.xyz');self.save(data)
        self.assertIn('XYZ 格式错误',self.client.get(self.url).json()['structures']['forward']['error'])
