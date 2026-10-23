"""T118 local reading boundaries and JSON shapes, using invented data only."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError, decode_document
from tests.study_fixture import create_studies


class FilesViewTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.study = create_studies(self.root)
        self.area = self.study/'analyses'
        self.store = Studies(self.root)
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('localhost', 50000))
        self.url = '/api/studies/butane-demo/files/'

    def write(self, name, raw):
        path = self.area/name; path.parent.mkdir(exist_ok=True, parents=True)
        path.write_bytes(raw if isinstance(raw, bytes) else raw.encode())
        return path

    def test_json_shapes_are_values_and_only_syntax_errors_have_positions(self):
        for value in ([{'a': 1}, {'b': 2}], [1, 'x', None], {'nested': {}}, 42, 'x', True, None, []):
            with self.subTest(value=value):
                self.write('value.json', json.dumps(value))
                doc = self.client.get('/api/studies/butane-demo/reports/value.json').json()
                self.assertEqual(doc, dict(name='value.json', data=value, error=None, updated_at=doc['updated_at']))
                self.assertEqual(self.client.get(self.url+'analyses/value.json?document=true').json(), {'data': value, 'error': None})
                row = self.store.analysis_summary('butane-demo', ('value.json',))
                self.assertIsNone(row['error'])
        self.write('value.json', '{\n  "a": }')
        doc = self.client.get(self.url+'analyses/value.json?document=true').json()
        self.assertIn('解析失败：第 2 行第 8 列', doc['error'])
        self.assertIn('第 2 行第 8 列', self.store.analysis_summary('butane-demo', ('value.json',))['error'])
        self.write('bad.md', b'one\n\xe4\xb8\xad\xff')
        self.assertIn('第 2 行第 2 列', self.client.get(self.url+'analyses/bad.md?document=true').json()['error'])
        for text, column in [('NaN', 1), ('["NaN", NaN]', 9), ('[-Infinity]', 2)]:
            self.assertIn(f'第 1 行第 {column} 列', decode_document(text.encode(), True)['error'])
        self.assertIsNone(decode_document(b'1e400', True)['error'])

    def test_type_allowlist_size_and_bytes_without_mutation(self):
        for suffix in ('md', 'txt', 'csv', 'json', 'xyz', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'html'):
            path = self.write('sample.'+suffix, b'Synthetic bytes')
            before = (path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
            with patch('subprocess.Popen', side_effect=AssertionError('no process')):
                response = self.client.get(self.url+'analyses/'+path.name)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b'Synthetic bytes')
            self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
            self.assertEqual(before, (path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest()))
        for suffix, limit in [('txt', 4*1024*1024), ('html', 4*1024*1024), ('png', 10*1024*1024), ('svg', 10*1024*1024)]:
            path = self.write('large.'+suffix, b'')
            with path.open('wb') as stream: stream.truncate(limit+1)
            self.assertEqual(self.client.get(self.url+'analyses/'+path.name).status_code, 413)
        for suffix in ('log', 'chk', 'py', 'exe', 'pdf'):
            self.write('denied.'+suffix, 'DENIED')
            response = self.client.get(self.url+'analyses/denied.'+suffix)
            self.assertEqual(response.status_code, 400); self.assertNotIn('DENIED', response.text)

    def test_paths_symlinks_special_files_and_replacement_rejected(self):
        outside = self.root/'outside.txt'; outside.write_text('OUTSIDE_SENTINEL')
        (self.area/'linked.txt').symlink_to(outside)
        (self.study/'linked').symlink_to(self.root, target_is_directory=True)
        (self.root/'linked-study').symlink_to(self.study, target_is_directory=True)
        os.mkfifo(self.area/'pipe.txt')
        for path in ('../outside.txt', '/outside.txt', 'a//b.txt', 'a/./b.txt', 'a/../b.txt', 'a\\b.txt'):
            with self.assertRaises(StudyError): self.store.file('butane-demo', path)
        for path in ('analyses/linked.txt', 'linked/outside.txt', 'analyses/pipe.txt', 'analyses'):
            response = self.client.get(self.url+path)
            self.assertIn(response.status_code, (400,403)); self.assertNotIn('OUTSIDE_SENTINEL', response.text)
        self.assertEqual(self.client.get('/api/studies/linked-study/files/study.md').status_code,403)
        for path in ('%2e%2e/outside.txt','%2Foutside.txt','analyses/%2e%2e/study.md','analyses%5clinked.txt'):
            self.assertIn(self.client.get(self.url+path).status_code, (400,403,404))
        # Replace a checked directory just before open: descriptor traversal must
        # reject the new symlink rather than read an outside target.
        folder=self.study/'swap'; folder.mkdir(); (folder/'outside.txt').write_text('INSIDE')
        original=os.open
        def race(path, flags, *args, **kwargs):
            if path=='swap':
                folder.rename(self.study/'saved-swap'); folder.symlink_to(self.root, target_is_directory=True)
            return original(path, flags, *args, **kwargs)
        with patch('autog_frontend.studies.os.open', side_effect=race):
            with self.assertRaises(StudyError): self.store.file('butane-demo','swap/outside.txt')

    def test_csp_is_preserved_only_for_isolated_active_formats(self):
        policy="sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
        for name in ('unsafe.html','unsafe.svg'):
            self.write(name, '<script>parent.injected=true</script>')
            response=self.client.get(self.url+'analyses/'+name)
            self.assertEqual(response.headers['content-security-policy'],policy)
            self.assertEqual(response.headers['x-content-type-options'],'nosniff')
        self.write('plain.txt','safe')
        response=self.client.get(self.url+'analyses/plain.txt')
        self.assertIn("frame-ancestors 'none'",response.headers['content-security-policy'])
        self.assertIn("script-src 'self'",self.client.get('/api/studies').headers['content-security-policy'])
        for headers in ({'Origin':'https://example.org'},{'sec-fetch-site':'cross-site'}):
            self.assertEqual(self.client.get(self.url+'analyses/plain.txt',headers=headers).status_code,403)
        self.assertEqual(self.client.post(self.url+'analyses/plain.txt').status_code,405)

    def test_discovery_category_priority_no_filename_guesses_or_extra_depth(self):
        cases = {
            'formal-energy.json': ('{}', 'other', '按文件类型'),
            'declared.json': ('{"kind":"formal"}', 'formal', '按报告声明'),
            'schema.json': ('{"schema":"ag-ensemble/1","kind":"energy"}', 'ensemble', '按 schema'),
            'front.md': ('---\nkind: energy\n---\n# Saved', 'energy', '按报告声明'),
            'late.md': ('# Text\nkind: energy', 'other', '按文件类型'),
            'invalid.json': ('{"kind":[]}', 'other', '按文件类型'),
            'group/demo.png': (b'png', 'figure', '按文件类型'),
            'group/demo.jpg': (b'jpg', 'figure', '按文件类型'),
            'group/demo.webp': (b'webp', 'figure', '按文件类型'),
            'group/demo.svg': ('<svg/>', 'figure', '按文件类型'),
            'group/demo.html': ('<h1>HTML</h1>', 'figure', '按文件类型'),
        }
        for name,(raw,_,_) in cases.items(): self.write(name,raw)
        self.write('group/deeper/not-listed.md','# Hidden')
        reports={r['name']:r for r in self.store.study('butane-demo')['analyses']}
        for name,(_,kind,basis) in cases.items():
            self.assertEqual((reports[name]['kind'],reports[name]['category_basis']),(kind,basis))
            self.assertIsNone(reports[name]['data'])
        self.assertNotIn('group/deeper/not-listed.md',reports)
        self.write('large.json',json.dumps({'kind':'energy','padding':'x'*100000,'schema':'ag-thermo/1'}))
        self.assertEqual(self.store.analysis_summary('butane-demo',('large.json',))['kind'],'thermo')
