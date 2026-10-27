# T151：监控重试终态与未执行原因的前端反馈

版本：v1.1，2026-10-27。开发机做。前端一个分支、一个 PR；首行 `Task: T151`。不部署、不连接服务器、不提交计算。

## 1. 分支与目标

- 分支：`codex/t151-monitor-retry-feedback`。
- 已核实前端 main 基线：`aa8f2cfcfe3829f76b349fd584aa8f811ffdaba7`，已含 T147；不能从尚未包含 T147 的正式 v4.6.2 检出直接丢失这些修补。
- 负责人决定 X1 原话：“本批同时完成前端反馈：三张后端工单之外，再准备一张独立前端配套工单”。
- 目标：T149 登记后的请求有明确终态与原因；页面及时结束快速等待，不把请求受理、其他快照或超时误判成成功。
- 可以基于本单合成约定准备；**合并前 T149 必须已合并**，记录其真实完整 SHA，再按最终 CLI/字段做配套验证。
- 默认做法（已告知负责人）：新旧后端兼容、一次点击只登记一次、按请求标识关联。旧后端无法精确追踪时明确能力限制，不编造结果。
- 新检查防的事故：旧前端拒绝新增字段；不同入口或同秒请求串结果；晚到响应覆盖较新的操作；把被丢弃请求等 120 秒后当作完成。
- 资料：前端 `autog_frontend/actions.py:157`（retry_monitor）、`studies.py:1038`（monitor）、`:1053`（monitors）、`monitor.py:11`；上述 main 的 `web/src/server-monitor.tsx:15`、`server-detail.tsx:18`；`web/src/api.ts:24`、`jobs-data.ts:4`；现有 `docs/ag-monitor-1.md`；T149。

## 2. 允许改动的路径

- `autog_frontend/actions.py`：固定参数调用、按能力开启追踪、兼容响应校验。
- `autog_frontend/studies.py`、`autog_frontend/monitor.py`：安全读取、验证和返回控制状态，复用既有路径保护。
- `web/src/api.ts`、`web/src/jobs-data.ts`、`web/src/server-monitor.tsx`、`web/src/server-detail.tsx`：类型、请求关联、轮询与用户反馈。
- `tests/test_actions.py`、`tests/test_server_monitor.py`、`web/tests/server-page.spec.ts`、`web/tests/actions.spec.ts`：假 ag 与浏览器回归。
- `tests/monitor-fixtures/t151/`（可新建）：仅合成控制状态/快照与必要验收截图，不复制真实缓存。
- `README.md`、`docs/ag-monitor-1.md`：在既有格式说明中写新增包装字段及兼容边界。
- `docs/redesign-tasks/T151-monitor-retry-feedback.md`、`docs/redesign-tasks/open-tasks.txt`：本单归档与自身标记。

不修改后端仓库、认证/同源保护、计算操作锁、节点选择、样式体系、版本号、依赖或其他任务待办。

## 3. 要做的

### T149 / T151 共用字段约定（两单文字必须保持一致）

这是本批拟新增的本机控制数据，不是现有字段。沿用既有锁、缓存目录与读取保护，不另建队列服务或数据库。

1. 新监控在根部 `watch.json` 发布 `retry_tracking_version: 1`；其 `entries[入口].source` 明确为 `legacy` 或 `named`，指向该入口实际控制文件布局。根目录始终是已核对的本机 study 根；不接受任意路径。
2. 默认 `ag monitor --retry <ENTRY> [--auth-fixed] --json` 仍只返回既有四键 `entry/result/reason/requested_at`，退出码和原枚举不变。旧前端对四键作严格检查，不得直接加字段。
3. 本单新增显式 `--track`，只允许与 `--retry`、`--json` 同用。启用时额外返回 `request_id`：受理结果为 32 位小写十六进制随机标识，refused 为 null。不改变认证确认、只读或提交权限。
4. `queued` 分配新标识；`already_queued` 返回原待处理请求标识；`in_progress` 返回所合并的当前采样标识。同一轮被多个客户端合并时标识相同；不拿秒级时间戳当标识。默认未追踪调用也走同一处理逻辑。
5. 每入口在原 `retry-request.json` 同级保存一个 `retry-status.json`，只保留最近一次受理请求的状态，不创建额外子目录。字段：
   - `version: 1`、`entry: string`、`request_id: string`、`requested_at: UTC ISO`；
   - `state: "queued" | "running" | "finished" | "discarded"`；
   - `reason: null | "auth_confirmation_required" | "entry_removed" | "config_changed" | "monitor_restarted"`；
   - `finished_at: UTC ISO | null`、`sampled_at: UTC ISO | null`、`ok: boolean | null`。
