"""Invented small-molecule and scheduler records; never live cluster data."""

from datetime import datetime, timezone
import json
import os
from tests.study_fixture import ATOMS, create_preview_studies


# Saved facts variants are deliberately independent of the synthetic atom count.
# They exercise display fidelity, not the scientific validity of a mode analysis.
VIBRATION_FACTS_CASES = {
    "complete": {
        "n_vibrational_modes": 3,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": True,
        "frequency_unavailable_reason": None,
    },
    "incomplete": {
        "n_vibrational_modes": 2,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": False,
        "frequency_unavailable_reason": "Synthetic frequency section is truncated",
    },
    "unknown": {
        "n_vibrational_modes": None,
        "expected_vibrational_modes": None,
        "vibrational_modes_complete": None,
        "frequency_unavailable_reason": None,
    },
    "legacy": {},
    "equal-null": {
        "n_vibrational_modes": 3,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": None,
    },
    "equal-missing": {
        "n_vibrational_modes": 3,
        "expected_vibrational_modes": 3,
    },
    "zero": {
        "n_vibrational_modes": 0,
        "expected_vibrational_modes": 0,
        "vibrational_modes_complete": True,
        "frequency_unavailable_reason": None,
    },
    "count-only": {"n_vibrational_modes": 2},
    "expected-only": {"expected_vibrational_modes": 3},
    "true-mismatch": {
        "n_vibrational_modes": 2,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": True,
    },
    "false-equal": {
        "n_vibrational_modes": 3,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": False,
    },
    "missing-reason": {
        "n_vibrational_modes": 2,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": False,
        "frequency_unavailable_reason": None,
    },
    "empty-reason": {
        "n_vibrational_modes": 2,
        "expected_vibrational_modes": 3,
        "vibrational_modes_complete": False,
        "frequency_unavailable_reason": "",
    },
}


# Each value is a manifest-field overlay, including absence for legacy input.
# These are deliberately invalid as well as valid saved records, not ag output.
RELAXED_INPUT_CASES = {
    "valid": {
        "input_validation": {
            "mode": "relaxed",
            "skipped_checks": [
                "route keyword support", "custom basis parsing", "SCRF=Read parsing"
            ],
            "method_verified": False,
        }
    },
    "empty": {"input_validation": {
        "mode": "relaxed", "skipped_checks": [], "method_verified": False,
    }},
    "non-string": {"input_validation": {
        "mode": "relaxed", "skipped_checks": ["route support", 42], "method_verified": False,
    }},
    "wrong-list": {"input_validation": {
        "mode": "relaxed", "skipped_checks": "route support", "method_verified": False,
    }},
    "null-list": {"input_validation": {
        "mode": "relaxed", "skipped_checks": None, "method_verified": False,
    }},
    "verified": {"input_validation": {
        "mode": "relaxed", "skipped_checks": ["route support"], "method_verified": True,
    }},
    "wrong-method": {"input_validation": {
        "mode": "relaxed", "skipped_checks": ["route support"], "method_verified": "false",
    }},
    "unknown": {"input_validation": {
        "mode": "future-mode", "skipped_checks": ["route support"], "method_verified": False,
    }},
    "legacy": {},
    "null": {"input_validation": None},
    "non-object": {"input_validation": "relaxed"},
    "array": {"input_validation": []},
    "empty-object": {"input_validation": {}},
    "missing-checks": {"input_validation": {
        "mode": "relaxed", "method_verified": False,
    }},
    "missing-method": {"input_validation": {
        "mode": "relaxed", "skipped_checks": ["route support"],
    }},
    "missing-mode": {"input_validation": {
        "skipped_checks": ["route support"], "method_verified": False,
    }},
    "whitespace": {"input_validation": {
        "mode": "relaxed", "skipped_checks": ["route support", " \t\n "], "method_verified": False,
    }},
    "escaped": {
        "input_validation": {
            "mode": "relaxed",
            "skipped_checks": [
                '<img src="x" onerror="window.relaxedInputXss=1">',
                '<script>window.relaxedInputXss=1</script>',
                '[synthetic link](javascript:alert(1)) https://example.invalid/relaxed',
                '$(synthetic-command) `synthetic-command` & < > " quoted',
                "SyntheticLongCheck_" + "x" * 2400,
            ],
            "method_verified": False,
        }
    },
}


