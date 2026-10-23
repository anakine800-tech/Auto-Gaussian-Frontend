"""T122: synthetic local files, reference boundaries, limits and cache races."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.studies import Studies, StudyError, markdown_local_links


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve(); self.study = self.root/'water-demo'; self.study.mkdir()
        self.write('study.md', '# Synthetic water study')
        self.write('analyses/report.md', '[data](data.csv) [data again](./data.csv#row)\n![figure](figure.svg)\n[review](../attempts/a/review.md)')
        self.write('analyses/data.csv', 'value\n1\n'); self.write('analyses/figure.svg', '<svg/>')
        self.write('attempts/a/review.md', '[not a reference](../../analyses/data.csv)')
        self.write('attempts/a/inputs/job.gjf', 'SYNTHETIC INPUT')
        self.write('attempts/a/outputs/job.log', 'SYNTHETIC LOG')
        self.write('structures/water/final.xyz', '3\nsynthetic\nO 0 0 0\nH 1 0 0\nH 0 1 0\n')
        self.write('signoffs/result.json', '{}')
        self.write('analyses/review-manifest-synthetic.json', '{}')
        self.store = Studies(self.root)
        self.client = TestClient(create_app(self.root), base_url='http://localhost', client=('localhost',50000))

    def write(self, path, data):
        dest = self.study/path; dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(data, encoding='utf-8'); return dest

    def catalog(self):
        raw = '{"synthetic":true}\n'
        self.write('catalog/journal.jsonl', raw)
        state = {'schema':'ag-catalog-state/1','journal_sha256':hashlib.sha256(raw.encode()).hexdigest(),
                 'objects':[{'id':'water-a','name':'Water A','status':'adopted','members':[{'attempt':'a','role':'opt'}],
                             'adopted':{'opt':{'attempt':'a','report':'report.md'}},'values':{}}]}
        self.write('catalog/state.json', json.dumps(state)); return state

    def test_file_inventory_types_associations_and_exact_reference_sources(self):
        self.catalog()
        self.write('analyses/ignored.json', '{"report":"data.csv"}')
        self.write('analyses/ignored.html', '<a href="data.csv">x</a>')
        before={p.relative_to(self.study).as_posix():(p.stat().st_mtime_ns,p.read_bytes()) for p in self.study.rglob('*') if p.is_file()}
        with patch('subprocess.Popen',side_effect=AssertionError('read-only')):
            response=self.client.get('/api/studies/water-demo/evidence')
        self.assertEqual(response.status_code,200)
        result=response.json(); rows={f['path']:f for f in result['files']}
        self.assertEqual(len(rows),len(result['files'])); self.assertFalse(result['truncated'])
        self.assertEqual(rows['analyses/data.csv']['referenced_by'],[{'kind':'markdown','path':'analyses/report.md'}])
        self.assertEqual(rows['analyses/report.md']['referenced_by'],[{'kind':'adoption','object':'water-a','role':'opt'}])
        self.assertEqual(rows['analyses/report.md']['objects'],['water-a'])
        self.assertEqual(rows['attempts/a/review.md']['objects'],['water-a'])
        self.assertEqual(rows['attempts/a/review.md']['type'],'review')
        self.assertEqual(rows['attempts/a/inputs/job.gjf']['type'],'input-log')
        self.assertEqual(rows['signoffs/result.json']['type'],'signature')
        self.assertEqual(rows['analyses/review-manifest-synthetic.json']['type'],'signature')
        self.assertEqual(rows['structures/water/final.xyz']['type'],'structure')
        self.assertEqual(before,{p.relative_to(self.study).as_posix():(p.stat().st_mtime_ns,p.read_bytes()) for p in self.study.rglob('*') if p.is_file()})
        self.assertEqual(self.client.post('/api/studies/water-demo/evidence').status_code,405)

    def test_markdown_parser_local_relative_links_only(self):
        text='''[inline](a.csv "title") ![image](<a b.png>) [nested](plot(1).png)
[reference][r] [shortcut] [collapsed][]
[r]: ../attempts/a/review.md
[shortcut]: ./a.csv
[collapsed]: b.csv
[external](https://example.org/a.csv) [escape](../../outside.csv)
[absolute](/outside.csv) [encoded](%2Foutside.csv) [backslash](..%5Coutside.csv)
`[code](code.csv)`
```md
[fence](fence.csv)
```
    [indented](indented.csv)
<!-- [comment](comment.csv) -->
<a href="html.csv">not Markdown</a>
'''
        self.assertEqual(set(markdown_local_links(text,'analyses/report.md')),{'analyses/a.csv','analyses/a b.png','analyses/plot(1).png','attempts/a/review.md','analyses/b.csv'})

    def test_reference_cache_invalidation_and_path_recheck(self):
        self.store.evidence('water-demo')
        with patch('autog_frontend.studies.markdown_local_links',side_effect=AssertionError('cache hit')):
            self.store.evidence('water-demo')
        path=self.study/'analyses/report.md'; info=path.stat()
        path.write_text('[new](figure.svg)'); os.utime(path,ns=(info.st_atime_ns,info.st_mtime_ns))
        rows={f['path']:f for f in self.store.evidence('water-demo')['files']}
        self.assertEqual(rows['analyses/data.csv']['referenced_by'],[])
        self.assertEqual(len(rows['analyses/figure.svg']['referenced_by']),1)
        # Same size and mtime, new inode: cached references must be discarded.
        replacement=self.write('analyses/replacement.md','[new](otherX.csv)')
        path.unlink(); replacement.rename(path); os.utime(path,ns=(info.st_atime_ns,info.st_mtime_ns))
        self.assertNotIn('analyses/figure.svg', self.store.evidence_links('water-demo','analyses/report.md',[1000]))
        path.unlink(); path.symlink_to(self.root/'outside.md')
        with self.assertRaises(StudyError): self.store.evidence_links('water-demo','analyses/report.md',[1000])

    def test_no_symlinks_special_files_traversal_or_unbounded_walk(self):
        (self.root/'outside.md').write_text('OUTSIDE_SENTINEL')
        (self.study/'linked.md').symlink_to(self.root/'outside.md')
        (self.study/'directory').symlink_to(self.root,target_is_directory=True)
        os.mkfifo(self.study/'pipe.txt')
        result=self.store.evidence('water-demo')
        self.assertEqual(len(result['issues']),3)
        self.assertNotIn('OUTSIDE_SENTINEL',json.dumps(result))
        for study in ('..','a/../water-demo','a\\b',''):
            with self.assertRaises(StudyError): self.store.evidence(study)
        (self.root/'linked-study').symlink_to(self.study,target_is_directory=True)
        with self.assertRaises(StudyError): self.store.evidence('linked-study')
        with patch('autog_frontend.studies.EVIDENCE_ENTRY_LIMIT',3):
            result=self.store.evidence('water-demo'); self.assertTrue(result['truncated']); self.assertLessEqual(len(result['files']),3)
        with patch('autog_frontend.studies.EVIDENCE_DEPTH_LIMIT',1):
            self.assertTrue(self.store.evidence('water-demo')['truncated'])
        store=Studies(self.root)
        with patch('autog_frontend.studies.EVIDENCE_REFERENCE_BYTES',1):
            self.assertTrue(any('读取量上限' in i['error'] for i in store.evidence('water-demo')['issues']))

    def test_directory_swap_is_not_followed_and_stale_catalog_is_ignored(self):
        self.catalog(); self.write('catalog/journal.jsonl','changed')
        result=self.store.evidence('water-demo'); self.assertFalse(result['catalog']['journal_ok'])
        self.assertTrue(result['catalog']['warning'])
        self.assertTrue(all(not r['objects'] for r in result['files']))
        original=os.open
        moved=False
        def race(path,flags,*args,**kwargs):
            nonlocal moved
            if path=='analyses' and not moved:
                moved=True; (self.study/'analyses').rename(self.study/'saved'); (self.study/'analyses').symlink_to(self.root,target_is_directory=True)
            return original(path,flags,*args,**kwargs)
        with patch('autog_frontend.studies.os.open',side_effect=race):
            result=self.store.evidence('water-demo')
        self.assertTrue(result['issues']); self.assertNotIn('OUTSIDE_SENTINEL',json.dumps(result))

    def test_hook_uses_local_terms_and_rejects_staged_hits(self):
        repo=self.root/'hook-demo'; repo.mkdir(); (repo/'scripts').mkdir(); (repo/'.githooks').mkdir()
        source=Path(__file__).resolve().parents[1]
        for name in ('scripts/scan_public.py','.githooks/pre-commit'):
            (repo/name).write_bytes((source/name).read_bytes())
        (repo/'.githooks/pre-commit').chmod(0o755)
        env={**os.environ,'GIT_AUTHOR_NAME':'Demo','GIT_COMMITTER_NAME':'Demo','GIT_AUTHOR_EMAIL':'demo@users.noreply.github.com','GIT_COMMITTER_EMAIL':'demo@users.noreply.github.com'}
        def git(*args): return subprocess.run(['git',*args],cwd=repo,env=env,capture_output=True,text=True)
        self.assertEqual(git('init').returncode,0); self.assertEqual(git('config','core.hooksPath','.githooks').returncode,0)
        terms=self.root/'terms.txt'; terms.write_text('synthetic-local-marker\n'); env['SCAN_PUBLIC_TERMS_FILE']=str(terms)
        (repo/'sample.txt').write_text('synthetic-local-marker\n'); git('add','sample.txt')
        self.assertNotEqual(git('commit','-m','synthetic hit').returncode,0)
        (repo/'sample.txt').write_text('clean synthetic value\n'); git('add','sample.txt')
        self.assertEqual(git('commit','-m','synthetic clean').returncode,0)
        terms.unlink(); (repo/'sample.txt').write_text('another clean value\n'); git('add','sample.txt')
        missing=git('commit','-m','missing local terms'); self.assertIn('terms',missing.stdout+missing.stderr)
