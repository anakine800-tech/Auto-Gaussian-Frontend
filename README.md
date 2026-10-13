# Auto-Gaussian Study Viewer

A local, strictly read-only viewer for the new `ag` study directory architecture.
No calculation package, database, SSH connection, scheduler, task queue, project
library or archive import is used. Submit and cancel calculations through `ag`.

## Run locally

Requires Python 3.11–3.13, Node.js and pnpm matching `web/package.json`.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install setuptools==82.0.1
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python -m pip install --no-deps --no-build-isolation .
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
.venv/bin/python -B -m autog_frontend --studies-root "$AG_STUDIES_ROOT" --ui-directory "$PWD/web/dist"
```

Set `AG_STUDIES_ROOT` to the existing parent of your study directories. Alternatively,
omit `--studies-root` and use the environment variable alone. `--port` defaults to
8765. Open the loopback URL printed by the process. Use canonical paths without
symbolic links (on macOS, system aliases such as `/tmp` may themselves be links).
A missing root is an error; the viewer never creates it.

The API can run without `--ui-directory`. The optional `--ui` flag uses bundled
`autog_frontend/ui` assets if a distributor includes them in a wheel. The ordinary
source installation above serves the explicit Vite build.

## Files displayed

```text
<studies_root>/<study_id>/
  study.md
  attempts/<attempt_id>/
    manifest.json
    status.json
    facts.json
    review.md
    final.xyz
    outputs/*.log or *.out
  analyses/*.json, *.md, *.csv, *.xyz, *.txt
```

- Study description and human review are displayed as escaped text, preserving their
  contents. The viewer does not write signatures, interpretations, or edits.
- Attempt states are read as saved, including `unknown`. Refresh rereads local
  files. It does not query a cluster or change a state.
- The relationship graph reads `manifest.parents[].attempt_id` and `relation`.
  Missing parents remain visible. Cycles and shared children do not cause traversal
  loops. The accompanying table lists every edge.
- The molecule viewer uses `final.xyz` beside `facts.json`. It retains rotation,
  zoom, inferred bonds, and geometric measurements. It never follows paths embedded
  in JSON, including `final_geometry` and remote directory fields.
- Vibration display directly parses the selected Gaussian log in memory, reusing
  the independent Cartesian displacement decoder in `autog_frontend/vibrations.py`.
  Standard low-precision `Atom AN X Y Z` tables are supported. The last Standard
  orientation must have one unambiguous subsequent harmonic analysis. Truncated,
  ambiguous, reordered, or unsupported displacement data is reported unavailable.
  Animation uses the log's reference coordinates, not potentially rotated XYZ
  coordinates. It is a display aid, not TS or scientific validation.
- Output logs are paged in 120-line windows; the API accepts up to 500 lines per
  page. Log display supports up to 256 MiB with a 1 MiB line limit. Vibration
  decoding supports up to 32 MiB; other documents up to 4 MiB. Larger files receive
  an explicit error rather than a partial result. Missing and malformed documents
  are reported per file so other available results remain readable.
- `ag-thermo/1` tables display the saved `rows`, degeneracy, population (fraction
  converted to percent), E/ZPE/H/qh_H/qh_G, relative G, `weighted_mean_G` and
  `ensemble_G`. They are not recalculated. Settings and full JSON remain inspectable.
  Dedup and cluster outputs are shown verbatim. No complete sampling or scientific
  acceptance is inferred from any saved status or number.

## Read-only and local boundary

Only GET/HEAD are allowed. The server binds exclusively to loopback; remote peers,
non-local Host headers, cross-site requests, and foreign Origins are rejected.
No permissive CORS is enabled. Do not put this private-data viewer behind a reverse
proxy or expose it on a network interface.

All study paths are traversed with descriptor-relative `O_NOFOLLOW` opens, including
ancestor directories. All symbolic links are rejected, including links that point
inside the root; regular files only. This prevents traversal and symlink replacement
from exposing files outside the selected root. Paths in manifests are displayed but
never opened. No file writes, sidecars, caches, network calls, or subprocesses occur
in the study adapter. `-B` prevents Python bytecode writes during launch.

This is an intentionally incompatible replacement of the former query-service
frontend. Old database/profile/task-queue/import/monitor startup flags and APIs
have been removed. Older documents under `docs/` describe historical releases;
this README is the current launch and behavior guide.

## Synthetic demo and tests

The fixture generator uses only synthetic normal butane with invented energies,
three illustrative displacement modes, and local statuses. It is not a Gaussian
calculation or a complete frequency analysis. No research data is included. The
runtime never imports or invokes the generator.

```sh
# Choose a new demo parent outside the repository; existing study is not overwritten.
.venv/bin/python -B -m tests.study_fixture "$DEMO_STUDIES_ROOT"
.venv/bin/python -B -m autog_frontend --studies-root "$DEMO_STUDIES_ROOT" --ui-directory "$PWD/web/dist"

.venv/bin/python -B -m unittest discover -s tests -t . -v
pnpm --dir web build
pnpm --dir web exec playwright install chrome
AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test
```

Tests use temporary study directories and check file contents/mtimes remain
unchanged after all reads, symlink swaps and escaping paths are refused, no
subprocess or calculation-package import is used, unknown/missing data stays
explicit, pagination reconstructs exact log text, and Gaussian vectors retain
atom and frequency order. Browser checks exercise the molecule, vibration,
thermochemistry, graph, responsive navigation, and read-only HTTP traffic.
CI installs this repository without checking out the calculation backend.
