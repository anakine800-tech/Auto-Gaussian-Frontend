ag-monitor/1 快照显示（T7c、T7e）

文件位置：旧单集群为 `<studies_root>/.ag-monitor/latest.json`；命名集群为
`<studies_root>/.ag-monitor/<name>/latest.json`（包括命名 default）。每个文件 UTF-8 JSON，
≤ 2 MiB，由 ag 原子替换写入，前端只读。两种 default 位置并存时显示来源歧义，不能自动认定当前来源。

顶层字段
- schema: "ag-monitor/1"（其他值一律拒绝显示）
- sampled_at: string，UTC ISO8601，本次采样时间
- interval_seconds: int 60–600 或 null（单次采样时为 null）
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

前端显示规则
- now - sampled_at > 3 × interval_seconds 时以 warn 标记“数据已过期”；interval_seconds 为 null 时超过 600 秒标为过期（T87）；均使用严格大于边界，并每秒更新页面时钟。
- ok=false：顶部显示 error 和 last_ok_at，下方显示上一次成功的数据，并注明“非最新”。
- study/attempt 不为 null 时可点击，跳转到 #/s/<study>/a/<attempt>。
- 必填字段缺失或字段类型不符时显示“快照格式不正确”，不能崩溃。

T7e / T19 增量适配：当前多集群生产端字段以
[Auto-Gaussian T19](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/redesign-tasks/T19-clusters-json.md)
为准：`own.core_cap` 为集群配置的正整数，不能固定为 44；Slurm 作业不保证存在
mem/walltime_limit/start_time。命名集群快照位于 `.ag-monitor/<name>/latest.json`。
Slurm `cluster` 可含 budget（core_hours/used/reserved，单位核时）、expires、
storage_kib、expiry_warning、hardware_capacity_known。缺失/null 保持未知；
失败时保留的预算和存储须显示非最新；hardware_capacity_known=false 时不能使用占位零推断容量。

T97 的作业表、快照摘要和待取回分组口径见 [作业页](t97/jobs.md)。

T103 容量显示：只用 `committed_cap` 作为总上限与占用比例分母，缺失时显示
“总上限未知（旧快照）”，不显示占用比例；`core_cap` 单独标为“单作业上限 N 核”。
运行 / 排队分项不完整时使用已保存的 `cores_in_use`，不推算缺失分项。
首次采样失败没有成功占用数据时显示“占用未知”，但仍展示快照已有的上限和共享说明。
失败、过期和来源歧义沿用非最新标记。`shared_with` 非空时显示
“与 <入口名> 共享总上限”，多个名称以顿号分隔；页面没有跨入口核数合计或占用比例。
`budget` / `expires` 为 null 时不显示对应行。此规则替代 T97 文档中的旧容量退回显示。

T106 / T112 可选增量（T110 消费；不改变 `ag-monitor/1` 原字段含义）：

- `own.max_queued_cores`：非负整数，排队上限；未提供时显示“未提供”。
- `own.scheduler_max_running_cores`：正整数，调度器运行限额；显示
  “由调度器执行，ag 未核实”，不能作为 ag 对正在运行核数的保证。
- `own.max_cores`：正整数，单作业上限。优先展示它，旧快照仍使用 `core_cap`。
- `own.tiers`：对象，各档位为 `{cores: 正整数, mem_gb: 有限正数}`，内存单位 GB。
  缺少或为空显示“未知（后端未提供）”，不按档位名称猜测核数和内存。
- T112 要求成功、失败快照均写 `tiers` 和 `max_cores`，来自当前配置；前端不填造。
- `cluster.display_name`：可选的可打印非空字符串，1–32 个字符，与 T112 校验一致。成功和失败快照
  均可提供，包括尚无成功采样的失败快照。卡片、总览和作业列表显示
  “显示名（入口名）”，例如 `scnet-初筛（scnet-test）`；缺少时只显示入口名。
  该字段只用于显示，不改变内部入口名、关联、排序、共享归组或作业号。

T110 总览替代上述 T103 的“页面不分组”规则：按 `shared_with` 的连通关系合组。
作业页的独立集群卡片仍然一入口一张，不合并。
一组只显示一次运行、排队和剩余额度。组内不累加重复采样，使用采样时间最新的
成功占用记录；总上限取组内最小值，已配置排队上限同样取最小值。每个入口的
单作业上限和档位仍分别显示。旧快照的 `core_cap` 不代替 `committed_cap`。
组内任一来源失败、过期、歧义，或引用入口没有快照，或占用分项/总上限缺失，
剩余均为“未知”；否则为 `max(0, 总上限 - 运行 - 排队)`。
表中保留各入口最后成功采样时间；旧占用和节点数据明确标记非最新。
PBS 节点信息完整时，空闲节点数只计 `state=free` 且 `cores_used=0` 的节点，
空闲核数汇总 `state=free` 节点的非负 `cores_total - cores_used`；
Slurm、硬件容量未知或没有完整节点信息时不推算。节点名称不出现在总览中。