def add_relaxed_input_attempts(study):
    """Opt-in synthetic records; preserve the default browser demo inventory."""
    cases = [
        (name, fields, "fetched", True)
        for name, fields in RELAXED_INPUT_CASES.items()
    ]
    cases += [
        (state, RELAXED_INPUT_CASES["valid"], state, False)
        for state in ("submitted", "running", "failed")
    ]
    cases.append(("no-facts", RELAXED_INPUT_CASES["valid"], "fetched", False))
    for name, fields, state, has_facts in cases:
        attempt_id = "relaxed-" + name
        base = study / "attempts" / attempt_id
        base.mkdir()
        manifest = {
            "attempt_id": attempt_id,
            "label": "Synthetic relaxed-input " + name,
            "template": "gaussian",
            "parents": [],
            "science": {"method_basis": "Synthetic method record; unverified"},
            **fields,
        }
        (base / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (base / "status.json").write_text(json.dumps({"state": state}), encoding="utf-8")
        if has_facts:
            (base / "facts.json").write_text(
                json.dumps({
                    "schema": "ag-facts/1",
                    "termination": "normal",
                    "route": "# HF/STO-3G Opt Freq",
                }),
                encoding="utf-8",
            )


def orientation(kind="Standard", shift=0):
    lines = [
        f" {kind} orientation:",
        " ---------------------------------------------------------------------",
        " Center Atomic Atomic Coordinates (Angstroms)",
        " Number Number Type X Y Z",
        " ---------------------------------------------------------------------",
    ]
    lines += [
        f" {i} {6 if a[0] == 'C' else 1} 0 {a[1] + shift:.6f} {a[2]:.6f} {a[3]:.6f}"
        for i, a in enumerate(ATOMS, 1)
    ]
    return (
        "\n".join(
            lines
            + [" ---------------------------------------------------------------------"]
        )
        + "\n"
    )


def opt_log(converged=True):
    text = " Synthetic butane optimization; invented values, not a calculation.\n # HF/STO-3G Opt Freq\n ------------------\n"
    for step, energy in enumerate([-157.0, -157.002, -157.0025], 1):
        text += orientation("Input", step * 0.1 + 1)
        if step != 2:
            text += orientation("Standard", step * 0.1)
        text += f" SCF Done: E(RHF) = {energy:.8f} A.U. after 10 cycles\n Step number {step} out of a maximum of 20\n"
        text += " Item Value Threshold Converged?\n"
        for label, threshold in [
            ("Maximum Force", 0.00045),
            ("RMS Force", 0.00030),
            ("Maximum Displacement", 0.0018),
            ("RMS Displacement", 0.0012),
        ]:
            yes = converged and step == 3
            text += f" {label} {threshold * (0.5 if yes else 2):.8f} {threshold:.8f} {'YES' if yes else 'NO'}\n"
    if converged:
        text += " Optimization completed.\n Stationary point found.\n" + orientation(
            "Standard", 99
        )
        text += " SCF Done: E(RHF) = -156.9 A.U. after 10 cycles\n Harmonic frequencies (cm**-1)\n Frequencies -- 100 200 300\n Normal termination of Gaussian (synthetic).\n"
    else:
        text += " Optimization stopped.\n Number of steps exceeded\n Error termination (synthetic).\n"
    return text


def monitor_snapshot():
    return {
        "schema": "ag-monitor/1",
        "sampled_at": datetime.now(timezone.utc).isoformat(),
        "interval_seconds": 120,
        "ok": True,
        "error": None,
        "last_ok_at": None,
        "own": {
            "cores_in_use": 8,
            "core_cap": 44,
            "jobs": [
                {
                    "job_id": "synthetic-001",
                    "name": "synthetic-opt",
                    "state": "R",
                    "queue": "demo",
                    "cores": 8,
                    "mem": "12gb",
                    "walltime_used": "00:03:12",
                    "walltime_limit": "01:00:00",
                    "start_time": None,
                    "study": "butane-demo",
                    "attempt": "opt-demo",
                }
            ],
        },
        "cluster": {
            "nodes": [
                {
                    "name": "synthetic-node",
                    "state": "free",
                    "cores_total": 44,
                    "cores_used": 8,
                }
            ],
            "queues": [{"name": "demo", "running": 1, "queued": 0}],
            "cores_total": 44,
            "cores_used": 8,
        },
        "warnings": [
            {
                "kind": "scheduler-residue",
                "job_id": "synthetic-002",
                "study": "butane-demo",
                "attempt": "waiting",
                "detail": "需人工确认后 ag cancel",
            },
            {
                "kind": "future-kind",
                "job_id": None,
                "study": None,
                "attempt": None,
                "detail": "运行 ag status 核对",
            },
        ],
    }


def create_results_studies(root, *, relaxed_inputs=False):
    study = create_preview_studies(root)
    with (study / "study.md").open("a") as f:
        f.write(
            "\n## 待你决定\n- 合成示例：是否进入下一轮人工审阅。\n\n## 里程碑签字\n| 里程碑 | 展示并确认的对象 | 日期 | 签字人 | 人的确认原意 |\n|---|---|---|---|---|\n| 结构 | 合成正丁烷 | 2026-01-01 | Synthetic reviewer | 仅为查看器演示 |\n| 代表构象集合 | 合成集合 | 待签 | 待签 | 待确认 |\n| 最终结果 | 虚构能量 | 待签 | 待签 | 待确认 |\n\n## 进度日志\n- 2026-01-02：准备合成数据，等待人工审阅演示。\n"
        )
        f.write(
            '\n## 安全检查\n**Markdown 正常渲染**\n\n[当前阻塞](#当前阻塞) [外部链接](https://example.invalid) [脚本链接](javascript:alert(1))\n\n<script>window.syntheticXss=1</script>\n<img src="x" onerror="window.syntheticXss=1">\n\n![外部图片](https://example.invalid/image.png)\n'
        )
    for name, converged in [("opt-demo", True), ("opt-failed", False)]:
        base = study / "attempts" / name
        (base / "outputs").mkdir(parents=True)
        (base / "outputs" / "optimization.log").write_text(opt_log(converged))
        (base / "manifest.json").write_text(
            json.dumps(
                {
                    "label": "Synthetic optimization",
                    "template": "gaussian",
                    "parents": [],
                    "cluster": "default",
                    "cores": 8,
                    "science": {"method_basis": "HF/STO-3G"},
                }
            )
        )
        (base / "status.json").write_text(
            json.dumps({"state": "fetched", "elapsed": "00:03:12"})
        )
        (base / "facts.json").write_text(
            json.dumps(
                {
                    "schema": "ag-facts/1",
                    "route": "# HF/STO-3G Opt Freq",
                    "opt_converged": converged,
                    "termination": "normal" if converged else "error",
                    "energies": {"scf": -157.0025, "g": -156.91}
                    if converged
                    else {"scf": -157.0025},
                    "n_imag": 0 if converged else None,
                    "frequencies_low": [100, 200, 300] if converged else [],
                }
            )
        )
    folder = study / "analyses" / "cluster-demo"
    folder.mkdir()
    (folder / "representatives.xyz").write_bytes(
        (study / "analyses" / "representatives.xyz").read_bytes()
    )
    for i, report in enumerate(sorted((study / "analyses").glob("*.json"))):
        os.utime(report, (1767312000 + i * 3600, 1767312000 + i * 3600))
    snap = study / "attempts/anti/snapshots/synthetic-capture"
    snap.mkdir(parents=True)
    (snap / "snapshot.json").write_text(
        json.dumps(
            {
                "schema": "ag-log-snapshot/1",
                "attempt_id": "anti",
                "created_at": "2026-01-01T12:00:00+00:00",
                "file": "butane.log",
                "read_bytes": 128,
                "remote_size": 256,
                "truncated": True,
                "sha256": "a" * 64,
                "notice": "运行中快照，不是结果，不能用于签字或分析。",
                "progress": {
                    "program": "gaussian",
                    "scope": "captured_fragment",
                    "scf_done_count": 2,
                    "last_step_number": 1,
                },
            }
        )
    )
    (snap / "butane.log").write_text("RAW_SNAPSHOT_LOG_SENTINEL")
    monitor = root / ".ag-monitor"
    monitor.mkdir()
    (monitor / "latest.json").write_text(json.dumps(monitor_snapshot()))
    if relaxed_inputs:
        add_relaxed_input_attempts(study)
    return study
