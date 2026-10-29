# T193：已保存自由能剖面的能级图、来源跳转与CSV

## 分支与目标

前端 `codex/t193-profile-view-csv`；对应V4.8 W9。一单一PR，从最新main。当前 `SavedReport` 将 ag-profile/1 直接显示为JSON；本单提供可核对已有结果的图和导出，不计算新能量。

## 允许改动的路径

- `web/src/profile-panels.tsx`（新增）、`web/src/file-view.tsx`、`web/src/ui/report.css`：专用展示与集成。
- `web/src/analysis-summary.ts`、`web/src/data-table-view.tsx`：仅必要的已有报告/来源链接复用。
- `tests/analysis_fixture.py`、`tests/test_results.py`、`tests/test_analysis_labels.py`、`web/tests/report-reading.spec.ts`、`web/tests/analysis.spec.ts`：合成回归。
- `README.md`、`docs/redesign-tasks/T193-profile-view-csv.md`。

## 要做的

1. 对照实际后端profile输出：读取states保存的relative_G_kcal、id/kind/species，显示单位、reference、temperature_K、standard_state、显式浓度、警告和来源。禁止从G_kcal重新计算相对能、用新facts替换报告值或更换参考态。
2. 能级点击到该状态实际采用的Attempt。状态可能包含多个物种和构象：列出报告保存的conformers/attempt_id/spc_attempt_id供选择，不凭排序推定唯一代表或最低构象。
3. 图、表、CSV基于同一个已读取的不可变内存快照。下载期间不重新请求或拼接新文件；保留单位、条件、来源与缺失原因。缺字段/非有限数显示未知，不能当零或连接虚假能级。
4. CSV文本单元格防公式注入（含前导空白后的=,+,-,@及控制字符），正确处理逗号、引号、换行；可信数值与文本区分，不把负的数值能量变成公式。
5. 保留完整原始JSON入口与旧/未知格式回退。桌面/窄屏可读，键盘可操作，长名称不遮挡相邻能级。
6. 只格式化实际改动的文件；不引入后端报告格式或新的机理拓扑定义。

## 测试

构造多物种、多构象、TS、负相对能、缺数值/缺来源、报告加载后源变化和CSV注入的合成报告。核对CSV与图同源、来源跳转正确、无额外ag调用。按仓规Python相关单测、pnpm build、首次PR及合并前全量浏览器测试；固定测试端口须与其他前端工单串行使用。实际截图；精确暂存、敏感扫描、差异检查、noreply身份。

## 真实环境验证与非目标

只读前端，合成离线验证，不读研究目录、不操作集群/服务、不改ag科学计算或签字。无需真实计算。超出路径或同一问题修两次不成功须报告。

## 交付

PR首行 `Task: T193`。报告字段核对、图/CSV一致性、缺失和注入用例及截图。T192先合并，随后按最终main解决README重叠；协调会话审阅合并。

## 实现核对

- 对照后端 `4fce3cf7305bd57eb31525e54bb3edcc70b71986` 的 `ag/src/ag/profile.py` 与 `_profile_sources.py`：`units` 为字符串，`state.species` 为物种到计量数映射，报告 `species` 为物种对象；来源逐个展开 `conformers`，分别显示 Freq 与可选 SPC。`spc_attempt_id: null` 与缺字段分开说明。
- 专用面板仅复制 `relative_G_kcal`，保留参考态、温度、标准态、显式浓度以及报告、对称性、物种三个层级警告。能级按报告顺序，无机理连线，缺数值不画能级。
- 读取后复制并冻结快照；状态表、能级图、CSV、完整 JSON 共用该快照。CSV 每个状态/物种/构象一行，保留来源 JSON、设置、缺失原因；有限负数保持数值，其余文本防公式注入并按 CSV 规则转义。
- 精确 Attempt 路由不借用页面关键字；剖面表关闭通用 Attempt 自动识别，避免状态名与 Attempt 同名时误开结构预览。
- 桌面与窄屏图和表可局部横向滚动，长状态名不覆盖相邻能级；按钮支持键盘，选状态后聚焦来源标题。

## 合成验证记录

- Python：`tests.test_results`、`tests.test_analysis_labels` 共 21 项通过；接口保留原保存值，读取前后文件字节及 mtime 不变，subprocess 禁止。
- 专项浏览器：`report-reading.spec.ts`、`analysis.spec.ts`、`shell.spec.ts` 共 63 项通过，含快照冻结、加载后响应替换、下载零额外请求、多物种/多构象/SPC、负能量、缺数值/缺来源、未知 schema、旧格式、CSV 注入、保留字 Attempt 路由与同名状态。
- Node 24.22.1 / pnpm 11.19.0：构建通过；原有大于 500 kB 包提示保留。
- 首轮全量检查发现 TSX 内联样式不符合仓规，能级位置已改为 SVG 坐标，相关检查复测通过。最终全量浏览器 369 项通过；随后按协调要求做限定文件格式化，格式化后相关 63 项再次通过。实际合成截图随交付提供，不写入公开仓库。
- 本单仅合成离线验证，没有读取真实研究、操作配置、调用真实 ag 或连接集群。T192 先合并，合并前按最终 main 核对 README 并重跑全量浏览器；开发会话不自行合并。

## 格式验收补充

- 按协调要求临时安装固定 Prettier 3.6.2，仅对本单改动的 `profile-panels.tsx`、`file-view.tsx`、`report.css`、`report-reading.spec.ts`、`analysis.spec.ts` 执行 `--write` 与 `--check`，后者通过；没有全仓格式化，也没有修改产品依赖或 lockfile。
- 格式化前后四份 TS/TSX 的语义 AST 一致（忽略位置/注释元数据，按 React 规则规范化 JSX 空白及等价字符串子节点）；CSS 选择器、声明值与规则顺序一致（规范化格式空白和等价属性引号）。
- 格式化后生产构建通过，相关 63 项浏览器回归通过；按协调指示，纯格式变化不再次重跑完整套件。
- 测试结束已释放本单合成服务；后续同机浏览器顺序为 T192 → T194 → T195，不复用其他会话服务。
