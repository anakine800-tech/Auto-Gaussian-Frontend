# T104：IRC 页 TS 与两端点并排三维视图

版本：v1（监督方，2026-10-20）。**开发机做。** 前端仓库一个 PR，PR 描述第一行 `Task: T104 (frontend)`。

## 分支与目标

- 分支：`codex/t104-irc-ts-endpoints`。
- **开工条件：** 前端 main 为 `65724c6` 或其后（如果 T103 已合并，就以合并后的 main 为准）；没有与本单路径冲突的未合并 PR。
- **目标（下一轮修复第 5 项，时间要求：在研究 A 首批 IRC 提交之前完成）：** 在现有 IRC 查看页上加一个区块，把 **TS 结构、reverse 端点优化结构、forward 端点优化结构**三者用三维并排显示，并且每个都能跳转到对应 Attempt 的详情页。
- **资料：** 前端 `docs/ag-irc-review-1.md`、`docs/redesign-tasks/T87-frontend-irc-view.md`、`web/src/irc-panels.tsx`、`web/src/molecule-viewer.tsx`、`autog_frontend/irc_reviews.py`、`web/src/api.ts`、`web/src/routing.ts`；后端 `docs/ag-irc-review-1.md`（`ag-irc-review/1` 规范）。

## 背景（前端 main `65724c6` 的代码现状）

1. IRC 页（T87）已经有：双向能量曲线、键长曲线、逐点查看结构、四项判据表。页头会显示 `TS：<id> · forward：<IRC Attempt> · reverse：<IRC Attempt>`。
2. 报告顶层的 `ts` 字段是 TS 的 Attempt ID。端点判据（`criteria.endpoint`）记录了端点 facts 的来源和身份核对结果。端点 Opt+Freq 的 Attempt 来自生成报告时传入的 `--forward-endpoint`、`--reverse-endpoint`，并在 `inputs` 里留有 manifest 和 facts 的路径与哈希。
3. 前端已经有可以复用的 `MoleculeViewer`，以及按 Attempt 读取最终几何的 API（`Attempt.geometry`）。
4. 端点判据还有另一种来源：用 XYZ 参照代替端点 Attempt，这种情况下没有端点 Attempt。

## 允许改动的路径

- `web/src/irc-panels.tsx`，新建 `web/src/irc-structures.tsx`（或同类拆分文件）。
- `autog_frontend/irc_reviews.py`：只用于从已核对的报告引用中解析出端点 Attempt ID，并按现有规则读取它们的最终几何（只读、核对路径和哈希）。
- `web/src/style.css` 或 `web/src/molecule-layout.css`：只加本区块的布局样式。
- 测试：`web/tests/irc-review.spec.ts`、`tests/test_irc_reviews.py`、`tests/irc_review_fixture.py`。
- `docs/ag-irc-review-1.md`（前端说明部分）、`docs/redesign-tasks/T104-irc-ts-endpoints.md`（本单副本）。

## 要做的

### 1. 确定三个结构的来源（只读，不猜）

- **TS：** 取报告顶层的 `ts`，读取这个 Attempt 的最终几何。
- **端点：** 只能从报告中**明确的引用**解析出端点 Attempt。优先用 `criteria.endpoint` 记录的来源；其次用 `inputs` 中属于端点的 manifest 路径。解析结果必须和该 Attempt 的 manifest 一致，读取前核对路径和哈希。
- 解析不出端点 Attempt 时（例如端点判据用的是 XYZ 参照），这一格显示"报告未提供端点 Attempt"。**不按名称或编号猜测。**
- 读到的文件哈希和报告记录的不一致时，这一格显示错误，不显示结构。与 T87 现有的哈希检查规则一致。

### 2. 并排显示

