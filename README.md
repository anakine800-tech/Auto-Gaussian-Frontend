# Auto-Gaussian Study Viewer v4.4.0

**配合 ag 4.4.0 使用。** This is the v4.4.0 release candidate; see [CHANGELOG.md](CHANGELOG.md#v440).

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

## 两种启动模式与兼容范围

默认只读，不注册操作 POST 接口、不显示操作按钮；刷新页面只重读本地文件，不查询服务器。
完成上面的安装和构建后，使用已存在且不含符号链接的 study 根目录启动：

```sh
.venv/bin/python -B -m autog_frontend \
  --studies-root '<STUDIES_ROOT>' --ui-directory "$PWD/web/dist"
```

显式开启操作模式：

```sh
.venv/bin/python -B -m autog_frontend \
  --studies-root '<STUDIES_ROOT>' --ui-directory "$PWD/web/dist" \
  --enable-actions --ag '<AG_WORKTREE>/.venv/bin/ag'
```

尖括号为占位符，替换成本机值后执行；每个 worktree 使用自己的 `.venv`。
`--ag` 省略时从 PATH 查找，HTTP 请求不能指定可执行文件。
启动执行 `ag --version`，失败则拒绝开启；此检查不验证精确版本或集群能力。
操作模式允许通过 ag 刷新远程状态、取回结果、基于已有输入新建 Attempt、提交及取消。
提交/取消仍须人亲手点击 Mac 系统确认框，前端不直接连接 SSH 或调用调度器，
也不提供重提 UNKNOWN、覆盖旧 Attempt 或绕过确认的接口。

服务器监控的唯一数据来源是 **ag monitor 快照**，不是浏览器直接查询服务器：

- 旧单集群配置：在独立终端运行 `ag monitor --watch 120`，生成
  `<STUDIES_ROOT>/.ag-monitor/latest.json`，前端每 30 秒读取该固定文件。
- ag 4.0.0 多集群配置：快照位于
  `<STUDIES_ROOT>/.ag-monitor/<CLUSTER>/latest.json`。
- 前端不会启动采样器；缺失、过期和采样失败均需按界面提示解释，不能视为服务器空闲。

## 只读模式在计算机上启动

1. 同步已合并的前端 main，按上面的步骤安装并构建；配合 ag 4.4.0 使用。
2. 将下列占位符换成本机前端目录和已有 study 根目录。使用不含符号链接的规范路径。
3. 启动后打开终端显示的本机 URL，确认右上角为 **只读**。此启动方式不调用 ag。

```sh
cd '<FRONTEND_DIRECTORY>'
.venv/bin/python -B -m autog_frontend \
  --studies-root '<STUDIES_ROOT>' --ui-directory '<FRONTEND_DIRECTORY>/web/dist'
```

从 Study 概览或“分析”打开构象集合、选择候选并查看三维结构，再通过来源 Attempt 链接打开
CREST 输出逐帧查看；浏览器后退恢复集合候选。TS Attempt 中点击“解析振动位移”，
选中虚频后可启用审阅模式。“作业”页只读取已保存的 monitor 快照；缺失时按提示
单独运行采样器。合并后的实际 study 检查由负责人完成，仅在 PR 评论记录“可用”
或“有问题（类别）”，不上传研究截图或数值。

## 四个入口与链接

- **作业**：`#/jobs`，显示本地 monitor 快照。
- **Study**：`#/s/<study>` 展示 KPI、待处理事项、最近分析和折叠的研究说明 / 进度日志；
  `/attempts` 为可排序筛选的 Attempt 表，筛选排序保存在 URL，
  `/a/<attempt>` 为详情。首页打开上次访问的 Study，无记录时取列表第一项。
- **分析**：`#/s/<study>/analysis`；集合、IRC 和普通分析文件分别使用
  `/analysis/ensemble/<报告>`、`/analysis/irc/<报告>`、`/analysis/file/<文件>`。
- **文件**：`#/s/<study>/files`；研究说明、结构文件、关系图和其他分析文件。

旧 hash 自动替换为新链接，不增加重定向历史。候选、路径点和旧集合筛选参数保留。
上下文栏“返回列表”恢复来源页面的筛选、排序和滚动；浏览器后退同样可用。
全局搜索只检索当前浏览器会话已读取的 Study、Attempt 标签和文件名；读取过
Attempt 详情后，输入、日志和记录文件也会出现在搜索结果中。输入关键词不发请求，
选择结果时才读取目标。页面刷新会清空内存搜索索引。
折叠状态与既有集合表排序记在本机浏览器中；存储不可用时使用默认值，仍可正常阅读。
Attempt 表的筛选和排序保存在 URL，刷新与返回时保留。

T94–T98a 均已合并：统一框架与组件、Study 概览与 Attempt 表、Attempt 详情与操作抽屉、作业页、分析入口和快速比较（含 termination / n_imag 列），以及 TS 立体标签报告只读查看。T87 提供 IRC 曲线与路径点结构。快速比较为前端计算、非正式结果；工具状态与报告不等于科学验收。
设计和验收记录见 [T94](docs/t94/design-checkpoint.md)；待审 / 待签计数、字段来源与
本次截图、字段规则与负载测量见 [T96](docs/t96/attempt.md)；[T95](docs/t95/overview.md) 截图保留。

## Files displayed

- 构象集合：结果页列出 `analyses/*.json` 与 `analyses/<group>/*.json` 中的
  `ag-ensemble/1`；校验后展示来源、各层保存值、缺失层、分页缩略图与 3D 结构。
  清单最多 4 MiB，XYZ 最多 32 MiB / 1000 帧 / 每帧 500 原子，超限报错。
  只读清单同目录的 `inputs.xyz.file`，核对文件与候选几何 SHA-256；不跟随 `path`。
  数值不作科学判断，不重算布居；不能跨路线比较的 xTB 值按路线展开。
  选中项保存在 `#/s/study/analysis/ensemble/group/name.json?candidate=1`，缩略图每页最多 50 个、可见时绘制。
- CREST Attempt 的 `outputs/crest_conformers.xyz`、`crest_best.xyz` 和
  `crest_ensemble.xyz` 可逐帧查看，沿用上述 XYZ 限制。注释中首个可解析的浮点数
  按 Hartree 显示，无数值则未知；相对最低已知帧按 627.5094740631 换算 kcal/mol。
  仅供显示，以 facts 和后端分析为准；缺失文件明确报错。


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
    outputs/crest_conformers.xyz, crest_best.xyz, crest_ensemble.xyz
  structures/<name>/*.xyz
  analyses/*.json, *.md, *.csv, *.xyz, *.txt, *.png, *.jpg, *.jpeg, *.webp, *.svg, *.html
  analyses/<name>/* (same supported types)
```

- Study descriptions and Markdown reports use pinned `remark-gfm@4.0.1` with
  raw HTML disabled. Tables, CSV and JSON object arrays share a sortable table
  (numeric columns sort numerically; other columns sort as text). Exact Attempt
  IDs open the existing comparison-structure reader and 3D preview.
- Local links resolve relative to the source document inside its study; links to
  known Attempts, structures and analyses keep their existing dedicated routes.
  Other files open at `#/<study>/file/<relative-path>`. Traversal outside the study
  and unsupported protocols become text with a reason. HTTP(S) links open a new
  tab with `noopener noreferrer`. Local images display inline with failure text.
- `GET /api/studies/{study}/files/{path}` reads only md/txt/csv/json/xyz,
  png/jpg/jpeg/webp/svg/html through descriptor-relative `O_NOFOLLOW`, with a
  regular-file check. Documents retain the 4 MiB limit; images use 10 MiB.
  `?document=true` returns decoded text or JSON with positioned parse errors;
  otherwise it returns the original bytes. All responses have `nosniff`.
  HTML uses an iframe with an empty sandbox, without scripts or same-origin
  permission. SVG is displayed only as an image. Both raw formats receive CSP
  `sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'`.
- CSV supports quoted fields, commas, escaped quotes and embedded line breaks;
  at most 5,000 data rows are displayed with a truncation notice. Invalid CSV
  retains its source and physical error line. Any valid report JSON shape is
  readable: object arrays use up to 30 union-key columns, scalar arrays use lists,
  other objects use a lazy expandable tree or formatted source, and scalars show
  their values. Known ag schemas retain their dedicated views. Syntax and UTF-8
  failures include line and column. Fixed ag records still validate object shape.
- Report discovery adds images and HTML at the existing directory depth. The
  directory groups nonempty categories by known schema, explicit JSON `kind` or
  Markdown front matter `kind`, then file type; it never guesses from names.
  Metadata reads stay within the document size limit, including late top-level
  schema/kind fields, and never return report rows in the directory response.
  Unchanged metadata is cached in process by path, nanosecond mtime and size;
  file identity/change time also invalidate replacements. Each lookup still
  checks the path with `O_NOFOLLOW`. The cache retains at most 1024 metadata
  entries, never file bodies. Known schemas retain thermochemistry / profiles,
  channel coverage and NCI groups; the existing fixed TS-label layout keeps its
  own group. The Other group has folder subgroups. Category evidence
  is shown beside each file. Reports, structure preview and wide tables adapt to
  narrow screens without page overflow.
- These T118 reading rules supersede the historical T7c link/image restrictions
  and the blanket no-cache statement below: report metadata may be cached in
  memory, with no disk cache. Human reviews remain escaped text. The viewer does not write
  signatures, interpretations, or edits.
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
- **模式审阅（T55）：** 选择振动模式后，来源面板显示 log 文件名、SHA-256
  （前 12 位，可展开）、按频率排序的模式序号、原始频率序号、频率和坐标方向。
  当前解码器仍只支持 Standard orientation，不新增 Input orientation 解析。
  依次点选两个原子可添加多组距离，编号从 1 开始；可逐对删除。
  原子对写入 URL 的 `modeScope` / `modePairs` 查询参数（在 `#` 之前），
  按 study、Attempt、log 哈希和原始模式序号隔离；刷新并重新选择该模式后恢复。
  平衡、正负位移距离及变化量均按“最大原子位移 = 归一化振幅”计算，默认 0.3 Å。
  原有动画默认仍为原始打印位移 × 显示幅度（默认 0.45）；勾选“启用审阅模式”后，
  动画才使用归一化振幅，并显示当前帧距离。关闭审阅模式后恢复原显示幅度。
  模式整体正负号任意；有限振幅距离变化可能不同于线性导数。
- **mode-review 报告对照：** 只扫描 `analyses/*.json` 及一层子目录的 JSON，
  沿用 4 MiB 文件读取上限和逐级 `O_NOFOLLOW` 路径检查；不打开 `source.log`。
  按 Attempt 和识别字段筛选，数值非有限、缺失必需字段、原子编号越界等问题单独显示。
  只有当前 log SHA-256、模式序号、频率和坐标方向对应时才带出报告原子对；
  URL 中已有的选择（含空列表）优先。多份报告由用户选择，显式选择会替换默认原子对。
  log 哈希不同显示“报告来自另一份 log，不自动带出”。报告振幅先同步到距离面板，
  正负方向逐项对照；绝对差值大于 0.001 Å 标记“不一致”。手动改振幅后需点击
  “使用报告振幅进行对照”，避免不同振幅混比。报告损坏不影响动画。
  数值对照仅说明两处显示是否一致，不作过渡态或反应方向的科学判断。
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

## 构象集合与 CREST 输出（T54）

“结果”页识别 `analyses/*.json` 以及下一层目录的 `ag-ensemble/1` 清单。
清单必须显式引用同目录 XYZ 文件并匹配 SHA-256；映射、能量、布居和缺失层均来自
保存的数据，不按文件名推断构象对应关系，不重新计算去重或热化学。
能量表、缩略图与三维查看器联动，候选选择保存到 URL；可排序列支持排序，
缩略图每页最多 50 个。缺失或歧义的值留空，悬停可看原因；分路线能量标为
“各路线 xTB 能量不可直接比较”，不能作跨路线排序。来源链接打开对应 Attempt。
缩略图包含 B、Cl、Br、P、Si、I 的专用配色。

带 T70 可选局部构象描述的清单还显示二面角分组（悬停查看角度）、近边界标记和
关键距离（Å，三位小数），支持按各二面角多选分组及“只看近边界”。筛选保存在
URL 的 `#` 前，并按集合隔离；重载和浏览器前进/后退可恢复。分组汇总展示清单保存的
候选数、最低能候选及层级，点击候选会清除筛选并选中它。页面不重新计算这些值。
可选数据损坏时单独显示原因并隐藏该部分，原有能量和结构仍可读；无新字段的页面
保持原样。字段说明与来源见 [ag-ensemble/1](docs/ag-ensemble-1.md)。

CREST Attempt 可查看 `outputs/crest_conformers.xyz`、`crest_best.xyz` 和
`crest_ensemble.xyz`。逐帧显示注释中的 Hartree 能量和相对最低已知帧的 kcal/mol 值，
无法识别的能量显示“未知”。这些仅供显示，以 facts 和后端分析为准。
集合与 CREST 专用读取上限均为 32 MiB、1,000 帧、每帧 500 原子；清单上限为
4 MiB。超限、XYZ 哈希不符、缺失文件和符号链接会显示原因，不展示部分集合。
原有通用结构文件查看器的上限见下文，二者不同。

```text
#/<study>/ensembles/<manifest.json>?candidate=2
#/<study>/ensembles/<group>/<manifest.json>?candidate=2
```

## 虚频审阅与报告对照（T55）

Attempt 页“解析振动位移”读取所选 Gaussian log，选择模式后显示动画。
“启用审阅模式”使用归一化振幅（最大原子位移，Å）；原有动画幅度与该设置独立。
在三维结构中依次点两个原子，面板显示参考距离、正负位移后的距离和变化；
审阅模式还显示当前动画帧距离。可维护多个原子对，选择保存在 URL 查询参数中。
模式整体正负号任意，有限振幅距离变化不等于线性导数。

面板读取 `analyses/` 及下一层目录中该 Attempt 的 `ag mode-review` JSON 报告，
展示原始频率序号、坐标方向和 log SHA-256。只有同一 log、模式和方向的报告
才可自动带出原子对；多份报告需选择，另一份 log 会明确提示且不自动带出。
报告与页面振幅一致时，正负方向分别按 0.001 Å 容差显示距离对照。
不合规报告单独显示错误，仍可播放可用模式；截断或不支持的位移表显示不可用原因，
原始日志和其他文件仍可读。页面不保存报告或科学签字，虚频动画与距离一致均不等于
TS 验收；科学判断仍需振动方向审阅、双向 IRC 与端点识别。

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

The **服务器** navigation (`#server`) reads local snapshots every 30 seconds; see
T7e below for the per-cluster locations.
The [ag-monitor/1 definition](docs/ag-monitor-1.md) follows the task's
producer specification, including T19 additions. The adapter reads only the fixed snapshot filenames, through the
existing descriptor-relative `O_NOFOLLOW` traversal, at most 2 MiB. Hidden root
directories do not appear as studies. Missing files show
`请在终端运行 ag monitor --watch 120`. The page shows sampling age, expiry after three
sampling intervals (one-shot null-interval samples expire after 10 minutes), previous data marked
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
Startup runs `ag --version` and the T19 `ag clusters` query described below;
actions are refused if either fails or the viewer root does not match.
Resource/root changes require a restart. This avoids acting on a different same-named study or writing
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
  --input <new-draft> --cluster <cluster> --tier <tier> --walltime <HH:MM:SS> --label <label>
  --parent <original-id> --relation <relation> --method-basis <basis>
```

A successful JSON result opens the new input structure and parent input diff.
Only `prepared` Attempts show **提交**; its first click displays the structure
link, cluster, estimated core-hours, charge/multiplicity, full route, tier, walltime and first 12 bundle-hash
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
the result. Normal completion displays the full streams and actual exit code. T52 fetch JSON
including the new `facts` status/reason remains visible verbatim in stdout; a
successful fetch exit code does not imply that facts parsing or scientific review passed. A
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

## Multi-cluster operation and snapshots (T7e)

Actions require ag with the T19 query interface ([Auto-Gaussian #233](https://github.com/anakine800-tech/Auto-Gaussian/pull/233)).
At startup and before every action, the selected executable runs:

```text
ag clusters --json --verify-studies-root <viewer-studies-root>
```

This local read-only query supplies cluster names, scheduler types, resource tiers
and program availability while returning only a boolean directory match. The
viewer no longer parses TOML or reads budget ledgers. A failed query, a false or
missing directory match, or changed execution settings prevents the action before
any draft is written. Restart after changing cluster resources or enabled programs.
Budget/date changes alone do not invalidate the resource selection. The default
read-only viewer does not invoke ag at all.

**基于此新建** defaults to the parent's saved cluster; old manifests without a
cluster use `default`. Changing the cluster updates tier choices and input resource
lines. Selecting another cluster displays **同一能量曲线内的物种应在同一集群计算**.
A removed parent cluster requires an explicit choice; a cluster with Gaussian
disabled cannot prepare a Gaussian Attempt. `programs_enabled` means configured,
not remotely verified. Preparation always passes `--cluster <selected-name>`.
Attempt details and the submit summary display the saved cluster; the summary
also displays cores × walltime as estimated core-hours, not measured billing.

The server page groups snapshots by cluster. It discovers named directories in
read-only mode; action mode also includes configured clusters with no snapshot.
Legacy `default` uses `.ag-monitor/latest.json`; named clusters (including a named
`default`) use `.ag-monitor/<name>/latest.json`. Each file retains the 2 MiB and
no-symlink restrictions. Missing or malformed files are reported in their own
section. If both default locations exist, both appear with source labels and an
ambiguity notice; neither is assumed to be current or used to authorize a
scheduler-residue cancellation. Sampling age, failed sampling and last-success
times stay visible for every cluster.

Slurm snapshots show budget total/used/reserved in core-hours, expiry date/reminder
and storage in KiB when present. Budget values are ag's local ledger summary, not
platform credit. Missing/null fields are not zero. Retained budget/storage are
marked **非最新** on failed, expired or ambiguous samples. Unknown Slurm hardware
capacity is shown as unknown, never as the producer's placeholder zero capacity.
The [T19 producer specification](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/redesign-tasks/T19-clusters-json.md)
defines these optional fields. The viewer's `/api/monitor` response is a
`clusters` array of `{name, source, ambiguous, snapshot, error}` entries; each
`snapshot` is the saved `ag-monitor/1` object.

Synthetic tests cover legacy default metadata, two clusters with distinct tiers,
parent-cluster selection, cluster switching, the warning, exact CLI arguments,
root mismatch, disabled programs, independent monitor errors, absent optional
fields and retained old values. Execution changes require supervisory review
before a human merges this PR.

Synthetic screenshots: [cluster selection](docs/t7e/clusters-form.png),
[submission summary](docs/t7e/submit-summary.png), [cluster monitoring](docs/t7e/monitor.png).
All displayed calculations and scheduler data are synthetic.

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

T57 adds `tests/test_integration.py` and `web/tests/integration.spec.ts` using
`tests/integration_fixture.py`: one combined synthetic study plus isolated damaged
copies, T51 monitor snapshots, and a fake T52 fetch response. Browser integration
starts two additional temporary loopback servers on ports 18767/18768 and stops
them on completion. It exercises the built UI against real local HTTP adapters;
no API responses are mocked in these integration tests.

## Release status

V4.4.0 includes T103 and T104: separate total and per-job core limits,
explicit unknown totals for old snapshots, shared-entry notices, multiplicity-based
R/U prefix completion with original and completed spellings in quick comparison,
and side-by-side IRC TS and optimized endpoint structures. The three structures
include source hash checks, electronic energies, imaginary-frequency counts,
Attempt links and atom-pair highlights, with the human-review notice visible above.
Pair it with backend ag 4.4.0. Both T107 PRs change only versions and release
documentation. Read-only defaults, path/size checks and ag-mediated actions stay
unchanged; submit and cancel still require a human click in the Mac dialog.
Synthetic tests demonstrate software behavior, not scientific acceptance.

快速比较只在前端计算相对能量，非正式结果；正式结论以 ag 报告为准。
`termination` 和 `n_imag` 只显示 facts 保存值，不作为自动验收。

Supervisory review and owner merge are required for both PRs. The owner creates
`v4.4.0` tags on each PR's exact merge commit, after verifying the release commit,
and uses each repository's v4.4.0 CHANGELOG section for release notes. Do not
select whichever commit main happens to point to later. After merge, sync both
main checkouts, rebuild the frontend and open all four entries once. The owner
schedules the calculation-machine update after confirming no fetch, submit or
reparse is in progress. This release task does not deploy or run calculations.

## 版本历史

- **v4.4.0**：T103 监控总上限、共享入口说明与快速比较 R/U 前缀修复；T104 IRC 的 TS 与两端点三维并排审阅；配合 ag 4.4.0。[发布说明](CHANGELOG.md#v440)
- **v4.3.0**：T87 IRC 查看与过期提示、T94–T98a 四入口改版、详情与作业页、分析和快速比较、TS 标签只读展示；配合 ag 4.3.0。[发布说明](CHANGELOG.md#v430)
- **v4.2.1**：T71 局部构象分组、近边界筛选、关键距离与汇总导航。[发布说明](CHANGELOG.md#v421)
- **v4.2.0**：T54 构象集合、T55 虚频审阅与报告对照、T57 跨页集成回归。[发布说明](CHANGELOG.md#v420)
- **v4.0.0**：本地 study 查看器、可选 ag 操作与多集群快照。[发布说明](CHANGELOG.md#v400)

## IRC 查看页（T87）

结果页列出 `analyses/*.json` 及一层子目录中的 `ag-irc-review/1` 报告。
格式同步自后端 T79，见 [格式说明](docs/ag-irc-review-1.md)。仅显示报告保存的
能量、距离、阈值、四条判据、原始状态和依据；工具核对仍需人工审阅。
能量以各方向第 0 点为基准，TS facts 对照原值同时保留；缺能量处断线。
reverse 在横轴左侧，forward 在右侧，TS 为 0。停止原因和最后已接受点分别标记。
非零路径点数与含 TS 的点数、XYZ 帧数分别显示；缺几何的点不借用相邻帧。

点击曲线点或使用逐点按钮查看保存帧，可选择报告原子对以橙色描边高亮，
距离读报告值，不重新计算判据或播放路径动画。路径点通过 `geometry_frame` 映射。
URL 支持刷新、前进及后退恢复，例如：

```text
#/<study>/irc-reviews/<report.json>?direction=reverse&point=2
#/<study>/irc-reviews/<group>/<report.json>?direction=forward&point=0
```

只读报告同目录中明确声明的两份路径 XYZ；来源日志等引用只显示、不打开。
沿用逐级 `O_NOFOLLOW` 路径读取：JSON 上限 4 MiB，每份 XYZ 上限 32 MiB、
1,000 帧、每帧 500 原子，每方向最多 1,000 个报告点（含 TS）。
必需字段、有限数值、点号、帧号映射、帧数与元素行序不符时，整份报告拒绝显示。
`inputs` 中有对应 study 相对路径的 SHA-256 时逐份核对，字节不符则拒绝；
没有对应哈希时明确显示“未核对哈希”（负责人在 T87 对话中已明确允许），
不按同名文件猜测哈希，也不声称未绑定的 XYZ 没有被替换。
`met_by_endpoint_optimization` 同时显示实际降能和原阈值，状态采用中性色。

服务器监控：单次采样超过 10 分钟显示“数据已过期”；连续采样保持超过
3 个采样间隔的规则。距今按天、小时、分钟显示，不足一分钟显示秒数，
页面时钟持续更新，过期数据同时标记为“非最新”。

## 切帧、任意结构对比与容量总览（T110）

优化、IRC 路径点、构象集合及 XYZ（含扫描与 CREST 输出）切帧保留查看器、相机、
缩放和滚动位置。可选“对齐到参考帧”默认关闭，参考帧默认为第一帧，可另选；
按全部原子作 Kabsch 刚体对齐，仅改变显示，不重排原子或写回坐标。
原子数或元素顺序不同、几何缺失时不能对齐。

在同一 study 的 Attempt 表勾选 2–3 项后打开“结构对比”，复用 IRC 三格展示。
新只读 `GET /api/studies/{study}/attempts/{attempt}/comparison-structure` 只读固定的
`facts.json` 和 `final.xyz`，沿用描述符路径检查和读取上限，不打开输入、日志、
审阅文件或 facts 中的路径。最终几何与普通 Attempt 详情使用同一读取规则；
独立读取不是报告哈希证明，原有 IRC 报告绑定的哈希校验保持不变。
可对齐到第一项，也可输入 `1-2,2-3` 高亮并显示前端计算的距离。
相对电子能复用 T98a/T103 的方法、版本、电荷、多重度、元素组成和单位核对；
口径不同或证据不足就列出原因，不给相对能。所有差值均标为“前端计算、非正式”。

作业页顶部容量总览按 `shared_with` 合组；共享快照不相加，采用组内最新成功
占用记录和最小总上限。任一入口失败、过期、来源歧义、缺少共享入口快照或缺少
运行/排队分项时，剩余可提交核数显示“未知”。各入口的单作业上限和档位分别保留；
未提供档位时显示“未知（后端未提供）”。完整字段见 [快照说明](docs/ag-monitor-1.md)。
监控快照有 `cluster.display_name` 时，集群卡片、容量总览及作业列表显示
“显示名（入口名）”，例如 `scnet-初筛（scnet-test）`；没有时沿用入口名。
作业页卡片始终一入口一张，容量总览仍按内部入口名关联共享额度。
前端不选择集群、不提交作业；调度器运行限额注明“由调度器执行，ag 未核实”。
动作令牌不匹配时明确提示“前端已重启，请刷新页面”，不自动刷新令牌或重试操作。
