# T128（前端）：服务器卡片修正、手动重试与单服务部署

版本：v1（监督方，2026-10-25）。**开发机做。** 前端出一个 PR，PR 描述第一行写 `Task: T128 (frontend)`。

## 分支与目标

- 分支：`codex/t128-server-cards-retry`。
- **开工条件：** 以前端 main（不早于 `6267b08`，v4.5.0）为基线。**和后端 T127 并行开发**：照 T127 第 3 节（命令行契约）和第 7 节（快照字段）写合成快照和假 ag，开发、测试都用它们。**T127 合并之后才能合并本单**；两单合并后发 v4.5.1（T129）。
- **问题来源（开发机截图和 `latest.json` 已证实）：**
  - default、newhpc 卡片右上角显示“未知”：读的是 `cluster.scheduler`，PBS 快照没有这个字段。
  - scnet 两入口核数显示“未知”，各计 1 条警告：`jobs-data.ts` 只要 `hardware.error` 不为空，就把核数和内存一起作废，并计入警告。
  - 距今时间显示成“0 天 0 小时 1 分”。
- **负责人 2026-10-25 决定：**
  - F1 核数和内存**分开判断**，每条进度条只看自己的数值。`hardware.notes` 显示为灰色提示，**不计入警告**；`hardware.error` 仍计入警告，并在详情区置顶。
  - F2 快照缺 `cluster.scheduler` 时，按快照内容推断（`hardware.source` 为 `pbsnodes` 就是 PBS，为 `sinfo` 就是 SLURM），推不出显示“—”，不显示“未知”。
  - F3 显示 T127 的新状态：退避中（连续失败次数、下次采样时间）、已暂停（认证失败 / 主机指纹变化）、正常时的下次采样时间。没有 `sampling` 字段的旧快照照旧显示。
  - F4 **手动立即重试**：操作模式下可以对任一入口立即重新采样，不限频。因认证或主机指纹暂停的入口，先在页面内二次确认，再带 `auth_fixed` 发出。
  - F5 **前端合并为一个服务**：两台电脑以后都只运行操作模式（8773），停用 8774 和 8765（停用属于 T129 部署）。代码里的只读模式（不带 `--enable-actions`）**保留不删**。仓库新增 8773 的 plist 样例。
  - F6 合并顺序：T127 → T128；本单用合成快照与 T127 并行开发。
- **资料：** 后端 T127 工单第 3、7 节；`web/src/server-cards.tsx`、`server-detail.tsx`、`server-monitor.tsx`、`jobs-data.ts`、`api.ts`；`autog_frontend/monitor.py`（`validate_monitor`）、`actions.py`、`api.py`；`docs/ag-monitor-1.md`；T115 任务单。

## 允许改动的路径

- `web/src/jobs-data.ts`、`web/src/server-cards.tsx`、`web/src/server-detail.tsx`、`web/src/server-monitor.tsx`、`web/src/api.ts`（只加重试请求函数）、`web/src/ui/server.css`。
- `autog_frontend/monitor.py`：只在 `validate_monitor` 里加新字段的校验。
- `autog_frontend/actions.py`：新增重试方法。`autog_frontend/api.py`：新增一个 POST 路由（只在操作模式下注册）。
- `autog_frontend/studies.py`：只改第 835 行的提示文字（见第 5 节）。
- 测试：`tests/test_server_monitor.py`、`tests/test_actions.py`、`tests/fake_ag.py`（给假 ag 加 `monitor --retry`）、`tests/monitor-fixtures/`（新的合成快照，以及 `t128/` 截图）、`web/tests/server-page.spec.ts`。PR 中逐个列出。
- 新建 `docs/ops/launchd/local.autogaussian.frontend.plist.example`。
- 文档：`docs/ag-monitor-1.md`（合入 T127 PR 附的补丁）、`README.md`（服务器页、操作模式、部署三处）、`.gitignore`（加 `.pnpm-store/`）；本单 `docs/redesign-tasks/T128-server-cards-retry.md`、`docs/redesign-tasks/open-tasks.txt`。
- **不改** `main.tsx`、`routing.ts`、`navigation.ts`、Study / 结果 / 证据页面、现有 `execute()` 里的操作（status / fetch / prepare / submit / cancel）、`.githooks`、`scripts/`；不改 `CHANGELOG.md`（T129 统一写）。

## 要做的

### 1. 数据层（`jobs-data.ts`）

