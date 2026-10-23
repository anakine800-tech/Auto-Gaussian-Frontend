# T118：前端报告阅读——表格、图片、本地链接、数据形状与分类

版本：v1（监督方，2026-10-23）。**开发机做。** 前端出一个 PR，PR 描述第一行写 `Task: T118 (frontend)`。

## 分支与目标

- 分支：`codex/t118-report-reading`。
- **开工条件：** 以前端 main（不早于 `fb4c15b`）为基线。和 T115、T120 并行；合并顺序 T118 → T115 → T120。
- **负责人 2026-10-23 决定（设计稿：前端改版规格 v6 的"结果 · 报告"一节，原型第 4 屏）：**
  - R1 Markdown 表格按表格显示（引入 `remark-gfm`，这是本单**唯一**新增的依赖）；CSV 和 JSON 数组用同一个表格组件显示；这个表格可以按列排序。
  - R2 合法的 JSON 不论顶层是对象、数组还是标量，**都不算错误**。认识的 schema 用专门的视图；不认识的对象按折叠树或格式化原文显示；对象数组按表格显示。"解析失败"只用于 UTF-8 或 JSON 语法真正有错的文件，并给出行号和列号。
  - R3 报告里引用的本地图片直接显示；报告和 study.md 里的本地相对链接可以点，在只读的文件查看页打开。
  - R4 analyses 里的图片（png、jpg、webp、svg）和 HTML 报告进入文件列表。HTML 放在隔离的只读框里显示，不运行脚本。
  - R5 报告目录按类别分组：正式结论 / 能量与排序 / 电子态检查 / 构象集合 / IRC / 热化学 / 阶段审阅 / 图与演示 / 其他。没有内容的组不显示（不再出现一排"暂无可识别报告"）。"其他"组内按文件夹分小组。
  - R6 表格里的单元格如果正好是本 study 的 Attempt 编号，就显示为链接；点开结构预览，复用现有的比较结构接口。
  - R7 前端改版规格 v6 放进本仓库 `docs/redesign-v6.md`（负责人提供的文本，原样放入），并在 `docs/redesign-v5.md` 开头注明"已由 v6 取代"。
- **资料：** `web/src/results-panels.tsx`（`StudyMarkdown`）、`analysis-panels.tsx`、`analysis-summary.ts`、`study-panels.tsx`（`Analyses`）、`autog_frontend/studies.py`（analyses 发现与 `document()`）、`autog_frontend/api.py`；前端 `AGENTS.md` 的路径与大小规则。

## 允许改动的路径

- `web/package.json`、`web/pnpm-lock.yaml`：只新增 `remark-gfm`（选一个已发布满两周的确切版本）。
- `web/src/results-panels.tsx`、`analysis-panels.tsx`、`analysis-summary.ts`、`study-panels.tsx`。
- 新建 `web/src/data-table-view.tsx`（Markdown 表格、CSV、JSON 数组共用的排序表格）、`web/src/json-view.tsx`、`web/src/file-view.tsx`（只读文件查看页）、`web/src/ui/report.css`。
- `web/src/routing.ts`：**只新增**一条文件查看路由 `#/<study>/file/<相对路径>`，不改已有路由（T120 会改导航，两单在这里只会是加法冲突）。
- `autog_frontend/studies.py`：analyses 的发现（新增文件类型）、`document()` 对 JSON 的处理、报告分类、新增的文件读取函数。
- `autog_frontend/api.py`：**只新增**一个只读接口 `GET /api/studies/{study}/files/{path:path}`。
- 测试：`tests/` 下与 analyses 相关的测试和夹具，`web/tests/analysis*.spec.ts`；新建 `tests/test_files_view.py`、`web/tests/report-reading.spec.ts`。
- 文档：`docs/redesign-v6.md`（新建）、`docs/redesign-v5.md`（只在开头加一行）、`README.md` 的"Files displayed"一节；本单 `docs/redesign-tasks/T118-report-reading.md`、`docs/redesign-tasks/open-tasks.txt`。

