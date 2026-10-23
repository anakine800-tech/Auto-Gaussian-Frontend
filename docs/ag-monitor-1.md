ag-monitor/1 快照显示（T7c、T7e）

文件位置：旧单集群为 `<studies_root>/.ag-monitor/latest.json`；命名集群为
`<studies_root>/.ag-monitor/<name>/latest.json`（包括命名 default）。每个文件 UTF-8 JSON，
≤ 2 MiB，由 ag 原子替换写入，前端只读。两种 default 位置并存时显示来源歧义，不能自动认定当前来源。

顶层字段
- schema: "ag-monitor/1"（其他值一律拒绝显示）
- sampled_at: string，UTC ISO8601，本次采样时间
- interval_seconds: int 30–600 或 null（单次采样时为 null）
- ok: bool，本次采样是否成功
- error: string 或 null（ok=false 时为已脱敏的错误说明）
- last_ok_at: string 或 null，最近一次成功采样时间
- own: object（ok=false 时为上一次成功的数据，可能为 null）
- cluster: object（同上）
- warnings: array

own
- cores_in_use: int，本人作业占用核数
- core_cap: 正整数，单作业核数上限
- committed_cap: 可选非负整数，运行加排队总上限；不依赖分项核数是否存在
- cores_running / cores_queued: 可选非负整数，运行 / 排队分项核数
- shared_with: 可选 string 数组，与本入口共享总上限的其他入口名（T101）；原样传递，不推断分组
- jobs: array，每项：
  - job_id: string
  - name: string
  - state: string，调度器状态码（PBS 或 Slurm）
  - queue: string
  - cores: int 或 null
  - mem: string 或 null（原样，如 "12gb"；Slurm 可缺省）
  - walltime_used: "HH:MM:SS" 或 null
  - walltime_limit: "HH:MM:SS" 或 null（Slurm 可缺省）
  - start_time: string 或 null（原样；Slurm 可缺省）
  - study: string 或 null（关联到的本地 study 名）
  - attempt: string 或 null（关联到的 Attempt id）

cluster
- nodes: array，每项 {name: string, state: string, cores_total: int 或 null, cores_used: int 或 null}
- queues: array，每项 {name: string, running: int, queued: int}
- cores_total: int 或 null
- cores_used: int 或 null

warnings 每项
- kind: "scheduler-residue" | "absent-from-scheduler" | "over-cap"（未知 kind 照常显示）
- job_id: string 或 null
- study: string 或 null
- attempt: string 或 null
- detail: string（原样显示，例如“需人工确认后 ag cancel”“运行 ag status 核对”）

前端显示规则（T115）
- `#/jobs` 保持不变。每入口一张按钮卡片，下方用标签切换详情，支持左右键 / Home / End。
- 仍每 30 秒读取本机 `/api/monitor`，不新增服务器连接或采样请求。
- `now - sampled_at > 3 × interval_seconds` 时标为“非最新 / 数据已过期”；单次采样超过 600 秒过期。
- `ok=false` 的卡片占用条和本人占用为未知，显示上次成功时间；详情保留旧数据并整块标非最新。
- 只有 `hardware.error` 时硬件条未知，本人核数照常显示；错误在详情置顶。
- 进度条：本人运行占用、硬件已分配减本人、硬件总量减已分配。任一输入缺失或差值矛盾，整条未知，不填零。
- study/attempt 可安全解析时链接到 `#/s/<study>/a/<attempt>`；最近快照沿用本地 SnapshotProgress，不读取运行日志。
- 快照格式不正确时显示对应错误，未知字段忽略，新字段缺失可读。