6. queued/running：后三项为 null，reason 为 null。finished：真实采样及快照发布完成后写入，finished_at、sampled_at 非空、ok 为本轮真实布尔值、reason 为 null。discarded：本条追踪请求已终止，不再继续处理或重放；finished_at 非空，sampled_at/ok 为 null，reason 必须为上述具体原因；不是作业取消。auth_confirmation_required、entry_removed、config_changed 表示待处理请求未执行。monitor_restarted 表示监控已重启，本次请求结果尚未确认；重启前已为 running 时可能已经查询，但没有可确认的发布完成结果，不能据此断言从未执行。
7. 状态原子发布，在现有 `watch.lock` 下与登记/领取串行处理。未采样不得更新 `latest.json.sampled_at`、`last_ok_at`、`ok`，不得往采样 history 添加假轮次。正常定时采样不覆盖上一条追踪终态；收到新请求可以替换最近状态。
8. 新前端仅在同一已核对根下、心跳新鲜且来源唯一的版本 1 标记存在时使用 --track。旧标记缺失则使用原命令；未知/损坏版本不能宣称支持。若调用失败，不再次换命令登记请求。标记只能表示能力；真正是否运行、能否受理由 ag 原有检查决定。
9. 前端 `GET /api/monitor` 的每个 ClusterRow 增加可选 `retry_tracking_supported: boolean`、`retry_status: object | null`、`retry_status_error: string | null`。数据来自同一 name/source 的本地控制文件，绝不混入保存的 ag-monitor/1 快照；即使还没有快照或入口已移除，已有控制结果仍可展示。
10. 已知字段严格验证；未知附加键忽略。未知版本、非法枚举、身份不符、损坏/越界/符号链接控制文件仅影响请求状态，不能清空正常监控快照。单文件读取上限复用现有 2 MiB 保护。
11. UI 以 name + source + request_id 对应终态。不同标识、被覆盖的结果、控制文件暂缺或超时都不能表示成功；不能凭另一次新快照时间判断被追踪请求完成。旧四字段响应才沿用旧快照时间兜底，并明确不能精确确认该请求。

### 3.1 本地适配

- POST 请求体仍严格为 `{cluster, auth_fixed}`；token、回环、同源保护保持。浏览器不能提供路径、命令、request_id 或绕过参数。
- 能力判定与状态读取共用同一个已核对 study 根及来源解析；不要按显示名称、缓存时间新旧或任意第一个同名目录绑定。
- 新前端在版本 1 能力存在时，固定 argv 使用选定 ag 的 `monitor --retry <ENTRY> --json --track`，按原 auth_fixed 布尔值追加既有选项。缺能力用旧 argv。**单次点击只启动一次登记进程**，超时/解析失败/不支持参数时不重试另一套命令。
- 保留 15 秒登记超时和原返回码校验；默认旧响应四字段可读，追踪响应必须有合法 request_id。refused 必须无请求标识；受理却缺标识不可伪装追踪成功。
- 验证 sidecar 的版本、状态组合、UTC 时间、entry 和来源；读取使用既有描述符相对路径/O_NOFOLLOW 和大小限制。新控制字段不影响旧 ag-monitor/1 验证。
- 标记无效或状态文件损坏只报告请求状态不可用，监控数据继续按自身证据显示；不修改文件，不创建控制文件，不调用 SSH。

### 3.2 页面行为