## 要做的

### 1. 文件读取接口（R3、R4）

- `GET /api/studies/{study}/files/{path}`：
  - 路径按现有方式逐级用 `O_NOFOLLOW` 打开，拒绝 `..`、绝对路径、符号链接和非普通文件；
  - 只允许 study 目录内的文件；
  - 类型白名单：md、txt、csv、json、xyz、png、jpg、jpeg、webp、svg、html；
  - 大小上限沿用现有的文档上限，图片单独设 10 MB；
  - 响应头带 `X-Content-Type-Options: nosniff`。HTML 和 SVG 的响应头带 `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`。
- 页面上：SVG 只能用 `<img>` 显示；HTML 用 `<iframe sandbox>`（不带 `allow-scripts`，也不带 `allow-same-origin`）加载上面这个接口。
- analyses 的发现：在现有的 json、md、csv、txt 之外，加上图片和 html。目录深度和数量上限保持不变。

### 2. Markdown 渲染（R1、R3）

- `StudyMarkdown` 和报告正文都用 react-markdown 加 remark-gfm。**不开启原始 HTML**（保持 react-markdown 的默认行为）。
- 表格交给 `data-table-view`：列内的值全部可以解析为数字时按数值排序，否则按文本排序；点表头切换升序和降序，并设置 `aria-sort`。
- 链接：
  - 相对路径：以文档所在目录为基准解析，再规范化；落在 study 内的，指向已有的专门路由（Attempt、结构文件、analyses 报告）或新的文件查看路由；越出 study 的，显示为纯文本，并在悬停提示里写明原因。
  - `http(s)` 链接在新标签页打开（`rel="noopener noreferrer"`）；其他协议显示为纯文本。
- 图片：相对路径走文件接口，加载失败时显示替代文字和原因。

### 3. CSV 与 JSON（R1、R2）

- CSV：按 RFC 4180 的子集解析（支持带引号的字段，以及字段中的逗号和换行），行数上限 5000，超过的部分截断并提示。解析失败时显示原文，并写明"CSV 解析失败：第 n 行"。
- JSON：
  - 认识的 ag schema：沿用现有视图；
  - 对象数组：用表格显示，列取各对象键的并集，最多 30 列；
  - 标量数组：显示为列表；
  - 其他对象：用折叠树显示，同时可以切换成格式化原文。
- `document()` 不再把非对象的 JSON 当错误。JSON 语法错误时返回带行号和列号的错误，页面显示"解析失败：第 n 行第 m 列"；"格式不认识"不算错误。

### 4. 分类（R5）

- 每个文件按下面的顺序决定类别，并在页面上用小字写明依据（"按 schema""按报告声明""按文件类型"）：
  1. ag schema（现有映射：ensemble、irc、thermo、profile、coverage、nci 等）；
  2. 报告自己的声明：JSON 顶层的 `"kind"` 字段，或 Markdown 开头 front matter 里的 `kind:`。可选值：`formal`、`energy`、`state-check`、`ensemble`、`irc`、`thermo`、`stage-review`、`figure`、`other`；
  3. 文件类型：图片和 html 归入"图与演示"；
  4. 其余归入"其他"。
- **不按文件名猜**类别（避免误判）。以后 T119 的登记记录会成为第 2 条之前的一条来源，本单先留好接口。
- 报告目录是左侧一栏，分组标题写数量；正文是中间一栏；右侧是 R6 的结构预览栏（窄屏时移到正文下方）。现有的路由 `#/<study>/analysis/<type>/<name>` 照旧可用。

### 5. Attempt 编号链接（R6）

- 表格单元格的文本与本 study 某个 Attempt 编号完全相同时，显示为链接。点击后右侧显示结构预览（复用现有的 comparison-structure 接口和三维查看器）和"打开 Attempt"链接。不做模糊匹配。

## 不允许

