# T98：分析入口与快速比较

所有测试和截图均为合成水 / 正丁烷及虚构报告。页面只显示保存的记录，工具记录仍待人工审阅。

## 报告入口与结论来源

分析按构象集合、IRC、热化学 / 能量剖面、通道覆盖、TS 标签、NCI 分组；其余归入“其他文件”。
列表接口继续仅返回文件名、mtime、schema 和读取错误，不返回正文。
前端只有结论行进入视口时才通过既有有界报告接口读取正文；屏外报告不请求正文。
Study 概览复用同一结论组件，只列最近更新的 6 项。未读取、缺字段或不认识的字段显示 `—`。

- `ag-ensemble/1`：`candidates` 数量、`bin_summary` 数量、`references` 各层最低候选；不重新排序能量选择最低者。
- `ag-irc-review/1`：`directions.forward.summary` 与 `directions.reverse.summary`，不把工具状态升级为科学结论。
- `ag-thermo/1`：`ensemble_G` 与报告保存的能量单位。
- `ag-profile/1`：`selectivity[].pairwise` 的 `ddG_barrier_kcal` / `ratio_a_over_b` 与 `products.*.fraction`；不现场重算选择性。
- `ag-channel-coverage/1`：`channels` / `product_branches` 中已有 `imbalances`，不另设阈值。
- TS 标签：`attempts[].product_configuration`、`product_centers[].label` 中 `unknown` / `needs_review` 数量及 `catalyst_check.status`。
- `ag-nci/1`：各帧 `fragment_pairs[].atom_pairs` 中保存的原子对与 `percent`，在各片段对内按保存百分比显示最多三对，不跨片段对比较不同分母的百分比；不解释成能量分解。

TS 与 NCI 字段按后端 T91 / T92 的现有源码核对（分别为 `321fe21`、`b13b2e8`）；不要求它们已部署或完成实际环境验收。
T91 `labels.json` 没有 schema，因此只用获准的固定路径识别；不伪造 schema。
构象集合与 IRC 详情保留全部原有排序、筛选、候选 / 路径点联动、来源和结构交互，使用统一 Panel / ActionBar / Collapsible / FactGrid / StatusBadge。

## TS 固定路径只读扩展

这是监督方 10-17 批准的对适配器的只读扩展。

只新增 `analyses/ts-labels/<名称>/` 内 `labels.json`、`labels.md`、`channel-suggestions.csv` 三个固定文件的发现和只读详情。
不普遍加深目录，不递归，不通配发现任意深层文件。名称继续走现有组件校验、逐级目录描述符与 `O_NOFOLLOW`、普通文件检查和 4 MiB 限制。
TS 列表正文同样只在结论行可见时读取；Markdown 与 CSV 打开详情才读取。
CSV 始终标注“建议，待确认”，使用 warn，不呈现已归类结果。

合成安全覆盖：正常三文件、目录根 / 名称目录 / 文件符号链接、非法路径、超限、坏 JSON、其他深层路径拒绝，以及读取前后字节与 mtime 不变。

## 快速比较

Attempt 表勾选至少两个记录后打开“快速比较（前端计算，非正式结果）”。
口径提取与 SCF 方法白名单的前端实现移植自后端 `ag/src/ag/_profile_sources.py` 的 T82 规则；不 import 或修改后端代码。
按需读取所选 Attempt，用保存的 Gaussian `facts.route` 按后端 T82 的 `protocol()` 规则提取方法、基组、色散、溶剂模型 / 名称和基函数形式；核对程序版本、电荷、多重度、最终几何元素组成及原子数。
SCF 支持范围与 T82 相同；未知方法、相关 / 复合方法、自定义基组 / ECP / IOp、SCRF Read / 歧义口径、缺版本 / 几何 / 单位均拒绝。
口径不同逐项列出差异并不展示相对能量表。

电子能只取 `energies.scf`，自由能只取 `energies.g`，单位须明确为 Hartree。
前端按每列最低有效保存值计算 `ΔE / ΔG = (值 − 最低值) × 627.5094740631 kcal/mol`；缺值显示 `—`，不会拿另一列填补。
不做 Boltzmann、不改温度、不生成正式报告、不写任何研究文件。比较通过只表示以上口径一致，不表示科学验收。

## T96 非阻塞项

- 查看器没有独立 Review 备选几何时去掉“坐标来源”单选框，Attempt 的“预览结构”保留输入 / 最终切换；若真的有独立 Review 几何仍保留必要的选择能力。
- `analysis_summary` 的 `import codecs` 移至模块顶部。
- 没有新增视觉令牌，全部新增样式引用 T94 / T96 的既有令牌。动作参数、原生确认、只读边界不变。

## 验证与截图

- Python 离线：107 项通过。
- TypeScript 与 Vite 构建通过。
- 浏览器全量首跑 127 / 128 通过；唯一搜索测试把概览可见结论的延后读取计入搜索请求，改从不读取报告正文的 Attempt 表进入后，分析与搜索相关 27 / 27 复测通过，仍断言搜索输入产生零请求。最终提交的全量 CI 结果见 PR。
- 新增各类结论与缺字段、T82 口径逐字段不一致 / 缺证据 / 相对能量、固定 TS 深链与 CSV 标记、20 报告按视口读取、重复选择器覆盖。
- 严格首屏断言：两个视口的六组分析卡片、快速比较表、集合表头，以及 IRC 详情标题；无横向滚动，页面不出现“已验证”。T96 两视口结构卡与 190 px 最小场景断言原样保留。
- 首轮 1280×720 分析容器超出 21.8 px，原因是 Panel 默认 margin 的级联覆盖；改为网格子项 margin 规则后通过，没有放宽断言、字号或内容。
- 未执行真实集群 / 科学验证；合并由负责人操作。

| 页面 | 1440 × 860 | 1280 × 720 |
| --- | --- | --- |
| 分析入口 | [截图](analysis-1440x860.png) | [截图](analysis-1280x720.png) |
| 快速比较 | [截图](comparison-1440x860.png) | [截图](comparison-1280x720.png) |
| 构象集合 | [截图](ensemble-1440x860.png) | [截图](ensemble-1280x720.png) |
| IRC | [截图](irc-1440x860.png) | [截图](irc-1280x720.png) |
