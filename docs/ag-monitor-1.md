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
- core_cap: 正整数，集群配置的核数上限
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
