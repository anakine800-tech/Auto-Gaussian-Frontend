# T121：前端计算链与采用结果——研究对象 → 计算链 → 采用结果

版本：v1（监督方，2026-10-24）。**开发机做。** 前端出一个 PR，PR 描述第一行写 `Task: T121 (frontend)`。

## 分支与目标

- 分支：`codex/t121-chains-adoption`。
- **开工条件：** 以前端 main（不早于 `a9695c5`，已含 T115、T116、T118、T120）为基线；后端 T119 已合并（`ag-catalog/1`、`ag-catalog-state/1`，字段见后端 `docs/ag-catalog-1.md`）。和 T122 并行开发，**T121 先合并**，T122 之后 rebase。
- **负责人 2026-10-23 决定（前端改版规格 v6 的"研究 · 计算链"一节和第 3 节口径，原型第 2、3 屏）：**
  - H1 研究页新增"计算链"分区，放在"进展"和"全部 Attempt"之间。每行一个对象（构象 × 电子态）：对象名、电子态、计算链小标签（例如 CREST → Opt ✓ → Stable ✓ → Freq 0 虚频 → SP ✓，用颜色表示状态）、相对能量、状态（已采用 / 候选 / 待取回 / 历史）、审阅情况、"＋比较"。
  - H2 对象来源：读 study 的 `catalog/state.json`，并用 `journal_sha256` 核对日志；没有登记，或核对不一致时，按 parents 连通分组自动成链（规则与 `ag catalog suggest` 一致），标为"未登记"。核对不一致时在页面顶部显示警告。
  - H3 展开一行显示每一步：Attempt、计算类型、**取自 route 的方法**、服务器、状态、关键事实（收敛、虚频、⟨S²⟩、稳定性等，来自 facts）、审阅情况。"方法依据"文本不在表格里显示。
  - H4 相对能量只对**已登记、已采用**的对象计算（未登记的显示"—（未登记）"）。口径可以选 E / E+ZPE / G，默认读 study.md front matter 的 `energy_basis`，没有就用 E+ZPE。计算方法：
    - E = `scf_h`（SP）；
    - E+ZPE = `scf_h + zpe_h`；
    - G = `scf_h + (g_h − freq_scf_h)`。
    - 任何一项为 null 就留空；参照对象可选（默认取能量最低的已采用对象），单位换算为 kcal/mol。
    - 比较前核对口径：SP 的方法、基组、溶剂相同，元素组成和电荷相同；不同的行留空并写明原因。多重度不同时照常显示，但标"电子态能差"。
    - 标题固定写"前端现场换算，正式数值以报告和登记为准"。
  - H5 筛选：电子态、计算类型、状态、隐藏历史、只看需要我处理。
  - H6 进展页补上两块（T120 留下的位置）：
    - **当前采用的结果**：对象 · 电子态、结构 / 频率 / 能量分别来自哪个 Attempt、H4 口径下的相对能量、依据报告、状态（已签 / 候选 / 待签）。
    - **关键报告**：按"`report-kind` 为 formal → 被采用记录引用的报告 → 里程碑里待签条目指向的报告"的顺序挑选，不按修改时间。
    - 没有登记时，这两块显示"尚未登记采用结果"，并给出 `ag catalog suggest` 的提示。
  - H7 "＋比较"放入比较篮的是这个对象的**代表 Attempt**：已采用的 SP，没有就用已采用的 Freq，再没有就用已采用的 Opt；未登记的对象取链上最后一个已取回的 Attempt。
  - H8 "全部 Attempt"平铺表加两列：对象 · 电子态（来自登记，没有登记写"未登记"）、计算类型（登记了就用登记的 role；没有就按 route 推断，规则与后端 `infer_roles` 一致：TS / Opt / Freq / Stable / IRC / Scan / SP，以及 CREST、xTB）。
  - H9 报告类别：在 T118 预留的位置接入登记里的 `report_kinds`，优先级为 ag schema → 登记 → 报告自己的声明 → 文件类型。类别取值和后端 T123 统一后的表一致（含 coverage、ts、nci）。
  - H10 截图夹具加一个以 `val-` 开头的合成 study，好让"验证与测试"分组也能截到（T120 审阅 #2）。
- **资料：** 后端 `docs/ag-catalog-1.md`；`web/src/overview.tsx`、`attempt-table.tsx`、`progress-definitions.ts`、`compare-basket.ts`、`analysis-summary.ts`；`autog_frontend/studies.py`（T120 已有的 catalog 读取）；前端改版规格 v6。

