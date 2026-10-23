"""T120 uses invented metadata only; no calculation or external request."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.search_index import SearchIndex
from autog_frontend.studies import Studies
from autog_frontend.study_summary import parse_sections, study_type


class SearchTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.study = self.root / 'water-example'
        self.study.mkdir()
        (self.study / 'study.md').write_text('# Synthetic water\nBODY_SECRET_NOT_INDEXED\n')
        self.attempt = self.study / 'attempts' / 'water-001'
        self.attempt.mkdir(parents=True)
        (self.attempt / 'manifest.json').write_text(json.dumps({'label': 'synthetic-tag', 'template': 'gaussian'}))
        (self.attempt / 'facts.json').write_text('CONTENT_SENTINEL')
        (self.study / 'analyses').mkdir()
        (self.study / 'analyses' / 'public-table.csv').write_text('CONTENT_SENTINEL')
        self.store = Studies(self.root)
        self.index = SearchIndex(self.store)

    def hits(self, query):
        return [h for g in self.index.search(query)['groups'] for h in g['hits']]

    def test_all_studies_metadata_only_and_no_writes(self):
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        for query in ('water-example', 'Synthetic water', 'water-001', 'synthetic-tag', 'gaussian', 'public-table'):
            self.assertTrue(self.hits(query), query)
        for query in ('CONTENT_SENTINEL', 'BODY_SECRET_NOT_INDEXED', 'facts.json'):
            self.assertEqual(self.hits(query), [])
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def test_lazy_cache_invalidation_manifest_and_directory(self):
        self.assertEqual(self.index.cache, {})
        self.assertTrue(self.hits('synthetic-tag'))
        with patch.object(self.store, 'read', wraps=self.store.read) as read:
            self.hits('water')
            self.assertEqual(read.call_count, 0)
        (self.attempt / 'manifest.json').write_text(json.dumps({'label': 'new-tag'}))
        self.assertTrue(self.hits('new-tag'))
        self.assertFalse(self.hits('synthetic-tag'))
        (self.study / 'analyses' / 'added.md').write_text('not indexed')
        self.assertTrue(self.hits('added.md'))
        (self.study / 'analyses' / 'added.md').unlink()
        self.assertFalse(self.hits('added.md'))

    def test_limits_and_top_50(self):
        for i in range(60):
            (self.study / 'analyses' / f'row-{i:03}.csv').write_text('')
        result = self.index.search('row-')
        self.assertEqual(sum(len(g['hits']) for g in result['groups']), 50)
        self.assertTrue(result['truncated'])
        for setting, limit in [('MAX_FILES_PER_STUDY', 1), ('MAX_ENTRIES_PER_STUDY', 1), ('MAX_TOTAL_ENTRIES', 1), ('MAX_SECONDS', 0)]:
            with patch('autog_frontend.search_index.'+setting, limit):
                result = SearchIndex(self.store).search('water')
                self.assertTrue(result['incomplete'], setting)
                self.assertIn('索引未完成', result['message'])

    def test_unsafe_and_invalid_files_are_not_followed(self):
        outside = self.root / 'outside.txt'
        outside.write_text('OUTSIDE_SECRET')
        (self.study / 'analyses' / 'escape.csv').symlink_to(outside)
        (self.study / 'analyses' / 'escape-dir').symlink_to(self.root, target_is_directory=True)
        self.assertFalse(self.hits('escape'))
        self.assertFalse(self.hits('OUTSIDE_SECRET'))
        (self.attempt / 'manifest.json').write_text('[')
        self.assertTrue(self.hits('water-001'))
        self.assertTrue(self.index.search('water')['incomplete'])
        (self.study / 'study.md').write_bytes(b'\xff')
        self.assertTrue(self.index.search('water')['incomplete'])

    def test_api_search_and_type(self):
        with TestClient(create_app(self.root), base_url='http://localhost', client=('127.0.0.1', 50000)) as client:
            self.assertEqual(client.get('/api/studies').json()['studies'][0]['type'], 'research')
            self.assertEqual(client.get('/api/search', params={'q':'water-001'}).status_code, 200)
            self.assertEqual(client.get('/api/search', params={'q':'x'*257}).status_code, 422)
            self.assertEqual(client.get('/api/search?q=water', headers={'origin':'https://example.invalid'}).status_code, 403)

    def test_catalog_absent_hash_mismatch_and_active_scope(self):
        self.assertFalse(self.store.catalog_review_scope(self.study.name)['available'])
        catalog = self.study / 'catalog'
        catalog.mkdir()
        journal = b'{"schema":"ag-catalog/1"}\n'
        (catalog / 'journal.jsonl').write_bytes(journal)
        state = {'schema':'ag-catalog-state/1', 'journal_sha256':hashlib.sha256(journal).hexdigest(), 'objects':[
            {'status':'adopted', 'members':[{'attempt':'historical'}], 'adopted':{'opt':{'attempt':'water-001'}, 'freq':None, 'sp':None}},
            {'status':'candidate', 'members':[{'attempt':'water-002'}]},
            {'status':'retired', 'members':[{'attempt':'retired'}]},
        ]}
        path = catalog / 'state.json'
        path.write_text(json.dumps(state))
        self.assertEqual(self.store.catalog_review_scope(self.study.name)['attempts'], ['water-001','water-002'])
        (catalog / 'journal.jsonl').write_bytes(journal+b'\n')
        result = self.store.catalog_review_scope(self.study.name)
        self.assertFalse(result['available'])
        self.assertIn('哈希', result['warning'])
        path.unlink()
        path.symlink_to(self.root/'outside.json')
        (self.root/'outside.json').write_text(json.dumps(state))
        self.assertFalse(self.store.catalog_review_scope(self.study.name)['available'])


class SummaryTest(unittest.TestCase):
    def test_front_matter_types(self):
        for name, raw, expected in [('val-a','', 'validation'), ('test-a','', 'test'), ('demo-a','', 'test'), ('water','', 'research'),
                                    ('val-a','---\ntype: research\n---', 'research'), ('water','---\n类型: 验证\n---','validation'),
                                    ('water','---\n类型: 测试\n---','test'), ('water','# title\ntype: test','research'), ('water','---\ntype: test','research')]:
            self.assertEqual(study_type(name,raw),expected)

    def test_five_milestone_states_and_source_line(self):
        text='## 里程碑签字\n- 结构：已签 2026-01-01\n- 构象：待签\n- 结果：未开始\n- 机理：不适用\n- 其他：文字不认识\n'
        entries=parse_sections(text)['里程碑签字']['entries']
        self.assertEqual([e['state'] for e in entries], ['recorded','pending','not_started','not_applicable','unknown'])
        self.assertEqual(entries[-1]['line'],6)
        table=parse_sections('## 里程碑签字\n| 里程碑 | 状态 |\n|---|---|\n| 结构 | 待签 |\n| 结果 | 不适用 |\n')['里程碑签字']['entries']
        self.assertEqual([e['state'] for e in table], ['pending','not_applicable'])
