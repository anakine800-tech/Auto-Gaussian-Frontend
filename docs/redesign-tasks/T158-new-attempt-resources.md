# T158：新建任务默认资源、节点选择与容量提示

版本：v1，2026-10-28。目标仓库：Auto-Gaussian-Frontend。本单是开发工单；写单不等于启动开发、部署或计算。

## 分支与目标

- 分支：`codex/t158-new-attempt-resources`；一张任务单、一个分支、一个 PR，PR 第一行 `Task: T158`。
- 核查基线：`19bc0c9fe31abdc37beb77602c70a2f83068d472`；实际开发从包含前置任务的最新 main 建独立 worktree，不切换或改写在用检出。开工再次核对任务编号及上游提交。
- 前置与并行：完整接入依赖 T154/T156/T157 最终接口；可先用对应合成响应开发独立表单。前端T160如修改相同API/详情组件，在本单合并后rebase再接入；不让两单各写资源/容量算法。
- 开工先读现行 AGENTS.md、本单、README、后端 docs/DEVELOPING.md 与 docs/LESSONS.md。旧任务单只用于实现追溯。
- 目标：用户在新建/基于旧任务新建时看到与实际申请一致的资源，并能区分当前足够、需要排队和无法判断。
- 依据：`autog_frontend/actions.py` 已负责固定ag argv和资源转换；`web/src/actions.tsx` 当前复制tier并只允许available节点。只读展示与计算操作模式保持现状。
- 只改新建表单，不在服务器页增加预估控件，不扩展前端已有程序支持范围。

## 允许改动的路径

- `autog_frontend/actions.py`：默认字段校验、固定只读容量调用与节点可选性；`autog_frontend/api.py`：所需本地API；`autog_frontend/monitor.py`：仅复用快照新鲜度/来源，不自行算另一套容量。
- `web/src/actions.tsx`、`web/src/api.ts`、`web/src/jobs-data.ts`、`web/src/style.css`：新建表单数据、资源和提示；可新建 `web/src/attempt-capacity.tsx` 作为该表单局部组件。
- `tests/test_actions.py`、`tests/fake_ag.py`、`tests/study_fixture.py`：合成后端；`web/tests/`：仅新建表单相关浏览器用例和合成截图。
- `README.md`、`docs/ag-monitor-1.md`：兼容能力、表单说明及 T156 新增快照字段。
- `docs/redesign-tasks/T158-new-attempt-resources.md`：本单随实现 PR 纳入；`docs/redesign-tasks/open-tasks.txt`：只处理本单条目，不覆盖其他任务。

## 要做的

1. 从 T154 的 `resources.default_tier` 获取默认：显式配置入口的新草稿与复制新建优先用默认；没配置时保留现有继承/回退行为。用户手动选择合法档位有效，刷新容量不能把手动选择重置。
2. 切换入口按目标入口规则产生新草稿资源，显示核数与调度器内存，Gaussian字段按现有80%写入（96GB对应76800MB）。不改结构、route、方法依据、原Attempt或源文件。
3. 仅通过本机已选ag的固定argv读取 T156 容量，shell=False；前端不SSH、不调用任意程序，不从分区总内存自行判断。输入参数验证与页面请求关联，防止快速切换入口/档位/节点后显示上一请求结果。
4. 展示当前容量足够/需要排队/无法判断/规格不适用；显示数据时间与来源限制，容量足够不保证立即启动。未知不新添保存/提交全局禁令；超规格或既有保护仍由ag执行。
5. 具名节点同表显示空闲/占用，保持既有priority/order；显式选择节点，保留1/2、1/4和档位映射，按T157 selectable允许已占用节点。不得自动换节点或悄悄降档。
6. 旧后端缺default_tier时按旧规则；缺新容量能力则显示能力不可用/未知，不猜值或反复执行；缺selectable按旧available规则保守处理。文档写完整能力需配套T154/T156/T157，不能只以版本号推断。
7. 容量读取不改变操作锁、提交/取消授权和等待超时不杀ag的规则。所有计算操作仍走现有ag路径。

## 不允许

- 不改范围外文件、AGENTS.md、冻结目录、版本号或 CHANGELOG；需要扩大范围时说明具体阻塞。
- 不改已有 Attempt、源文件、manifest、bundle、输入哈希、提交绑定、研究台账或科学签字。
- 不改提交授权、一次性声明、UNKNOWN 只读、确切作业绑定和共享账号额度；不自动换节点、重提、取消或迁移。
- 不做磁盘目录/配额改造、RSS/峰值监测、监控性能专项、跨机锁、PBS_NODEFILE 原文归档或已移出范围的事项。
- 不提交实际连接信息、用户名、主机、绝对路径、私有交接或研究数据；公开夹具只用合成数据。

## 测试

- 新建/复制/切入口/手动档位；默认48/96及Gaussian76800MB，原输入字节与旧Attempt不变。
- 占用节点可选、排队、禁用/受限节点、过期/未知/总量超限、原账号检查仍有效。
- 快速切换与乱序响应、局部失败、旧后端缺字段/命令的兼容；无令牌只读模式不获得操作能力。
- Python假ag断言完整argv且无shell；浏览器覆盖桌面/窄屏表单、提示和资源字段一致。
- 隔离安装实际配套后端，用合成目录完成clusters/capacity/本地prepare集成，禁止真实SSH/submit/cancel。

`.venv/bin/python -B -m unittest discover -s tests -t . -v`、`pnpm --dir web build`；首次 PR 和合并前运行 `AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test`。安装/浏览器前置按 README，不用真实 ag 提交或取消。
仅暂存本单文件，运行 `git diff --cached --check`；按本仓现行敏感扫描说明检查暂存内容、提交身份和 PR，词表缺失或检查未覆盖须如实报告。

## 真实环境验证

本单使用合成数据、假ag和隔离实际后端进行本地配套验证，不提交测试计算、不改正式服务。上线后的界面兼容观察随另行部署单记录；本PR不声称现场调度或科学验收。不得以测试需要访问真实研究目录。

## 停止条件

- 范围越界；新约束说不清防哪个具体事故；同一问题修两次仍未解决。
- 真实环境出现 UNKNOWN、哈希不一致、SSH 错误、输出异常或作业异常结束，立即停止报告，不改写命令绕过拒绝。
- 本单要求的证据不足时记录待补事项，不用离线结果冒充现场验证，不自行扩大执行权限。

## 合并前审阅与交付

- 监督方审阅必须绑定当前完整 head；读取 `<!-- ag-review head=... -->` 评论并逐项回应。
- PR 写清行为前后差异、兼容处理、相关与全量测试、实际验证版本及范围、未观察项和实际阻塞类别。
- 处理共享文件冲突时只保留本单增量，不复制一份解析或判断规则；rebase 后复核受影响行为。
- 合并由负责人完成。发布、生产配置迁移及服务操作另行安排；本单不授权这些动作。

## 当前实施阶段

- 已完成既有新建表单、默认资源、容量提示及最终节点／比例选项兼容；PR 保持 draft 等待当前 head 的独立审阅与 CI。
- 最终接口核对后端合并提交 `e109019b3028aad75fb434b5eafce1633af72aca`，包含 T154/T156/T157。
- 隔离实际 CLI 配套联调覆盖 defaults、occupied/selectable、顺序与 1/2／1/4、queue／unknown、本地 prepare、精确内存的比例准入边界，以及原输入／Attempt 字节和时间戳不变。
- 本单本地配套验证仅使用隔离安装和合成配置；禁止真实 SSH、submit/cancel、部署或服务变更。
