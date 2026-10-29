"""T120 uses invented metadata only; no calculation or external request."""

import hashlib
import json
import os
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
        self.study = self.root / "water-example"
        self.study.mkdir()
        (self.study / "study.md").write_text(
            "# Synthetic water\nBODY_SECRET_NOT_INDEXED\n"
        )
        self.attempt = self.study / "attempts" / "water-001"
        self.attempt.mkdir(parents=True)
        (self.attempt / "manifest.json").write_text(
            json.dumps({"label": "synthetic-tag", "template": "gaussian"})
        )
        (self.attempt / "facts.json").write_text("CONTENT_SENTINEL")
        (self.study / "analyses").mkdir()
        (self.study / "analyses" / "public-table.csv").write_text("CONTENT_SENTINEL")
        self.store = Studies(self.root)
        self.index = SearchIndex(self.store)

    def hits(self, query):
        return [h for g in self.index.search(query)["groups"] for h in g["hits"]]

    def test_all_studies_metadata_only_and_no_writes(self):
        before = {
            p: (p.read_bytes(), p.stat().st_mtime_ns)
            for p in self.root.rglob("*")
            if p.is_file()
        }
        for query in (
            "water-example",
            "Synthetic water",
            "water-001",
            "synthetic-tag",
            "gaussian",
            "public-table",
        ):
            self.assertTrue(self.hits(query), query)
        for query in ("CONTENT_SENTINEL", "BODY_SECRET_NOT_INDEXED", "facts.json"):
            self.assertEqual(self.hits(query), [])
        self.assertEqual(
            before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}
        )

    def test_lazy_cache_invalidation_manifest_and_directory(self):
        self.assertEqual(self.index.cache, {})
        self.assertTrue(self.hits("synthetic-tag"))
        with patch.object(self.store, "read", wraps=self.store.read) as read:
            self.hits("water")
            self.assertEqual(read.call_count, 0)
        (self.attempt / "manifest.json").write_text(json.dumps({"label": "new-tag"}))
        self.assertTrue(self.hits("new-tag"))
        self.assertFalse(self.hits("synthetic-tag"))
        (self.study / "analyses" / "added.md").write_text("not indexed")
        self.assertTrue(self.hits("added.md"))
        (self.study / "analyses" / "added.md").unlink()
        self.assertFalse(self.hits("added.md"))

    def test_limits_and_top_50(self):
        for i in range(60):
            (self.study / "analyses" / f"row-{i:03}.csv").write_text("")
        result = self.index.search("row-")
        self.assertEqual(sum(len(g["hits"]) for g in result["groups"]), 50)
        self.assertTrue(result["truncated"])
        for setting, limit in [
            ("MAX_FILES_PER_STUDY", 1),
            ("MAX_ENTRIES_PER_STUDY", 1),
            ("MAX_TOTAL_ENTRIES", 1),
            ("MAX_SECONDS", 0),
        ]:
            with patch("autog_frontend.search_index." + setting, limit):
                result = SearchIndex(self.store).search("water")
                self.assertTrue(result["incomplete"], setting)
                self.assertIn("索引未完成", result["message"])

    def test_unsafe_and_invalid_files_are_not_followed(self):
        outside = self.root / "outside.txt"
        outside.write_text("OUTSIDE_SECRET")
        (self.study / "analyses" / "escape.csv").symlink_to(outside)
        (self.study / "analyses" / "escape-dir").symlink_to(
            self.root, target_is_directory=True
        )
        self.assertFalse(self.hits("escape"))
        self.assertFalse(self.hits("OUTSIDE_SECRET"))
        (self.attempt / "manifest.json").write_text("[")
        self.assertTrue(self.hits("water-001"))
        self.assertTrue(self.index.search("water")["incomplete"])
        (self.study / "study.md").write_bytes(b"\xff")
        self.assertTrue(self.index.search("water")["incomplete"])

    def test_api_search_and_type(self):
        with TestClient(
            create_app(self.root),
            base_url="http://localhost",
            client=("127.0.0.1", 50000),
        ) as client:
            self.assertEqual(
                client.get("/api/studies").json()["studies"][0]["type"], "research"
            )
            self.assertEqual(
                client.get("/api/search", params={"q": "water-001"}).status_code, 200
            )
            self.assertEqual(
                client.get("/api/search", params={"q": "x" * 257}).status_code, 422
            )
            self.assertEqual(
                client.get(
                    "/api/search?q=water", headers={"origin": "https://example.invalid"}
                ).status_code,
                403,
            )

    def write_method(
        self, route="# B3LYP/6-31G(d) Opt Freq", basis="Synthetic rationale"
    ):
        path = self.attempt / "manifest.json"
        path.write_text(
            json.dumps(
                {
                    "label": "synthetic-tag",
                    "template": "gaussian",
                    "science": {"route": route, "method_basis": basis},
                }
            )
        )
        return path

    def add_other_study(self):
        other = self.root / "other-example"
        other.mkdir()
        (other / "study.md").write_text("# Other synthetic study\n")
        attempt = other / "attempts" / self.attempt.name
        attempt.mkdir(parents=True)
        (attempt / "manifest.json").write_text(
            json.dumps(
                {
                    "science": {
                        "route": "# B3LYP/6-31G(d) SP",
                        "method_basis": "Other rationale",
                    },
                }
            )
        )
        return other

    def test_route_and_method_basis_casefold_and_metadata_only(self):
        self.write_method(basis="Synthetic STRASSE rationale")
        (self.attempt / "input.gjf").write_text("INPUT_BODY_SENTINEL")
        (self.attempt / "output.log").write_text("LOG_BODY_SENTINEL")
        before = {
            p: (p.read_bytes(), p.stat().st_mtime_ns)
            for p in self.root.rglob("*")
            if p.is_file()
        }
        with patch.object(self.store, "read", wraps=self.store.read) as read:
            for query in ("b3lyp", "6-31g(D)", "opt freq", "strasse", "straße"):
                result = self.index.search(query, self.study.name)
                self.assertEqual(
                    result["groups"][0]["hits"][0]["label"], self.attempt.name
                )
                self.assertFalse(result["incomplete"])
            self.assertEqual(
                {call.args[0][-1] for call in read.call_args_list},
                {"study.md", "manifest.json"},
            )
        for query in (
            "INPUT_BODY_SENTINEL",
            "LOG_BODY_SENTINEL",
            "CONTENT_SENTINEL",
            "BODY_SECRET_NOT_INDEXED",
        ):
            self.assertFalse(self.index.search(query, self.study.name)["groups"])
        self.assertEqual(
            before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before}
        )

    def test_scoped_search_does_not_traverse_other_studies_or_prune_cache(self):
        self.write_method()
        other = self.add_other_study()
        result = self.index.search("b3lyp")
        self.assertEqual(
            {g["study"] for g in result["groups"]}, {self.study.name, other.name}
        )
        self.assertEqual(len({g["hits"][0]["href"] for g in result["groups"]}), 2)
        with patch.object(self.store, "open_dir", wraps=self.store.open_dir) as opened:
            result = self.index.search("b3lyp", self.study.name)
            self.assertEqual([g["study"] for g in result["groups"]], [self.study.name])
            for call in opened.call_args_list:
                self.assertEqual(call.args[0][0], self.study.name)
        self.assertEqual(set(self.index.cache), {self.study.name, other.name})
        result = self.index.search("rationale", other.name)
        self.assertEqual([g["study"] for g in result["groups"]], [other.name])

    def test_scoped_search_ignores_root_budget_and_unrelated_invalid_manifest(self):
        self.write_method()
        other = self.add_other_study()
        (other / "attempts" / self.attempt.name / "manifest.json").write_text("[")
        for i in range(20):
            (self.root / f"unrelated-{i}").mkdir()
        with patch("autog_frontend.search_index.MAX_TOTAL_ENTRIES", 12):
            result = self.index.search("b3lyp", self.study.name)
            self.assertFalse(result["incomplete"])
            self.assertEqual(len(result["groups"]), 1)
            self.assertTrue(self.index.search("b3lyp")["incomplete"])

    def test_method_cache_invalidation_in_place_and_replacement(self):
        path = self.write_method(route="# HF/STO-3G", basis="old rationale")
        self.assertTrue(self.index.search("old rationale", self.study.name)["groups"])
        old = path.stat()
        self.write_method(route="# HF/STO-3G", basis="new rationale")
        os.utime(path, ns=(old.st_atime_ns, old.st_mtime_ns))
        self.assertTrue(self.index.search("new rationale", self.study.name)["groups"])
        self.assertFalse(self.index.search("old rationale", self.study.name)["groups"])
        replacement = path.with_suffix(".new")
        replacement.write_text(json.dumps({"science": {"route": "# PBE0/def2-SVP"}}))
        replacement.replace(path)
        self.assertTrue(self.index.search("pbe0", self.study.name)["groups"])
        self.assertFalse(self.index.search("hf/sto-3g", self.study.name)["groups"])

    def test_invalid_method_types_keep_valid_fields_and_id_with_unknown_notice(self):
        path = self.attempt / "manifest.json"
        for science in (
            None,
            [],
            "bad",
            {"route": 123},
            {"method_basis": False},
            {"route": [], "method_basis": {"nested": "not-string"}},
            {"route": "# ValidRoute", "method_basis": ["bad"]},
            {"route": {}, "method_basis": "ValidBasis"},
        ):
            with self.subTest(science=science):
                path.write_text(json.dumps({"label": "kept-label", "science": science}))
                result = self.index.search(self.attempt.name, self.study.name)
                self.assertTrue(result["incomplete"])
                self.assertIn("方法", result["message"])
                self.assertIn("kept-label", result["groups"][0]["hits"][0]["detail"])
                self.assertRegex(
                    result["groups"][0]["hits"][0]["detail"], "方法未知|方法索引不完整"
                )
                self.assertFalse(
                    self.index.search("not-string", self.study.name)["groups"]
                )
        path.write_text(
            json.dumps({"science": {"route": "# ValidRoute", "method_basis": []}})
        )
        self.assertTrue(self.index.search("validroute", self.study.name)["groups"])
        for raw in ("[", "[]", "null", '"text"'):
            path.write_text(raw)
            result = self.index.search(self.attempt.name, self.study.name)
            self.assertTrue(result["incomplete"])
            self.assertIn("方法未知", result["groups"][0]["hits"][0]["detail"])
        path.write_text("{}")
        result = self.index.search(self.attempt.name, self.study.name)
        self.assertFalse(result["incomplete"])
        self.assertIn("方法未知", result["groups"][0]["hits"][0]["detail"])

    def test_method_metadata_limit_and_partial_recovery(self):
        self.write_method(basis="x" * 300)
        with patch("autog_frontend.search_index.MAX_METADATA_BYTES", 128):
            result = self.index.search(self.attempt.name, self.study.name)
            self.assertTrue(result["incomplete"])
            self.assertIn("方法未知", result["groups"][0]["hits"][0]["detail"])
        self.assertTrue(self.index.search("xxx", self.study.name)["groups"])
        self.assertFalse(self.index.search("xxx", self.study.name)["incomplete"])

    def test_partial_timeout_keeps_completed_hits_and_retries_uncached_tail(self):
        self.write_method()
        second = self.attempt.with_name("water-002")
        second.mkdir()
        (second / "manifest.json").write_text(
            json.dumps({"science": {"route": "SecondMethod"}})
        )
        original_read = self.store.read

        def read(parts, limit):
            data = original_read(parts, limit)
            if parts[-2:] == (self.attempt.name, "manifest.json"):
                self.index.deadline = 0
            return data

        with patch.object(self.store, "read", side_effect=read):
            result = self.index.search("b3lyp", self.study.name)
            self.assertTrue(result["incomplete"])
            self.assertEqual(result["groups"][0]["hits"][0]["label"], self.attempt.name)
        result = self.index.search("secondmethod", self.study.name)
        self.assertFalse(result["incomplete"])
        self.assertTrue(result["groups"])

    def test_scoped_limits_and_top_50(self):
        for i in range(60):
            attempt = self.attempt.with_name(f"row-{i:03}")
            attempt.mkdir()
            (attempt / "manifest.json").write_text(
                json.dumps({"science": {"route": "SharedMethod"}})
            )
        result = self.index.search("sharedmethod", self.study.name)
        self.assertEqual(sum(len(g["hits"]) for g in result["groups"]), 50)
        self.assertTrue(result["truncated"])
        for setting, limit in [
            ("MAX_FILES_PER_STUDY", 1),
            ("MAX_ENTRIES_PER_STUDY", 1),
            ("MAX_TOTAL_ENTRIES", 1),
            ("MAX_SECONDS", 0),
        ]:
            with (
                self.subTest(setting=setting),
                patch("autog_frontend.search_index." + setting, limit),
            ):
                result = SearchIndex(self.store).search("water", self.study.name)
                self.assertTrue(result["incomplete"])

    def test_method_strings_are_not_paths_commands_or_response_details(self):
        secret_path = str(self.root / "outside.txt")
        (self.root / "outside.txt").write_text("OUTSIDE_SECRET")
        text = secret_path + " $(touch injected) `echo nope` <img src=x>"
        self.write_method(route=text, basis=text)
        with patch.object(self.store, "read", wraps=self.store.read) as read:
            result = self.index.search("injected", self.study.name)
            self.assertTrue(result["groups"])
            self.assertNotIn(secret_path, json.dumps(result))
            self.assertNotIn("<img", json.dumps(result))
            self.assertEqual(
                {call.args[0][-1] for call in read.call_args_list},
                {"study.md", "manifest.json"},
            )
        self.assertFalse(self.index.search("OUTSIDE_SECRET", self.study.name)["groups"])
        self.assertFalse((self.root / "injected").exists())

    def test_api_scope_path_rejections_and_same_named_attempts(self):
        self.write_method()
        other = self.add_other_study()
        (self.root / "linked-study").symlink_to(other, target_is_directory=True)
        with TestClient(
            create_app(self.root),
            base_url="http://localhost",
            client=("127.0.0.1", 50000),
        ) as client:
            result = client.get(
                "/api/search", params={"q": "b3lyp", "study": self.study.name}
            )
            self.assertEqual(result.status_code, 200)
            self.assertEqual(
                [g["study"] for g in result.json()["groups"]], [self.study.name]
            )
            self.assertEqual(
                len(client.get("/api/search", params={"q": "b3lyp"}).json()["groups"]),
                2,
            )
            for study in (
                "..",
                "../other-example",
                "/absolute",
                "other-example/attempts",
                "a\\b",
                "\x00",
            ):
                for query in ("b3lyp", ""):
                    response = client.get(
                        "/api/search", params={"q": query, "study": study}
                    )
                    self.assertEqual(response.status_code, 400, (study, query))
                    self.assertNotIn(str(self.root), response.text)
            for study, code in [
                ("linked-study", 403),
                ("missing", 404),
                ("_archive", 404),
                (".hidden", 404),
                ("", 422),
                ("x" * 256, 422),
            ]:
                self.assertEqual(
                    client.get(
                        "/api/search", params={"q": "b3lyp", "study": study}
                    ).status_code,
                    code,
                )

    def test_warm_method_cache_rejects_replaced_manifest_symlink(self):
        path = self.write_method()
        self.assertTrue(self.index.search("b3lyp", self.study.name)["groups"])
        outside = self.root / "outside.json"
        outside.write_text(json.dumps({"science": {"route": "ESCAPED_ROUTE"}}))
        path.unlink()
        path.symlink_to(outside)
        self.assertFalse(self.index.search("b3lyp", self.study.name)["groups"])
        self.assertFalse(self.index.search("ESCAPED_ROUTE", self.study.name)["groups"])

    def test_catalog_absent_hash_mismatch_and_active_scope(self):
        self.assertFalse(self.store.catalog_review_scope(self.study.name)["available"])
        catalog = self.study / "catalog"
        catalog.mkdir()
        journal = b'{"schema":"ag-catalog/1"}\n'
        (catalog / "journal.jsonl").write_bytes(journal)
        state = {
            "schema": "ag-catalog-state/1",
            "journal_sha256": hashlib.sha256(journal).hexdigest(),
            "objects": [
                {
                    "status": "adopted",
                    "members": [{"attempt": "historical"}],
                    "adopted": {
                        "opt": {"attempt": "water-001"},
                        "freq": None,
                        "sp": None,
                    },
                },
                {"status": "candidate", "members": [{"attempt": "water-002"}]},
                {"status": "retired", "members": [{"attempt": "retired"}]},
            ],
        }
        path = catalog / "state.json"
        path.write_text(json.dumps(state))
        self.assertEqual(
            self.store.catalog_review_scope(self.study.name)["attempts"],
            ["water-001", "water-002"],
        )
        (catalog / "journal.jsonl").write_bytes(journal + b"\n")
        result = self.store.catalog_review_scope(self.study.name)
        self.assertFalse(result["available"])
        self.assertIn("哈希", result["warning"])
        path.unlink()
        path.symlink_to(self.root / "outside.json")
        (self.root / "outside.json").write_text(json.dumps(state))
        self.assertFalse(self.store.catalog_review_scope(self.study.name)["available"])


