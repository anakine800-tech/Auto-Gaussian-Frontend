# Auto-Gaussian Study Viewer v4.7.0

**v4.7.0 已于 2026-10-29 正式发布，配合 ag 4.7.0。** 两个发布 PR 的最终独立审阅与 CI 均通过；资源与监控两项实际后端配套验证均通过、0 跳过。

- [前端 Release](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/releases/tag/v4.7.0)：tag 固定于 `f9c8143d4b30ff912140bcc4e2e931373754a84c`（[T177 #51](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/51)）。
- [后端 Release](https://github.com/anakine800-tech/Auto-Gaussian/releases/tag/v4.7.0)：tag 固定于 `d2e6308e5f15964c363549d98e16239806650eb1`（[T178 #372](https://github.com/anakine800-tech/Auto-Gaussian/pull/372)）。

截至 2026-10-29，本机开发环境已按上述两个 tag 部署并验收：前后端元数据／runtime 与网页包均为 4.7.0，前端构建依赖 setuptools 84.1.0；网页构建、五卡显示与三个 HTTP 200 检查通过。研究机尚未更新，不能据此视为所有机器均已部署。
发布与部署摘要见 [CHANGELOG.md](CHANGELOG.md#v470)；[T177 验收记录](docs/redesign-tasks/T177-release-v4.7.0-frontend.md)及 tag 内“发布准备”文字保留为合并前历史，不代表当前状态。后续文档提交不替代发布 tag，也不移动 tag。

标准部署为每台电脑一个操作模式前端（8773）+ 一个监控服务；重启操作版后令牌会更换，已打开页面须刷新。
功能合入或 Release 发布不会自动更新其他机器；各机器部署及服务重启仍按明确指示执行，经对应机器实际验收后才记录已升级。具体机器、路径与配置只留私有部署记录。
顶部导航为服务器 / 研究 / 结果 / 证据，右侧为使用说明；旧链接自动跳转。
构建依赖 setuptools 84.1.0，并按[提交前扫描说明](#启用提交前扫描)启用本机 hook。

A local viewer for the new `ag` study directory architecture, read-only by default.
Optional actions delegate to a startup-selected local `ag` executable. The viewer
has no calculation-package, SSH, scheduler, database, or archive dependency.

## Run locally

Requires Python 3.11–3.13, Node.js and pnpm matching `web/package.json`.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install setuptools==84.1.0
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python -m pip install --no-deps --no-build-isolation .
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
.venv/bin/python -B -m autog_frontend --studies-root "$AG_STUDIES_ROOT" --ui-directory "$PWD/web/dist"
```

Set `AG_STUDIES_ROOT` to the existing parent of your study directories. Alternatively,
omit `--studies-root` and use the environment variable alone. `--port` defaults to 8765. Open the loopback URL printed by the process. Use canonical paths without
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
  --enable-actions --ag '<AG_EXECUTABLE>' --port 8773
```

尖括号为占位符，替换成本机值后执行；每个 worktree 使用自己的 `.venv`。
`--ag` 省略时从 PATH 查找，HTTP 请求不能指定可执行文件。
启动执行 `ag --version`，失败则拒绝开启；此检查不验证精确版本或集群能力。
操作模式允许通过 ag 刷新远程状态、取回结果、基于已有输入新建 Attempt、提交及取消。
提交/取消仍须人亲手点击 Mac 系统确认框，前端不直接连接 SSH 或调用调度器，
也不提供重提 UNKNOWN、覆盖旧 Attempt 或绕过确认的接口。

服务器监控的唯一数据来源是 **ag monitor 快照**，不是浏览器直接查询服务器：

- 旧单集群配置：在独立终端运行 `ag monitor --watch 30`，生成
  `<STUDIES_ROOT>/.ag-monitor/latest.json`，前端每 30 秒读取该固定文件。
- ag 4.0.0 多集群配置：快照位于
  `<STUDIES_ROOT>/.ag-monitor/<CLUSTER>/latest.json`。
- 前端不会启动采样器；缺失、过期和采样失败均需按界面提示解释，不能视为服务器空闲。

## 标准部署与可选只读模式

更新、备份、服务替换与回退、首轮核对及按部署消息指定的观察见[后端运维文档](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/OPERATIONS.md)；先开发机通过，再部署研究用计算机。

两台电脑都采用一个操作模式前端（8773）+ 一个独立监控服务（`ag monitor --watch 30`）。
前端 LaunchAgent 样例见 [local.autogaussian.frontend.plist.example](docs/ops/launchd/local.autogaussian.frontend.plist.example)。
将 Python、前端检出、study 根目录、ag 可执行文件和日志目录的占位符替换成本机值，
先在临时副本上运行 `plutil -lint`；本任务不加载服务，也不修改现有服务。
不带 `--enable-actions` 的只读模式继续保留，按需在空闲临时端口使用：

### 可选只读启动

1. 在获准部署时同步已核对的前端 v4.7.0 发布提交，按上面的步骤安装并构建；配合 ag 4.7.0 使用。
2. 将下列占位符换成本机前端目录和已有 study 根目录。使用不含符号链接的规范路径。
3. 启动后打开终端显示的本机 URL，确认右上角为 **只读**。此启动方式不调用 ag。

```sh
cd '<FRONTEND_DIRECTORY>'
.venv/bin/python -B -m autog_frontend \
  --studies-root '<STUDIES_ROOT>' --ui-directory '<FRONTEND_DIRECTORY>/web/dist' --port '<AVAILABLE_PORT>'
```

从 Study 概览或“分析”打开构象集合、选择候选并查看三维结构，再通过来源 Attempt 链接打开
CREST 输出逐帧查看；浏览器后退恢复集合候选。TS Attempt 中点击“解析振动位移”，
选中虚频后可启用审阅模式。“作业”页只读取已保存的 monitor 快照；缺失时按提示
单独运行采样器。合并后的实际 study 检查由负责人完成，仅在 PR 评论记录“可用”
或“有问题（类别）”，不上传研究截图或数值。

## 四个入口与链接

- **服务器**：`#/servers`，显示本地监控快照。
- **研究**：`#/s/<study>/research/progress` 显示进展与来源；
  `#/<study>/chains` 为计算链，`/research/attempts` 为全部 Attempt，`/research/a/<attempt>` 为详情。
- **结果**：`#/s/<study>/results` 显示报告、构象集合与 IRC；`#/<study>/compare` 为统一比较页。
- **证据**：`#/s/<study>/evidence/library` 为文件库，`/evidence/lineage` 为单对象来源关系，`/evidence/document` 为研究说明。
- **使用说明**：`#/help`，口径表与进展页共用常量，说明各页用途、来源与操作边界。

| 旧链接                                                   | 新位置                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| `#server`、`#/jobs`                                      | `#/servers`                                   |
| `#/<study>`、`#/s/<study>`                               | `#/s/<study>/research/progress`               |
| `#/s/<study>/attempts`                                   | `#/s/<study>/research/attempts`               |
| `#/<study>/<attempt>`、`#/s/<study>/a/<attempt>`         | `#/s/<study>/research/a/<attempt>`            |
| `#/s/<study>/analysis/...`                               | `#/s/<study>/results/...`                     |
| `#/s/<study>/files/...`                                  | 按 T122 对应表跳到文件库、来源关系或研究说明  |
| `#/<study>/ensembles/<report>`                           | `#/s/<study>/results/ensemble/<report>`       |
| `#/<study>/irc-reviews/<report>`                         | `#/s/<study>/results/irc/<report>`            |
| `#/<study>/analyses/<file>`                              | `results/file/<file>`（XYZ 保持证据结构查看） |
| `#/<study>/file/…`（T118 本地文件查看）                  | 保持原路径，不参与旧链接迁移                  |
| 旧 `tab=overview/graph/structures`                       | 证据的 `document/lineage/library` 视图        |
| 旧 `tab=attempts` / `tab=analyses/ensembles/irc-reviews` | 全部 Attempt / 结果                           |

旧 hash 用 `replaceState` 转换，不增加历史记录。精确文件参数、候选、IRC 方向与路径点、
旧集合筛选参数保留；返回列表恢复来源页面的筛选、排序和滚动。

上下文栏的 Study 切换器支持筛选、键盘和 Esc，研究与默认收起的验证/测试分组，最近打开优先。
分组读 study.md 开头的 `type: research|validation|test` 或 `类型: 研究|验证|测试`；
无字段时，`val-`、`test-`、`demo-` 前缀归入验证与测试，其余归入研究。

顶部搜索在 Study 页面默认选择“当前 Study”，可切换“所有 Study”；服务器和使用说明页
保留跨 Study 搜索。覆盖名称、标题、Attempt 编号、标签、模板、analyses 与结构文件名，
以及 manifest 的 `science.route`、`science.method_basis` 字符串，匹配不区分大小写。
方法依据只取 manifest；不索引结果正文、输入或日志内容，不发远程请求。
切换 Study 会恢复当前范围、保留关键词并清除旧结果；陈旧请求的成功或错误不会覆盖新范围。

首次搜索时由本地后端建立内存索引。`GET /api/search?q=...&study=<ID>` 直接在指定 Study
内有界读取，不先扫描所有研究；省略 `study` 保留跨 Study 检索。路径校验和逐级描述符
安全打开同其他只读接口，方法字符串仅用于匹配，不作为文件路径、命令或响应详情。
缺失方法显示“方法未知”；坏 manifest 或非法方法类型保留可读取的编号和字段并提示部分索引。
索引按目录与 manifest 的 mtime、ctime、文件身份更新，最多返回 50 条、按 Study 分组。
单 study 最多 1,000 个索引文件、6,000 个目录项，每次搜索最多 30,000 个目录项和 2 秒，
单份元数据最多 256 KiB；超限或不可安全读取时显示“索引未完成”。

进展数字分别统计本地 running、finished、待审阅 Attempt 和明确待签记录；缺少里程碑节显示未知。
待审阅要求 fetched、facts 为可读对象且 review.md 缺失/为空。
有效 catalog/state.json 的日志哈希与 catalog/journal.jsonl 一致时，仅计采用结果引用与候选对象成员；
退役对象和采用对象的历史成员不计入。无登记或格式/哈希异常时回退全部已取回 Attempt，异常明确提示。
里程碑区分已签、待签、未开始、不适用、无法识别；工具完成不显示为科学通过。
最近改动的文件默认收起，只按修改时间；进度日志在折叠区显示最后三条，更早记录另行展开。

比较篮固定在研究和结果页底部，同 Study 最多 10 项，与 Attempt 勾选共用状态。
选择保存在 sessionStorage 和 URL 的 `cmp` 参数，URL 优先；复制链接、刷新、查看详情和返回均保留。
第十一项明确拒绝；超量历史链接或缓存会提示仅保留前十个不同条目，重复来源不重复计数。
“打开比较”进入统一比较页，选择继续以比较篮和 URL `cmp` 为准；结构叠合从篮中选 2–10 项。

T94–T98a 均已合并：统一框架与组件、Study 概览与 Attempt 表、Attempt 详情与操作抽屉、作业页、分析入口和快速比较（含 termination / n_imag 列），以及 TS 立体标签报告只读查看。T87 提供 IRC 曲线与路径点结构。快速比较为前端计算、非正式结果；工具状态与报告不等于科学验收。
设计和验收记录见 [T94](docs/t94/design-checkpoint.md)；待审 / 待签计数、字段来源与
本次截图、字段规则与负载测量见 [T96](docs/t96/attempt.md)；[T95](docs/t95/overview.md) 截图保留。

## 计算链与采用结果（T121）

研究页的“计算链”位于进展与全部 Attempt 之间，链接为 `#/<study>/chains`。
每行显示登记对象、电子态、计算步骤、采用状态和审阅记录。展开步骤可查看 route 中的方法、
服务器与 facts 中的收敛、虚频、⟨S²⟩、稳定性和终止记录；方法依据保留在 Attempt 详情。
支持电子态、计算类型、状态、隐藏历史及只看需要处理的对象筛选。

读取 `catalog/state.json`（`ag-catalog-state/1` 或 `/2`）并核对 `journal.jsonl` **原始字节**的 SHA-256。
哈希不一致、缺文件或无法安全读取时显示警告，退回未登记分组；不调用 ag，不写 study。
无登记的 Attempt 按 parents 无向连通分组，已登记/退役节点不作为桥梁；分支同组、环只遍历一次，
缺失父节点明确提示。分组不证明构象或电子态相同，全部标“未登记”，相对能留空。

**前端现场换算，正式数值以报告和登记为准。** 仅已登记、已采用对象参与：

| 口径  | Hartree 数值                 |
| ----- | ---------------------------- |
| E     | `scf_h`（已采用 SP）         |
| E+ZPE | `scf_h + zpe_h`              |
| G     | `scf_h + (g_h - freq_scf_h)` |

默认读取 study.md 初始 front matter 的 `energy_basis: E|E+ZPE|G`，没有有效值时为 E+ZPE。
任一所需值缺失时留空，不从其他作业补值。参照默认为当前口径最低能的已采用对象，也可手选；
差值乘以 **627.5094740631** 得 kcal/mol。计算链和比较页共用 `quick-comparison.ts` 的
口径与能量实现；方法使用 Gaussian SCF 白名单，按层核对基组、色散、溶剂模型/溶剂、
基函数形式、程序版本、组成、电荷及多重度，并要求明确 Hartree 单位与有效最终几何。
缺失、无法识别或不一致时，两页的差值、留空原因和电子态能差标记一致。
只有跨多重度且底层方法相同时允许 R/U/RO 前缀差异；同多重度仍核对前缀。
E+ZPE 与 G 独立核对采用 Freq；同一对象内 SP/Freq 还核对组成、电荷、多重度，
不要求 SP 与 Freq 使用相同方法。G 另核对 Freq route 的 `temperature=` 和 `pressure=`，
未写时分别按 298.15 K 和 1 atm；已写但无效、重复或无法识别时留空。
不做布居、温度变换或其他校正；登记数值是最近一次写入时的副本，不自动刷新 facts。

进展页“当前采用的结果”显示结构/频率/能量来源、相对能、依据报告与状态。
只有里程碑明确引用该对象的依据报告才显示已签/待签，其余为候选；采用登记本身不是科学签字。
“关键报告”依次选择正式结论、当前采用引用、待签里程碑引用，去重且不按 mtime 排序。
无有效登记时两处给出 `ag catalog suggest <study>` 的终端提示。
“＋比较”使用已采用 SP → Freq → Opt；未登记对象使用按父子顺序的最后一个已取回 Attempt。
比较篮存储格式不变。全部 Attempt 新增“对象 · 电子态”和“计算类型”，未登记时按 T119 infer_roles 推断。
报告类别优先级为已知 ag schema → 登记 report_kinds → 报告声明 → 文件类型，保留既有 TS 标签目录识别。
类别包含 coverage、ts、nci，与 T123 扩充后的类别表一致。

### 通道与候选（T132）

展开 v2 登记对象后，在计算步骤下方显示该对象的“通道与候选”折叠面板；
v1 对象保留原有内容。沿用现有读取接口，不写 catalog、不调用 ag。
字段按后端 [ag-catalog/2](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/ag-catalog-2.md)
校验；非法字段、坏哈希回退未登记并提示，未知版本显示“不支持的 catalog 版本”。

面板显示期望组成、电荷、多重度和成员不一致；组成/电荷区分未提供、未知与具体值，
多重度沿用 nullable 整数，null 标为“未提供 / 未知（原记录未区分）”。不一致只报告，未改动任何文件。
通道状态直接显示 state 保存的六种状态，不在前端派生。“暂定找到”注明待负责人确认，
与“已验证”使用不同颜色；已验证与低置信度排除附负责人声明原话、时间和理由。

每个通道可展开候选台账，保留全部历史结果及最新归属；归属不能唯一确定时列出候选通道，
另列未关联通道的候选。transform/diagnosis 仅作可折叠的原始 JSON 展示。
整体稳定声明限定在原话中的通道范围与采样预算内，撤销记录明确显示“已撤销”。
catalog 是登记视图，不是科学验收；状态由登记事件派生。
同一候选可关联多个通道，各通道计数不能相加作为不重复尝试数。表格在自己的框内横向滚动。

studies 根目录下以 `_` 或 `.` 开头的目录按容器处理，不列为 study，也不计入问题列表；
例如 `_archive/` 与 `.ag-monitor/`。不会递归将容器中的目录当作 study。
真实研究 study 的 v2 事件须等 T131/T132 随 v4.6.0 在两台机器部署后再写入。
合成夹具与三尺寸截图见 `tests/catalog-fixtures/t132/`。

## 已保存自由能剖面（T193）

`ag-profile/1` 报告显示能级图、状态表和 CSV 下载，数值只取保存的
`states[].relative_G_kcal`，不从绝对能重算、不更新 facts、不更换参考态。
单位、reference、temperature_K、standard_state、显式溶剂浓度和分层警告随报告显示；
显式浓度 `{}` 表示未指定额外浓度，缺字段或非有限数明确为未知。

能级按保存的 states 顺序排列，不新增机理连线；长名称独立换行，窄屏可横向滚动。
点击能级或状态名列出该状态全部物种、化学计量数和 conformers，
每个 `attempt_id` 与 `spc_attempt_id` 分开跳转。不会选择首个或最低构象充当唯一来源。
`spc_attempt_id: null` 表示未采用独立单点；缺来源保留缺失原因。

图、表、CSV 和完整 JSON 入口共用本次读取的冻结快照。下载不重新请求报告或来源，
CSV 每个状态/物种/构象一行，保留单位、条件、警告、来源字段及缺失原因；
缺能量留空。文本防公式注入并转义引号、逗号和换行，有限数值负能量仍为数值。
旧报告缺 states 时保留原始 JSON，未知 schema 沿用通用阅读器。
全部验证使用合成报告；只读展示不代表科学验收。

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
    outputs/*.log or *.out, outputs/job.slurm.err
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
- 来源关系一次显示一个登记对象的计算链；未登记 Attempt 按 parents 的未分配子图连通分组。
  已登记对象不作为连接桥梁，缺失父节点保留提示；分叉分行、环明确提示且不无限遍历。
  框色表示 review.md 的记录状态，有记录不代表通过审阅；点击框打开对应 Attempt。
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

## 放宽输入提醒（T197）

Attempt 的关键事实顶部只读显示不可变 manifest 保存的输入检查标记，
不依赖作业状态或 facts 是否解析成功。仅当顶层 `input_validation` 的
`mode` 为 `relaxed`、`method_verified` 为 `false`、`skipped_checks` 为非空且
每项均为非空白字符串的清单时，显示“输入检查已放宽”“方法口径未核验”及原样跳过项。
该来源不能用于 `ag scan-peak`；解析、自定义基组、`SCRF=Read` 等情况可能使结果
无法进入 `ag profile`，页面不把可能不适用写成一律不可用。

旧 manifest 无该字段时保留既有显示，不推断已核验或已放宽。标记损坏、未知 mode、
空或错误清单、缺失字段、`method_verified=true` 冲突以及不可读 manifest 均提示
“输入检查标记无法核实”，方法核验状态保持未知。来源按钮打开已有 manifest 查看区；
跳过项只显示转义文本，不执行 HTML、链接或命令，也不修正原记录。
此提醒不声明底线检查或科学验收通过，不新增 GUI 编辑、放宽开关或提交能力。
当前使用约定字段与合成数据验证；T188 最终字段及后端组合验证仍待协调确认。
任务与交付边界见 [T197](docs/redesign-tasks/T197-relaxed-input-notice.md)。

## CREST 错误摘要与来源（T160）

CREST Attempt 默认展示已有 `facts.crest_diagnostics` 的摘要及四种状态：错误证据、
原因未明确、未发现匹配错误、错误输出不可用。直接使用后端保存的判断，不重新匹配
错误规则；`identified`、`parse_status=complete` 或 facts 存在均不代表计算成功。
旧 facts 缺少此字段时继续显示 `error_hint` 并注明没有结构化来源，不要求刷新事实。

展开单个来源才读取片段。来源限于当前 Attempt 的 `outputs/crest.out`、`job.pbs.out`、
`job.slurm.out`、`job.slurm.err`；文件名、完整 SHA-256 和 1 基闭区间来自已有 facts。
服务端复用逐级描述符路径检查，仅打开普通文件，读取后检查文件身份和诊断是否变化。
哈希不符、缺失、空文件、非法范围、符号链接、特殊文件或超限分别提示，拒绝把当前
不同字节作为原诊断的命中证据，不改写任何文件。

片段包含前后至多三行上下文，最多 120 行、64 KiB UTF-8 显示文本，截断明确提示。
“查看完整日志”打开该精确文件的现有分页器，默认每页 120 行；全文留在本地，
文件上限仍为 256 MiB、单行上限仍为 1 MiB。分页显示当前本地文本，不自动证明与
原诊断对应。日志和片段均为转义纯文本，这些固定诊断日志在打开折叠区前不预加载正文。
只新增固定 `job.slurm.err` 的文本入口，不开放其他 `.err`；CREST 和调度器固定日志
不进入 Gaussian 振动／优化解析。普通日志搜索、选择与浏览器后退继续可用。

只读及操作模式均可查看已有来源；查看不调用 ag、不取回、不刷新 facts、不重试计算。
已合并后端提交、CLI 生成的合成样例与前端配套检查见
[T160 合成检查说明](tests/fixtures/crest-diagnostics/README.md)。
这里的本地合成检查不代表现场取回、实际研究页面观察或科学验收。

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

### 振动模式完整性（T194）

Attempt 的“关键事实”同时显示虚频数与振动模式的已读 / 预期数。
计数仅取 `n_vibrational_modes`、`expected_vibrational_modes`；完整 / 不完整 / 未知
仅取 `vibrational_modes_complete`，不按原子数推算，也不由计数替代保存的标志。
`false` 保留为不完整，`0` 保留为零；null、缺字段、旧 facts、部分计数与无 facts
均明确说明。计数与标志不一致时保留原值并提示核对，缺少的不可用原因不猜测。

展开模式摘要可查看字段说明与 `frequency_unavailable_reason`，旁边“来源”打开
原始 facts。已有虚频、不可用原因、模式动画与方向审阅保留；解析日志中的动画模式
不会补齐或改写 facts 计数。完整性标签只描述记录，不代表 TS 或科学验收通过。

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

服务器页（`#/servers`，旧 `#/jobs`、`#server` 链接仍可用）每 30 秒读取本机监控快照。
每入口一张摘要卡片，显示采样状态、警告数、核数与内存分段、作业数和本人总额度。
点击卡片或标签切换详情，左右方向键也可切换；运行与排队分别列出，本人置顶，
“只看本人”按服务器记在浏览器中。PBS 显示全员作业，Slurm 只显示本人明细和其他用户汇总。
最近快照进度与 Attempt 链接保留；“刚结束待取回”位于页面底部。

核数、内存各自按对应数值判断，未知时用斜纹；采样失败时卡片占用未知，详情保留值标非最新。
`hardware.error` 计入警告且在详情置顶，不单独使已有数值失效；`hardware.notes` 为灰色说明，不计警告。
调度器优先取 `cluster.scheduler`，缺失时由 `pbsnodes` / `sinfo` 推断 PBS / SLURM，否则显示“—”。
卡片与详情显示退避次数、下次采样时间和认证 / 主机指纹暂停原因；旧快照无 `sampling` 时照旧显示。

操作模式的详情区提供“立即重新采样”。暂停入口先在页面内确认认证或主机指纹问题已修复，
再交给本机 `ag monitor --retry <入口> --json --auth-fixed`；其他状态不带 `--auth-fixed`。
按钮不限频，重复请求由 ag 合并；监控未运行时显示“监控未运行，未登记请求”。
请求受理后只把 `/api/monitor` 加速为每 3 秒读取，最多 120 秒。T151 在同一已核对根、
新鲜心跳与唯一来源的版本 1 标记下追加 `--track`，按入口、来源与请求标识对应完成、失败
或结果未确认等原因；控制终态独立于采样快照。匹配终态立即恢复 30 秒，超时显示结果尚未确认，
仍可在普通轮询中接收迟到的匹配结果。其他请求、新快照或缺失记录不能当成本请求完成。
重启终态显示“监控已重启，本次请求结果尚未确认”；重启前已进入 running 时也不推断未执行，
仍立即结束快速轮询且不自动重新登记。
旧四字段响应保留新快照兜底，但只提示“已收到新采样，无法精确对应本次请求”。
每次点击仅启动一次登记，失败不换命令重发。来源歧义或损坏控制记录不清空正常监控快照。
其他本地记录不加速读取；无效 JSON、超时和其他错误明确显示，不自动重发重试请求。
连续采样允许 30–600 秒，超过三倍间隔才过期；单次采样超过十分钟过期。
“节点与队列”和“限额、档位与存储”默认收起，单节点默认展开节点区。
共享入口用同一份最新成功占用，不累加；总上限取组内最小值。
单作业上限和资源档位只在详情折叠区显示，不能代替总上限。
缺失新字段的旧快照仍可读，新内容显示未知；完整字段见 [ag-monitor/1](docs/ag-monitor-1.md)。

PBS 节点明细复用该快照中的节点状态、分配 slots、内存和作业数，不发起额外查询。
`free` 是调度器状态，不能解释成未分配；表中独立显示已分配/总 slots、剩余 slots
及分配比例。slots 不是实时 CPU 利用率，剩余值也不保证新作业立即运行。
内存仅使用已分配/总内存字段，不从物理可用内存或核数估计。
缺值、零分母和自相矛盾的数值不生成比例；分配超过总量时保留原数并注明异常。
失败或过期节点记录标为非实时。节点表支持键盘聚焦和自身横向滚动。
卡片按入口数组生成；四卡保留宽屏四列，五卡在普通桌面排列为居中的三加二，
超宽屏五列，窄屏沿用双列或单列。合成验收见 [T143](docs/redesign-tasks/T143-pbs-node-details.md)。
档位表与新建 Attempt 表单按 `mini/simple/general/complex/max/ultra` 顺序显示实际配置档位，
可选的后两档未配置时不占位。本人排队上限沿用共享账号入口中的最小值。
可选单作业时限按小时显示，非整小时保留分钟、秒和原值；未配置不表示调度器无限制。
操作表单支持 2–4 位小时，禁止零时长，并在有入口上限时反馈超限；最终校验和提交审批仍由 ag 执行。

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

## Local ag actions（操作模式）

Standard deployment uses `--enable-actions --port 8773`, optionally `--ag <executable>` (otherwise PATH).
Omitting `--enable-actions` retains the optional read-only mode.
`POST /api/monitor/retry` accepts exactly `{"cluster": string, "auth_fixed": boolean}` and requires the same token, loopback and same-origin checks. It calls only the configured local ag with a 15-second timeout, independently of the existing calculation action lock.
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

V4.7.0 was published on 2026-10-29 with the already merged T158 (#49) and T160 (#50).
It also includes T179 ([#52](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/52)),
merged as `8ceda045b1aa007c9dba882f287b11b4df12b840`, pinning setuptools to 84.1.0
for builds and CI. This dependency update does not change runtime dependencies or
prove Windows-specific exploit validation; the GitHub alert status is checked separately.
T158 uses each selected entry's explicit default tier for a new Gaussian Attempt,
shows cores, scheduler memory and Gaussian input memory separately, and displays
local single-node capacity with its time and source. Manual choices survive capacity
refreshes. Selectable occupied nodes and each permitted fraction remain explicit;
unknown capacity is not an availability guarantee, and no node or tier is changed
automatically. Missing capabilities retain the documented older-backend behavior.

T160 displays saved CREST diagnostics and reads bounded source excerpts only when
expanded, checking the exact allowed filename, SHA-256 and line range. Error evidence,
unclear cause, no matching error and unavailable output remain distinct. Old facts
retain error_hint; absent evidence never implies success. Fetching and facts parsing
remain ag's responsibility; viewing does not fetch, refresh facts or retry a calculation.

The paired backend is ag 4.7.0 from T178, merged as
`d2e6308e5f15964c363549d98e16239806650eb1`. Both existing resource and monitor pairing
classes passed against that exported source: one test each, zero skips. These are
isolated synthetic checks, not deployment or scientific acceptance. T177 changed
only version constants and release documentation. Existing Attempts, inputs, facts,
read-only defaults, path/size checks and ag-mediated action gates remain unchanged.
This frontend adds no Hessian generation, Hessian report viewer or Hessian-derived
mode display; the existing Gaussian-log vibration view retains its original limits.
The existing UI passes no approval/policy option, so its submit and cancel
actions still use the Mac dialog.

页面上的相对能量和比较均为前端现场计算的非正式结果，正式数值以报告和登记为准；
工具状态、采用记录、`termination` 和 `n_imag` 均不等于科学验收。

Both release PRs passed final independent review and CI and have been merged.
The [frontend v4.7.0 Release](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/releases/tag/v4.7.0)
is fixed at `f9c8143d4b30ff912140bcc4e2e931373754a84c`; the
[backend v4.7.0 Release](https://github.com/anakine800-tech/Auto-Gaussian/releases/tag/v4.7.0)
is fixed at the full T178 merge SHA above. Later documentation commits do not replace
these release targets or move either tag. T177 and the tagged preparation text preserve
the earlier execution stage.

As of 2026-10-29, the local development environment has passed deployment acceptance
at both tags: backend/frontend metadata and runtime plus the web package are 4.7.0,
frontend setuptools is 84.1.0, and the web build, five-card display and three HTTP 200
checks passed. The research computer has not been updated; this does not establish
deployment on every machine. Machine-specific evidence stays in private records.
Further deployment requires authorization and follows
[OPERATIONS.md](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/OPERATIONS.md)
after both exact release tags are verified.
Complete all required development-machine checks, including existing-entry regression
and the observation period specified in the private deployment message, before configuring
the research computer. Its approved maintenance window must have no research writes,
and its checks are independent. Rebuild the UI, restart the single service and refresh open
action pages for the new token. Rollback includes the paired backend and compatible
configuration; new policy/resource fields must not silently lose enforcement on old code.
Do not rewrite node-bound Attempts into an old format during rollback. If old code
cannot safely handle new records, stop affected operations and report partial recovery.
Special CPU mapping and cross-client races require separate site acceptance;
the current nodefile guard checks but does not archive the original nodefile.
Real synthetic compute requires its own approval and placement/output/receipt evidence.
This release adds no study/catalog migration; the existing v2 conditions below remain.
Before real studies write v2 events, both machines must be deployed and a temporary
non-research study must pass candidate registration, `ag g0 --record` and frontend
ledger display checks on the research computer. Preserve that study in a container
directory beginning with `_`. An existing study's first `--upgrade-catalog` requires
owner approval; upgraded catalogs cannot be downgraded or opened/written with 4.5.x.
Publication does not establish deployment on other machines; deployment results are recorded separately.
Research-computer maintenance reuses its existing private plan; the target version
and maintenance window require later instructions. Historical release notes do not
establish the current deployed version or acceptance status of either machine.

### 版本核对

在对应隔离安装或获准部署的 Python 环境核对包元数据、实际导入模块与网页包，
三处版本均应为 `4.7.0`；同时核对 `pyproject.toml`，不再沿用 runtime 4.0.0 例外。
模块路径必须指向本次选定安装或源码，版本字符串本身不能证明运行服务已经升级。

```sh
.venv/bin/python -B -c 'import importlib.metadata as m, autog_frontend; print(m.version("autog-frontend-readonly")); print(autog_frontend.__version__); print(autog_frontend.__file__)'
.venv/bin/python -B -c 'import json, pathlib, tomllib; print(tomllib.loads(pathlib.Path("pyproject.toml").read_text())["project"]["version"]); print(json.loads(pathlib.Path("web/package.json").read_text())["version"])'
```

### 已知问题

- CREST 取回/诊断的现场覆盖沿用后端最新复核：旧普通 PBS 与 Slurm 正式取回兼容均已通过；此前 PBS 传输失败记录保留。新输出集合、mdopt、不完整取回和真实错误诊断尚未现场覆盖；这些是已披露的覆盖边界，不新增为原 T159 的强制发版门槛，前端合成显示不能补足现场证据。
- 前端不提供新增 Hessian 生成或专用查看；原 Gaussian log 振动显示不因后端新增能力而扩大。
- 串行采样经转发一轮可能 100–150 秒；手动重试先等当前入口完成，再耗时采目标入口。睡眠停采、醒来自动恢复，初期可能因网络未就绪失败或退避。
- catalog v2 升级后不能降级，也不能删行降级；G0、扫描和登记状态都是诊断与记录，不代表科学验收。
- 证据库冷启动在已有测量中约 2.5 秒，实际耗时随本机与文件数量变化。
- source-map-js 的临时 override 待 PostCSS 自然升级到修复版本后删除。

## 版本历史

- **v4.7.0（2026-10-29 已发布）**：T158 新 Attempt 默认资源、单节点容量与可选节点比例；T160 CREST 诊断摘要和可核验来源；T179 构建依赖 setuptools 84.1.0；配合 ag 4.7.0，T178 真实合并源码的两项配套均通过、无跳过。[发布说明](CHANGELOG.md#v470)
- **v4.6.3（发布准备）**：T147 监控资源与重试显示修补、T151 请求终态与重启未确认反馈；三处版本统一，清理已完成待办，配合 ag 4.6.3。[发布说明](CHANGELOG.md#v463)
- **v4.6.2**：T145 显式 PBS 节点选择、原优先级分组与顺序、半数/四分之一及资源摘要；旧入口不显示不适用控件，配合 ag 4.6.2。[发布说明](CHANGELOG.md#v462)
- **v4.6.1**：T143 PBS 节点分配明细、四/五卡响应式布局、可选四/六档与单作业时限显示；配合 ag 4.6.1，复用快照并明确未知及非实时状态。[发布说明](CHANGELOG.md#v461)
- **v4.6.0**：T132 catalog v2 通道与候选只读面板、负责人声明及容器目录过滤；配合 ag 4.6.0，catalog 升级不可降级。[发布说明](CHANGELOG.md#v460)
- **v4.5.1**：T128 资源独立显示、调度器推断、退避/暂停与手动重新采样；单服务运维步骤，配合 ag 4.5.1。[发布说明](CHANGELOG.md#v451)
- **v4.5.0**：T110 切帧与结构对比、T115 服务器卡片、T118 报告阅读、T120 导航与进展、T121 计算链与采用结果、T122 比较与证据库、T116 公开扫描及 T113 依赖安全更新；配合 ag 4.5.0。[发布说明](CHANGELOG.md#v450)
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

在同一 study 的 Attempt 表勾选 2–10 项后打开统一比较页，可查看多行结构卡；
IRC 报告保留原来的三卡展示。
新只读 `GET /api/studies/{study}/attempts/{attempt}/comparison-structure` 只读固定的
`facts.json` 和 `final.xyz`，沿用描述符路径检查和读取上限，不打开输入、日志、
审阅文件或 facts 中的路径。最终几何与普通 Attempt 详情使用同一读取规则；
独立读取不是报告哈希证明，原有 IRC 报告绑定的哈希校验保持不变。
几何参照默认使用第一项，可切换到其他完整结构；也可输入 `1-2,2-3` 高亮并显示前端计算的距离。
相对电子能复用 T98a/T103 的方法、版本、电荷、多重度、元素组成和单位核对；
口径不同或证据不足就列出原因，不给相对能。所有差值均标为“前端计算、非正式”。

T115 已用服务器卡片和按入口切换的详情替换 T110 容量总览；共享组仍采用
最新成功占用和最小总上限，不相加。显示名仅用于标签，不改变入口身份。
前端不选择集群、不提交作业；调度器运行限额注明“由调度器执行，ag 未核实”。
动作令牌不匹配时明确提示“前端已重启，请刷新页面”，不自动刷新令牌或重试操作。

## T122：比较与证据库

比较页标题为“比较（前端现场计算，非正式结果）”。Opt、SP、Freq 逐层列出方法、基组、
色散、溶剂模型/溶剂、基函数形式、程序版本、元素组成、电荷和多重度的一致/不同/缺失。
沿用 T82 的 Gaussian SCF 方法白名单、明确 Hartree 单位和有效最终几何要求；
非 SCF、自定义基组/ECP/IOp、含糊溶剂与缺失证据仍拒绝计算能差。
参照项可选，不相容格留空并给原因；跨多重度仅把相同基础方法的 R/U 区别视为电子态差异，
标“电子态能差”，同多重度的 R/U 方法差异仍拒绝。不做布居、不换温度。
G 使用同一套 Freq 温压核对：缺省 298.15 K、1 atm；显式无效值不能回退默认值。

- 登记对象各层只取当前采用的 Opt/Freq/SP；SP、ZPE、G 使用 catalog 的 Hartree 快照，
  Opt E 读取采用 Opt 的 facts。`E+ZPE = scf_h + zpe_h`；
  `G = scf_h + (g_h - freq_scf_h)`，缺项不从别层回填。
- 未登记条目只用自己的 facts，按 route 区分层，Opt+Freq 不伪装为 SP。
  一个 Attempt 登记到多个对象时提示归属歧义，不擅选采用记录。
- 性质来自每层 facts，审阅状态来自 review.md 是否可读/存在；来源 Attempt 可打开。
  “只看有差异的行”用于口径、能量、性质及原子对距离。
- 几何按比较篮条目 final.xyz 的原编号计算；结构对齐复用 T110 Kabsch，
  不反射、不重排原子，默认第一个结构为几何参照，也可选择其他完整结构，
  对齐与 RMSD 随之同步更新；原子对距离不变，不写入 study。
- 每轮读取按实际来源 Attempt 去重请求与 JSON 解析，采用层和结构卡共用结果；刷新重新读取。
  单项加载失败只在该项标明缺失，其他结构仍可查看；方法/组成/电荷等口径限制保持不变。
- 十结构按多行显示，窄屏单列、数据表在容器内横向滚动；IRC 仍为原有 reverse / TS / forward 三卡。

`GET /api/studies/{study}/evidence` 只读列出每份普通文件的类型、大小、修改时间、
关联对象/Attempt 和被谁引用。类型分面为报告、表格、JSON、图片、HTML、结构、审阅意见、
签字记录（含 analyses/review-manifest-\*.json）、输入与日志。文件每页 60 项，预览复用现有文件、结构、输入和分页日志读取器。
未知格式仍可查看元数据，不扩大文件读取类型白名单。

遍历使用逐级目录描述符和 `O_NOFOLLOW`，不跟随符号链接、不打开特殊文件。
为防大量嵌套文件耗尽本机资源，一次扫描最多 10,000 个目录项、8 层目录；截断明确提示。
“被谁引用”只看 analyses 下 Markdown 的本地相对链接（含图片和引用式链接）与当前采用的
`report`，不解析其他文件正文、裸 URL 或代码块。单份 Markdown 限 4 MiB，
每次新解析正文总量限 32 MiB；缓存最多 1,024 项，键含路径、mtime、大小及文件身份，
引用缓存命中仍重新核对安全路径。目录索引另按目录 mtime、ctime、身份缓存，
每次仍逐级 `O_NOFOLLOW` 打开目录并对每个文件做不跟随链接的 stat；文件的身份、类型、
mtime、ctime、大小变化时重新完整安全打开，不因目录 mtime 未变而忽略原地改写。
目录缓存只保留已经核验的元数据，跨 study 总量受同一 10,000 条预算约束；不缓存正文。
报告、引用读取异常均提示，目录项不重复。catalog 直接调用 T121 的同一读取函数，
哈希核对及警告文字一致，不再保留备用实现。

合成截图已入库：[比较与证据截图](tests/fixtures/compare-evidence/README.md)。
监控格式已同步 T123 的可选 `job_summary_error` 和 `mem_source`，见 [格式说明](docs/ag-monitor-1.md)。

| 旧入口                                            | T122 位置（replaceState，不新增历史记录）              |
| ------------------------------------------------- | ------------------------------------------------------ |
| Attempt 表的快速比较 / 结构对比、比较篮“打开比较” | `#/<study>/compare?cmp=<ids>`                          |
| `#/s/<study>/files`、`#/s/<study>/evidence`       | `#/s/<study>/evidence/library`                         |
| 旧 files/evidence 下 graph 或 `tab=graph`         | `#/s/<study>/evidence/lineage`                         |
| 旧 structures / analyses 标签                     | `#/s/<study>/evidence/library`                         |
| 旧 structures/analyses 的具体文件                 | 文件库 `?file=<study-relative-path>`，保留其他查询参数 |
| 旧 document / `tab=overview`                      | `#/s/<study>/evidence/document`                        |
| T118 `#/<study>/file/<path>`                      | 保留原文件阅读链接                                     |

## 启用提交前扫描

前端 hook 来自后端 `.githooks/pre-commit`，在当前仓库调用 `scripts/scan_public.py`。
合并并同步后，在前端检出执行：

```sh
git config core.hooksPath .githooks
python3 scripts/scan_public.py
```

词表仅在本机维护，默认读取 `$HOME/.config/auto-gaussian/sensitive-terms.txt`；
可用 `SCAN_PUBLIC_TERMS_FILE` 指向另一份本机词表。不要把词表或其中内容写入仓库、
README 或 hook。hook 扫描暂存字节，命中拒绝提交，词表缺失时给出提示；
README 与 hook 本身不包含任何项目私有词条。

## 新建 Attempt 的资源与容量（T158）

完整能力需要后端同时具备 T154 的入口默认档位、T156 的本地 `capacity` 命令和
T157 的节点及比例选项 `selectable` 字段；不按版本号推断能力。
已用包含三项接口的后端合并提交 `e109019b3028aad75fb434b5eafce1633af72aca` 完成隔离合成联调。
本功能只在既有 Gaussian 新建表单中显示，不增加服务器页控件。

“基于此新建”在所选入口显式配置 `resources.default_tier` 时优先用该档位，
切入口时按目标入口默认值重新填入资源。没有配置时保留父档位／当前合法档位与 simple 回退。
手动选档有效；刷新容量不重置档位或节点。核数、调度器内存与 Gaussian 输入内存分别展示：
例如 48 核 / 96 GB 对应 `%nprocshared=48`、`%mem=76800MB`。
只生成新草稿，不迁移旧 Attempt，不改源输入、结构、route 或方法依据。

新建表单通过带操作令牌的本机 `POST /api/attempt-capacity` 读取容量，字段只有
`cluster`、`tier` 与可选 `target_node`。入口与档位必须已配置；节点名按既有规则验证。
调用启动时选定的 ag，固定 argv：

```text
ag capacity --cluster <ENTRY> --tier <TIER> [--target-node <NODE>] --json
```

此命令读取已有本地快照，不刷新远程采样。前端不合计分区内存，不重算节点容量；
校验响应对应的入口、档位、目标及核数／调度内存，显示“当前容量足够／需要排队／无法判断／规格不适用”。
展示采样时间、有效期、核数和内存来源；打开期间过期会转为“无法判断”。容量足够也不保证立即启动。
容量结论仅作提示，未知或查询失败不另行禁止保存；最终账号额度、规格、节点与授权检查仍由 ag 执行。

每次选择变化或手动刷新只发一次请求，旧响应不会覆盖新选择。仅旧 CLI 明确报告不存在 capacity 命令
（退出码 2、stdout 为空且 stderr 为对应 argparse unknown-command 错误）时，本前端进程记为能力不可用，
不重复执行；升级后重启前端重新发现。结构化退出码 2 的本地读取错误及其他失败保留未知，允许手动刷新，不自动重试。
查询不占用、释放或改变计算操作锁；已有计算操作等待超时不杀 ag 的行为保持不变。
只读模式不注册此 POST，令牌、回环与同源限制沿用现有规则。

具名节点保留原 priority/order，同表显示空闲候选与占用节点；仍需明确选择具体节点和 1/2 或 1/4 比例。
`selectable=true` 的占用节点可选，`false` 不可选；缺字段时仅允许旧 `available` 状态。
比例选项明确返回 `selectable=false` 时保留当前选择并提示不可用，保存前须明确选择其他合法比例或节点；
缺少比例标记时沿用原档位匹配规则。节点整体可选不代表每个比例都可用，容量 unknown 本身不禁止保存。
禁用、受限、过期节点与无对应档位的原保护保留；不自动换节点或降档。

T158 的本地配套验收可在当前检出的独立 `.venv` 安装指定后端源码后运行：

```sh
T158_BACKEND_SOURCE='<ISOLATED_BACKEND>/ag/src' .venv/bin/python -B -m unittest tests.test_actions.PairedResourceTests -v
```

该用例核对实际导入位置，替换配置入口为临时合成配置，并禁止构造 SSHTransport；
使用真实 CLI 完成 clusters、nodes、capacity 和本地 prepare，核对默认 48/96、占用节点的 1/2 与 1/4、
queue／unknown 均可本地准备，以及精确内存导致仅某一比例不可用的边界；核对旧输入／Attempt 字节及时间戳不变。
未提供路径时普通测试跳过该独立配套项。它不执行 submit/cancel，不代表现场调度验收。
