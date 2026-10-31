ag-monitor/1 快照显示（T7c、T7e）

## T217C：全机链路判定（HTTP 包装字段）

数据提供端：T217A [PR #393](https://github.com/anakine800-tech/Auto-Gaussian/pull/393)，
核对 head `8d096ee3edff6849f4d8917dfacff9e0f28b77e8`。既有 `ag clusters --json`
顶层增加 `link_health`，每次调用读取最近本机监控缓存并使用后端同一分类器；
前端不使用 study 级自主记录，不复制分类策略。

`GET /api/monitor` 保留原 `clusters` 数组，增加 `link_health`（对象或 null）和
`link_health_error`（固定说明或 null）。操作模式复用已选定的 ag；只读模式
仅在启动显式提供 `--ag` 时启用该只读查询，默认不找 PATH、不启动 ag。
每次 GET 执行固定 `ag clusters --json --verify-studies-root <viewer-root>`，
15 秒超时、不立即重试；校验 `studies_root_matches=true`、输出大小与字段。
不缓存首次判定，不把动态健康状态混入 `Actions.clusters` 的资源配置比较。
读取失败不清空原快照，不新增 POST 或采样，不授予推进权限。

投影只包含：

| 字段 | 类型与含义 |
| --- | --- |
| schema | `ag-link-health/1` |
| observed_at | 有限 epoch 秒，本次全机判定时间 |
| status | healthy / relay_outage / local_outage / cluster_failure / unknown |
| entries[].name | 通用入口身份，唯一 |
| entries[].relay_group | null 或统一投影为 `relay`；不返回原本机分组标识 |
| entries[].sampled_at | UTC ISO 或 null |
| entries[].age_seconds | 判定时的快照年龄或 null；与时间核对一致 |
| entries[].interval_seconds | 30–600 整数或 null |
| entries[].status | success / failed / unknown |
| entries[].reason | null / sample_failed / missing / invalid / configuration / future / stale |

原配置、拓扑、主机、账号、路径和 stdout/stderr 不转发；未知附加键不透传。
每个已知入口判定还须匹配唯一、无歧义的前端快照来源，以及相同 sampled_at、
interval_seconds 和成功/失败事实。分次读取遇到更新窗口时只降为 unknown，
保留快照供查看；不选取两个同名 default 中“较新”的一个。

HTTP 返回和浏览器每秒时钟均检查证据尚未生效/超过 `3 × interval_seconds`；
只降为未知，不推导其他故障类别、不重新判成功，不添加 15 分钟宽限。
HTTP 整次读取失败时，保留的旧判定也立即显示未知，原判定时间仍可见。
旧后端缺字段保留原卡片行为并显示“尚无链路检查”或缺字段说明。
单次快照仍用既有 600 秒显示过期规则，但 T217A 当前不将其作为已知链路证据。

healthy 显示“链路正常”；relay_outage 显示“链路中断”，对应 relay 失败卡片
和详情一致标注；cluster_failure 保留个别失败行为；local_outage 显示
“本机断网”及“全部入口失败（按本机断网处理）”。这些是基于快照的分类，
不能证明物理故障根因。各入口自己的快照年龄、上次成功与非最新标记保留。

## 原有快照字段与显示

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
- 通常每 30 秒读取本机 `/api/monitor`；T128 手动请求后的短暂加速见下文，前端不连接服务器。
- `now - sampled_at > 3 × interval_seconds` 时标为“非最新 / 数据已过期”；单次采样超过 600 秒过期。
- `ok=false` 的卡片占用条和本人占用为未知，显示上次成功时间；详情保留旧数据并整块标非最新。
- 核数与内存条分别判断对应数值；`hardware.error` 不单独使条失效，错误在详情置顶并计入警告。
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
- T143：档位按 `mini/simple/general/complex/max/ultra` 顺序呈现，只显示实际项；后两档可选，旧四档无占位。
- `own.max_walltime`（T143 可选）：正 `HH:MM:SS` 字符串，小时 2–4 位、分秒 00–59。缺省省略，不接受 null、布尔、数字或零时长；不改变 `ag-monitor/1` 版本。失败快照由生产端刷新当前配置上限，配置移除时清除旧字段。前端显示小时，非整小时保留分钟、秒与原值；缺省不解释成调度器无限制。
- `ag clusters --json` 的 `clusters[].resources` 提供相同的实际 `tiers` 与可选 `max_walltime`。操作模式校验元数据后保留该时限，按固定六名顺序提供档位；仅新增兼容字段，不新增操作或查询，最终 prepare/submit 资源限制仍由 ag 执行。
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

## T123：局部采样错误与作业内存来源

可选字段与后端 T123（合并提交 `8ab8b915`）一致；旧快照省略时继续接受。

- `cluster.job_summary_error`：字符串或 null。分区作业汇总查询失败而本人查询成功时，
  顶层 `ok=true`、本人作业保留，`job_summary` 的汇总值为 null，此字段说明失败原因。
  硬件采样的错误仍在 `cluster.hardware.error`，不把局部错误扩展成整个快照失败。
- `own.jobs[]`、`cluster.jobs[]` 的 `mem_source`：`scheduler` / `manifest` / null。
  PBS 内存来自调度器；Slurm 只对精确关联到 Attempt 的作业取 manifest 档位内存，
  此时为 `manifest`；没有精确关联时内存与来源都保持 null。
  前端仅校验和保留来源，不按作业名猜关联、不从来源推导实时内存用量。

校验器对这两个字段进行类型/枚举校验；字段缺失/null 不解释成零或成功。

补丁来源：[后端 T127 PR #329](https://github.com/anakine800-tech/Auto-Gaussian/pull/329)
描述中附带的 `docs/ag-monitor-1.md` 补丁；后端合并提交
`ead920d7178434856281e3c66074e12bf1f6af65`。以下 T127 段落逐字合入，
T128 的本机 API 和显示约定单列其后。

## T127：监控容错与手动重试（T128 消费字段）

`ag-monitor/1` 仅增加字段，旧前端可继续忽略未知字段。`interval_seconds` 仍为基础采样间隔。

| 位置 | 字段 | 类型与语义 |
|---|---|---|
| sampling | state | normal / backoff / paused；连续失败 1–2 次仍为 normal |
| sampling | consecutive_failures | 非负整数；自动成功或手动成功清零，普通手动失败不增加 |
| sampling | current_interval_seconds | 30–600 整数或 null；当前实际间隔，一次性为 null |
| sampling | next_sample_at | UTC ISO 或 null；暂停、一次性采样为 null |
| sampling | pause_reason | null / auth / host_key；只在 paused 时非 null |
| sampling | trigger | scheduled / manual / manual_auth_fixed |
| sampling | retry_pending | bool；发布时是否还有待处理请求 |
| cluster | scheduler | PBS 明确写 pbs；Slurm 仍写 slurm |
| cluster.hardware | notes | 字符串数组，缺省/旧缓存按空列表；局限说明，不作查询错误 |

退避：连续失败 k ≥ 3 后间隔为 min(600, 基础间隔 × 2^(k−2)) 秒；成功恢复基础间隔。
认证/主机指纹失败仅暂停该入口。配置变化或监控重启可重新采样；手动恢复须确认修复且成功一次。
硬件、存储的局部失败不计入入口退避。hardware.error 只记录真正查询失败。
Torque 节点总内存取 status.physmem（PBS Pro 字段优先）；已分配内存仅在节点作业精确匹配、
全部申请值可解析且无跨节点作业时求和。未知值为 null 并附 notes；空节点为 0.0。
不使用 physmem − availmem，不按核数分摊。异构 Slurm 内存/两次作业查询不一致的说明在 notes，
不应因此清空已知核数或多计一条查询失败警告。

前端手动刷新只调用本机命令，不发 SSH：

```text
ag monitor --retry <入口> [--auth-fixed] --json
```

暂停原因为 auth/host_key 时，前端二次确认“已修复”后才传 --auth-fixed。
该命令与 --watch 互斥；旧单集群入口名为 default。stdout 恰好一个 JSON 对象：

```json
{"entry":"<入口>","result":"queued","reason":null,"requested_at":"<ISO UTC>"}
```

- result = queued / already_queued / in_progress：退出码 0，分别表示已登记/已合并待处理请求/正在采样。
- result = refused：退出码 1；reason = monitor_not_running / auth_confirmation_required / unknown_entry。
- requested_at 为 UTC ISO 或 null；拒绝时为 null。配置读取失败等沿用 CLI 原有错误对象。
- 不限点击频率；同入口只执行一次采样。手动成功清零并恢复基础间隔；普通手动失败保持原失败数和自动时间。
- 监控 PID 不存在或心跳超过 90 秒即拒绝，不遗留新请求。旧请求在监控启动时丢弃。
- `.ag-monitor/` 根下新增 watch.json / watch.lock 文件，不是入口；不新增控制子目录。

默认监控 stdout 为 ag-monitor-line/1 一行摘要，--json 才输出完整快照；前端仍读取 latest.json。

## T128：前端显示与本机重试接口

旧快照可省略 sampling；对象存在时七个字段均须通过校验。
notes 表达局限，不计入警告；error 表达真实查询失败，计入警告并在详情置顶。
核数条和内存条独立核对各自的总量、已分配、本人运行占用；缺失不补零。
旧 PBS 缺 scheduler 时，从 hardware.source=pbsnodes 推断 PBS；sinfo 推断 SLURM；否则“—”。
前端不重新推算硬件值。

操作模式下 `POST /api/monitor/retry` 请求体恰好是：

```json
{"cluster":"default","auth_fixed":false}
```

cluster 必须是启动时查询的入口；两个字段缺少、多余或类型错误均为 400。
只读模式无此路由，POST 返回 405；令牌、同源和回环检查与现有操作共用。
调用固定 argv `ag monitor --retry <入口> --json`；auth_fixed 为 true 时末尾加 `--auth-fixed`。
暂停入口只有页面内二次确认后才传 true。重试不限频、不占用现有操作锁，合并由 ag 负责。
15 秒超时或无效 JSON 均返回错误，不自动重试。

ag JSON 返回以下已知字段（未知附加键忽略），退出码 queued / already_queued / in_progress 为 0，refused 为 1：

```text
entry: 当前入口名
result: queued | already_queued | in_progress | refused
reason: null | monitor_not_running | auth_confirmation_required | unknown_entry
requested_at: UTC ISO 时间 | null
```

前三种 result 的 reason 为 null；refused 必须带原因。前端校验字段、入口与退出码，
不从人类输出推断成功。仅受理结果加速本机 `/api/monitor`，每 3 秒读取；追踪及旧后端
兜底见 T151。其他 Study / Attempt 请求保持原有 30 秒节奏。


## T151：请求控制状态与 API 包装字段

配套生产端：T149 合并提交 `06f3dfe2d4a62452bbd003a51cd3472c427834a1`。
控制文件与 `ag-monitor/1` 快照分开读取，不往快照插入请求状态，也不依据控制文件改变占用数据。
`GET /api/monitor` 每个 ClusterRow 可含：

| 字段 | 类型与含义 |
| --- | --- |
| retry_tracking_supported | boolean；同根、心跳年龄 0–90 秒、唯一 name/source 的版本 1 标记可用 |
| retry_status | 下述对象或 null；来自该来源的独立控制文件 |
| retry_status_error | string 或 null；只表示请求状态读取/来源/能力问题，不覆盖 snapshot/error |

根部 `.ag-monitor/watch.json` 的 `retry_tracking_version` 必须为整数 1；
`entries[name].source` 为 `legacy` 或 `named`。legacy 仅可绑定 default；named 使用确切入口名。
legacy 控制结果读取 `.ag-monitor/retry-status.json`，named 读取
`.ag-monitor/<name>/retry-status.json`。无快照或入口从 watch 移除后，仍保留该位置的结果行。
双 default 来源不按显示名或时间选取；来源歧义不能开启追踪。
控制读取复用描述符相对路径、`O_NOFOLLOW`、普通文件检查及每文件 2 MiB 上限。
标记/状态的已知字段严格校验，未知附加键忽略，坏记录只使请求结果不可用。

retry_status 字段：version=1、entry、32 位小写十六进制 request_id、UTC requested_at、
state、reason、finished_at、sampled_at、ok。queued/running 的 reason 和后三项均为 null；
finished 的 finished_at/sampled_at 为 UTC 时间，ok 为真实布尔值，reason=null；
discarded 的 finished_at 为 UTC 时间，sampled_at/ok=null，reason 为下列四种之一。

| reason | 页面反馈 |
| --- | --- |
| auth_confirmation_required | 需先确认认证问题已修复 |
| entry_removed | 入口已移除 |
| config_changed | 配置已变化，旧请求未执行 |
| monitor_restarted | 监控已重启，本次请求结果尚未确认 |

`monitor_restarted` 也可能来自重启前已进入 running 的请求：可能已经查询，但没有可确认的发布完成结果。
前端因此显示结果尚未确认，不据此断言未执行；匹配该终态仍立即结束快速轮询，不自动重新登记。

只有能力可用时，固定 argv 为 `ag monitor --retry <入口> --json --track`，
auth_fixed=true 追加 `--auth-fixed`；追踪前再次通过现有 clusters 查询核对 study 根。
标记只说明能力，ag 自己判断进程是否运行、请求能否受理。浏览器 POST 字段与权限保持原样。
追踪响应增加 request_id：受理必须为有效标识，refused 必须为 null；无标识不能降级冒充追踪受理。
旧命令仍只返回原四字段。登记 15 秒超时、退出码不符、JSON 无效或参数不支持均不再登记第二次。

页面以 name + source + request_id 对应终态。finished/ok=true 显示“本次采样完成”，
ok=false 显示“本次采样失败，请查看采样错误”；discarded 显示上述原因，两者都在下一次读取结束快速轮询。
不同标识显示“本次请求结果无法确认”；缺记录、心跳陈旧和网络暂断保持未知，最多等待 120 秒，
超时显示“等待超时，结果尚未确认”。普通 30 秒读取继续接收同一标识的迟到结果。
旧四字段响应以新快照结束等待时，只显示“已收到新采样，无法精确对应本次请求”。
请求消息按入口来源保存，切卡不串结果；旧登记响应先核对操作序号再改变文案或轮询。
不展示内部标识，不自动重登记、停止 ag 或取消作业。

本地配套验收使用隔离导出的上述后端源码，以 `T151_BACKEND_SOURCE=<EXPORTED_BACKEND>/ag/src`
运行 `python -B -m unittest tests.test_server_monitor.PairedBackendTests -v`。
配置替身调用真实 CLI，假 Transport 走真实锁、控制文件、sample/publish；无默认配置、真实研究或 SSH。
未指定该显式源码路径时，普通测试跳过此独立配套项。正式服务兼容性留给后续发布部署单。

## T156：单节点容量增量与 T158 表单消费

核对数据提供端：包含 T154/T156/T157 的合并提交 `e109019b3028aad75fb434b5eafce1633af72aca`。
这些是可选增量；旧快照缺字段继续读取，缺失容量信息保持未知。

| 位置 | 字段 | 含义 |
| --- | --- | --- |
| cluster | nodes_error | 可选节点采样错误；不清空已成功的本人作业或硬件摘要 |
| cluster.nodes[] | partition / partition_state | Slurm 精确分区身份与状态 |
| cluster.nodes[] | cores_idle / cores_other | Slurm 可用／其他 CPU 数，非实时 CPU 使用率 |
| cluster.nodes[] | cpu_source / memory_source | Slurm 为 `sinfo CPUsState` / `sinfo Memory/AllocMem` |
| cluster.nodes[] | capacity_error | 可选矛盾节点记录说明 |
| cluster.nodes[] | capacity_cpu_consistent | PBS 容量核数观测一致性；旧快照缺字段无法证明容量 |
| cluster.nodes[] | mem_total_bytes / mem_assigned_bytes | PBS 精确总内存／已申请内存字节数，容量边界不使用已舍入 GB |

Slurm 的 mem_total_gb / mem_assigned_gb 保留 MiB 转为二进制 GB 后的精确分数，不向上取整。
PBS 仍按既有 available/assigned 或 Torque 作业申请来源取值，不用 RSS、physmem−availmem 或按核数分摊。
节点记录不能按行号拼接、重复相加或以分区总和替代；这些判断由后端 `ag capacity` 负责。

新建表单不直接消费快照推算容量，而读取该本地命令的 JSON：
`cluster`、`tier`、`target_node`、`cores`、`mem_gb`、`fits_total`、`availability`、`reasons`、
`sampled_at`、`valid_until`、`snapshot_fresh`、`cpu_source`、`memory_source`、`nodes`。
`fits_total` 为 true/false/null；`availability` 为 enough/queue/unknown/not_applicable。
每个节点含 name、fits_total、availability、reasons 和两项来源。
前端核对响应与请求一致，按后端有效期显示过期；不另设容量算法，不改变采样周期或服务器页。
来源字段描述调度分配口径，不能作为立即启动、账号剩余额度或科学验收的保证。

具名节点另读 `ag nodes`：节点行与每个比例选项的 `selectable` 控制是否可选择／本地准备，
`status` 继续表达空闲、占用等显示状态。前端保留两级判定，不从容量提示反推可选性；
选项的精确容量判断由 T157 复用 T156 完成。缺新字段沿用原状态与档位匹配规则。