- 一行三格，顺序为：**reverse 端点 | TS | forward 端点**，和曲线的方向一致（reverse 在左）。每格标题写清楚是哪个结构，以及 Attempt ID。
- 每格下方附三项：电子能（Hartree，6 位小数）、虚频数、到该 Attempt 详情页的链接。数值来自对应 Attempt 的 facts；缺失就显示"未知"，不推算。
- **高亮原子：** 报告里 `distances_angstrom` 跟踪的原子对，在三个结构中都高亮显示，并在格内列出该原子对在这个结构里的距离（Å，用最终几何计算，前端计算的值要标明）。
- 原子编号沿用文件里的原始顺序，三格一致。
- 三格各自独立旋转即可，不要求同步旋转。
- 窄屏（<1024 px）时三格改为纵向排列。

### 3. 措辞

- 区块标题和说明里**不出现**"已验证"或"IRC 成立"。结论仍以四项判据表为准；本区块只用于人工比对结构。

## 不允许

- 不改后端，不改报告格式，不在前端重新计算判据。
- 不读取报告引用之外的文件；不放宽路径和哈希检查。
- 不改动现有曲线、判据表和逐点查看的行为。

## 测试

| 场景 | 预期 |
|---|---|
| 报告含 TS 和两个端点 Attempt | 三格都显示结构、能量、虚频数、链接 |
| 端点判据用 XYZ 参照，没有端点 Attempt | 对应格显示"报告未提供端点 Attempt" |
| 端点 Attempt 文件哈希和报告不符 | 对应格显示错误，不显示结构 |
| facts 缺能量或虚频数 | 显示"未知" |
| 跟踪原子对 | 三格都高亮，距离数值正确（夹具已知值） |
| 1440×860、1280×720 | 三格首屏完整可见，不需要滚动（Playwright 断言，不加容差；高度按实测栏高推导，不写死像素） |
| <1024 px | 纵向排列 |

全部离线测试、浏览器测试和构建各跑一次；敏感扫描与 `git diff --cached --check`。

## 真实环境验证（合并前，开发机）

1. 用开发机上已有的**非研究** IRC 验证 study（T79/T87 验证时用过的那个），重新生成一份含两个端点 Attempt 的 `ag irc-review` 报告。如果原本已有，就直接用。在新前端打开，两个视口各截图一张。截图里不能有主机名、用户名、路径。
2. 如果开发机上没有带端点 Attempt 的非研究 IRC 数据，就用测试夹具截图，并在 PR 里说明。**不提交新的计算**，也不使用研究 A 数据。

## 停止条件

- 端点 Attempt 必须靠猜测才能确定；需要改后端报告格式。
- 需要改动范围外的文件；同一问题修两次仍未解决。

## 合并前审阅与交付

- 需要监督方审阅：**是**（截图类验收）。合并只由负责人操作。
- PR 描述：来源解析规则、截图说明、测试结果。
- **合并后（负责人安排）：** 开发机重新构建前端；研究用计算机在首批 IRC 之前更新。

## 版本记录

- T116 脱敏：研究标识、编号与环境字面量改为泛称；原工单结构和结论不变。

- v1（2026-10-20，监督方）：依据下一轮修复清单第 5 项起草。

## v1 实施记录（2026-10-20）

- 基于前端 main `65724c6`；开工时无未合并 PR，分支为本单指定分支。
- 实现与只读来源规则见 [前端说明](../ag-irc-review-1.md#前端结构比对t104)。
  仅改本单允许路径，复用 MoleculeViewer、最终 XYZ 解析器和原有安全文件读取。
- 使用已有的非研究 L3 D 组报告及其三个 Attempt 的逐字节本地副本验证；
  9 份 manifest / facts / final.xyz 哈希均与报告一致，未改原 study，未生成新计算。
  两侧保留含起点的 45 / 7 个点；结构展示不构成新的科学验收。
- 已保存 1440×860、1280×720 两张截图供监督方审阅。两种视口三格完整在首屏内，
  通过无容差的边界断言；截图不含主机、用户或绝对路径。
  图片作为本次开发对话交付物保留，不新增工单范围之外的仓库图片目录。
- 浏览器全量验证在临时副本使用独立回环端口，避免占用其他开发会话的默认测试端口；
  生产代码、构建与测试断言不变。最终测试数量、敏感扫描结果见 PR。
- 合并仍待监督方截图审阅和负责人操作；合并后构建、部署按负责人另行安排。