- `usable` 拆成两个：
  - 核数条：采样成功、来源确定、`hardware_capacity_known !== false`，并且 `cores_total`、`cores_allocated`、本人运行核数都不为 null；
  - 内存条：同样的前三个条件，并且 `mem_total_gb`、`mem_allocated_gb`、`own.mem_running_gb` 都不为 null。
  - `hardware.error` **不再**单独让两条作废：真失败时后端已把数值写成 null。
- `warningCount` = `warnings` 条数 + (`hardware.error` ? 1 : 0) + `storage_error` + `expiry_warning`。**`notes` 不计入。**
- 调度器标签：有 `cluster.scheduler` 就转大写；没有时按 F2 推断；再推不出就是“—”。现有排序（PBS 在前）也改用推断后的值。
- 模型里加上 `sampling`（没有时为 null）和 `notes`（没有时为空列表）。

### 2. 卡片（`server-cards.tsx`）

- 右上角显示调度器标签（F2）。
- 状态行沿用现有徽标（新鲜 / 非最新 / 采样失败），旁边按 `sampling.state` 加一段：
  - `backoff`：“退避中 · 连续失败 n 次 · 下次 hh:mm:ss”，警示色；
  - `paused`：“已暂停：SSH 认证失败”或“已暂停：主机指纹变化”，错误色；
  - `normal` 且有 `next_sample_at`：小字“下次采样 hh:mm:ss”。
- 内存条或核数条为“未知”且有 `notes` 时，在该条下方用灰色小字逐条显示 notes。
- 距今时间改成去掉前导零：“48 秒”、“1 分 5 秒”、“2 小时 3 分”、“1 天 2 小时”。
- 卡片本身是 `<button>`，**不要在卡片里嵌套按钮**。重试按钮放在详情区（第 3 节）。

### 3. 详情区与重试（`server-detail.tsx`、`server-monitor.tsx`、`api.ts`）

- 详情区顶部加一行采样状态：状态、连续失败次数、下次采样时间；暂停时写原因和处理提示（“检查密钥、隧道或 known_hosts，修复后再重试”）。
- **“立即重新采样”按钮**：只在操作模式（页面有令牌）下显示；只读模式不显示。
  - 普通状态和退避中：直接发请求。
  - `paused`：先弹出**页面内**确认框（不用 `window.confirm`）：“上次因 SSH 认证失败 / 主机指纹变化而暂停。请确认已经修复，再试一次；失败会继续暂停。” 按“确认重试”才带 `auth_fixed: true` 发出。
  - 请求结果显示在按钮旁：
    - `queued`：“已请求，等待采样”；
    - `already_queued`、`in_progress`：“已在等待 / 正在采样，结果见下一份快照”；
    - `refused`，原因 `monitor_not_running`：“监控未运行，未登记请求”；
    - `refused`，原因 `auth_confirmation_required`：“需要先确认已修复认证问题”；
    - 其他错误：显示 ag 返回的文本。
  - 不限频，按钮不禁用。
  - 发出请求后，页面改为每 3 秒读一次 `/api/monitor`。该入口的 `sampled_at` 变化或满 120 秒后，恢复每 30 秒一次。**只读本机接口，不新增其他请求。**
- 后端接口：`POST /api/monitor/retry`，请求体正好是 `{"cluster": str, "auth_fixed": bool}`，多字段、少字段、类型不对都返回 400。
  - `cluster` 必须在 `actions.clusters` 里。
  - 运行参数为 `[ag, 'monitor', '--retry', cluster, '--json']`，`auth_fixed` 为 true 时再加 `'--auth-fixed'`，`shell=False`，超时 15 秒。
  - **不占用现有的操作锁**，所以长时间的 fetch 不会挡住重试，重试也不会挡住 fetch。合并与并发由 ag 处理。
  - 只解析 ag 的 JSON：按 T127 契约校验 `entry`、`result`、`reason`、`requested_at`，原样返回。JSON 无效时返回错误说明，**不自动重试**。
  - 沿用现有的令牌、同源、回环检查。

### 4. 校验器（`autog_frontend/monitor.py`）

- 字段存在时逐个校验，缺失时照旧通过：
  - `sampling`：对象。`state` 只能是三种取值之一；`consecutive_failures` 为非负整数；`current_interval_seconds` 为 null 或 30–600 的整数；`next_sample_at` 为 null 或 UTC 时间；`pause_reason` 为 null、`auth` 或 `host_key`，且只在 `paused` 时非 null；`trigger` 只能是三种取值之一；`retry_pending` 为布尔值。
  - `hardware.notes`：字符串列表。
