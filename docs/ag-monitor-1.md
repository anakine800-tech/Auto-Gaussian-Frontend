ag-monitor/1 快照定义（T10 将在 Auto-Gaussian 仓库按此实现；T7c 先用合成数据开发，并把本定义原样保存为前端仓库 docs/ag-monitor-1.md）

文件位置：<studies_root>/.ag-monitor/latest.json（UTF-8 JSON，≤ 2 MB）。由 ag 原子替换写入，前端只读。

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
- core_cap: int，固定 44
- jobs: array，每项：
  - job_id: string
  - name: string
  - state: string，Torque 状态码，如 Q R E H C
  - queue: string
  - cores: int 或 null
  - mem: string 或 null（原样，如 "12gb"）
  - walltime_used: "HH:MM:SS" 或 null
  - walltime_limit: "HH:MM:SS" 或 null
  - start_time: string 或 null（原样）
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
- now - sampled_at > 3 × interval_seconds 时标红“数据已过期”；interval_seconds 为 null 时显示采样时间，不判断是否过期。
- ok=false：顶部显示 error 和 last_ok_at，下方显示上一次成功的数据，并注明“非最新”。
- study/attempt 不为 null 时可点击，跳转到 #/<study>/<attempt>。
- 字段缺失或类型不符时显示“快照格式不正确”，不能崩溃。

另：analyses/ 也要支持一级子目录（analyses/<名称>/*.xyz），处理方式与 structures/ 一致。如果已经处理过，可以忽略这一条。