- queued：已登记，等待采样；already_queued：沿用既有请求；in_progress：合并当前采样。仅受理结果进入 3 秒本地读取。
- 对匹配请求的 finished/ok=true 显示“本次采样完成”；finished/ok=false 显示“本次采样失败，请查看采样错误”。两者都结束快速轮询，不把失败写成成功。
- discarded 对应文案：需先确认认证问题已修复 / 入口已移除 / 配置已变化，旧请求未执行 / 监控已重启，本次请求结果尚未确认。收到匹配终态的下一次正常读取立即结束快速轮询，不等 120 秒。
- `monitor_restarted` 可来自重启前已进入 running 的请求。可能已经查询，但没有可确认的发布完成结果；页面不得据此断言未执行。仍按匹配终态立即停止快速轮询，不自动重新登记。
- 多入口请求独立跟踪；其他快照、其他 request_id、其他 source 不得结束本请求。若最近状态被新请求覆盖，显示“本次请求结果无法确认”，不能归入成功。
- 网络暂断、记录暂缺、心跳陈旧：保留未知语义；快速轮询上限仍为 120 秒，到期显示“等待超时，结果尚未确认”，不自动重登记、不杀 ag、不取消作业。恢复普通 30 秒本地读取后，仍可用同一标识更新迟到的终态。
- 旧后端无追踪标识：保留既有新快照/120 秒兜底；新快照只能提示“已收到新采样，无法精确对应本次请求”，不得写成精确追踪成功。
- 状态消息由对应入口持有，切换卡片不串结果。晚到的旧登记响应不覆盖新操作；先核对 requestNumber，再更新追踪和文案。
- 拒绝、HTTP 502/504、网络失败、无效 JSON 不开启快速轮询，保留 T147 修补。普通 30 秒 study 读取频率不随快速轮询提高。
- UI 只展示人能使用的状态与原因，不展示内部 UUID、文件格式或本机路径。

## 4. 不允许

不在前端重新实现调度、认证修复或重试队列；不直接写 study/Attempt/监控控制文件；不修改 SSH、节点策略、提交确认；不把已受理说成已完成；不顺带修 D01/D04、拆卡、发布或部署。

## 5. 测试

| 场景 | 预期 |
|---|---|
| 新标记与旧无标记；精确来源/双 default 歧义 | 正确选择固定 argv，歧义不误绑定 |
| 默认旧四字段、合法新追踪字段、未知附加键 | 已知键严格校验，允许约定的向前附加 |
| CLI 非零/15 秒超时/无效响应/新参数不支持 | 一次登记，无自动回退或重复发起 |
| queued → running → finished 成功/失败 | 正确文案和停止快速轮询 |
| 四种 discarded 原因，sampled_at 不变 | 下一次读取结束等待，准确说明原因；重启保持结果未确认 |
| 同秒请求、不同入口、legacy/named、晚响应乱序 | request_id 与来源严格对应 |
| 状态被新请求覆盖、心跳陈旧、记录缺失、120 秒超时 | 不能误报成功；迟到匹配结果可更新 |
| 无快照但有请求状态、移除入口后遗留终态 | 仍能读取控制结果，不伪造快照 |
| 损坏/超限/符号链接 sidecar、错误版本 | 请求状态报错，正常快照仍可读 |
| 旧后端新快照兜底、T147 refused/502/504/无效 JSON | 保留兼容与明确不确定性 |
| 五卡、九节点、具名节点选择、资源图例 | 现有 T143/T145/T147 行为不退化 |

使用假 ag、合成缓存和浏览器假时钟，不读取真实研究。首次开 PR 与合并前按现行规则运行完整浏览器测试；中间复测只跑受影响部分加构建。

命令以本仓库现行 README 为准：`.venv/bin/python -B -m unittest discover -s tests -t . -v`、`pnpm --dir web build`、`AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test`。如本地环境限制阻断浏览器运行，在 PR 写清，最终准确 HEAD 的 CI 必须完成，不能把受限运行记为通过。

暂存精确文件后执行 `python scripts/scan_public.py --staged --terms-file <PRIVATE_TERMS_FILE>`、`git diff --cached --check`；检查 noreply 身份和公开截图。

