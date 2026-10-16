# T87（前端）：IRC 查看页；服务器监控的过期提示

> 在**前端仓库** `Auto-Gaussian-Frontend` 开发，**开发机做**。数据来自后端 T79 的 `ag irc-review` 输出（`ag-irc-review/1`，格式见后端 `docs/ag-irc-review-1.md`，以该文档为准）。

## 修订与开工记录（v3）

- v1 为负责人提供的附件；v2 补充排期与字段阻塞；v3 记录负责人解除哈希缺失阻塞的决定，其他功能范围不变。
- 排在 T83 之后；负责人要求 T83 合并后开工。现已只读核实后端 T79（#296）、T83（#299）均已合并。
- 格式依据：后端 main `0cccf9598e4d751138144dc43b39e1742547c45f` 的 `docs/ag-irc-review-1.md`。
- 前端起点：main `54f614ff86462ed4cfdc70656b0b1bcaa8d8ef7f`；分支 `codex/t87-irc-view` 已建立。
- 负责人在本对话确认：“允许缺哈希时明确提示，继续 T87 前端开发”。此决定优先于原附件相应停止条款；无需为缺哈希另开后端小单。
- 现有 T79 路径 XYZ 无报告内哈希时显示“未核对哈希”；`inputs` 记录对应路径哈希时必须核对，哈希不符拒绝整份报告。其他停止条件不变。
- 真实报告点数口径已核对：forward / reverse 为 44 / 6 个非零路径点；各含 TS 第 0 点时为 45 / 7 个点及 XYZ 帧。后退方向判据 ② 为 `met_by_endpoint_optimization`，降能约 0.28 kcal/mol，阈值仍为 3。
- 原 study 和其证据均未修改；开发前的 JSON 核对不等于查看页真实验证。后续仍需按下文完成页面、曲线、键长及监控验证。

## 分支与目标

- 分支：`codex/t87-irc-view`；基于前端最新 main，一张任务单一个 PR。
- **开工条件：** 后端 T79（#296）及 T83（#299）已合并（均已满足）；哈希缺失处理按负责人下列确认执行。
- **目标：**
  1. 新增 **IRC 查看页**：读取 study `analyses/` 下的 `ag-irc-review/1` 报告，显示两个方向的能量曲线、关键键长曲线、停止位置、四条判据的原始状态与依据，并可在结构查看器中查看任一路径点的结构；
  2. **服务器监控过期提示**（之前记下的小问题）：单次采样也提示过期；“距今”改为按天 / 小时 / 分钟显示。
- **原则（与后端一致）：** 页面只显示报告里已有的值，不重新计算，不把工具汇总显示成“已验证”或“通过”。
- 资料：前端 `autog_frontend/ensembles.py`、`mode_reports.py`（只读报告适配器的写法、字段校验、路径限制）、`web/src/ensemble-panels.tsx`、`mode-panels.tsx`、`molecule-viewer.tsx`、`server-monitor.tsx`、`autog_frontend/monitor.py`；后端 `docs/ag-irc-review-1.md`。

## 允许改动的路径

- 新增 `autog_frontend/irc_reviews.py`（只读适配器）；`autog_frontend/api.py`、`studies.py`：只为登记新的只读接口和列出报告所必需的改动。
- 新增 `web/src/irc-panels.tsx`；`web/src/main.tsx`、`routing.ts`、`study-panels.tsx`：只为挂载新页面和入口所必需的改动。
- `web/src/server-monitor.tsx`（过期提示）；必要时 `autog_frontend/monitor.py`（只读）。
- 新增 `tests/test_irc_reviews.py`、`tests/irc_review_fixture.py`、`web/tests/irc-review.spec.ts`；`web/tests/` 中监控相关用例。
- `docs/ag-irc-review-1.md`：从后端同步（注明来源 T79）；`README.md`：页面说明。
- 不改版本号（随下一次发版一起改）；不新增写操作。

## 要做的

### 1. 只读适配器

- 只读 study `analyses/` 下 `schema == "ag-irc-review/1"` 的 JSON，以及它在 `path_geometry` 中声明的两个路径 XYZ；拒绝符号链接、越界路径。
- 校验必需字段和类型（数值必须有限或为 `null`；`points` 中点号、帧号与 XYZ 帧数一致）；用报告 `inputs` 中的 SHA-256 核对路径 XYZ（若报告记录了它们的哈希；未记录则显示“未核对哈希”）。不合规时显示错误原因，不显示这份报告的其余内容。
- 设大小上限（与集合页一致的做法），超出则拒绝。