- 除 `remark-gfm` 外不新增依赖（表格排序、CSV 解析都自己写）。
- 不开启 Markdown 原始 HTML，不让 HTML 报告运行脚本，不放宽路径检查。
- 不改已有路由和导航，不改 `main.tsx`；不改服务器页（T115）。
- 不按文件名启发式分类，不做能量排序或科学判断。
- 测试和截图只用合成 study（虚构 study 名、公开小分子），不出现真实研究内容。

## 测试

| 场景 | 预期 |
|---|---|
| 带 GFM 表格的 Markdown | 显示为表格；数值列按数值排序；`aria-sort` 正确 |
| CSV 中有引号、逗号、换行 | 解析正确；超过 5000 行时截断并提示 |
| JSON：对象数组 / 标量数组 / 普通对象 / 标量 | 分别显示为表格、列表、折叠树、值，都不报错 |
| JSON 语法错误 | 显示"解析失败：第 n 行第 m 列" |
| ag schema 报告 | 沿用原来的视图 |
| front matter 写了 `kind: energy` | 归入"能量与排序"，标明"按报告声明" |
| 图片和 html | 进入列表，归入"图与演示" |
| 报告内的相对链接（同目录、上级目录、Attempt、越出 study） | 前三种可以点，最后一种显示为纯文本并附原因 |
| 报告内引用的图片 | 能显示；文件缺失时显示替代文字 |
| 文件接口：`..`、符号链接、类型白名单之外、超过大小 | 都被拒绝 |
| HTML 报告里带 `<script>` | 脚本不运行（检查 iframe 的 sandbox 属性和响应头） |
| SVG 里带 `<script>` | 只用 `<img>` 显示，脚本不运行 |
| 表格单元格等于 Attempt 编号 | 显示为链接，点开有结构预览 |
| 没有内容的分组 | 不显示 |
| 窄屏 390 px | 没有横向页面滚动；宽表格在自己的框里滚动 |

推送前本地跑 Python 测试、浏览器测试和构建各一次，之后以 CI 为准；同时做敏感信息扫描，并运行 `git diff --cached --check`。

## 真实环境验证

- 不需要提交计算。合并前在开发机上用一个**非研究**的 study 打开几份 Markdown、CSV、JSON 报告自查；PR 里只写结果，不截研究数据的图。

## 停止条件

- 需要新增 `remark-gfm` 以外的依赖；需要放宽路径或类型检查。
- 需要改已有路由或 `main.tsx`；同一问题修两次仍未解决。

## 合并前审阅与交付

- 监督方**轻审**。但第 1 节的文件接口和 HTML/SVG 隔离**要逐行审**，因为它涉及读取边界。看三个尺寸的截图（合成数据）、测试结果和 diff 概要。合并只由负责人操作，排在 T115、T120 之前。
- PR 描述包括：R1–R7 各自对应的改动、文件接口的安全措施清单、截图、全量测试结果。
- **合并后：** 开发机重新构建前端，两个常驻前端服务各重启一次。T113（依赖升级）要以本单合并后的锁文件为基线。

## 版本记录

- v1（2026-10-23，监督方）：依据负责人 10-23 决定 R1–R7 与前端改版规格 v6 起草。

## 实现与审阅记录（2026-10-23）