T7e / T19 / T101 / T106 / T112 兼容字段
- 命名集群快照位于 `.ag-monitor/<name>/latest.json`。`cluster.name` 为入口名，`scheduler` 为调度器。
- `cluster.display_name`：可选可打印非空字符串，1–32 字符；显示“显示名（入口名）”，不改变身份。
- `cluster.hardware_capacity_known=false` 时旧占位零不可当作硬件容量。
- `own.shared_with`：共享同一调度器账号总上限的入口名数组。
- `own.max_cores`（正整数）：单作业上限，缺省用 `core_cap`。
- `own.max_queued_cores`（非负整数）：排队上限。
- `own.scheduler_max_running_cores`（正整数）：调度器运行限额，标明“由调度器执行，ag 未核实”。
- `own.tiers`：`{名称: {cores: 正整数, mem_gb: 有限正数}}`，缺省不猜档位。
- `cluster.budget`：`{core_hours, used, reserved}`，非负有限数，单位核时；null 不显示，不等于平台余额。
- `cluster.expires` / `expiry_warning`：可选字符串或 null。
- `cluster.storage_kib`：非负整数或 null，除以 1024² 显示 GB。
- `cluster.storage_checked_at` / `storage_sampled_at`：查询时间 / 数据时间，UTC ISO 或 null。
- `cluster.storage_error`：字符串或 null；失败时保留值明确标为非最新。

T114 新增字段（按工单第 6 节；T115 合并前需与 T114 PR 的生产端及文档补丁核对）

| 位置 | 字段 | 类型与语义 |
|---|---|---|
| 顶层 | sample_duration_ms | 非负整数；首次失败可为 null |
| cluster | display_order | 整数或 null；显式顺序优先，未配置的 PBS 在前、Slurm 在后，再按入口名 |
| cluster | jobs | PBS 全员、Slurm 本人作业数组 |
| cluster | jobs_omitted | 非负整数，截断后省略数量；首次失败可为 null |
| cluster | job_summary | 对象或 null，见下表 |
| cluster | hardware | 对象或 null，见下表 |
| cluster.nodes[] | mem_total_gb / mem_assigned_gb | 非负有限数或 null，GB |
| cluster.nodes[] | jobs | 非负整数或 null |
| own | mem_running_gb / mem_queued_gb | 非负有限数或 null，GB |

`cluster.jobs[]` 和 `own.jobs[]` 新字段：

| 字段 | 类型 |
|---|---|
| user | string |
| mine | bool |
| cores_kind | `allocated` / `requested` |
| mem_gb | 非负有限数或 null |
| elapsed_seconds / walltime_limit_seconds | 非负整数或 null |
| elapsed_source | `start_time` / `walltime_used` / null |
| start_time / qtime | 可解析的 UTC ISO 时间或 null |

原有 job_id、name、state、queue、cores、study、attempt 不变。
旧 `own.jobs` 未带 cores_kind 的 start_time 仍兼容原始调度器字符串；新格式按 ISO 校验。
旧 walltime 字符串继续显示；显式新增秒数为 null 时不得退回旧值。

`cluster.job_summary` 各项均为非负整数或 null：
`running_jobs`、`running_cores`、`queued_jobs`、`queued_cores`、
`others_running_jobs`、`others_running_cores`、`others_queued_jobs`、`others_queued_cores`。
标题用采样汇总，因此不会因 500 条截断或“只看本人”而把入口总量错误缩小。

`cluster.hardware`：
- `cores_total` / `cores_allocated` / `cores_idle` / `cores_other`：非负整数或 null。
- `mem_total_gb` / `mem_allocated_gb`：非负有限数或 null。
- `source`：`pbsnodes` / `sinfo`；`error`：字符串或 null。

共享组沿用 T110 `capacityGroups` 连通归组：选择最近成功占用记录，不相加；总上限取组内最小值，已配置排队上限也取最小值。
多个卡片明确标注“共享总上限（只计一次）”，页面不提供跨入口求和；每个入口仍有独立硬件条。
如果共享账号占用大于某入口的硬件分配，不能推导有效分段，显示未知。

详情中运行作业用实际分配核数，排队用申请核数并按 qtime 排序；本人始终置顶。
Slurm 不显示其他人明细，只显示两个分组各自的“其他用户”汇总；只看本人时隐藏他人汇总。
“只看本人”按入口保存在浏览器，读写失败时使用默认关闭且不妨碍查看。
作业号是可选列；walltime ≥90% 使用警示色，超限仍显示真实百分比。
节点与队列、限额档位与存储默认收起，PBS 单节点默认展开节点区；Slurm 仅显示分区 CPU 汇总。
本地状态 `finished` 的 Attempt 在底部“刚结束待取回”中独立列出，不从队列消失推断结束。
