import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError
from autog_frontend.geometry import parse_xyz
from autog_frontend.vibrations import parse_log_modes
from tests.study_fixture import create_studies, gaussian_log


class StudyViewerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.studies=self.root/'studies'; self.study=create_studies(self.studies)
        self.client=TestClient(create_app(self.studies), base_url='http://localhost', client=('127.0.0.1', 50123))
        self.base='/api/studies/butane-demo'

    def snapshot(self):
        return {str(p.relative_to(self.studies)):(p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None) for p in self.studies.rglob('*')}

    def test_container_directories_are_neither_studies_nor_issues(self):
        for name in ('_archive', '.ag-monitor', '_container-with-study'):
            path = self.studies / name
            path.mkdir()
            if name == '_container-with-study':
                (path / 'study.md').write_text('# Container, not a study\n')
        (self.studies / '_linked-container').symlink_to(self.study, target_is_directory=True)
        (self.studies / 'broken-study').mkdir()
        result = self.client.get('/api/studies').json()
        self.assertEqual([s['id'] for s in result['studies']], ['butane-demo'])
        self.assertEqual([issue['path'] for issue in result['issues']], ['broken-study'])

    def test_all_reads_are_immutable_and_have_no_process_or_package_dependency(self):
        before=self.snapshot()
        with patch('subprocess.Popen', side_effect=AssertionError('unexpected process')):
            urls=['/api/studies',self.base,self.base+'/attempts/anti',self.base+'/attempts/waiting',self.base+'/attempts/anti/logs/butane.log?start=120&limit=120',self.base+'/attempts/anti/vibrations/butane.log']
            for url in urls:
                with self.subTest(url=url):
                    response=self.client.get(url);self.assertEqual(response.status_code,200,response.text)
                    self.assertNotIn(str(self.root),response.text)
                    self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(self.snapshot(),before)
        import sys
        self.assertFalse(any(m=='auto_g16' or m.startswith('auto_g16.') for m in sys.modules))

    def test_study_graph_and_saved_thermochemistry(self):
        data=self.client.get(self.base).json()
        self.assertEqual(len(data['attempts']),3)
        self.assertIn({'parent':'anti','child':'gauche','relation':'conformer_of'},data['graph']['edges'])
        self.assertIn({'id':'missing-seed','state':'missing','missing':True},data['graph']['nodes'])
        thermo=self.client.get(self.base+'/reports/thermo-demo.json').json()['data']
        self.assertEqual([r['degeneracy'] for r in thermo['rows']],[1,2])
        self.assertAlmostEqual(sum(r['population'] for r in thermo['rows']),1)
        self.assertIn('ensemble_G',thermo)
        self.assertEqual(self.client.get(self.base+'/attempts/waiting').json()['status']['data']['state'],'unknown')

    def test_log_pages_reconstruct_exact_text(self):
        uri=self.base+'/attempts/anti/logs/butane.log'
        text='';start=0
        while True:
            page=self.client.get(uri+f'?start={start}&limit=120').json();text+=page['text'];start+=120
            if start>=page['total_lines']:break
        self.assertEqual(text,gaussian_log())
        self.assertEqual(self.client.get(uri+'?start=-1').status_code,422)
        self.assertEqual(self.client.get(uri+'?limit=501').status_code,422)
        self.assertEqual(self.client.get(uri+'?start=99999').json()['text'],'')
        path=self.study/'attempts/anti/outputs/empty.out';path.write_bytes(b'')
        self.assertEqual(self.client.get(uri.replace('butane.log','empty.out')).json()['total_lines'],0)

    def test_missing_and_malformed_documents_are_explicit(self):
        (self.study/'attempts/anti/facts.json').write_text('{bad')
        (self.study/'attempts/anti/status.json').write_text('{"state": NaN}')
        (self.study/'attempts/anti/final.xyz').write_text('')
        response=self.client.get(self.base+'/attempts/anti')
        self.assertEqual(response.status_code,200,response.text)
        data=response.json()
        for key in ('facts','status','geometry'):self.assertIsNone(data[key]['data']);self.assertTrue(data[key]['error'])
        self.assertEqual(self.client.get('/api/studies/missing').status_code,404)

    def test_invalid_summary_types_and_overflowing_json_do_not_break_reads(self):
        (self.study/'attempts/anti/manifest.json').write_text('{"label": {}, "template": [], "parents": 1}')
        (self.study/'attempts/anti/status.json').write_text('{"state": {}}')
        (self.study/'analyses/overflow.json').write_text('{"value": 1e400}')
        response=self.client.get(self.base)
        self.assertEqual(response.status_code,200)
        data=response.json()
        self.assertEqual(data['attempts'][0]['state'],'unavailable')
        self.assertTrue(data['issues'])
        self.assertIsNone(next(a for a in data['analyses'] if a['name']=='overflow.json')['data'])

    def test_symlinks_in_every_read_surface_are_not_followed(self):
        outside=self.root/'outside';outside.mkdir();(outside/'secret.log').write_text('PRIVATE')
        (self.studies/'escape').symlink_to(outside,target_is_directory=True)
        self.assertTrue(self.client.get('/api/studies').json()['issues'])
        self.assertEqual(self.client.get('/api/studies/escape').status_code,403)
        for rel in ['study.md','attempts/anti/manifest.json','attempts/anti/status.json','attempts/anti/facts.json','attempts/anti/review.md','attempts/anti/final.xyz','analyses/thermo-demo.json']:
            path=self.study/rel;original=path.read_bytes();path.unlink();path.symlink_to(outside/'secret.log')
            response=self.client.get(self.base if rel=='study.md' or rel.startswith('analyses') else self.base+'/attempts/anti')
            self.assertNotIn('PRIVATE',response.text);self.assertIn('error',response.text)
            path.unlink();path.write_bytes(original)
        (self.study/'attempts/anti/outputs/escape.log').symlink_to(outside/'secret.log')
        for suffix in ['logs/escape.log','vibrations/escape.log']:
            self.assertEqual(self.client.get(self.base+'/attempts/anti/'+suffix).status_code,403)
        (self.study/'attempts/linked').symlink_to(outside,target_is_directory=True)
        self.assertEqual(self.client.get(self.base+'/attempts/linked').status_code,403)
        root_link=self.root/'root-link';root_link.symlink_to(self.studies,target_is_directory=True)
        with self.assertRaises(StudyError):Studies(root_link)
        # Internal links are rejected too, so there is no alias-dependent escape.
        (self.study/'attempts/anti/outputs/internal.log').symlink_to('butane.log')
        self.assertEqual(self.client.get(self.base+'/attempts/anti/logs/internal.log').status_code,403)

    def test_directory_swap_to_symlink_cannot_escape(self):
        store=Studies(self.studies);original=os.open;swapped=False
        outside=self.root/'outside';outside.mkdir();(outside/'study.md').write_text('PRIVATE')
        def race(path,*args,**kwargs):
            nonlocal swapped
            if path=='butane-demo' and not swapped:
                self.study.rename(self.studies/'original');self.study.symlink_to(outside,target_is_directory=True);swapped=True
            return original(path,*args,**kwargs)
        with patch('os.open',side_effect=race):
            with self.assertRaises(StudyError):store.study('butane-demo')

    def test_paths_writes_cross_origin_and_remote_clients_rejected(self):
        store=Studies(self.studies)
        for name in ['..','a/b','a\\b','\x00','/absolute']:
            with self.assertRaises(StudyError):store.attempt('butane-demo',name)
        for method in ('post','put','patch','delete'):
            self.assertEqual(getattr(self.client,method)(self.base).status_code,405)
        for uri in ['/api/tasks','/api/queue','/api/submit','/api/cancel','/api/projects','/api/import']:
            self.assertEqual(self.client.get(uri).status_code,404)
        self.assertEqual(self.client.get('/api/monitor').json()['clusters'][0]['error'],
                         '监控未运行或尚无快照：请启动常驻监控（ag monitor --watch 30）')
        for headers in [{'host':'untrusted.invalid'}, {'origin':'https://untrusted.invalid'}, {'sec-fetch-site':'cross-site'}]:
            self.assertEqual(self.client.get('/api/studies',headers=headers).status_code,403)
        remote=TestClient(create_app(self.studies),base_url='http://localhost',client=('remote.invalid',1234))
        self.assertEqual(remote.get('/api/studies').status_code,403)

    def test_nonregular_and_oversized_files_fail_without_blocking(self):
        outputs=self.study/'attempts/anti/outputs'
        os.mkfifo(outputs/'fifo.log')
        self.assertEqual(self.client.get(self.base+'/attempts/anti/logs/fifo.log').status_code,403)
        (outputs/'long.log').write_bytes(b'x'*(1024*1024+1))
        self.assertEqual(self.client.get(self.base+'/attempts/anti/logs/long.log').status_code,413)