## 允许改动的路径

- 新建 `web/src/chains-view.tsx`、`web/src/catalog-data.ts`（读取、核对、自动成链、角色推断、能量换算）、`web/src/ui/chains.css`。
- `web/src/overview.tsx`（H6）、`attempt-table.tsx`（H8）、`progress-definitions.ts`（口径文字）、`compare-basket.ts`（只加"按对象放入"的入口函数，不改存储格式）、`analysis-summary.ts`（H9）、`help-page.tsx`（计算链一节）。
- `web/src/main.tsx`、`web/src/routing.ts`：**只新增**"计算链"分区及其路由 `#/<study>/chains`。
- `autog_frontend/studies.py`：在 study 返回值中加入 `catalog`（`state`、`journal_ok`、`warning`），以及 study.md front matter 里的 `energy_basis`；`autog_frontend/study_summary.py`（front matter 解析）。
- 测试：新建 `tests/test_catalog_view.py`、`web/tests/chains.spec.ts`，以及相关的现有测试；夹具只用合成 study 和公开小分子。
- 文档：`README.md`；本单 `docs/redesign-tasks/T121-chains-adoption.md`、`docs/redesign-tasks/open-tasks.txt`。

## 不允许

- 不写任何 study 文件（登记只能通过 ag）；不调用 ag。
- 不把未登记、未采用的对象当作已采用；不推定构象或电子态是否相同。
- 能量换算只按 H4 的公式，不做 Boltzmann、不换温度、不做其他校正。
- 不改比较篮的存储格式（T122 会用到）；不改服务器页和报告阅读页的实现。
- 测试和截图里不出现真实 study 名、编号、用户名或主机名。

## 测试

| 场景 | 预期 |
|---|---|
| 有登记、哈希一致 | 对象、成员、采用情况按登记显示 |
| 哈希不一致 | 顶部显示警告，按"未登记"自动成链 |
| 没有 catalog 目录 | 自动成链，全部标"未登记" |
| 自动成链 | 和后端 `suggest` 用同一份合成数据得到相同的分组 |
| 角色推断 | `opt=(ts,calcfc)` → TS；只有方法和基组 → SP；`Opt Freq` 不算 SP；CREST / xTB 按模板判断 |
| 能量换算（E / E+ZPE / G） | 和手算一致；任一项为 null 时留空 |
| SP 方法或溶剂不同 | 该行留空并写原因 |
| 多重度不同 | 显示数值，并标"电子态能差" |
| `energy_basis` front matter | 默认口径跟随它；没有时用 E+ZPE |
| 进展页"当前采用的结果""关键报告" | 按 H6 的规则挑选；没有登记时显示提示 |
| "＋比较" | 放入的是 H7 规定的代表 Attempt |
| 平铺表的两列新列 | 显示正确 |
| 报告类别 | 登记的 `report_kinds` 排在报告声明之前 |
| `val-` 开头的 study | 归入"验证与测试" |
| 窄屏 390 px | 没有横向页面滚动；表格在自己的框里滚动 |

推送前本地跑 Python 测试、浏览器测试和构建各一次，之后以 CI 为准；同时运行 `python scripts/scan_public.py` 和 `git diff --cached --check`。

## 真实环境验证

- 不需要提交计算。合并前在开发机上用真实 studies_root 打开计算链和进展页自查一次（研究 study 可能还没有登记，这时看到"未登记"是正常的）。**不截图，PR 里不写真实 study 名**，只写结果。

## 停止条件

- 需要改后端，或者需要写 study 文件；需要改比较篮的存储格式。
- 需要改动范围外的文件；同一问题修两次仍未解决。

## 合并前审阅与交付

- 监督方**轻审**，但 `catalog-data.ts` 里的**能量换算和口径核对要逐行审**（会显示科学数值）。看三个尺寸的截图（合成数据）、测试结果和 diff 概要。合并只由负责人操作，排在 T122 之前。
- PR 描述包括：H1–H10 各自对应的改动、能量换算公式与口径核对规则表、截图、全量测试结果。
- **合并后：** 开发机重新构建前端，两个常驻前端服务各重启一次。

## 版本记录

- v1（2026-10-24，监督方）：依据负责人 10-23 决定与前端改版规格 v6 起草；能量换算采用 T119 复审确定的 `freq_scf_h` 组合方式。


## 实现与验证记录（2026-10-24）