## 6. 真实环境验证

不需要 SSH 或真实计算。T149 合并后，在开发机隔离合成环境使用其准确实现做本地配套验证；监控采样用假 Transport，前端调用假 ag 或明确的本地-only 登记路径。禁止误启动读取真实配置的监控。

验证新/旧后端配对、终态不刷新快照的读取、失效标记和各原因文案。正式运行服务的验收放到后续发布部署单，不替换当前检出或服务。

## 7. 停止条件

T149 最终字段与本单不同；需要扩大 POST 权限或前端直接写控制文件；无法证明根目录/来源一致；需要范围外代码；同一问题两次未解决。先报告，不自己删掉兼容场景。

## 8. 合并前审阅与交付

逐行审阅控制数据来源、CLI 参数、严格类型与可选字段、请求关联和迟到响应；逐段审阅文案、旧后端能力边界及格式说明。PR 写 T149 精确依赖 SHA、前端 HEAD、新旧配套矩阵、测试与敏感扫描。

T149 先合并；本单基于含 T147 的 main，按 T149 最终实现复核后再交负责人合并。本单不代表新正式版本或部署完成。

## 9. 版本记录

- v1.0：根据负责人明确选择新增独立前端配套单，完成后端请求终态到页面反馈。
- v1.1：按负责人增量要求，将 monitor_restarted 反馈改为“监控已重启，本次请求结果尚未确认”，补 running → 重启终态覆盖；字段及后端实现不变。
- v1.2（T153，2026-10-27）：仅澄清共用字段约定第 6 项的 discarded 与 monitor_restarted 语义，与 T152 对 T149 的修订同步；保留原 v1.1 增量验收记录，页面与字段实现不变。


## 10. 实现与验收记录

- 前端基线：`aa8f2cfcfe3829f76b349fd584aa8f811ffdaba7`（已含 T147）。
- T149 已合并：后端 PR #349，合并 SHA `06f3dfe2d4a62452bbd003a51cd3472c427834a1`，实现 HEAD `23aad6441a7ac8a542d639f75b39c5cf7e1a76c6`。
- 第 3 节共用字段块与该 SHA 的 T149 工单逐字一致，未调整字段；未修改后端仓库。最终前端 HEAD 与 CI 见本单 PR，避免提交号自引用。
- open-tasks.txt 没有 T151 行；未改其他工单的历史待办标记。