### 2. IRC 查看页

- **顶部：** TS、两个 IRC Attempt、方法口径、`notice` 原文（必须显示）、阈值。
- **能量曲线：** 横轴为路径点（forward 在右、reverse 在左，TS 在中间为 0），纵轴为相对 TS 的能量（kcal/mol）；两侧分别标出停止原因（completed / max_points / corrector_failed / truncated）和最后一个已接受点；缺能量的点留空，不连线。
- **键长曲线：** 每个 `--pair` 一条曲线，横轴同上；若判据 ③ 有预期端点距离和中点，用水平参考线标出。
- **判据表：** 每个方向四条判据各一行：原始状态值（`tool_checks_passed`、`met`、`met_by_endpoint_optimization`、`not_met`、`unknown`，原样显示并配中文说明）、关键数值（降能、阈值、中点比较、末点 facts、身份比较结论）、依据（文件与行号）。`met_by_endpoint_optimization` 必须同时显示实际降能与阈值。方向汇总只显示报告中的 `summary` 原文（“工具核对完成，待人工审阅”或“IRC 未完成”）及 `unresolved` 列表。
- **结构查看：** 点击曲线上的点，在现有结构查看器中显示该帧结构，并高亮 `--pair` 原子对；可逐帧前后翻看。不做动画（负责人 10-16 决定）。
- **入口：** study 页面列出 `analyses/` 中的 IRC 报告；URL 可直接定位到某份报告和某个点。
- **措辞：** 页面任何地方不出现“已验证”“通过验收”字样；颜色上不要把 `tool_checks_passed` 显示成绿色的“通过”（建议中性色加“待人工审阅”）。

### 3. 服务器监控过期提示

- 现状：只有连续采样（`interval_seconds` 不为空）时才判断过期；单次采样无论多旧都不提示，“距今”按秒显示（例如 19 万秒），容易看漏。
- 修改：单次采样超过 10 分钟即显示“数据已过期”（阈值写成常量）；连续采样保持现有规则（超过 3 个采样间隔）。“距今”按“X 天 X 小时 X 分”显示，不足 1 分钟显示秒数。

## 不允许

- 不重新计算能量、距离或判据；不新增写操作；不改其他页面的行为。
- 不显示“已验证”；不把工具状态翻译成科学结论。
- 测试只用合成数据。

## 测试

- Python：合规报告通过校验；缺字段、非有限数、帧数不一致、XYZ 被改动、符号链接、越界、超大文件分别报错。
- Playwright：能量曲线和键长曲线显示；停止原因和最后一点标记；判据表原始状态值显示（含 `met_by_endpoint_optimization` 的降能与阈值）；点击路径点显示结构并高亮原子对；URL 恢复；页面不含“已验证”字样。
- 监控：单次采样 5 分钟前不提示、15 分钟前提示过期；连续采样规则不变；“距今”格式。
- 首次开 PR 和合并前运行前端全部离线测试、浏览器测试和构建；复测只跑受影响部分加构建。
- 敏感扫描与 `git diff --cached --check`。

## 真实环境验证

- 用后端 T79 在 L3 上生成的真实 `ag-irc-review/1` 报告（D 组，写在 study 以外的那份）在开发机上打开查看页，核对：曲线点数为 forward 44、reverse 6；后退方向判据 ② 显示 `met_by_endpoint_optimization`、降能约 0.28 kcal/mol 和阈值 3；C–F、C–Cl 键长曲线与对照表一致。截图或文字结果写进 PR（不写路径和主机）。
- 监控过期提示：在开发机上用一份旧的单次采样文件确认提示出现。

## 停止条件

- `ag-irc-review/1` 的实际输出与后端文档有出入，且不清楚以哪个为准。
- 需要后端补字段（例如路径 XYZ 的哈希没有记录在报告中且无法从 `inputs` 得到）：先停下汇报，由监督方决定是否开后端小单。

## 合并前审阅与交付

- 需要监督方审阅：是。
- PR 描述第一行：`Task: T87`；附 L3 报告的查看结果。
- 合并只由负责人操作。