- H1–H5：新增计算链页、登记读取与原始日志哈希核对；未登记子图分组、角色推断、展开 facts、筛选、参照与三种能量口径。
- H6：进展页当前采用结果与关键报告；签字状态仅关联明确引用的依据报告，不把 adopted 当签字。
- H7：比较篮入口优先采用 SP、Freq、Opt；未登记链取按父子顺序最后一个 fetched；存储格式保持原样。
- H8：平铺表新增对象/电子态与计算类型列；旧表回归断言同步新增列。
- H9：schema → 登记 → 报告声明 → 文件类型；TS 固定目录识别仅作无显式类别时的兼容回退；登记变化不受报告文件元数据缓存影响。
- H10：合成 `val-water` 夹具与展开“验证与测试”的截图；三尺寸页面无横向溢出，宽表在自身容器滚动。
- 能量公式逐行审阅入口：`web/src/catalog-data.ts` 的 `energyValue`、`protocol`、`relativeEnergies`；单位为 Hartree，差值乘 627.5094740631 得 kcal/mol。缺失值不补算；方法/基组/色散/基函数形式/溶剂/元素组成/电荷不同均留空并给原因；多重度差异仅标电子态能差。
- 与后端 T119 `suggest` 用同一组合成图交叉核对：分叉、环、缺父、退役桥节点，共 5 个分组逐项一致；该核对仅使用临时合成文件，无 CLI/配置/远程调用。
- Python 全量首次运行 150 项通过；报告类别优先级补充后，相关 34 项通过（新增 1 项，最终全量由 CI 验证）。
- 浏览器全量 216 项运行：211 通过、5 项旧列位置/列数断言失败；更新为新增两列后的预期后，计算链、进展、报告阅读 32 项复测全部通过。
- 生产构建通过，保留既有大包体积提示。敏感扫描与暂存 diff 检查随提交执行。
- 真实环境：负责人明确授权后临时启动本机只读服务，计算链与进展页可打开，无登记回退符合预期；0 浏览器异常、0 写请求；不截图、不调用 ag、不写研究文件，临时服务已关闭。
- 当前阻塞（科学审阅）：等待监督方轻审及能量公式/比较口径逐行审阅。由负责人合并，T121 先于 T122；常驻服务构建/重启留待合并后执行。

### 监督审阅修订（2026-10-24，针对 18380d2）

- 方法比较去掉 R/U/RO 前缀（优先 RO，去掉后须非空）；展开步骤单列“自旋处理”，不把该信息作为口径差异。RB3LYP/UB3LYP 和 RωB97X-D/UωB97X-D 可显示电子态能差，B3LYP/M062X 仍拒绝比较。
- E+ZPE、G 分别核对双方采用的 Freq 方法、色散、基组、基函数形式及溶剂；G 再核对 Freq route 温度与压力，缺省为 298.15 K、1 atm。差异按“Freq 方法不同”“Freq 温度不同”等说明；显式值无法解析时不套默认值。
- 保留 SP 与 Freq 可采用不同方法的组合方式；E 不依赖 Freq 口径。缺少采用 Freq Attempt、参照口径不全也有回归覆盖。
- 合成 S0/T1 夹具改用 RB3LYP/UB3LYP；SP 不再伪造优化收敛、虚频或稳定性事实。补充两种页面的口径切换和“自旋处理”显示断言，重新生成三尺寸合成截图。
- 验证：计算链定向 22 项、Python 全量 151 项、浏览器全量 223 项及生产构建通过；公开扫描 231 文件、0 错误，提交前另做含私有词表的暂存扫描。
- 两条阻塞意见均已实现，等待监督方复审；不操作真实研究、集群或常驻服务。

合成截图（均不含真实研究与环境信息）：

| 尺寸 | 计算链 | 采用结果与关键报告 | 验证与测试分组 |
|---|---|---|---|
| 1440×860 | [计算链](../../tests/fixtures/chains/chains-1440.png) | [采用结果](../../tests/fixtures/chains/adoption-1440.png) | [分组](../../tests/fixtures/chains/validation-1440.png) |
| 1280×720 | [计算链](../../tests/fixtures/chains/chains-1280.png) | [采用结果](../../tests/fixtures/chains/adoption-1280.png) | [分组](../../tests/fixtures/chains/validation-1280.png) |
| 390×844 | [计算链](../../tests/fixtures/chains/chains-390.png) | [采用结果](../../tests/fixtures/chains/adoption-390.png) | [分组](../../tests/fixtures/chains/validation-390.png) |
