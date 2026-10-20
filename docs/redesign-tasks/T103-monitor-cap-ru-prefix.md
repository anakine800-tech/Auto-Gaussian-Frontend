# T103：前端监控上限显示、快速比较 R/U 前缀

版本：v2（v1 工单 + 负责人范围补充，2026-10-20）。**开发机做。** 前端仓库一个 PR，PR 描述第一行 `Task: T103 (frontend)`。

## 分支与目标

- 分支：`codex/t103-monitor-cap-ru-prefix`。
- **开工条件：** 前端 main 为 `65724c6`（v4.3.0）或其后；后端运行版本含 T101（`76d5d15` 或其后）；前端没有与本单路径冲突的未合并 PR。
- **目标：**
  1. 下一轮修复第 1 项的前端部分（后端已在 T101 修好）：作业页准确显示**运行加排队总上限**，不再把单作业上限当成总上限；同一集群的多个入口要标明"共享上限"。
  2. 下一轮修复第 3 项：快速比较按后端 T99 的规则补全 R/U 前缀，单重态下 `M062X` 与 `RM062X` 视为相同。
- **资料：** 后端 `ag/src/ag/_profile_sources.py` 中的 `normalized_method()`（T99 规则），后端 `monitor.py`（T101 新增的 `committed_cap` 与 `shared_with`），前端 `docs/ag-monitor-1.md`、`docs/t97/jobs.md`、`docs/t98a/comparison-facts.md`。

## 背景（前端 main `65724c6` 的代码现状）

1. `web/src/server-monitor.tsx`：只有 `cores_running`、`cores_queued`、`committed_cap` 三项都存在时，才用 `committed_cap` 作为总上限；否则退回用 `core_cap`（单作业上限）充当总上限。监控失败的快照和旧快照都会走这条退回路径，这就是"显示 88/32"的原因之一。
2. 前端还不认识后端 T101 新增的 `own.shared_with`。
3. `cluster.budget` 和 `cluster.expires` 为 null 时，页面已经会隐藏对应行。本单只需核对，不必改。
4. `web/src/quick-comparison.ts`：`protocol()` 直接把原始方法名放进比较项，所以 `M062X` 与 `RM062X` 会被判为"方法不同"。`variants()` 只在识别是不是 SCF 方法时去掉了前缀。

## 允许改动的路径

- `web/src/server-monitor.tsx`、`web/src/jobs-data.ts`（如有需要）。
- `web/src/quick-comparison.ts`、`web/src/quick-comparison-panel.tsx`（只改显示文字）。
- `autog_frontend/monitor.py`：只为接受并原样传递 `own.shared_with` 而改校验。
- 测试：`web/tests/jobs.spec.ts`、`web/tests/results.spec.ts`（仅更新受本单影响的监控断言）、`web/tests/analysis.spec.ts`（或快速比较实际所在的 spec）、`tests/` 下对应的 Python 测试，以及必要的夹具。
- `docs/ag-monitor-1.md`（补 `shared_with` 字段）、`docs/t98a/comparison-facts.md`（补前缀规则）、`README.md`（已知问题里删去 R/U 前缀一条）、`CHANGELOG.md` 不改（发版时统一写）。
- `docs/redesign-tasks/T103-monitor-cap-ru-prefix.md`（本单副本）。

## 要做的

### 1. 监控上限显示

- **总上限：** 快照里有 `committed_cap` 就显示它，不管有没有运行和排队的分项数。没有 `committed_cap` 时（T51 之前的旧快照），显示"总上限未知（旧快照）"，**不再**拿 `core_cap` 代替。
- **单作业上限：** `core_cap` 单独显示为"单作业上限 N 核"。
- **共享上限：** 有 `shared_with` 时，在该入口的容量区加一句"与 scnet-test 共享总上限"（入口名从字段读取，不写死）。如果页面上有任何跨入口汇总（核数合计、占用比例等），同组入口只计一次。没有跨入口汇总就不新增。
- 失败快照、"非最新"快照沿用现有标识，总上限按上面的规则显示。
- 核对：`budget` 和 `expires` 为 null 时不显示对应行。

### 2. 快速比较的 R/U 前缀

- 按后端 `normalized_method()` 的规则：方法名转为小写、去掉连字符之后，如果**完整**地落在已支持的 SCF 方法集合中（没有写前缀），就按多重度补全——单重态补 `r`，其他补 `u`。已经显式写了 R、U、RO 的保持原样，彼此不同。基础名称要整体匹配，避免把 `revTPSS` 误拆成 R + `evTPSS`。
- 用补全后的方法名参与比较。差异提示里同时显示原始写法和补全后的写法，例如："方法不同：A = M062X（按单重态视为 RM062X）；B = UM062X"。
- 缺少多重度时维持现状，直接拒绝比较。
- 页面上"快速比较为前端计算、非正式结果"的提示保留。

## 不允许

- 不改后端，不改 `ag-monitor/1` 现有字段的含义。
- 不放宽快速比较的其他口径检查（基组、色散、溶剂、程序版本、组成、电荷、多重度）。
- 不出现"已验证"之类的措辞；不改无关页面。

## 测试

| 场景 | 预期 |
|---|---|
| 快照有 `committed_cap`，没有运行和排队分项 | 总上限显示 `committed_cap` |
| 旧快照只有 `core_cap` | 显示"总上限未知（旧快照）"，单作业上限另行显示 |
| 快照带 `shared_with` | 显示共享说明；如有跨入口汇总，同组只计一次 |
| `budget` 和 `expires` 为 null | 不显示对应行 |
| 单重态 `M062X` 对 `RM062X` | 视为相同，可以比较 |
| 三重态 `M062X` 对 `UM062X` | 视为相同 |
| `RM062X` 对 `UM062X`、`ROM062X` 对 `UM062X` | 判为不同 |
| `revTPSS` 等名称 | 不被误拆前缀 |
| 缺多重度 | 拒绝比较（与现状一致） |

全部离线测试、浏览器测试和构建各跑一次；敏感扫描与 `git diff --cached --check`。

## 真实环境验证（合并前，开发机）

前端只读，不连接集群、不提交作业。

1. 开发机用新前端读取当前真实的监控快照（含 `scnet` 与 `scnet-test`）。在 1440×860 和 1280×720 两个视口下截图作业页，显示应为：总上限 256、单作业上限 64、共享说明。截图里不能有主机名、用户名、路径。
2. 用非研究 study（例如 T101 的正丁烷 study，或 T99 用过的水分子与正丁烷结果）做一次快速比较截图，展示前缀补全后的结果。如果手边没有单重态下 `M062X`/`RM062X` 写法不同的真实例子，就用测试夹具截图，并在 PR 里写明。
3. 不使用 HSS 数据截图。

## 停止条件

- 需要改后端或改动范围外的文件；前缀规则与后端行为对不上。
- 同一问题修两次仍未解决。

## 合并前审阅与交付

- 需要监督方审阅：**是**（截图类验收）。合并只由负责人操作。
- PR 描述：两项改动、截图说明、测试结果。
- **合并后（负责人安排）：** 开发机重新构建前端；HSS 计算机的前端更新时间由负责人定。

## 版本记录

- v1（2026-10-20，监督方）：依据下一轮修复清单第 1 项（前端部分）、第 3 项和 T101 审阅意见起草。

- v2（2026-10-20，负责人补充）：允许更新 `web/tests/results.spec.ts` 中受 T103 影响的监控断言；负责人原话：“允许更新相关监控断言”。其余范围和验收要求不变。
