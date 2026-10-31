# T217C：服务器页链路状态显示

## 目标与范围

中继入口因共同链路不可用而同时失败时，服务器页应显示“链路中断”，
避免把同一链路问题写成各集群独立故障。入口配置与判定由 T217A 提供；
前端只消费已确认的只读字段，不根据入口名、调度器或共享额度猜测链路。

基线：`fa5b47d88f313d2678d2aedf33caeab15f50e847`（已 fetch 的 `origin/main`）。
分支：`codex/t217c-link-status`；独立 worktree，一张任务卡、一份 Draft PR。
协调方审阅后安排合并；本单不合并、不部署、不升级版本号。

实际模块盘点及允许路径：

- `autog_frontend/monitor.py`：监控快照和可选链路字段校验。
- `autog_frontend/studies.py`、`autog_frontend/api.py`：仅现有只读 monitor
  返回的必要适配；不改变操作入口或 Attempt 读取/写入。
- `web/src/server-monitor.tsx`、`web/src/server-cards.tsx`、
  `web/src/server-detail.tsx`、`web/src/jobs-data.ts`、`web/src/ui/server.css`：
  当前服务器页对应原工单所称 monitor-panel/types/monitor.css。
- `tests/test_server_monitor.py`、必要的只读 monitor API 测试；
  `web/tests/monitor.spec.ts`（本单新增），既有回归在 `server-page.spec.ts`。
- `README.md`、`docs/ag-monitor-1.md`、本任务卡。

## 行为与兼容

- 所有 relay 入口失败、至少一个 nonrelay 入口正常：显示“链路中断”。
- 只有部分 relay 入口失败：保留个别入口失败的原行为。
- 全部入口失败：显示“本机断网”。
- 缺失、过期、不支持或无法核验的字段保持未知，不伪装成功。
- 每入口快照年龄继续显示；连续采样仍以超过 `3 × interval_seconds`
  为过期，单次仍为 600 秒，不增加 15 分钟宽限。
- 老后端缺新字段仍能查看原有快照，不能从缺字段推断链路正常。
- 不改研究状态、权限、提交、取消、科学写入或既有重试行为；
  不直接 SSH、不采样、不新增调度器、不启动或改运行中的前端服务。
- 公开代码、夹具和文档只用通用 relay/nonrelay；真实数据及拓扑不入库。

## 离线验证

使用临时合成快照/后端 JSON，覆盖正常、链路中断、个别故障、全部失败、
旧后端、缺失与过期；校验未知字段、来源歧义和畸形字段的处理。
测试 HOME 隔离；浏览器固定端口 18765/18766 串行运行，先确认未被占用。
运行相关 Python 测试、TypeScript/Vite 构建和监控浏览器测试；首次 PR 前
按开发规则运行全部浏览器回归。提交前检查 diff、公开信息及私有词表，
核对 author/committer 使用 noreply 邮箱。

## 实现

消费 T217A [PR #393](https://github.com/anakine800-tech/Auto-Gaussian/pull/393)
head `8d096ee3edff6849f4d8917dfacff9e0f28b77e8` 的既有本机
`ag clusters --json --verify-studies-root` 顶层 `link_health`。
后续 head `23faa97a159a0dd5bfdbe4a4ea1dba2efee70d03` 的 clusters、link_health
及本单读取依赖字节未变；配对记录仍绑定实际执行的前一提交。
每次监控 GET 新读，操作模式复用已选定的 ag；只读模式仅在显式提供
`--ag` 时查询，默认仍不运行 ag。独立查询不进入操作配置缓存，不请求
任何 study 的自主状态，也不新增采样或后台调度。

只返回白名单摘要，relay 分组名归一；错误不返回原 stdout/stderr 或路径。
校验唯一入口与快照观测绑定；不匹配、尚未生效、过期和读取失败只降未知，
不会重新分类为其他故障。浏览器每秒检查到期，并保留判定时间和每入口年龄。
链路中断及全部入口失败时，卡片/详情与总览一致；缺快照为未知，部分失败
保留原显示。提交、取消、科学写入及既有重试追踪均未改。

## 验证记录（2026-10-31）

- TypeScript/Vite 构建通过；保留既有大 chunk 提示。
- 监控 Python 模块：23 通过、1 项既有独立配套测试未提供指定源码而跳过；
  本单新增的 13 项类型、只读查询、绑定、新鲜度与失败隔离测试全部通过。
- 全量 Python：289 项，283 通过、6 项既有独立配套测试未提供各自指定源码而跳过。
- 目标浏览器检查：既有服务器页 65 项通过；本单 30 项在修正来源标签的测试定位后
  全部通过。首次 PR 前完整浏览器回归 **484 项全部通过**，单 worker、隔离 HOME。
- 使用上述确切 T217A 导出源码与当前前端，五种状态的实际 CLI → 同一分类器 →
  前端 API 合成配对 5/5 通过。仅替换配置和 subprocess 边界，快照字节/mtime 不变；
  未读取默认配置、启动外部进程或 TCP 服务，未调用 SSH/网络。
- 桌面与 390px 窄屏合成画面检查；无横向溢出，卡片和详情保持一致归因。
- 公开扫描器自检 5 项通过；全仓与本单暂存内容通用/私有词表扫描零错误，
  `git diff --check` 通过。测试生成的既有截图文件已还原，不纳入 PR。
- 未访问真实集群、研究数据或运行服务；不部署、不升级、不合并。
