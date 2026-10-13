import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.geometry import MAX_ATOMS, xyz_frame
from autog_frontend.log_search import search_log, CHUNK_BYTES
from autog_frontend.studies import Studies, StudyError
from tests.study_fixture import ATOMS, create_preview_studies, gjf


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.study=create_preview_studies(self.root)
        self.store=Studies(self.root)
        self.client=TestClient(create_app(self.root),base_url='http://localhost',client=('127.0.0.1',51234))
        self.base='/api/studies/butane-demo'
        self.attempt=self.base+'/attempts/prepared'
        self.input=self.study/'attempts/prepared/inputs/butane.gjf'

    def test_gjf_metadata_xyz_and_manifest_hash(self):
        g=self.client.get(self.attempt).json()['input_geometry']['data']
        self.assertEqual((g['charge'],g['multiplicity'],g['n_atoms'],g['formula']),(0,1,14,'C4H10'))
        self.assertEqual((g['nprocshared'],g['mem'],g['route']),(8,'8GB','# HF/STO-3G Opt Freq'))
        self.assertEqual(len(g['atoms']),14);self.assertTrue(g['hash_matches'])
        response=self.client.get(self.base+'/attempts/xtb-prepared').json()['input_geometry']
        self.assertIsNone(response['error']);self.assertEqual(response['data']['formula'],'C4H10')
        self.assertIsNone(response['data']['route'])
        source=self.client.get(self.attempt+'/inputs/butane.gjf').json()
        self.assertEqual(source['text'],self.input.read_text())
        self.assertEqual(source['sha256'],hashlib.sha256(self.input.read_bytes()).hexdigest())

    def test_invalid_gjf_never_returns_500(self):
        cases=[gjf().replace('C -1.92 -0.2 0.0','C'),gjf()+'--Link1--\n'+gjf(),'',
               gjf().replace('C -1.92 -0.2 0.0','C NaN 0 0'),gjf().replace('8GB','11GB'),
               gjf().replace('%nprocshared=8','%nprocshared=4'),gjf().replace('butane.chk','../butane.chk'),
               gjf().replace('# HF/STO-3G Opt','# external=program'),gjf()+'B 1 2 F\n',
               gjf().replace('C -1.92 -0.2 0.0','999 0 0 0'),gjf().replace('C -1.92 -0.2 0.0','C 1e999 0 0')]
        for text in cases:
            self.input.write_text(text)
            response=self.client.get(self.attempt)
            self.assertEqual(response.status_code,200)
            preview=response.json()['input_geometry']
            self.assertIsNone(preview['data'],text)
            self.assertTrue(preview['error'].startswith('无法预览：'))
        self.input.write_bytes(b'\xff')
        self.assertTrue(self.client.get(self.attempt).json()['input_geometry']['error'].startswith('无法预览：'))

    def test_numeric_elements_and_resource_units_match_ag_grammar(self):
        self.input.write_text(gjf().replace('C ','6 ').replace('8GB','1000MB'))
        g=self.client.get(self.attempt).json()['input_geometry']['data']
        self.assertEqual(g['formula'],'C4H10');self.assertEqual(g['mem'],'1000MB')

    def test_input_and_parent_diff(self):
        uri=self.attempt+'/input-diff/butane.gjf?parent=anti&parent_file=butane.gjf'
        diff=self.client.get(uri).json()
        self.assertIn('-# HF/STO-3G Opt',diff['lines']);self.assertIn('+# HF/STO-3G Opt Freq',diff['lines'])
        self.assertFalse(diff['identical'])
        self.input.write_text(gjf())
        self.assertTrue(self.client.get(uri).json()['identical'])
        self.input.write_text(gjf().rstrip())
        self.assertFalse(self.client.get(uri).json()['identical'])
        self.assertEqual(self.client.get(uri.replace('parent=anti','parent=waiting')).status_code,400)
        self.assertEqual(self.client.get(uri.replace('parent=anti','parent=..')).status_code,400)

    def test_large_diff_is_bounded_and_input_text_is_not_truncated(self):
        self.input.write_text('current line\n'*3000)
        parent=self.study/'attempts/anti/inputs/butane.gjf'
        parent.write_text('parent line\n'*3000)
        diff=self.client.get(self.attempt+'/input-diff/butane.gjf?parent=anti&parent_file=butane.gjf').json()
        self.assertTrue(diff['truncated']);self.assertEqual(len(diff['lines']),2000)
        self.assertEqual(self.client.get(self.attempt+'/inputs/butane.gjf').json()['text'],self.input.read_text())

    def test_input_size_and_symlink_rejection(self):
        self.input.write_bytes(b'x'*(1024*1024+1))
        self.assertEqual(self.client.get(self.attempt+'/inputs/butane.gjf').status_code,413)
        self.assertIsNone(self.client.get(self.attempt).json()['input_geometry']['data'])
        self.input.unlink();self.input.symlink_to(self.study/'attempts/anti/inputs/butane.gjf')
        self.assertEqual(self.client.get(self.attempt+'/inputs/butane.gjf').status_code,403)
        self.assertIsNone(self.client.get(self.attempt).json()['input_geometry']['data'])
        parent=self.study/'attempts/anti/inputs/butane.gjf';parent.unlink();parent.symlink_to(self.study/'study.md')
        self.assertEqual(self.client.get(self.attempt+'/input-diff/butane.gjf?parent=anti&parent_file=butane.gjf').status_code,403)
        self.input.unlink();self.input.parent.rmdir();self.input.parent.symlink_to(self.study/'attempts/anti/inputs',target_is_directory=True)
        self.assertIsNone(self.client.get(self.attempt).json()['input_geometry']['data'])

    def test_multiframe_inventory_comments_and_single_frame_response(self):
        data=self.client.get(self.base).json()
        self.assertIn({'parts':['structures','butane','conformers.xyz'],'error':None},data['structure_files'])
        self.assertFalse(any(a['name'].endswith('.xyz') for a in data['analyses']))
        for frame,energy in [(0,-1.25),(2,-.95)]:
            response=self.client.get(self.base+f'/structures/butane/conformers.xyz?frame={frame}').json()
            self.assertEqual(response['frame_count'],3)
            self.assertEqual(len(response['geometry']['atoms']),14)
            self.assertIn(str(energy),response['comment']);self.assertNotIn('frames',response)
        self.assertEqual(self.client.get(self.base+'/analyses/representatives.xyz?frame=1').json()['frame_count'],2)
        self.assertEqual(self.client.get(self.base+'/structures/butane/conformers.xyz?frame=3').status_code,422)

    def test_frame_limits_corruption_and_symlinks(self):
        target=self.study/'structures/butane/conformers.xyz'
        for text in ['1\nsynthetic\nC 0 0 0\n'*5001,f'{MAX_ATOMS+1}\nsynthetic\n','14\ntruncated\nC 0 0 0\n','1\ninvalid\nC NaN 0 0\n']:
            target.write_text(text)
            self.assertEqual(self.client.get(self.base+'/structures/butane/conformers.xyz').status_code,422)
        with target.open('wb') as f:f.truncate(32*1024*1024+1)
        self.assertEqual(self.client.get(self.base+'/structures/butane/conformers.xyz').status_code,413)
        target.unlink();target.symlink_to(self.study/'analyses/representatives.xyz')
        self.assertEqual(self.client.get(self.base+'/structures/butane/conformers.xyz').status_code,403)

    def test_search_last_terminations_and_bounds(self):
        uri=self.base+'/attempts/anti/log-search/butane.log'
        raw=(self.study/'attempts/anti/outputs/butane.log').read_text().splitlines()
        for query in ['Normal termination','Error termination']:
            response=self.client.get(uri,params={'query':query,'last':'true'}).json()
            self.assertEqual(response['line'],max(i for i,s in enumerate(raw) if query in s))
            self.assertNotIn('text',response)
        self.assertIsNone(self.client.get(uri,params={'query':'absent'}).json()['line'])
        first=self.client.get(uri,params={'query':'Error termination'}).json()['line']
        second=self.client.get(uri,params={'query':'Error termination','start':first+1}).json()['line']
        self.assertGreater(second,first)
        with (self.study/'attempts/anti/outputs/large.log').open('wb') as f:f.truncate(32*1024*1024+1)
        self.assertEqual(self.client.get(uri.replace('butane.log','large.log'),params={'query':'x'}).status_code,413)

    def test_chunk_boundary_utf8_and_crlf_search(self):
        raw=b'x'*(CHUNK_BYTES-3)+'分块关键词'.encode()+b'\r\nNormal termination\r\nError termination'
        self.assertEqual(search_log(io.BytesIO(raw),'分块关键词')['line'],0)
        self.assertEqual(search_log(io.BytesIO(raw),'Error termination',last=True)['line'],2)
        self.assertEqual(search_log(io.BytesIO(raw),'Normal termination')['total_lines'],3)

    def test_new_routes_stay_readonly_and_leave_files_unchanged(self):
        def snapshot():
            return {str(p.relative_to(self.root)):(p.stat().st_mtime_ns,hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None) for p in self.root.rglob('*')}
        before=snapshot()
        routes=[self.attempt,self.attempt+'/inputs/butane.gjf',self.attempt+'/input-diff/butane.gjf?parent=anti&parent_file=butane.gjf',self.base+'/structures/butane/conformers.xyz',self.base+'/analyses/representatives.xyz',self.base+'/attempts/anti/log-search/butane.log?query=Normal']
        for route in routes:
            self.assertEqual(self.client.get(route).status_code,200)
            self.assertEqual(self.client.post(route).status_code,405)
            self.assertEqual(self.client.get(route,headers={'origin':'https://untrusted.invalid'}).status_code,403)
        self.assertEqual(snapshot(),before)