- 其他未知字段照旧忽略。

### 5. 部署相关（F5）

- 新建 `docs/ops/launchd/local.autogaussian.frontend.plist.example`：
  - 用 `<FRONTEND_PYTHON> -B -m autog_frontend --studies-root <STUDIES_ROOT> --ui-directory <FRONTEND_CHECKOUT>/web/dist --enable-actions --ag <AG_EXECUTABLE> --port 8773`；
  - `RunAtLoad=true`，`KeepAlive=true`，`ThrottleInterval=60`，日志写到 `<LOG_DIR>`；
  - **全用占位符**。替换到临时副本后通过 `plutil -lint`，不加载到 launchd。
- `README.md`：标准部署改为“每台电脑一个操作模式服务（8773）+ 一个监控服务”；只读模式作为可选写法保留；写明服务器页的重试按钮和二次确认。
- `studies.py` 第 835 行的提示，从“请在终端运行 ag monitor --watch 120”改为“监控未运行或尚无快照：请启动常驻监控（ag monitor --watch 30）”。
- `.gitignore` 加 `.pnpm-store/`。

## 不允许

- 前端不连服务器、不调用调度器，只通过本机 ag 登记重试请求。
- 不推算未知值，不把 null 画成 0；不对 notes 或 error 的文本做字符串匹配来决定显示逻辑。
- 不改现有操作的行为和锁；不删除只读模式；不停用、不修改任何电脑上的服务（T129 做）。
- 测试和截图只用合成快照（虚构用户 userA…、节点 node-a…、作业号），不出现真实用户名、主机、分区、队列或路径。

## 测试

| 场景 | 预期 |
|---|---|
| PBS 合成快照有 `scheduler="pbs"` / 旧快照缺该字段但 `hardware.source="pbsnodes"` / 两者都没有 | 显示 PBS / PBS / “—” |
| Slurm 快照：核数齐全、内存总量 null、`notes` 有说明、`error=null` | 核数条正常；内存条未知并显示灰色说明；警告数不含 notes |
| 只有 `AllocMem` 失败（`error` 有值，核数齐全） | 核数条正常；内存条未知；警告数 +1 |
| 硬件查询全部失败（数值全 null，`error` 有值） | 两条都未知；警告数 +1 |
| Torque 合成快照：总内存有值，已分配 null，`notes` 有说明 | 内存条未知并显示说明 |
| `sampling.state=backoff`，失败 4 次 | 卡片和详情显示退避、次数、下次时间 |
| `sampling.state=paused`，`auth` / `host_key` | 显示对应的暂停原因 |
| 旧快照没有 `sampling` | 与 v4.5.0 显示一致，不报错 |
| 距今 48 秒、65 秒、3 小时、26 小时 | “48 秒”、“1 分 5 秒”、“3 小时 0 分”、“1 天 2 小时” |
| 只读模式 | 没有重试按钮；POST `/api/monitor/retry` 返回 405 |
| 操作模式，普通入口点重试（假 ag 返回 `queued`） | argv 正确，不带 `--auth-fixed`，显示“已请求” |
| 暂停入口点重试 | 先出页面内确认框；取消则不发请求；确认则带 `--auth-fixed` |
| 假 ag 返回 `already_queued`、`in_progress`、`monitor_not_running`、`auth_confirmation_required` | 各显示对应文字 |
| 假 ag 返回无效 JSON / 超时 | 显示错误，不自动重试 |
| 请求体多字段、`cluster` 不在配置里、`auth_fixed` 不是布尔 | 400，不运行 ag |
| 有一个长时间 fetch 正在占用操作锁时点重试 | 重试照常执行 |
| 点重试后 | 每 3 秒读一次 `/api/monitor`；`sampled_at` 变化或满 120 秒后恢复 30 秒 |
| 无令牌或令牌错误 | 403 |
| 窄屏 390 px | 没有页面横向滚动；确认框可操作 |
| 校验器：`sampling` 各字段非法取值 | 报“快照格式不正确” |
| 校验器：T127 的新快照 | 通过 |

命令：`.venv/bin/python -B -m unittest discover -s tests -t . -v`、`pnpm --dir web build`、`AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test`、`python scripts/scan_public.py`、`git diff --cached --check`。记录通过数。

