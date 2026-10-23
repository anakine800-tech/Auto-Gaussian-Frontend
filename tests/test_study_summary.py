"""T95 parsing and readonly summary tests, entirely synthetic."""
import json
import os
from pathlib import Path
import tempfile
import unittest

from autog_frontend.studies import Studies
from autog_frontend.study_summary import parse_sections
from tests.study_fixture import create_studies


class SectionsTest(unittest.TestCase):
    def test_missing_empty_and_fenced_headings(self):
        for raw in ('', '# Synthetic\n', '```md\n## 当前阻塞\nexample\n```'):
            self.assertFalse(parse_sections(raw)['当前阻塞']['present'])
        sections = parse_sections('## 当前阻塞\n\n## 待你决定\n\n## 里程碑签字\n')
        for title in ('当前阻塞', '待你决定', '里程碑签字'):
            self.assertTrue(sections[title]['present'])
            self.assertEqual(sections[title]['entries'], [])

    def test_template_table_bullets_and_source_lines(self):
        text = '''# Synthetic
## 当前阻塞
- 解析：等待本地事实。
## 待你决定
| 待决定事项 | 所需信息与证据位置 | 可选方案及影响 | 决定后可推进的步骤 |
|---|---|---|---|
| 合成示例 | facts.json | 人工阅读 | 后续讨论 |
## 里程碑签字
请展示证据后签字。这段说明不是签字记录。
| 里程碑 | 展示并确认的对象 | 日期 | 签字人 | 人的确认原意 |
|---|---|---|---|---|
| 机理假设（机理研究） | <纯性质研究写不适用> | 待签 | 待签 | 待确认 |
| 结构 | 合成水 | 2026-01-01 | Synthetic reviewer | 测试记录 |
| 代表构象集合 | 合成集合 | — | — | — |
| 最终结果 | 纯性质示例 | 不适用 | 不适用 | 不适用 |
## 进度日志
- 仅合成测试
'''
        sections = parse_sections(text)
        self.assertEqual(sections['当前阻塞']['entries'], [{'line': 3, 'text': '解析：等待本地事实。'}])
        self.assertEqual(len(sections['待你决定']['entries']), 1)
        self.assertEqual([e['state'] for e in sections['里程碑签字']['entries']],
                         ['pending', 'recorded', 'not_started', 'not_applicable'])
        self.assertEqual(sections['里程碑签字']['entries'][0]['line'], 12)
        bullets = parse_sections('## 里程碑签字\n- 结构：待签字\n- 代表构象集合：需核对\n- 最终结果：不适用\n')
        self.assertEqual([e['state'] for e in bullets['里程碑签字']['entries']], ['pending', 'unknown', 'not_applicable'])

    def test_subsections_and_duplicate_sections_are_not_lost(self):
        parsed = parse_sections('## 当前阻塞\n### 本地\n- 一\n~~~\n## 待你决定\n- 示例\n~~~\n## 当前阻塞\n- 二\n# 其他\n- 三\n')
        self.assertEqual([e['text'] for e in parsed['当前阻塞']['entries']], ['一', '二'])
        self.assertFalse(parsed['待你决定']['present'])


class SummaryReadsTest(unittest.TestCase):
    def test_review_states_metadata_and_no_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            study = create_studies(root)
            nested = study / 'analyses' / 'synthetic-report'
            nested.mkdir()
            report = nested / 'summary.json'
            report.write_text(json.dumps({'schema': 'synthetic-test/1'}))
            os.utime(report, (1767225600, 1767225600))
            (study / 'attempts/gauche/review.md').write_text(' \n')
            files = [p for p in root.rglob('*') if p.is_file()]
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files}
            result = Studies(root).study(study.name)
            self.assertEqual({a['id']: a['review_state'] for a in result['attempts']},
                             {'anti': 'present', 'gauche': 'empty', 'waiting': 'missing'})
            self.assertTrue(result['sections']['当前阻塞']['present'])
            item = next(r for r in result['analyses'] if r['name'] == 'synthetic-report/summary.json')
            self.assertEqual(item['updated_at'], '2026-01-01T00:00:00+00:00')
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files})

    def test_unsafe_and_unreadable_reviews_reports_and_study(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            study = create_studies(root)
            (root / 'outside').write_text('OUTSIDE_STUDY_SENTINEL')
            (study / 'attempts/anti/review.md').unlink()
            (study / 'attempts/anti/review.md').symlink_to(root / 'outside')
            (study / 'attempts/gauche/review.md').write_bytes(b'\xff')
            (study / 'attempts/waiting/review.md').write_bytes(b'x' * (4*1024*1024+1))
            (study / 'analyses/unsafe.json').symlink_to(root / 'outside')
            nested = study / 'analyses/nested'
            nested.mkdir()
            (nested / 'unsafe.json').symlink_to(root / 'outside')
            (nested / 'bad.json').write_bytes(b'{bad')
            (study / 'analyses/escape').symlink_to(root, target_is_directory=True)
            (study / 'study.md').write_bytes(b'\xff')
            result = Studies(root).study(study.name)
            self.assertTrue(all(a['review_state'] == 'unreadable' for a in result['attempts']))
            self.assertIsNotNone(result['study']['error'])
            self.assertFalse(result['sections']['当前阻塞']['present'])
            self.assertNotIn('OUTSIDE_STUDY_SENTINEL', json.dumps(result))
            self.assertEqual(len([i for i in result['issues'] if 'symlink' in i['error']]), 3)
            self.assertIsNone(next(a for a in result['analyses'] if a['name'] == 'nested/bad.json')['data'])