class VibrationTests(unittest.TestCase):
    def test_decode_exact_vectors_and_frequency_order(self):
        raw=gaussian_log().encode();m=parse_log_modes(raw,'butane.log')
        self.assertEqual([v['frequency_cm1'] for v in m['modes']],[-42,120,300])
        self.assertEqual(m['modes'][1]['displacements'][1]['dy'],1)
        self.assertEqual(len(m['reference_geometry']['atoms']),14)
        self.assertEqual(m['result_source']['artifact']['sha256'],hashlib.sha256(raw).hexdigest())

    def test_truncated_nonfinite_wrong_atom_and_ambiguous_modes_fail(self):
        raw=gaussian_log().encode()
        for altered in [raw.replace(b' 14 1 0.00',b' 15 1 0.00'),raw.replace(b'1.00',b'NaN',1),raw.split(b' Atom AN')[0],raw.replace(b' Harmonic frequencies',b'--Link1--\n Harmonic frequencies'),raw.replace(b' Harmonic frequencies',b' Harmonic frequencies (cm**-1)\n Harmonic frequencies'),raw.replace(b' 14 1 0.00',b' 14 6 0.00')]:
            with self.subTest(altered=altered[:80]):
                with self.assertRaises((ValueError,IndexError)):parse_log_modes(altered,'butane.log')

    def test_xyz_empty_and_bad_numbers(self):
        for raw in ['', '1\ninvalid\nC NaN 0 0\n','2\ninvalid\nC 0 0 0\n']:
            with self.assertRaises(ValueError):parse_xyz(raw)