class SummaryTest(unittest.TestCase):
    def test_front_matter_types(self):
        for name, raw, expected in [
            ("val-a", "", "validation"),
            ("test-a", "", "test"),
            ("demo-a", "", "test"),
            ("water", "", "research"),
            ("val-a", "---\ntype: research\n---", "research"),
            ("water", "---\n类型: 验证\n---", "validation"),
            ("water", "---\n类型: 测试\n---", "test"),
            ("water", "# title\ntype: test", "research"),
            ("water", "---\ntype: test", "research"),
        ]:
            self.assertEqual(study_type(name, raw), expected)

    def test_five_milestone_states_and_source_line(self):
        text = "## 里程碑签字\n- 结构：已签 2026-01-01\n- 构象：待签\n- 结果：未开始\n- 机理：不适用\n- 其他：文字不认识\n"
        entries = parse_sections(text)["里程碑签字"]["entries"]
        self.assertEqual(
            [e["state"] for e in entries],
            ["recorded", "pending", "not_started", "not_applicable", "unknown"],
        )
        self.assertEqual(entries[-1]["line"], 6)
        table = parse_sections(
            "## 里程碑签字\n| 里程碑 | 状态 |\n|---|---|\n| 结构 | 待签 |\n| 结果 | 不适用 |\n"
        )["里程碑签字"]["entries"]
        self.assertEqual([e["state"] for e in table], ["pending", "not_applicable"])
