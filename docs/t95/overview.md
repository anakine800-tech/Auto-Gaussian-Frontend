# T95：Study 概览与 Attempt 表

基于已合并的 T94。沿用 `web/src/ui/tokens.css` 与统一组件，没有新增视觉令牌。
使用合成正丁烷、水和假 ag 验证；前端版本保持不变。

## 读取与显示规则

Python 适配器只增加本地展示字段。文件仍经原有目录描述符、`O_NOFOLLOW`、普通文件
和大小限制读取，不修改 study、Attempt、日志或分析结果，也不执行计算。

- 按现有 study 模板的二级标题读取“当前阻塞”“待你决定”“里程碑签字”和“进度日志”。
  保留原文、条目及原始行号；忽略代码围栏中的示例标题，重复标题的内容依次保留。
  缺失节显示“study.md 中没有此节”，空节显示“此节暂无条目”。文件本身不可读另行提示。
- 决定事项支持模板表格、列表和段落；里程碑支持模板的签字表和 ag 创建的简短列表。
  说明段落不计为里程碑。签字表的日期、签字人、确认原意中有空白、占位符或明确待签
  标记时计为待签；三项均明确“不适用”时排除。三项有内容只标为“已有签字记录”，
  不核验签字有效性，不据此宣称科学验收。无法判断的列表项显示“状态未明”。
- “阶段 / 里程碑”显示原文顺序中首个待签里程碑名称；无可识别待签项则显示“见签字记录”。
  不从作业状态推断研究阶段。待签数只统计明确待签项，缺节或无可识别条目显示“—”。
- “在跑”仅统计本地 `status.state == running`，不把 submitted、queued 或 unknown
  算作正在运行，不主动刷新集群状态。
- **待审规则**：`state == fetched`，`facts.json` 是可读 JSON 对象，且 `review.md`
  缺失或只有空白。不可读、超限、非 UTF-8 或符号链接的 review 显示未知，不当作缺失。
  非空 review 只表示有记录，不表示审阅通过、内容完整或已验收。
- “需要我处理”包含上述待审项，finished 待取回，以及 unknown、failed、failed_presubmit、
  stalled、interrupted、error、unavailable、awaiting_second_observation 状态；也包含
  manifest/status 无法读取、已取回却无法读取 facts、或 review 无法读取的项。
  这只是列表筛选，不新增可执行动作。

关键结果暂列最近修改的六个分析文件，显示名称和本地文件 mtime，以本机时区展示。
读取 analyses 根目录及一层子目录的 JSON、Markdown、CSV、TXT，沿用现有报告的目录深度
和逐级安全打开方式；不沿 JSON 中的路径读取文件。未知时间排在最后，内容读取异常明确
标注。集合和 IRC 报告打开现有专用查看器，其余打开原文件查看器。T98 前不提取或推算结论。

## Attempt 表与导航

默认列：编号、标签、类型、状态、方法缩写、电子能、自由能、虚频数、收敛。
可选列：集群、核数、用时、父 Attempt、提交时间。

- 类型取 manifest.template。方法先取 manifest.science.method_basis，缺失时展示已有
  facts.route / science.route 的截短文本，悬停可见全文，不自行解析或命名方法。
- Gaussian 电子能取 facts.energies.scf，xTB 取 facts.total_energy；自由能取 energies.g，
  虚频数取 n_imag。优化收敛只取 opt_converged 布尔值，不由 termination 代推。
- 集群和核数取 manifest；用时只取 status.elapsed；父 Attempt 只展示 manifest.parents
  的编号；提交时间只取明确的 status.submitted_at。当前生产者未提供该字段时为“—”，
  不以 manifest.created_at、status.updated_at 或文件 mtime 替代提交时间。
- 默认编号倒序；点击任意列排序，数值按数值比较，缺失值在两个方向均排最后。
  hash 查询参数 `status`、`type`、`attention=1`、`sort`、`order=asc|desc` 保存筛选排序；
  `review=1` 是待审 KPI 的精确筛选。保留其他查询参数；重置清除这些显示条件。
- 进入原 Attempt 详情后，刷新再返回仍恢复来源 URL、筛选、排序和页面滚动；浏览器后退
  同样恢复。研究说明、进度日志沿用 Collapsible 的本机折叠记忆。
- 旧概览中的结果表由新 Attempt 表承接；热化学、构象集合、IRC 保留在“分析”，结构文件
  保留在“文件”。所有既有精确链接继续定位同一对象。动作接口和 ag 人工确认流程未改动。

## 验证与截图

新增解析测试覆盖三节缺失、空节、模板表格、简短列表、原始行号、围栏和重复标题；
适配器验证 review 缺失 / 空白 / 存在 / 不可读、报告时间、嵌套报告、符号链接和读取前后
文件字节与修改时间不变。浏览器覆盖 KPI 计数、原文抽屉、报告跳转、可选列、排序筛选、
共享 URL、刷新后返回和滚动、空结果与缺失值，原有功能回归仍保留。

| 页面 | 1440 × 860 | 1280 × 720 |
| --- | --- | --- |
| Study 概览 | [截图](overview-1440x860.png) | [截图](overview-1280x720.png) |
| Attempt 表 | [截图](attempts-1440x860.png) | [截图](attempts-1280x720.png) |

两个视口均断言 KPI 整行、两栏标题和表头完全位于首屏，默认及全部可选列无页面横向
溢出；沿用全仓库未定义 CSS 变量及组件内样式扫描。最终全量测试结果见本 PR。

当前阻塞：无实现阻塞。等待监督方审阅和负责人合并。T96 在本 PR 合并后开工。
本次没有真实集群或科学验证，不修改后端 T92 / T93。