| 验收项 | 合成证据 |
| --- | --- |
| 版本 1 / 旧标记、UTC 心跳、来源唯一性、双 default | RetryControlTests.test_capability_requires_fresh_exact_unique_source；MonitorRetryTests.test_t151_invalid_stale_and_ambiguous_markers_use_one_legacy_call |
| CLI 固定参数、auth_fixed、四键兼容、附加键 | MonitorRetryTests.test_t151_tracking_argv_and_forward_fields；test_retry_fixed_argv_and_result_contract |
| 追踪前重核同一 study 根 | MonitorRetryTests.test_t151_changed_ag_root_refuses_before_registration |
| 无效标识、非零、超时、不支持参数、无自动回退 | MonitorRetryTests.test_t151_invalid_tracking_never_falls_back；test_retry_invalid_output_timeout_no_automatic_retry；浏览器 T151 malformed tracking id |
| token / 同源 / 回环 / 严格 POST / 计算锁不变 | MonitorRetryTests.test_retry_invalid_requests_and_access_do_not_run_ag；test_retry_and_fetch_do_not_block_each_other |
| 状态枚举、时间、身份、未知字段 | RetryControlTests.test_strict_known_fields_unknown_keys_and_no_snapshot_contamination |
| 无快照和移除入口仍可读控制结果 | RetryControlTests.test_states_without_snapshot_and_removed_terminal；浏览器 T151 discarded entry_removed |
| 文件损坏、2 MiB、链接和非普通文件 | RetryControlTests.test_corrupt_oversized_and_symlink_control_preserve_snapshot；快照内容独立保留 |
| queued → running → finished 成功/失败 | 浏览器 T151 queued running finished 两例；其他新快照不结束等待 |
| 四个 discarded 原因且无新快照 | 浏览器 T151 discarded 四例；下一次本地读取结束快速轮询 |
| running → monitor_restarted | 浏览器 T151 running then monitor restart：新文案、下一次 3 秒读取立即恢复 30 秒、快照不变、普通轮询不产生第二次 POST |
| 多入口 / 来源 / 同秒不同 ID / 切卡 / 旧响应乱序 | 浏览器 T151 entries and sources、replaced id、late old registration；消息与操作序号保存在父组件，入口丢失快照也不切走选中卡片 |
| 记录暂缺 / 心跳陈旧 / 网络暂断 / 超时 / 迟到终态 | 浏览器 T151 missing / stale / network 三例；120 秒后普通轮询仍接受同一标识，无第二次 POST |
| 旧后端不精确归因、拒绝与错误不加速 | 浏览器 T151 legacy new snapshot；保留 T147 拒绝 / 502 / 504 / 网络 / 无效 JSON 七例 |
| 本地 Study 读取不随快速轮询加速 | 既有 T128 fast monitor polling 两例 |
| 五卡 / 九节点 / 具名节点 / 资源图例 | 全量浏览器保留 T143 / T145 / T147 回归 |
| 新后端真实本地配套 | PairedBackendTests.test_t151_merged_backend_local_pair：配置替身调用实际 CLI、legacy/named、queued/already_queued/in_progress 同标识、sample/publish/finished、四个 discarded、不刷新快照、入口移除后状态可读 |
| 新旧调用矩阵 | 新前端 + 旧四键假 ag：原 argv 与不精确提示；新前端 + T149 实际源码：--track/状态配套；旧四键调用 + T149 实际源码：恰好原四字段 |

本地配套源码通过 Git 导出上述准确合并 SHA，仅显式 `T151_BACKEND_SOURCE` 注入测试，不安装或部署该版本。
普通 Python 套件不提供该路径时跳过这一个独立配套项；已单独运行并通过，CI 不以该跳过代替配套证据。
新增截图仅含合成监控数据。请求状态和错误不展示内部随机标识或原始 ag 输出。
真实环境边界：未新增现场查询；未启动读取真实配置的 watch；未修改正式检出、常驻服务或研究数据；未部署、发布、提交或取消计算。
当前交付待监督方对准确前端 HEAD 复核，合并由负责人执行；正式服务兼容观察属于后续发布部署单。

首版 `7505f953c0444ab184cf21c4e066b9db08ed2a3f` 的本地验证汇总：Python 全量 189 项（188 通过、独立源码配套项默认跳过 1）；最终针对性复核
19 项全部通过（含实际 T149 源码配套）；TypeScript/Vite 构建通过；完整浏览器 334 项全部通过。
桌面与窄屏反馈截图见 [1440 像素](../../tests/monitor-fixtures/t151/terminal-1440.png) 与
[390 像素详情](../../tests/monitor-fixtures/t151/terminal-390.png)，均已人工检查，不含真实研究或环境信息。


### v1.1 增量复核

本次只修改前端反馈、对应浏览器测试、README、格式说明及本单文案。
第 3 节共用字段块未修改；不改变终态枚举、CLI 或后端处理，不修改 T149 仓库。
新增合成场景先读到 running，再读到相同标识的 discarded/monitor_restarted，
验证结果保持未确认、快照不变、下一次读取即停止快速轮询，以及之后 30 秒普通读取不自动重新登记。
准确新 HEAD 与增量检查结果记录于原 PR，供监督方增量复核；未合并或部署。

增量本地检查：`pnpm --dir web build` 通过；`AUTOG_SOURCE_PYTHON=... pnpm --dir web test server-page.spec.ts`
65 项全部通过，包含新增 running → monitor_restarted 用例及原有四个 discarded 原因用例。
未改 Python 或后端实现；完整回归由新 HEAD 的 CI 执行，结果见 PR。本次验证仍仅使用合成响应与浏览器假时钟。
