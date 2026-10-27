# Changelog

## v4.6.3

### 升级须知

1. **监控显示（T147）。** Slurm 空闲只使用实际 Idle，Other 单列；矛盾或缺失的核数/内存保持未知。硬件 notes 去重；重新采样被拒不加速轮询；过期计划显示“等待下一轮”；修正暂停确认文案。[#46](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/46)
2. **请求反馈（T151）。** 仅在明确能力标记下追踪同一入口、来源与请求，匹配终态立即结束快速轮询。旧后端保留四键兼容，新快照只能说明结果未精确确认。监控重启显示“监控已重启，本次请求结果尚未确认”；重启前 running 可能已经查询，不能断言未执行，不自动重新登记。超时不伪报完成，普通轮询仍可接收迟到的匹配终态。[#47](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/47)
3. **配套后端 4.6.3。** 包含 T148 监控准确性、T149 请求追踪及配置重读、T150 新 Gaussian 输入资源补齐。补齐由 ag 按人已选入口和档位执行；前端不自行补写旧 Attempt，也不增加自动操作。最终配套必须使用 T152 的真实完整合并 SHA，不能以旧 T149 SHA 或浮动 main 代替。
4. **版本与文档（T153）。** Python 包元数据、运行时 `__version__` 和网页包均为 4.6.3，修正历史 runtime 4.0.0 差异；核对实际导入来源。清理已完成 T146/T147 待办，仅澄清 T151 共用字段块第 6 项的重启语义，保留 v1.1 验收记录；不修改 UI、字段、依赖或锁文件。
5. **发布与回退。** 本次为发布准备，功能合入不会自动更新运行检出或服务。负责人合并后，两个 tag/Release 须按后续明确指示指向各自确切发布合并提交；部署与重启另行授权并按 [OPERATIONS.md](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/OPERATIONS.md) 备份、核对、回退。对应机器实际验收后才记录升级完成，研究机沿用既有维护计划，目标版本与窗口以后决定。

按 `git log v4.6.2..a65e4854c219cc819533fdfd6699080ee6b68a96 --first-parent` 核对，本仓功能增量仅 T147（合并 `aa8f2cfcfe3829f76b349fd584aa8f811ffdaba7`）和 T151（合并 `a65e4854c219cc819533fdfd6699080ee6b68a96`）。T153 仅准备版本与文档，旧版本段落逐字保留。

### 验证与兼容边界

- 发布 PR 记录当前候选的 Python 全量、TypeScript/生产构建、全量 Playwright、版本导入来源及有效本机词表扫描；最终 HEAD 的必要 CI 全绿后交付监督复核。默认 CI 跳过可选配套项不代表配套通过，须在 T152 合并源码上另行实际运行并记录。
- T149/T151 从“共用字段约定”标题到下一个同级标题前的完整块须逐字一致，比较方法、双方准确 SHA 及结果记在 T153 和 PR；不另建协议文档。
- 保留默认只读、来源/路径保护与 ag 操作方式、3 秒快速轮询的 120 秒上限及 30 秒普通轮询；四/五卡、PBS 节点、Slurm 和研究/证据页面沿用既有回归。页面状态不等于科学验收。
- 保留串行采样与睡眠恢复的延迟、证据库冷启动成本、source-map-js 临时 override；不调整真实节点、资源、SSH 或服务配置。节点绑定 Attempt 不删字段、不重写为旧格式；回退恢复配套后端及相容配置，不能安全处理时停止受影响操作并报告部分恢复。
- catalog v2 启用批准、两机部署及临时非研究 study 验收条件不变；升级后不可降级，不以本次发布文字代替机器验收，不新增或转移 study。
- 本单仅离线合成、构建和发布候选配套验证；未进行真实服务重启、集群验证或计算。未合并、未建 tag/Release、未部署，现场兼容观察另行记录。

## v4.6.2

### 升级须知

1. **显式节点选择（T145）。** 仅当 PBS 入口广告 `node_targeting` 能力时，在既有 Gaussian 新建 Attempt 抽屉展示目标节点；初始不选择节点，排序不是授权。比例默认 1/2，可明确改为 1/4，显示匹配的已有档位、核数和内存。
2. **保留分组与禁用状态。** `priority_group` 是原配置分组，`order` 是保留组内次序的总顺序，旧 `priority` 为顺序别名。禁止、特殊 CPU 受限、占用、未知、资源不足、过期节点均明确显示且不可提交。表单打开期间也检查过期。
3. **前后端配套。** 必须配合 ag 4.6.2；适配层校验候选字段及档位后才创建草稿，仅传固定节点/比例参数。提交摘要显示不可变目标、比例、队列与实际资源。后端独立执行实时检查与 placement 判定；界面不能替代审批、Claim、UNKNOWN 或实际运行位置证据。
4. **兼容与回退。** 未启用策略的入口保留原控件，四/五卡、PBS 节点明细、Gaussian-only、资源字段、Slurm/作业详情保持兼容。回退须恢复配套后端和相容配置；新节点绑定 Attempt 不删字段、不重写脚本，不交给未确认兼容的旧版执行写操作。恢复不完整时报告具体范围。

本版功能增量为已合并的 [T145 #44](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/44)，配套后端 [#345](https://github.com/anakine800-tech/Auto-Gaussian/pull/345)。T146 只更新版本与发布文档，不增加功能、依赖或 study/catalog 迁移；历史发布条目原文保留。

### 验证与现场限制

- 发布 PR 记录准确 HEAD 的 Python、类型检查、构建、全量 Playwright、配套集成及有效词表扫描结果；只用合成数据，截图写独立测试输出目录。节点选择、分组、过期/错误、键盘/移动端和原有服务器/研究页面均须回归。
- 复用现有快照，不增加逐节点远程查询；free 不代表未分配，slots 不代表 CPU 实时利用率。严格定向解析失败保留只读显示，不能据此授权提交。
- 特殊 CPU 映射及两次查询后的跨客户端竞争未由本功能解决。当前 PBS_NODEFILE 守卫不归档原文；实际节点/输出/回执和所需原文证据须在单独获批合成作业中核验。
- 发布 PR 审阅完成后按负责人明确授权发布与部署，开发机全部必要验收通过才安排研究机；真实计算仍单独批准。前端 runtime `__version__` 保留历史 4.0.0，以 Python 包元数据与网页包的 4.6.2 核对版本。


## v4.6.1

### 升级须知

1. **PBS 节点分配（T143）。** 节点明细显示状态、已分配/总/剩余 slots、作业数、内存和分配比例。`state=free` 不代表没有分配，slots 是调度器分配量而非真实 CPU 利用率；未知不按零显示，失败或过期快照标记非实时。复用已有快照，不增加远程查询或改变监控采样协议。
2. **入口与资源显示。** 四卡布局继续可用，五卡响应式排列；档位按 mini、simple、general、complex、max、ultra 排序，仅显示实际配置项。已有排队上限及新增可选单作业 walltime 上限通过通用组件显示，不对某个服务器硬编码。Slurm 与现有作业详情保留。
3. **配合 ag 4.6.1。** 后端 T141 提供显式 Gaussian-only 白名单，T142 提供可选六档、显式 PBS 高内存及入口级时限硬上限。`ag-monitor/1` 只增可选资源字段；旧四档与缺省字段继续兼容。页面显示不能替代后端提交检查、调度器许可或单节点容量验收。
4. **升级、回退与验收。** 先备份两仓版本、依赖、构建、配置、SSH 与 LaunchAgent，并保存 SHA-256。重新构建 UI、重启唯一前端服务、刷新操作页令牌；回退须恢复配套后端及旧版本兼容配置，不能让新档位或时限在旧版上失去约束。操作顺序见 [OPERATIONS.md](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/OPERATIONS.md)。开发机全部必要验收通过后才配置研究机，后者须批准维护窗口并独立验收；观察时长与真实配置仅在私有部署消息中指定。

按 `git log v4.6.0..main --first-parent` 核对全部 1 个功能 PR：T143 #42。T144 只准备版本与发布文档；两个发布 PR 经审阅并由负责人合并后，负责人在各自确切合并提交上创建同号 tag/release。发版和部署仍需批准；本补丁不增加 study/catalog 迁移。

### 节点与资源视图

- T143 增强通用 PBS 节点分配表和多入口响应式卡片，兼容可选六档、排队上限与单作业时限；同步可选字段校验与类型，并覆盖合成数据、键盘、可访问名称、移动端和既有 Slurm/作业页面。[#42](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/42)
- T143 复审修复将新增 Playwright 截图写入 `testInfo.outputPath()`；普通测试不覆盖已跟踪的静态参考 PNG，参考图仅含合成数据。

### 验证与已知边界

- 本次发布 PR 单独记录 Python、全量 Playwright（含跨页面集成）、构建、有效本机词表扫描与测试前后工作区检查，功能 PR 的成功不替代本次结果。
- 原有 catalog v2 不可降级及启用批准条件继续适用；不修改旧 Attempt。共享目录、Gaussian 计算节点环境、高资源档位、双调度器冲突风险和 Keychain 重新登录后持久化均需独立现场验收。
- `autog_frontend/__init__.py` 的 `__version__` 仍为 4.0.0；按既有同号约定，Python 包元数据和网页包版本为 4.6.1。既有串行采样、睡眠后退避、Slurm“其他”核数显示及其他非阻塞问题保留，见下方 v4.6.0。
- 发布准备只运行离线合成测试和构建，不连接真实集群或提交计算。**代码合并、CI 或版本发布不等于新增入口部署完成，也不等于科学验收。**

## v4.6.0

### 升级须知

1. **通道与候选面板（T132）。** 展开 v2 登记对象时显示通道状态、候选台账、负责人声明原话和整体稳定声明；只读，不写 catalog，不调用 ag。v1 对象显示不变。
2. **必须配合 ag 4.6.0。** 前端 4.5.x 会把 v2 catalog 显示为未登记；catalog v2 升级后不能降级。第一次写入 v2 事件须显式 `--upgrade-catalog`，已有研究 study 须先经负责人批准；升级后的 study 不能用 4.5.x 打开或写入，也不能删行降级。两台电脑都部署完成，并在研究用计算机用临时非研究 study 登记候选、执行 `ag g0 --record` 和核对前端台账通过前，真实研究 study 不写 v2 事件。
3. studies 根目录中以 `_` 或 `.` 开头的目录按容器处理，不再列为 study，也不计入问题列表；不会递归将容器中的目录列为 study。
4. 重新构建前端并重启服务；操作版令牌会更换，已打开的页面要刷新。两个 tag 建好后，先部署开发机并通过首轮核对，当天暂停研究会话，再部署研究用计算机；本轮不设观察时长，至少完成 [运维文档](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/OPERATIONS.md) 的首轮核对。合成试写 study 移入以下划线开头的容器目录保留，不删除。

配合 ag 4.6.0 使用。按 `git log v4.5.1..main --first-parent` 核对全部 1 个 PR：T132 #40。T140 只准备版本号和文档；两个发布 PR 经监督方审阅、负责人合并后，由负责人核对各自确切合并提交，再创建 `v4.6.0` tag/release。

### 通道、候选与目录展示

- T132 只读展示 catalog v2 的对象、通道、候选、诊断原始记录及负责人声明，保留 v1 展示；校验字段和日志哈希，异常明确提示。过滤以 `_` 或 `.` 开头的容器目录，修复其误列为 study 的问题。[#40](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/40)

### 已知问题与验证边界

- catalog v2 升级后不能降级，兼容限制与启用顺序见升级须知第 2 条。
- 配套后端 `ag g0` 只比较元素序列来检查原子顺序，同种元素互换查不出来；立体标签须来自与候选完全相同的几何；批量诊断的频率段有歧义时整批报错。`ag scan-path` 只支持一维扫描；ts 卡已接近放宽后的 400 行上限，继续扩充前需拆分。页面展示不消除这些限制。
- Slurm“其他”状态核数被计入空闲，后续独立修正。
- 后端监控仍串行采样；经转发时单条 SSH 约 10–20 秒，一轮可能 100–150 秒。重试启动最多需等当前入口采完，新快照还需等待目标入口自身采样完成，须分别记录耗时。
- 电脑睡眠期间不采样，醒来自动恢复；刚醒来的一两轮可能因网络未就绪而失败并进入退避。不要求防睡眠，也不改电源设置。
- 睡眠醒来后 `next_sample_at` 可能显示过去时间，后续改为“等待下一轮”；核数和内存都未知时，硬件 notes 会重复显示一次。
- 重试被拒仍进入短暂快速轮询；暂停确认框文字有一个多余空格。两项均为 T128 非阻塞建议，后续修正。
- `autog_frontend/__init__.py` 的 `__version__` 仍为 4.0.0，本次按工单保留；Python 包元数据与网页包版本为 4.6.0。
- 沿用 v4.5.0：证据库冷启动已有测量约 2.5 秒，实际随本机和文件数量变化；source-map-js 临时 override 待 PostCSS 自然升级到修复版本后删除。
- 默认只读，动作经过 ag；页面相对能量和比较属于前端现场计算的非正式结果，工具状态不等于科学验收。

各项真实验证结果见对应 PR；本次发布准备只做离线测试、浏览器测试和构建。**发版不等于部署完成，也不等于科学验收；部署结果另行记录。**

## v4.5.1

### 升级须知

1. 推荐每台电脑只运行一个操作模式服务，只读模式保留为可选。使用 [前端 LaunchAgent 样例](docs/ops/launchd/local.autogaussian.frontend.plist.example)；先备份其他实例的启动方式和恢复脚本，再按 [后端运维文档](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/OPERATIONS.md) 替换服务。
2. **服务器页（T128）。** 核数和内存分开判断，局限说明显示为灰色提示且不计警告；调度器标签可从旧快照内容推断。显示退避、暂停和下次采样时间；操作模式可“立即重新采样”，认证或主机指纹暂停时须先确认已修复。**需要配合 ag 4.5.1 使用：ag 4.5.0 没有 `--retry`，其返回会被判为无效输出。**
3. 重新构建前端并重启服务；操作版令牌会更换，已打开页面要刷新。两个仓库的 tag 建好后，先部署开发机并观察通过，再部署研究用计算机。

配合 ag 4.5.1 使用。按 `git log v4.5.0..main --first-parent` 核对全部 1 个 PR：T128 #38。T129 只准备版本号与文档；两个发布 PR 经监督方审阅、负责人合并后，由负责人核对各自确切合并提交，再创建 `v4.5.1` tag/release。

### 服务器与采样

- T128 独立展示核数/内存，分开硬件 errors 与 notes，推断旧快照调度器，显示采样退避和暂停，并修正距今时间显示。操作模式通过本机 ag 登记重试；暂停入口先进行页面确认，重试不占用既有操作锁；短暂提高本机监控接口轮询频率。同步 `ag-monitor/1` 新字段与单服务部署样例。[#38](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/38)

### 已知问题与验证边界

- 后端监控仍串行采样；经转发时单条 SSH 约 10–20 秒，一轮可能 100–150 秒。重试启动最多需等当前入口采完，新快照还需等待目标入口自身采样完成，须分别记录耗时。
- 电脑睡眠期间不采样，醒来自动恢复；刚醒来的一两轮可能因网络未就绪而失败并进入退避。不要求防睡眠，也不改电源设置。
- 睡眠醒来后 `next_sample_at` 可能显示过去时间，后续改为“等待下一轮”；核数和内存都未知时，硬件 notes 会重复显示一次。
- 重试被拒仍进入短暂快速轮询；暂停确认框文字有一个多余空格。两项均为 T128 非阻塞建议，后续修正。
- `autog_frontend/__init__.py` 的 `__version__` 仍为 4.0.0，本次按工单保留；Python 包元数据与网页包版本为 4.5.1。
- 沿用 v4.5.0：studies 根目录中的容器目录（如 `_archive/`）仍可能显示“File not available”；证据库冷启动已有测量约 2.5 秒，实际随本机和文件数量变化；source-map-js 临时 override 待 PostCSS 自然升级到修复版本后删除。
- 默认只读，动作经过 ag；页面相对能量和比较属于前端现场计算的非正式结果，工具状态不等于科学验收。

各项真实验证结果见对应 PR；新快照显示与重试成功路径的部署验证另行记录。**发版不等于部署完成，也不等于科学验收。**

## v4.5.0

### 升级须知

1. 顶部导航调整为**服务器 / 研究 / 结果 / 证据**，右侧为使用说明；旧链接自动跳到新位置并保留对应选择参数。[#32](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/32)、[#35](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/35)
2. 升级后重新构建前端，两个常驻服务各重启一次；操作版令牌随重启更换，已打开页面须刷新，令牌失效时页面给出提示，不自动重试操作。[#28](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/28)
3. 前端仓库启用 `.githooks/pre-commit`，方法见 [README](README.md#启用提交前扫描)；本机敏感词表不进入仓库。[#30](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/30)、[#33](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/33)
4. Python 构建依赖固定为 **setuptools 83.0.0**，安装及构建环境须同步。[#36](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/36)

配合 ag 4.5.0 使用。按 `git log v4.4.0..main --first-parent` 核对全部 8 个主线 PR：T110 #28、T115 #29、T116 #30（包含合入该功能分支的 #33）、T118 #31、T120 #32、T121 #34、T122 #35、T113 #36。T126 只准备版本号和发布文档；两个仓库均须监督方审阅、负责人合并，再由负责人在各自 PR 的确切合并提交上创建 `v4.5.0` tag/release，不直接选择届时的 main。

### 结构与服务器

- T110 切换优化、IRC、集合及 XYZ 帧时保留相机、缩放和滚动，支持任意 2–3 个结构对比、可选刚体对齐及原子对高亮；增加集群容量总览、显示名和令牌失效提示。对齐只改变显示，不写回坐标。[#28](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/28)
- T115 将容量总览重构为每台服务器一张卡片，用本人 / 他人 / 空闲分段条显示核数和内存；运行中、排队中作业按服务器分组，可只看本人，节点与队列、限额与存储默认折叠。共享入口不重复累加，未知和过期数据保留提示。[#29](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/29)

### 报告与导航

- T118 将 Markdown 表格、CSV 和 JSON 对象数组显示为可排序表格，支持图片和隔离显示的 HTML、本地相对链接，并按 schema 和报告声明分类；损坏或不可安全读取的内容明确提示，报告只读。[#31](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/31)
- T120 提供四入口导航、Study 切换器、本机全局搜索、区分工具状态与签字状态的进展页、跨页保留的比较篮和使用说明；旧链接迁移，筛选及比较选择可随页面切换保留。[#32](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/32)

### 采用结果、比较与证据

- T121 新增计算链页、当前采用的结果及关键报告，读取 catalog 登记并核对日志哈希；相对能量可按 E / E+ZPE / G 换算，逐层核对 SP 与 Freq 的方法、组成、电荷、多重度及所需温压口径，缺项或不相容时留空。不从其他计算补值，采用不等于签字。[#34](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/34)
- T122 将口径核对、分层能量、性质、几何和结构叠合集中到统一比较页，增加证据库、单对象来源关系及服务器卡片图例。文件与来源只读，差值和几何比较均标明前端现场计算、非正式结果。[#35](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/35)

### 仓库与依赖

- T116 对公开工单副本脱敏并增加全仓库扫描、私有词表 hook；#33 先合入 #30 的功能分支，统一归档扫描失败规则，随 #30 进入 main。当前文件清理不表示 Git 历史已清理。[#30](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/30)、[#33](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/33)
- T113 升级 Vite 8.3.3、source-map-js 1.2.2、certifi 2026.10.19 和 setuptools 83.0.0，处理 9 条安全公告；依赖及锁文件更新，不改变计算功能。[#36](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/36)

### 已知问题与验证边界

- studies 根目录中的容器目录（如 `_archive/`）仍可能在 Study 列表显示“File not available”，不影响有效 study 的使用；后续按约定跳过以 `_` 或 `.` 开头的容器目录。
- 证据库冷启动在已有测量中约 2.5 秒，实际耗时随本机与文件数量变化。
- source-map-js 的临时 override 待 PostCSS 自然升级到修复版本后删除。
- **只读边界不变，动作都经过 ag 执行。** 页面上的相对能量和比较是前端现场计算的结果，不是正式结果；工具状态不等于科学验收。
- 全部离线测试、浏览器测试和构建结果见 T126 前端 PR；各项真实验证见对应 PR 评论，发版不等于科学验收。

## v4.4.0

配合 ag 4.4.0 使用。本节按 `git log v4.3.0..main --first-parent` 核对全部 2 个 PR：T103 #25、T104 #26。T107 只修改版本与发布文档；两个仓库均须监督方审阅、负责人合并，再由负责人在各自 PR 的确切合并提交上创建 `v4.4.0` tag/release，不直接选择届时的 main。

### 作业监控与快速比较

- T103 作业页分别显示运行加排队总上限 `committed_cap` 和单作业上限 `core_cap`；旧快照没有 `committed_cap` 时显示“总上限未知（旧快照）”，不再借用单作业上限。同一集群多个入口显示共享说明，不跨入口汇总容量；缺失值不按零处理。[#25](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/25)
- T103 快速比较按多重度补全受支持方法中省略的 R/U 前缀，单重态 `M062X` 与 `RM062X` 可按相同方法比较；显式 R/U/RO 仍保持区别。比较口径同时展示原始写法、补全后的写法与解释，方便核对被接受或拒绝的原因。[#25](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/25)

### IRC 结构审阅

- T104 IRC 页增加 reverse 端点优化结构、TS、forward 端点优化结构的并排三维视图，显示电子能、虚频数和 Attempt 跳转链接，支持报告原子对高亮。结构来源须经报告引用及 SHA-256 核验；缺失或不安全来源明确报错，不按名称猜测。三格独立旋转，窄屏纵向排列；人工审阅提示位于标题下方，在两种桌面尺寸下与三格一同留在首屏。[#26](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/26)

### 兼容与验证边界

- 默认只读、路径与大小检查不变；显式开启的动作均经本机 ag 执行，提交与取消仍需人亲手点击 Mac 系统确认框。
- 页面上的工具状态、虚频数或结构展示不等于科学验收；快速比较仍为前端计算的非正式结果，正式结论以 ag 报告为准。
- 全部离线测试、浏览器测试（含跨页集成）和构建结果见 T107 前端 PR；各项实际验证见对应功能 PR 评论，发版不等于科学验收。

## v4.3.0

配合 ag 4.3.0 使用，前后端统一版本号。本节按 `git log v4.2.1..main --first-parent` 核对全部 7 个 PR；T100 只准备版本号和发布文档。两个仓库分别经监督方审阅、负责人合并后，由负责人在各自 PR 的确切合并提交上创建 `v4.3.0` tag/release，不直接选择届时的 main。

### IRC 与监控

- T87 增加只读 IRC 查看页，展示逐方向曲线、路径点结构、完成判据与停止原因；按报告映射读取路径 XYZ，有哈希时核对，不匹配则拒绝，缺哈希明确标记未核对。监控快照显示持续更新的采样年龄和过期提示。[#17](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/17)

### 导航与页面改版

- T94 统一视觉令牌、通用组件与页面框架，提供作业、Study、分析、文件四个顶层入口，旧链接自动跳转并保留选择状态；全局搜索仅检索当前浏览器会话已读取的数据。[#18](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/18)
- T95 增加 Study 概览、待处理事项和最近分析，以及可筛选、排序并在 URL 保存选择的 Attempt 表。[#19](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/19)
- T96 重做 Attempt 详情、上下文信息和操作栏 / 抽屉，提供输入、结构、优化、频率、日志及本地快照的查看入口；状态与结果仍取保存值。[#20](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/20)
- T97 将作业与服务器监控集中到作业页，按集群展示本地 monitor 快照、占用和任务，保留缺失、陈旧及异常提示。[#21](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/21)
- T98 提供分析入口、报告索引、筛选和快速比较，支持只读展示 TS 立体标签报告；快速比较在前端检查口径并计算相对能量，属于浏览辅助，非正式结果。[#22](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/22)
- T98a 为快速比较增加 `termination` 与 `n_imag` 两列，只显示已读取的 facts 保存值，缺失保持未知，不据此自动判定科学合格。[#23](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/23)

### 兼容与已知问题

- 默认只读、路径与大小检查不变；显式开启的计算动作仍经本机 ag，提交与取消仍需人亲手点击 Mac 确认。页面上的工具状态、虚频数或报告均不等于科学验收。
- 快速比较尚未同步后端按多重度补全 R/U 前缀的规则：单重态 `M062X` 与 `RM062X` 会被视为不同口径而拒绝比较。后续修复；正式结论以 ag 报告为准，后端不受此前端限制影响。
- 发布前运行全部离线测试、浏览器测试和构建，结果见 T100 PR；各项实际验证见对应 PR 评论，发布不等于科学验收。

## v4.2.1

配合 ag 4.2.1（后端 T67）使用。T71 已合并；本 PR 仅更新版本与发布文档。
监督方审阅、负责人合并后，在本 PR 的确切合并提交上创建 v4.2.1 tag/release，
建 tag 前核对该提交就是发版提交，不直接选择届时的 main；与后端同步发布。

- T71：构象集合页读取后端 T70 的可选局部描述，展示二面角分组、角度、近边界
  标记与关键距离；支持分组多选、近边界筛选和按集合隔离的 URL 恢复。分组汇总
  显示保存的候选数、最低能候选及层级，点击跳转到对应候选，不重新计算科学数据。
  [#15](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/15)、
  [后端 #285](https://github.com/anakine800-tech/Auto-Gaussian/pull/285)
- 无新字段时沿用原页面；可选字段损坏时单独报告并隐藏该部分，原有能量和校验后
  的几何继续可读。保留 `ag-ensemble/1` 与原有读取边界，所有计算操作仍委托 ag。
- T71 已用后端合并后的 main 输出完成合成数据复测，细节见该 PR 评论。
  本次发布前运行完整浏览器与跨页集成回归、Python 测试和构建，结果见发布 PR。
  工程测试及发布不等于科学验收。

## v4.2.0

配合 ag 4.2.0（后端 T61）使用。版本准备完成后仍需监督方审阅、负责人合并；
负责人在合并后与 T61 同步创建 v4.2.0 tag/release。

- T54：新增 `ag-ensemble/1` 构象集合列表、能量表、缩略图/三维联动、候选 URL
  和 CREST 输出逐帧查看；核对 XYZ 哈希，保留缺失与跨路线能量限制。
  [#12](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/12)
- T55：新增可选虚频审阅模式、归一化振幅、原子对距离/变化及来源信息，
  与同源 mode-review 报告逐方向对照；不代替 TS/IRC 科学验收。
  [#13](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/13)
- T57：补全 B、Cl、Br、P、Si、I 缩略图配色；增加合成 study 的跨页浏览器与
  HTTP 集成回归，覆盖缺失/损坏 facts、XYZ 被替换、异源报告、截断日志、大小/
  帧数/原子数限制、陈旧/失败快照、符号链接、只读无 POST 及 T52 fetch facts 输出。
  补全启动与浏览说明，Python 与网页包版本同步为 4.2.0。修复三维图部分离开视口时聚焦滚动导致原子点击丢失的问题，
  以及既有动画对照测试提前取值的时序问题。
  [#14](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/14)

离线验证只证明软件行为；真实 study 的只读可用性由负责人在合并后验证，
在 PR 评论中仅记录“可用 / 有问题（类别）”。不发布研究截图、数据或科学验收结论。

## v4.0.0

配合 ag 4.0.0 使用。本节对比 T7 改造前的旧前端，仅包含已合并的功能。
前端版本准备已由 [#8](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/8) 合并；本次补记 T7e，不创建 tag 或 release。以下 PR 均属于本前端仓库，另有明确标注的后端关联。

### 保留

- 保留分子三维旋转、缩放、成键显示和几何测量，以及独立的 Gaussian 振动位移解码能力；振动动画是显示辅助，不是 TS 验证。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)
- 保留本机访问边界、响应式浏览体验与只读科学结果展示目的，将数据来源改为 study 文件；不沿用旧查询接口。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)

### 重做与新增

- 以本地 study 目录重做查看器：study Markdown、Attempt 状态、facts、review、分页日志、热化学、构象帧与父子关系图；缺失数据保持未知，文件读取拒绝越界和符号链接。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)
- 新增提交前输入结构、参数与哈希预览、父 Attempt 输入对比、结构多帧、日志关键词/终止标记搜索及直接定位链接。[#5](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/5)
- 重做结果首页，增加优化过程能量/收敛/结构播放与服务器页。服务器数据来自 ag monitor 保存的快照；界面只读文件，不启动采样或连接集群。[#6](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/6)
- 增加默认关闭的 `--enable-actions`：固定本机 ag 入口、新建草稿、prepare、submit、status、fetch、cancel；随机 token、同源检查和单操作锁；提交/取消继续由 ag 弹出 Mac 确认。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)
- 420 秒页面等待结束不终止 ag，后台读取输出并持锁至进程退出；监控时间按本地时区显示，兼容运行/排队核数与总额度字段。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)

- T7e：操作模式通过 `ag clusters --json --verify-studies-root` 获取各集群档位、程序启用配置并核对根目录，不再直接解析 TOML；新建默认父集群，切换联动档位，prepare 显式传入 `--cluster`，摘要显示集群及估算核时。[#9](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/9)、[后端 #233](https://github.com/anakine800-tech/Auto-Gaussian/pull/233)
- T7e：服务器页分集群读取快照，兼容旧 default 位置；显示 Slurm 本地核时预算、到期与存储，缺失不当零、陈旧值明确标记。两个 default 来源并存时显示歧义，取消提示按 Attempt 集群匹配，仍由 ag 和 Mac 确认执行。[#9](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/9)

### 移除

- 移除旧 calculation-package、数据库、profile、任务队列、导入和查询服务的启动参数/API 依赖；旧 native/pre-v31/navigation 注册文档和发布来源映射退役。新查看器不导入旧后端运行时，也不提供旧数据自动迁移。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)

### 兼容边界

- T7e 已支持 ag 4.0.0 多集群查询和快照布局，操作模式要求包含 T19 接口的 ag；程序启用标记仅代表已配置，本地预算不等于平台余额。默认只读不调用 ag，所有计算副作用仍经显式操作模式委托 ag，科学验收由人完成。启动与快照路径见 [README](README.md)。[#9](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/9)、[后端 #233](https://github.com/anakine800-tech/Auto-Gaussian/pull/233)
