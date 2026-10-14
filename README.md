# Auto-Gaussian Study Viewer

A local viewer for the new `ag` study directory architecture, read-only by default.
Optional actions delegate to a startup-selected local `ag` executable. The viewer
has no calculation-package, SSH, scheduler, database, or archive dependency.

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
    inputs/*
    outputs/*.log or *.out
  structures/<name>/*.xyz
  analyses/*.json, *.md, *.csv, *.xyz, *.txt
  analyses/<name>/*.xyz
```

- Study descriptions render Markdown with raw HTML disabled and only local heading
  anchors allowed; images and external links are disabled. Human reviews remain
  escaped text. The viewer does not write signatures, interpretations, or edits.
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
  Dedup and cluster JSON outputs are shown verbatim; XYZ files use the frame viewer. No complete sampling or scientific
  acceptance is inferred from any saved status or number.

## Results, optimization, and server snapshots (T7c)

Studies open on **结果**. The sortable Attempt table displays saved manifest,
status and facts values: route/template, termination, SCF energy, imaginary count,
lowest printed frequency (`frequencies_low[0]`) and G. Missing values stay blank.
Click a row to open the Attempt. The same page includes saved thermochemistry and
representative XYZ frames from `analyses/`, including one directory level below it.
Both XYZ locations also support direct links and the existing frame controls.

**优化过程** on an Attempt reads a selected output log (32 MiB maximum). It shows
SCF values, each printed convergence value/threshold/YES–NO result, and playable
structures with Standard orientation preferred over Input orientation within the
same cycle. Partial last steps keep missing fields explicit. Link1 jobs and step
number restarts have separate curves; post-optimization frequency coordinates are
excluded. The first energy in each segment is the plotting reference, converted
using 627.5094740631 kcal/mol per Hartree. This display-only conversion neither
changes facts nor supplies scientific acceptance. Parsing is adapted solely from
`83184af:autog_frontend/calculation_analysis.py`; there is no legacy package import.

The **服务器** navigation (`#server`) GETs `.ag-monitor/latest.json` every 30 seconds.
The [ag-monitor/1 definition](docs/ag-monitor-1.md) is reproduced from the task's
producer specification. The adapter only reads that fixed file, through the
existing descriptor-relative `O_NOFOLLOW` traversal, at most 2 MiB. Hidden root
directories do not appear as studies. Missing files show
`请在终端运行 ag monitor --watch 120`. The page shows sampling age, expiry after three
sampling intervals (no expiry for a one-shot null interval), previous data marked
**非最新** on sampling failure, own cores/jobs, cluster nodes/queues and unchanged
warning text. Unknown schemas and malformed required fields are rejected with
**快照格式不正确**. It never starts a sampler or connects to the cluster. Sampling and last-success
timestamps display in the browser’s local time zone, with the original UTC sample
available on hover. If all three optional T11 fields `cores_running`, `cores_queued`
and `committed_cap` are present, the own-core panel shows running, queued and total
cap separately. Older snapshots retain the original display.

The sole new direct dependency is pinned `react-markdown@10.1.0`, with its
transitive tree locked in `web/pnpm-lock.yaml`. It provides Markdown parsing
without HTML injection; `skipHtml`, fragment-only URLs and disabled images keep
the existing local-data restrictions intact. No raw-HTML plugin is installed.

Synthetic screenshots: [results](docs/t7c/results.png),
[optimization](docs/t7c/optimization.png), [server](docs/t7c/server.png).
The invented numbers and scheduler records are UI examples, not research results.

## Preview before submission, input comparison, and diagnosis

Prepared/submitting Attempts default to their input structure. Choose **输入结构 /
最终结构** when a final XYZ is present. The parameter panel displays charge,
multiplicity, formula, atom count, the full route, `%nprocshared`, `%mem`, and the
saved resource tier/walltime. Input SHA-256, the manifest hash, bundle hash and
saved scientific summary are available beside the structure for comparison with
`ag prepare`'s confirmation summary. A hash mismatch is shown explicitly. The
viewer neither repairs files nor replaces the submit confirmation.

GJF parsing is adapted from `Auto-Gaussian/ag/src/ag/gaussian_input.py`'s `validate`
implementation (read-only reference; no import). It retains the Link0 whitelist,
resource match/85% memory rule, route/title/charge grammar and Cartesian coordinate
format. Link1, internal coordinates, includes/external programs and additional
sections are unavailable with a per-file `无法预览：…` message. XYZ is parsed
directly; its charge/multiplicity come from the saved xTB/CREST template parameters
(defaults match ag). Display requires known elements, finite coordinates and no
more than 2,000 atoms. If more than one GJF/XYZ input exists, the viewer reports
ambiguity instead of guessing which file will run.

**输入文件** reads one selected UTF-8 file in `inputs/` at a time, up to 1 MiB.
**与父 Attempt 输入对比** allows only parents recorded in that Attempt's manifest;
select the parent and its input filename. Removed lines are red, additions green.
At most 2,000 diff lines are displayed, with an explicit truncation notice; files
remain individually readable in full. Very large line-count comparisons use a
linear whole-file replacement diff to avoid quadratic alignment. Differences in
final newline are identified separately. No diff files are written.

**结构文件** lists XYZ files under `structures/<name>/` and `analyses/`. Each
request validates the bounded trajectory but returns only the selected frame,
frame count and its comment (for example, a force-field energy). Previous/next
buttons and a frame-number input switch frames. Limits: 32 MiB per file, 5,000
frames, 2,000 atoms per frame. Oversized or damaged files show an error; the browser
never receives every frame at once. XYZ analysis files are no longer inlined in
the study JSON.

**日志关键词** performs literal, case-sensitive UTF-8 searches in backend chunks,
then requests the normal page around the matched line. Search-next starts after
the previous match and reports exhaustion without wrapping. The two termination
buttons locate the final `Error termination` or `Normal termination`. Search is
limited to 32 MiB and returns only a line index/counts, never the full log.

Direct links use URL-encoded path components:

```text
#/<study>/<attempt>
#/<study>/structures/<name>/<file.xyz>
#/<study>/analyses/<file.xyz>
```

Attempt links open the structure view; missing IDs show an error rather than
silently choosing another Attempt. Browser back/forward navigation is supported.
Only the URL fragment changes; viewing requests use GET through the same
local/same-origin/path checks. Optional calculation actions use the POST below.

## Read-only and local boundary

With actions disabled, only GET/HEAD are allowed. The server binds exclusively to loopback; remote peers,
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
have been removed. Obsolete native/pre-v31/navigation registration documents and
the publication source map have been deleted. This README is the current guide.

## Optional local ag actions (T7d)

Start with `--enable-actions`, optionally `--ag <executable>` (otherwise PATH).
The executable is fixed at startup; HTTP cannot select it or supply file paths.
The page header reads **可操作（经 ag）** when enabled and **只读** otherwise.
Startup runs only `ag --version` and refuses actions if it fails. It reads the
`local.studies_root` and `resources.tiers` values from ag’s existing local config
`~/.config/ag/config.toml`; the viewer root must match. Resource/root changes
require a restart. This avoids acting on a different same-named study or writing
resource directives from stale settings. Nothing connects to a cluster at startup.

On an Attempt, **刷新状态** runs `ag status --json <id>` (one selected Attempt,
matching the current CLI), and **取回结果** runs `ag fetch --json <id>`.
**基于此新建** starts from its unique Gaussian input. Edit the full input, tier,
walltime, label, parent relation and method basis. Resource lines are regenerated
from the local tier: its core count and 80% of its memory in decimal MB, below ag’s
85% ceiling. The server enforces the same transformation. It exclusively creates
`<study>/drafts/<UTC timestamp>-<label>.gjf` using descriptor-relative
`O_EXCL | O_NOFOLLOW`; it never edits an existing Attempt. ag receives:

```text
ag prepare --json --study <server-resolved-study> --template gaussian
  --input <new-draft> --tier <tier> --walltime <HH:MM:SS> --label <label>
  --parent <original-id> --relation <relation> --method-basis <basis>
```

A successful JSON result opens the new input structure and parent input diff.
Only `prepared` Attempts show **提交**; its first click displays the structure
link, charge/multiplicity, full route, tier, walltime and first 12 bundle-hash
characters. The second click runs `ag submit --json <id>`. **取消计算** runs
`ag cancel --json <id>` only for submitted/running states or an Attempt named in
a `scheduler-residue` monitor warning. Both display **请在 Mac 弹窗中确认**.
The actual Mac confirmation, one-submit claim, core limits, upload and hash checks
remain in ag. No confirmation bypass, delete, existing-input edit or resubmit
command is exposed. Unknown/failed_presubmit Attempts cannot be used for new
preparations in this UI; resolve them with Codex and ag first.

All commands use fixed argv lists with `shell=False`, a single nonblocking operation
lock, and a 420-second HTTP wait. Actions use `Popen`; reaching that wait limit
does not kill or terminate ag. A background thread continues draining stdout/stderr
and holds the operation lock until ag exits, including for status/fetch/cancel.
Other operations still receive 409 during that time. The page shows the partial
stdout/stderr available when the wait ends and an explicit running notice, with no
exit code invented and no automatic retry. After ag exits, use ag status to check
the result. Normal completion displays the full streams and actual exit code. A
successful prepare response without a valid JSON identity is retained for manual
inspection; human-readable output is never parsed. ag writes its own journal.
**study.md 中的计划和结论仍由 Codex 更新**.

POST `/api/actions` is registered only when enabled. A fresh random token is embedded
in the served page and required in `X-AG-Token`. Existing loopback, Host and Origin
checks still apply. Requests accept only each action’s fixed fields, at most 1 MiB;
study/Attempt components cannot be paths or command options. A second concurrent
operation receives 409. Opening a second browser tab does not create another lock.
Use a single viewer process per local study root; ag owns cross-process submit safety.

The test executable records argv and emits configured streams. Browser tests run
two temporary synthetic servers (default read-only and fake-ag actions). They do
not import or execute real ag, SSH, Gaussian, or Mac dialogs. Synthetic screenshots:
[new input](docs/t7d/new-attempt.png), [preview and summary](docs/t7d/preview-submit.png),
[submitted output](docs/t7d/submitted.png), [local time and T11 cores](docs/t7d/server-t11.png).
These illustrate software behavior only. Execution-related changes require the
supervisory review before a human merges the PR.

## Multi-cluster adaptation status (T7e)

T7e is blocked on a backend read-only configuration command. No multi-cluster
actions or monitoring support is claimed by this documentation change. The
existing T7d adapter still reads top-level `resources.tiers`; it cannot select
`clusters.<name>.resources.tiers`. Do not use it to prepare named-cluster work.

Checked against [Auto-Gaussian #229](https://github.com/anakine800-tech/Auto-Gaussian/pull/229)
and backend main `ac28a494b7ae9a699d0ea1f6822bd637f31075ec`:

- `config.py` handles legacy configuration as `default`, named clusters, and a
  mixed configuration with an implicit legacy `default` cluster.
- The CLI has `prepare --cluster`, but no command returns the configured cluster
  list and each cluster's resource tiers. `list --json` lists Attempts, while
  `doctor --json` contacts the cluster and does not expose its tier list.
- Legacy monitoring writes `.ag-monitor/latest.json`; named clusters write
  `.ag-monitor/<cluster>/latest.json`, including a named `default` cluster.
- Slurm snapshots currently expose `cluster.storage_kib` and
  `cluster.expiry_warning`. They do not expose budget totals, used/reserved
  core-hours, or an expiry date. Missing optional values must stay unavailable.

Before frontend implementation resumes, ag needs a **local, read-only JSON
configuration query**. The backend should choose and implement the command name;
no proposed command is treated as available. It must provide the configured
study root for the existing root-match check, normalized cluster names and
scheduler types, and each cluster's tier names, cores and memory in GB. It must
apply ag's own legacy/mixed-configuration handling without opening a remote
connection or changing files, and omit SSH credentials, connection identities
and remote paths. This lets the frontend use the same cluster/resource selection
as `ag prepare` without duplicating the TOML parser. The frontend must not read
ag's private budget ledger; budget display awaits producer-defined snapshot
fields if ag adds them.

After that interface is available, T7e still needs the parent-cluster default,
`--cluster` forwarding, cluster-dependent tiers, the cross-cluster warning
“同一能量曲线内的物种应在同一集群计算”, per-cluster monitor sections, Attempt/submit
cluster labels, and estimated core-hours from cores × walltime. Synthetic tests
must cover two clusters, legacy configuration, tier switching, the warning,
monitor sections, and absent optional fields. Remove this limitation only after
those behaviors are implemented and verified. Execution-related changes await
supervisory review before human merge.

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
