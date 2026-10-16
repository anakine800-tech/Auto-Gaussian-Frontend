import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient

from autog_frontend.api import create_app
from autog_frontend.ensembles import xyz_frames
from autog_frontend.studies import StudyError
from tests.ensemble_fixture import create_ensemble_study, make_ensemble


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