- 基线：`fb4c15b`；分支：`codex/t118-report-reading`。
- R1：`data-table-view.tsx` 统一 GFM、CSV、JSON 对象数组表格，提供稳定排序、数值列判定、`aria-sort` 和局部滚动。仅新增直接依赖 `remark-gfm@4.0.1`（2025-02-10 发布），原有依赖版本不变。
- R2：报告读取支持所有合法 JSON 顶层形状；已知 schema 保留原有视图，其他对象可展开或查看格式化原文。解析错误包含行列，固定 ag 记录仍验证对象形状。CSV 解析支持引号、逗号和换行，最多显示 5000 条数据行；JSON 表格最多显示 30 列。
- R3：新增只读文件接口和文件路由；链接相对文档目录解析，已有专门路由优先。本地图片显示读取失败原因，外链使用 `noopener noreferrer`。
- R4：发现图片和 HTML，保持原有目录深度。文件读取复用目录描述符及逐级 `O_NOFOLLOW`，限制类型、大小和普通文件；HTML 空 sandbox iframe、SVG img 和专用 CSP 共同隔离脚本。
- R5：按 schema、显式 kind、文件类型分类并展示依据，保留原 TS 标签目录判定；无内容类别不显示，“其他”按文件夹分组。首次读取大小上限内的完整元数据，保证文件末尾的顶层 schema 也优先于 kind；未变更元数据复用进程内缓存，目录响应仍不包含正文。
- R6：表格单元格与 Attempt 编号完全一致时链接到右侧比较结构预览；窄屏预览移到正文下面。
- R7：v6 与负责人提供的文件逐字节一致；v5 开头已注明取代关系。

### 已批准的最小范围扩展

负责人在本会话明确批准以下两项；其余修改遵守上面的路径范围。

1. `api.py` 中间件的 CSP 赋值改成 `setdefault`，保留文件接口的 HTML/SVG 专用策略。负责人答复：“允许这处最小修改（推荐）”。
2. `web/tests/results.spec.ts` 中一条旧 Markdown 测试改为检查 HTTPS 外链的 target/rel；保留脚本和外部图片隔离断言。负责人答复：“允许这条测试调整（推荐）”。

### 对 441a78d 的审阅修正

负责人在本会话提供监督方意见后，按以下范围修正：

1. 恢复原类别：`ag-profile/1` → `thermo`（热化学 / 能量剖面），`ag-channel-coverage/1` → `coverage`（通道覆盖），`ag-nci/1` → `nci`（NCI）。TS 标签沿用既有固定路径规则，标明“按 TS 标签目录”；通道覆盖、TS 标签、NCI 位于热化学与阶段审阅之间。前后端均逐项测试所有已识别 schema。
2. HTML/SVG 的专用 CSP 增加 `frame-ancestors 'self'`，允许本应用嵌入并限制其他来源；空 iframe sandbox 和脚本隔离不变。
3. 目录元数据按路径、纳秒 mtime、大小缓存；设备号、inode、ctime 参与失效，防止保留时间与大小的文件替换复用旧结果。每次命中前仍安全打开路径并检查普通文件。只缓存元数据、最多 1024 项，避免长期浏览多个 study 时无限保留；文件读取过程中发生改变则不写入缓存。测试检查未变更 JSON/MD 正文各只读取一次，以及修改、替换、调用方修改返回值和符号链接场景。

### 本地验证结果

- Python 全量：审阅修正后 130 项通过，覆盖类别映射、元数据缓存与文件边界。
- 浏览器全量：审阅修正后 195 项通过。为避开其他前端任务占用的端口，在临时测试副本中仅重映射本地端口，所有测试断言保持一致。
- TypeScript 类型检查及 Vite 生产构建通过。构建仍提示单包超过 500 kB（约 554 kB，gzip 174 kB）；未增加拆包改动。
- 三个尺寸的截图已重新生成并人工查看：1440×860、1280×720、390×844，位于 `tests/fixtures/report-reading/`；另附 `categories-1440x860.png` 展示独立 NCI 分组。窄屏无页面横向溢出，宽表格在自身容器内滚动。
- 敏感预扫描只命中 `api.py` 与旧 `results.spec.ts` 中已有的本机回环地址；没有新增私钥、用户目录或网络地址。正式暂存区扫描与空白检查见 PR 验证记录。

### 交付边界

- 测试与截图仅使用合成 butane study，无真实研究内容或集群操作。
- 文件接口与 HTML/SVG 隔离提交监督方逐行审阅；负责人执行合并，顺序为 T118 → T115 → T120。
- 合并后的构建、两个常驻服务重启和 T113 锁文件基线切换，按原工单安排后续执行。
