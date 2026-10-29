import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient
from autog_frontend.api import create_app
from autog_frontend.optimization import parse_optimization
from tests.results_fixture import (
    VIBRATION_FACTS_CASES,
    create_results_studies,
    opt_log,
    orientation,
    monitor_snapshot,
)


class ResultsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.study = create_results_studies(self.root)
        self.client = TestClient(
            create_app(self.root),
            base_url="http://localhost",
            client=("127.0.0.1", 51234),
        )
        self.base = "/api/studies/butane-demo"
        self.opt = self.base + "/attempts/opt-demo/optimization/optimization.log"
        self.snapshot = self.root / ".ag-monitor/latest.json"

    def test_results_use_saved_documents_and_missing_facts_remain_missing(self):
        data = self.client.get(self.base).json()
        rows = {a["id"]: a for a in data["attempts"]}
        self.assertEqual(
            rows["opt-demo"]["facts"]["data"]["energies"]["scf"], -157.0025
        )
        self.assertIsNone(rows["waiting"]["facts"]["data"])
        self.assertEqual(self.client.get("/api/studies").json()["issues"], [])
        hidden = self.root / ".hidden"
        hidden.mkdir()
        (hidden / "study.md").write_text("# Hidden")
        (self.root / ".hidden-link").symlink_to(self.study, target_is_directory=True)
        self.assertEqual(len(self.client.get("/api/studies").json()["studies"]), 1)
        self.assertEqual(self.client.get("/api/studies").json()["issues"], [])

    def test_vibration_completeness_facts_pass_through_without_inference_or_writes(
        self,
    ):
        path = self.study / "attempts/opt-demo/facts.json"
        original = json.loads(path.read_text())
        # The saved count must not be filled from the molecule size or log modes.
        original["n_atoms"] = 14
        for name, fields in VIBRATION_FACTS_CASES.items():
            with self.subTest(case=name):
                expected = {**original, **fields}
                path.write_text(json.dumps(expected))
                before = (path.read_bytes(), path.stat().st_mtime_ns)
                detail = self.client.get(self.base + "/attempts/opt-demo")
                self.assertEqual(detail.status_code, 200)
                self.assertEqual(
                    detail.json()["facts"], {"data": expected, "error": None}
                )
                for key, value in fields.items():
                    self.assertIs(
                        type(detail.json()["facts"]["data"][key]), type(value)
                    )
                study = self.client.get(self.base)
                self.assertEqual(study.status_code, 200)
                row = next(a for a in study.json()["attempts"] if a["id"] == "opt-demo")
                self.assertEqual(row["facts"], {"data": expected, "error": None})
                self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)

    def test_vibration_completeness_missing_facts_are_not_created_from_logs(self):
        path = self.study / "attempts/opt-demo/facts.json"
        path.unlink()
        detail = self.client.get(self.base + "/attempts/opt-demo")
        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.json()["facts"]["data"])
        self.assertTrue(detail.json()["facts"]["error"])
        self.assertEqual(detail.json()["logs"], ["optimization.log"])
        row = next(
            a
            for a in self.client.get(self.base).json()["attempts"]
            if a["id"] == "opt-demo"
        )
        self.assertIsNone(row["facts"]["data"])
        self.assertTrue(row["facts"]["error"])
        self.assertFalse(path.exists())

    def test_three_steps_and_frequency_geometry_excluded(self):
        data = self.client.get(self.opt).json()["segments"]
        self.assertEqual(len(data), 1)
        segment = data[0]
        self.assertEqual(segment["optimization"], "completed")
        self.assertEqual(segment["termination"], "normal")
        self.assertEqual([s["printed_step"] for s in segment["steps"]], [1, 2, 3])
        self.assertEqual(
            [s["scf_hartree"] for s in segment["steps"]], [-157.0, -157.002, -157.0025]
        )
        self.assertEqual(
            segment["steps"][0]["geometry"]["orientation_kind"], "Standard orientation:"
        )
        self.assertEqual(
            segment["steps"][1]["geometry"]["orientation_kind"], "Input orientation:"
        )
        self.assertAlmostEqual(segment["steps"][0]["geometry"]["atoms"][0]["x"], -1.82)
        self.assertTrue(
            all(m["result"] == "YES" for m in segment["steps"][2]["metrics"])
        )
        self.assertEqual(segment["steps"][0]["metrics"][0]["threshold"], 0.00045)

    def test_unconverged_termination_and_partial_last_step(self):
        segment = parse_optimization(opt_log(False).encode(), "synthetic")["segments"][
            0
        ]
        self.assertEqual(segment["optimization"], "stopped")
        self.assertEqual(segment["termination"], "error")
        self.assertEqual(len(segment["steps"]), 3)
        self.assertTrue(
            all(m["result"] == "NO" for m in segment["steps"][-1]["metrics"])
        )
        raw = (
            opt_log(False).split(" Optimization stopped.")[0]
            + orientation()
            + " SCF Done: E(RHF) = -157.003 A.U.\n Step number 4 out of 20\n Error termination\n"
        )
        step = parse_optimization(raw.encode(), "synthetic")["segments"][0]["steps"][-1]
        self.assertEqual(step["printed_step"], 4)
        self.assertEqual(step["metrics"], [])

    def test_link1_and_frequency_only_segment(self):
        frequency = (
            " # HF/STO-3G Freq\n ------\n"
            + orientation()
            + " SCF Done: E(RHF) = -157 A.U.\n Harmonic frequencies\n Normal termination\n"
        )
        for boundary in [
            "--Link1--",
            "Proceeding to internal job step number 2.",
            "Entering Link 1 = synthetic",
        ]:
            data = parse_optimization(
                (
                    opt_log()
                    + boundary
                    + "\n"
                    + frequency
                    + "--Link1--\n"
                    + opt_log(False)
                ).encode(),
                "synthetic",
            )["segments"]
            self.assertEqual([len(s["steps"]) for s in data], [3, 0, 3])
            self.assertEqual([s["index"] for s in data], [1, 2, 3])

    def test_missing_geometry_not_reused_and_truncated_table_explicit(self):
        raw = (
            opt_log()
            .replace(orientation("Input", 1.2), "")
            .replace(orientation("Standard", 0.1), "")
        )
        steps = parse_optimization(raw.encode(), "synthetic")["segments"][0]["steps"]
        self.assertIsNone(steps[1]["geometry"])
        self.assertEqual(steps[0]["geometry"]["orientation_kind"], "Input orientation:")
        raw = opt_log(False).split(" RMS Displacement")[0] + "\n Error termination\n"
        self.assertEqual(
            len(
                parse_optimization(raw.encode(), "synthetic")["segments"][0]["steps"][
                    0
                ]["metrics"]
            ),
            3,
        )
        with self.assertRaises(ValueError):
            parse_optimization(
                opt_log().replace("-157.00000000", "1D999").encode(), "synthetic"
            )

    def test_optimization_limits_symlinks_and_invalid_text(self):
        target = self.study / "attempts/opt-demo/outputs/optimization.log"
        target.write_bytes(b"\xff")
        self.assertEqual(self.client.get(self.opt).status_code, 422)
        with target.open("wb") as f:
            f.truncate(32 * 1024 * 1024 + 1)
        self.assertEqual(self.client.get(self.opt).status_code, 413)
        target.unlink()
        target.symlink_to(self.study / "study.md")
        self.assertEqual(self.client.get(self.opt).status_code, 403)

    def test_analysis_subdirectory_inventory_frame_and_safety(self):
        uri = self.base + "/analyses/cluster-demo/representatives.xyz"
        files = self.client.get(self.base).json()["structure_files"]
        self.assertIn(
            {
                "parts": ["analyses", "cluster-demo", "representatives.xyz"],
                "error": None,
            },
            files,
        )
        self.assertEqual(self.client.get(uri + "?frame=1").json()["frame_count"], 2)
        self.assertEqual(self.client.get(uri + "?frame=2").status_code, 422)
        folder = self.study / "analyses/cluster-demo"
        target = folder / "representatives.xyz"
        target.unlink()
        target.symlink_to(self.study / "analyses/representatives.xyz")
        self.assertEqual(self.client.get(uri).status_code, 403)
        target.unlink()
        folder.rmdir()
        folder.symlink_to(self.study / "structures/butane", target_is_directory=True)
        self.assertEqual(
            self.client.get(uri.replace("representatives", "conformers")).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(
                self.base + "/analyses/cluster-demo/deeper/conformers.xyz"
            ).status_code,
            404,
        )

    def test_monitor_normal_stale_failed_and_one_shot(self):
        data = monitor_snapshot()
        for changes in [
            {},
            {"sampled_at": "2000-01-01T00:00:00Z"},
            {
                "ok": False,
                "error": "Synthetic sampler error",
                "last_ok_at": "2000-01-01T00:00:00Z",
            },
            {"ok": False, "own": None, "cluster": None},
            {"interval_seconds": None},
        ]:
            value = {**data, **changes}
            self.snapshot.write_text(json.dumps(value))
            response = self.client.get("/api/monitor")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["clusters"][0]["snapshot"], value)

    def test_monitor_missing_oversized_and_symlinks(self):
        self.snapshot.unlink()
        response = self.client.get("/api/monitor")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["clusters"][0]["error"],
            "监控未运行或尚无快照：请启动常驻监控（ag monitor --watch 30）",
        )
        with self.snapshot.open("wb") as f:
            f.truncate(2 * 1024 * 1024 + 1)
        self.assertEqual(
            self.client.get("/api/monitor").json()["clusters"][0]["error"],
            "File exceeds display size limit",
        )
        self.snapshot.unlink()
        self.snapshot.symlink_to(self.study / "study.md")
        self.assertIn(
            "Unsafe", self.client.get("/api/monitor").json()["clusters"][0]["error"]
        )
        self.snapshot.unlink()
        self.snapshot.parent.rmdir()
        self.snapshot.parent.symlink_to(self.study, target_is_directory=True)
        self.assertEqual(self.client.get("/api/monitor").status_code, 403)

    def test_optional_t11_core_fields(self):
        data = monitor_snapshot()
        data["own"].update(cores_running=8, cores_queued=22, committed_cap=88)
        self.snapshot.write_text(json.dumps(data))
        self.assertEqual(
            self.client.get("/api/monitor").json()["clusters"][0]["snapshot"]["own"],
            data["own"],
        )
        for key in ("cores_running", "cores_queued", "committed_cap"):
            for invalid in (-1, True, "22", None):
                malformed = copy.deepcopy(data)
                malformed["own"][key] = invalid
                self.snapshot.write_text(json.dumps(malformed))
                self.assertEqual(
                    self.client.get("/api/monitor").json()["clusters"][0]["error"],
                    "快照格式不正确",
                )

    def test_monitor_malformed_fields_never_500(self):
        valid = monitor_snapshot()
        cases = []
        for key in valid:
            missing = copy.deepcopy(valid)
            del missing[key]
            cases.append(missing)
        for key, value in [
            ("schema", "ag-monitor/2"),
            ("ok", 1),
            ("sampled_at", "bad"),
            ("sampled_at", "2026-01-01T00:00:00"),
            ("interval_seconds", True),
            ("interval_seconds", 29),
            ("interval_seconds", 601),
            ("own", []),
            ("own", None),
            ("cluster", None),
            ("warnings", [{}]),
        ]:
            cases.append({**valid, key: value})
        for group, field, bad in [
            ("own", "jobs", [None]),
            ("own", "core_cap", 0),
            ("own", "cores_in_use", True),
            ("cluster", "nodes", [{}]),
            ("cluster", "queues", [{"name": "demo", "running": "1", "queued": 0}]),
        ]:
            data = copy.deepcopy(valid)
            data[group][field] = bad
            cases.append(data)
        for data in cases:
            self.snapshot.write_text(json.dumps(data))
            response = self.client.get("/api/monitor")
            self.assertEqual(response.status_code, 200, data)
            self.assertEqual(response.json()["clusters"][0]["error"], "快照格式不正确")
        for raw in [b"\xff", b"{", b"[]", b'{"x":NaN}', b"[" * 2000 + b"]" * 2000]:
            self.snapshot.write_bytes(raw)
            self.assertEqual(
                self.client.get("/api/monitor").json()["clusters"][0]["error"],
                "快照格式不正确",
            )

    def test_t103_shared_cap_passes_through_without_running_queued_fields(self):
        data = monitor_snapshot()
        data["own"].update(core_cap=64, committed_cap=256)
        data["cluster"].update(budget=None, expires=None)
        for peers in ([], ["batch-test"], ["batch-test", "batch-extra"]):
            for ok, last_ok in (
                (True, None),
                (False, None),
                (False, data["sampled_at"]),
            ):
                with self.subTest(peers=peers, ok=ok, last_ok=last_ok):
                    data["own"]["shared_with"] = peers
                    data.update(
                        ok=ok,
                        last_ok_at=last_ok,
                        error=None if ok else "Synthetic failure",
                    )
                    self.snapshot.write_text(json.dumps(data))
                    row = self.client.get("/api/monitor").json()["clusters"][0]
                    self.assertIsNone(row["error"])
                    self.assertEqual(row["snapshot"], data)

    def test_t103_malformed_shared_with_is_rejected(self):
        for invalid in (
            None,
            "batch-test",
            {},
            1,
            [None],
            [1],
            [True],
            [{}],
            [["batch-test"]],
        ):
            with self.subTest(invalid=invalid):
                data = monitor_snapshot()
                data["own"]["shared_with"] = invalid
                self.snapshot.write_text(json.dumps(data))
                row = self.client.get("/api/monitor").json()["clusters"][0]
                self.assertEqual(row["error"], "快照格式不正确")
                self.assertIsNone(row["snapshot"])

    def test_all_new_reads_leave_bytes_unchanged_and_reject_writes(self):
        def files():
            return {
                str(p.relative_to(self.root)): (
                    p.stat().st_mtime_ns,
                    hashlib.sha256(p.read_bytes()).hexdigest(),
                )
                for p in self.root.rglob("*")
                if p.is_file()
            }

        before = files()
        for uri in [
            self.base,
            self.opt,
            "/api/monitor",
            self.base + "/analyses/cluster-demo/representatives.xyz",
        ]:
            self.assertEqual(self.client.get(uri).status_code, 200)
            for method in ("post", "put", "patch", "delete"):
                self.assertEqual(getattr(self.client, method)(uri).status_code, 405)
            self.assertEqual(
                self.client.get(
                    uri, headers={"origin": "https://untrusted.invalid"}
                ).status_code,
                403,
            )
        self.assertEqual(files(), before)

    def test_named_clusters_optional_slurm_fields_and_isolated_errors(self):
        data = monitor_snapshot()
        data["own"]["core_cap"] = 96
        for job in data["own"]["jobs"]:
            for key in ("mem", "walltime_limit", "start_time"):
                job.pop(key, None)
        data["cluster"].update(
            name="batch",
            scheduler="slurm",
            hardware_capacity_known=False,
            nodes=[],
            queues=[],
            cores_total=0,
            cores_used=0,
            budget=dict(core_hours=100, used=1.5, reserved=0.25),
            expires="2099-01-01",
            storage_kib=1024,
            expiry_warning=None,
        )
        named = self.root / ".ag-monitor/batch"
        named.mkdir()
        path = named / "latest.json"
        path.write_text(json.dumps(data))
        rows = self.client.get("/api/monitor").json()["clusters"]
        self.assertEqual([row["name"] for row in rows], ["batch", "default"])
        self.assertEqual(rows[0]["snapshot"]["cluster"]["budget"]["used"], 1.5)
        # Failed sampling retains saved values; UI receives the original age and failure.
        data.update(
            ok=False, error="Synthetic failure", last_ok_at="2000-01-01T00:00:00Z"
        )
        path.write_text(json.dumps(data))
        self.assertEqual(
            self.client.get("/api/monitor").json()["clusters"][0]["snapshot"], data
        )
        for key in (
            "budget",
            "expires",
            "storage_kib",
            "expiry_warning",
            "hardware_capacity_known",
        ):
            data["cluster"].pop(key)
        path.write_text(json.dumps(data))
        self.assertIsNone(
            self.client.get("/api/monitor").json()["clusters"][0]["error"]
        )
        data["cluster"]["budget"] = dict(core_hours=100, used=True, reserved=0)
        path.write_text(json.dumps(data))
        rows = self.client.get("/api/monitor").json()["clusters"]
        self.assertEqual(rows[0]["error"], "快照格式不正确")
        self.assertIsNotNone(rows[1]["snapshot"])
        path.unlink()
        path.symlink_to(self.snapshot)
        self.assertIn(
            "Unsafe", self.client.get("/api/monitor").json()["clusters"][0]["error"]
        )

    def test_two_default_locations_remain_explicit(self):
        named = self.root / ".ag-monitor/default"
        named.mkdir()
        (named / "latest.json").write_text(json.dumps(monitor_snapshot()))
        rows = self.client.get("/api/monitor").json()["clusters"]
        self.assertEqual([r["source"] for r in rows], ["named", "legacy"])
        self.assertTrue(all(r["ambiguous"] for r in rows))
        self.snapshot.unlink()
        rows = self.client.get("/api/monitor").json()["clusters"]
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["ambiguous"])