**截图（提交进仓库，供轻审）**：`tests/monitor-fixtures/t128/`，三个尺寸 1440×860、1280×720、390×844，每个尺寸两张：
- 服务器页首屏：四张卡片，分别是正常的 PBS（有内存）、带 notes 的 Slurm、退避中、认证暂停；
- 暂停入口的二次确认框。

全部用合成数据，由 `web/tests/server-page.spec.ts` 生成。

## 真实环境验证（T127 合并后，开发机；不提交作业）

1. 用本分支构建，在**临时端口**（不用 8765、8773、8774）启动一个操作模式实例。`--studies-root` 用真实根目录，只读取快照；`--ag` 指向已合并 T127 的检出。**不停用、不修改现有三个前端服务。**临时实例上除了点重试，不执行任何操作（状态、取回、新建、提交、取消都不点）。
2. 确认：四张卡片调度器标签正确；scnet 两入口核数显示、不计 notes 警告；PBS 内存按 T127 实际结果显示。
3. 重试：常驻监控仍是 v4.5.0，没有心跳，所以对任一入口点重试应得到“监控未运行，未登记请求”，并且不留下文件。**这一步顺带证明拒绝路径可用**；成功重试的路径在 T129 部署后验证。
4. 结束后停掉临时实例。PR 里只写结果，不贴真实快照或截图。

## 停止条件

- 需要改范围外文件，或者需要改现有操作的锁或行为。
- T127 的契约在开发中发生变化：停下，等监督方同步两张单。
- 同一问题修两次仍未解决。

## 合并前审阅与交付

- 需要监督方审阅：页面部分**轻审**（看三个尺寸的截图、测试结果、diff 概要）；`actions.py`、`api.py` 的新 POST 接口和 `validate_monitor` **逐行审**。合并只由负责人操作，排在 T127 之后。
- PR 描述包括：F1–F6 各自对应的改动、合入的 `docs/ag-monitor-1.md` 补丁来源（T127 PR 编号）、测试结果、截图路径、真实验证记录。
- 用 `gh pr view <编号> --comments` 读取 `<!-- ag-review head=... -->` 评论，逐条处理并回复。

## 版本记录

- v1（2026-10-25，监督方）：依据负责人 10-25 三轮问答决定 F1–F6 起草；从 T127 草案移入 `.pnpm-store/` 一项；顺手修正距今时间显示和过期的监控提示文字。

## 实现与验证记录

- 基线：前端 main `6267b08`（v4.5.0）；实现仅依赖 T127 v1 第 3、7 节及合成快照、假 ag。
- F1–F4：独立资源条、notes 与警告分离、调度器推断、采样状态、页面确认、独立重试接口及仅 monitor 的短暂加速轮询。
- F5：8773 LaunchAgent 占位样例与 README 部署说明；临时替换副本通过 plutil -lint，没有加载或修改常驻服务。
- F6：合并顺序 T127 → T128；T127 PR 文档补丁核对及指定真实验证尚待依赖。
- 范围批准（负责人，2026-10-25，会话原话）：“允许同步这两处测试断言”。因此额外只修改 `tests/test_results.py:103`、`tests/test_study_viewer.py:127` 的旧提示预期文字，不改变断言逻辑。
- 合成快照：`tests/monitor-fixtures/t128-synthetic.json`；截图由 `web/tests/server-page.spec.ts` 生成在 `tests/monitor-fixtures/t128/`，含三个尺寸的首屏与确认框共六张。
- 验证：Python 全量 165 项通过；TypeScript/Vite 构建通过；服务器页 26 项通过；浏览器全量 256 项中 255 项通过，仅 `web/tests/results.spec.ts` 的旧距今时间预期失败。负责人已于 2026-10-25 批准：“允许同步这六个时间文字预期”。本次仅更新 `web/tests/results.spec.ts:194–199` 六个 age 字符串，不改变测试逻辑。
- 提交前：全量公开扫描 260 文件零错误；暂存私有词表扫描 29 文件零错误；六张二进制截图另行人工核查；diff 检查通过。
- 批准后的复验：`pnpm --dir web test results.spec.ts server-page.spec.ts` 37 项全部通过，覆盖原唯一失败；TypeScript/Vite 构建通过。按照开发手册仅复验受影响部分，后续全量由 CI 执行。
