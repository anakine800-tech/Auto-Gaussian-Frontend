import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient

from autog_frontend.api import create_app
from autog_frontend.ensembles import xyz_frames, validate, load_json
from autog_frontend.studies import StudyError
from tests.ensemble_fixture import create_ensemble_study, make_ensemble, make_descriptor_ensemble


class EnsembleTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name).resolve();self.study=create_ensemble_study(self.root)
        self.client=TestClient(create_app(self.root),base_url='http://localhost',client=('127.0.0.1',51234))
        self.base='/api/studies/ensemble-demo'
        self.url=self.base+'/ensembles/ensemble.json'
        self.manifest=self.study/'analyses/ensemble.json'
        self.xyz=self.study/'analyses/frames.xyz'
        self.original=json.loads(self.manifest.read_text())

    def save(self, data):
        self.manifest.write_text(json.dumps(data))

    def test_read_listing_nested_and_unchanged(self):
        before={p:(p.read_bytes(),p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        listing=self.client.get(self.base+'/ensembles').json()
        self.assertEqual(len(listing['ensembles']),3);self.assertEqual(listing['issues'],[])
        response=self.client.get(self.url);self.assertEqual(response.status_code,200)
        data=response.json();self.assertEqual(len(data['frames']),3)
        self.assertEqual(data['manifest'],self.original)
        self.assertEqual(data['frames'][0]['geometry']['atoms'][0]['atomic_number'],8)
        nested=self.client.get(self.base+'/ensembles/routes/separate.json').json()
        self.assertTrue(all(c['xtb_relative_kcal'] is None for c in nested['manifest']['candidates']))
        after={p:(p.read_bytes(),p.stat().st_mtime_ns) for p in self.study.rglob('*') if p.is_file()}
        self.assertEqual(before,after)
        self.assertEqual(self.client.post(self.url).status_code,405)

    def test_schema_required_fields_and_malformed_types(self):
        cases=[]
        bad=copy.deepcopy(self.original);bad['schema']='wrong';cases.append(bad)
        for key in self.original:
            bad=copy.deepcopy(self.original);del bad[key];cases.append(bad)
        for key in self.original['candidates'][0]:
            bad=copy.deepcopy(self.original);del bad['candidates'][0][key];cases.append(bad)
        for key in ['candidates','routes','references','inputs','warnings','unmatched_attempts']:
            bad=copy.deepcopy(self.original);bad[key]=42;cases.append(bad)
        for bad in cases:
            with self.subTest(bad=bad):
                self.save(bad);self.assertEqual(self.client.get(self.url).status_code,422)

    def test_nonfinite_json_and_xyz(self):
        for value in [float('nan'),float('inf'),float('-inf'),10**400]:
            bad=copy.deepcopy(self.original);bad['candidates'][0]['xtb_relative_kcal']=value
            self.save(bad);self.assertEqual(self.client.get(self.url).status_code,422)
        self.manifest.write_text(self.manifest.read_text().replace('-Infinity','1e999'))
        self.assertEqual(self.client.get(self.url).status_code,422)
        for value in ['nan','inf','1e999']:
            with self.assertRaises(StudyError):xyz_frames(f'1\ncomment\nH {value} 0 0\n'.encode())

    def test_hashes_and_frame_bounds_fail_without_geometry(self):
        for field in ['xyz','geometry','frame']:
            bad=copy.deepcopy(self.original)
            if field=='xyz':bad['inputs']['xyz']['sha256']='0'*64
            elif field=='geometry':bad['candidates'][1]['geometry_sha256']='0'*64
            else:bad['candidates'][0]['xyz_frame']=4
            self.save(bad);r=self.client.get(self.url)
            self.assertEqual(r.status_code,422);self.assertNotIn('frames',r.json())
            self.assertIn('mismatch' if field!='frame' else 'out of range',r.json()['detail'])

    def test_limits(self):
        with self.manifest.open('wb') as f:f.truncate(4*1024*1024+1)
        self.assertEqual(self.client.get(self.url).status_code,413)
        self.save(self.original)
        with self.xyz.open('wb') as f:f.truncate(32*1024*1024+1)
        self.assertEqual(self.client.get(self.url).status_code,413)
        for raw in [b'1\nframe\nH 0 0 0\n'*1001,b'501\nframe\n'+b'H 0 0 0\n'*501]:
            self.xyz.write_bytes(raw);bad=copy.deepcopy(self.original);bad['inputs']['xyz']['sha256']=hashlib.sha256(raw).hexdigest();self.save(bad)
            self.assertEqual(self.client.get(self.url).status_code,413)
        self.assertEqual(len(xyz_frames(b'1\nframe\nH 0 0 0\n'*1000)),1000)
        self.assertEqual(len(xyz_frames(b'500\nframe\n'+b'H 0 0 0\n'*500)[0]['geometry']['atoms']),500)

    def test_symlinks_at_every_level(self):
        for target,url in [(self.xyz,self.url),(self.manifest,self.url),(self.study/'analyses/routes',self.base+'/ensembles/routes/separate.json'),(self.study/'analyses',self.url)]:
            saved=target.with_name(target.name+'-saved');target.rename(saved);target.symlink_to(saved,target_is_directory=saved.is_dir())
            self.assertEqual(self.client.get(url).status_code,403)
            target.unlink();saved.rename(target)

    def test_filename_only_and_unfollowed_provenance(self):
        for name in ['../frames.xyz','sub/frames.xyz','a..xyz','..','x\\frames.xyz','/frames.xyz']:
            bad=copy.deepcopy(self.original);bad['inputs']['xyz']['file']=name;self.save(bad)
            self.assertIn(self.client.get(self.url).status_code,[400,422])
        bad=copy.deepcopy(self.original)
        for ref in bad['inputs'].values():ref['path']='never/open/this'
        self.save(bad);self.assertEqual(self.client.get(self.url).status_code,200)
        deep=self.study/'analyses/routes/deep';deep.mkdir();(deep/'ignored.json').write_text(json.dumps(self.original))
        self.assertEqual(len(self.client.get(self.base+'/ensembles').json()['ensembles']),3)

    def test_crest_outputs_and_energy(self):
        prefix=self.base+'/attempts/crest-demo/crest-frames/'
        for name in ['crest_conformers.xyz','crest_best.xyz','crest_ensemble.xyz']:
            data=self.client.get(prefix+name+'?frame=1').json()
            self.assertEqual(data['frame_count'],3);self.assertEqual(data['frame'],1)
            self.assertEqual(data['frames'][0]['energy_hartree'],-76.)
            self.assertAlmostEqual(data['frames'][1]['relative_kcal'],.6275094740631)
            self.assertIsNone(data['frames'][2]['energy_hartree']);self.assertIsNone(data['frames'][2]['relative_kcal'])
        self.assertEqual(self.client.get(prefix+'unlisted.xyz').status_code,422)
        self.assertEqual(self.client.get(prefix.replace('crest-demo','gaussian-demo')+'crest_best.xyz').status_code,422)
        self.assertEqual(self.client.get(prefix+'crest_best.xyz?frame=99').status_code,422)
        path=self.study/'attempts/crest-demo/outputs/crest_best.xyz'
        path.unlink();(path.parent.parent/'crest_best.xyz').write_bytes(make_ensemble()[1])
        self.assertEqual(self.client.get(prefix+'crest_best.xyz').status_code,404)
        path.symlink_to(path.parent.parent/'crest_best.xyz')
        self.assertEqual(self.client.get(prefix+'crest_best.xyz').status_code,403)

    def test_crlf_hash_and_damaged_later_frame(self):
        raw=b'1\r\ncomment\r\nH 0 0 0\r\n'
        self.assertEqual(xyz_frames(raw)[0]['geometry_sha256'],hashlib.sha256(b'H 0 0 0\r\n').hexdigest())
        for raw in [b'1\n', b'1\ncomment\n',b'1\ncomment\nH 0 0 0\n2\nbroken\nH 0 0 0\n']:
            with self.assertRaises(StudyError):xyz_frames(raw)


class DescriptorTests(unittest.TestCase):
    def test_t70_generated_payload_and_geometry(self):
        data, raw = make_descriptor_ensemble()
        self.assertEqual(validate(copy.deepcopy(data)), data)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), data['inputs']['xyz']['sha256'])
        frames = xyz_frames(raw)
        for row in data['candidates']:
            self.assertEqual(frames[row['xyz_frame']-1]['geometry_sha256'], row['geometry_sha256'])
        self.assertEqual([r['lowest_candidate'] for r in data['bin_summary']], [60,30,50])

    def test_optional_errors_preserve_base_data_and_report_location(self):
        original, _ = make_descriptor_ensemble()
        cases = [
            (('descriptors',), None),
            (('descriptors','dihedral_bins'), {}),
            (('descriptors','dihedral_bins',0,'names'), ['cis']),
            (('descriptors','dihedral_bins',0,'boundaries'), [-112, float('nan'),132]),
            (('descriptors','distance_pairs',0), [True, 4]),
            (('candidates',0,'local'), None),
            (('candidates',0,'local','bins'), ['unknown']),
            (('candidates',0,'local','dihedrals'), []),
            (('candidates',0,'local','near_boundary'), 1),
            (('candidates',0,'local','distances'), [float('inf'), 2]),
            (('candidates',0,'local','distances'), [float('-inf'), 2]),
            (('candidates',0,'local','distances'), [10**400, 2]),
            (('bin_summary',), {}),
            (('bin_summary',0,'count'), 1.5),
            (('bin_summary',0,'bins'), []),
            (('bin_summary',0,'lowest_candidate'), 1),
            (('bin_summary',0,'lowest_candidate'), 30),
            (('bin_summary',0,'lowest_layer'), 'unknown'),
        ]
        for path, value in cases:
            with self.subTest(path=path,value=value):
                bad = copy.deepcopy(original)
                target = bad
                for key in path[:-1]: target = target[key]
                target[path[-1]] = value
                result = validate(load_json(json.dumps(bad).encode()))
                self.assertIn('descriptor_error', result)
                self.assertIn(str(path[0]) if path[0] != 'candidates' else 'candidate 10', result['descriptor_error'])
                self.assertNotIn('descriptors', result)
                self.assertNotIn('bin_summary', result)
                for old, new in zip(original['candidates'],result['candidates']):
                    self.assertEqual(new, {k:v for k,v in old.items() if k != 'local'})
                json.dumps(result, allow_nan=False)

    def test_missing_fields_and_distance_only(self):
        original, _ = make_descriptor_ensemble()
        for key in ('descriptors','bin_summary'):
            data=copy.deepcopy(original);del data[key]
            result=validate(data)
            self.assertEqual('descriptor_error' in result,key=='descriptors')
        data=copy.deepcopy(original);del data['candidates'][0]['local']
        self.assertIn('candidate 10.local',validate(data)['descriptor_error'])
        data=copy.deepcopy(original)
        data['descriptors']['dihedral_bins']=[]
        for row in data['candidates']:
            row['local'].update(dihedrals=[],bins=[],near_boundary=False)
        data['bin_summary']=[dict(bins=[],count=6,lowest_candidate=None,lowest_layer=None)]
        self.assertEqual(validate(copy.deepcopy(data)),data)
        # T70 accepts a single periodic bin and an endpoint of +180.
        data=copy.deepcopy(original)
        data['descriptors']['dihedral_bins'][0].update(boundaries=[180],names=['all'])
        for row in data['candidates']: row['local']['bins']=['all']
        data['bin_summary']=[dict(bins=['all'],count=6,lowest_candidate=60,lowest_layer='sp')]
        self.assertEqual(validate(copy.deepcopy(data)),data)

    def test_api_isolates_nonfinite_optional_data_but_not_existing_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();create_ensemble_study(root)
            client=TestClient(create_app(root),base_url='http://localhost',client=('127.0.0.1',51234))
            base='/api/studies/descriptor-demo/ensembles'
            self.assertEqual(len(client.get(base).json()['ensembles']),2)
            good=client.get(base+'/ensemble.json');self.assertEqual(good.status_code,200)
            bad=client.get(base+'/invalid.json');self.assertEqual(bad.status_code,200)
            self.assertEqual(good.json()['frames'],bad.json()['frames'])
            self.assertIn('descriptor_error',bad.json()['manifest'])
            path=root/'descriptor-demo/analyses/invalid.json'
            data=json.loads(path.read_text());data['candidates'][0]['xtb_relative_kcal']=float('inf')
            path.write_text(json.dumps(data))
            self.assertEqual(client.get(base+'/invalid.json').status_code,422)
