# T196：自主运行状态页与操作拒绝

## 分支与目标

前端 `codex/t196-autonomy-view-action-guard`，一单一 PR，V4.8 W9，以及 W3 整节点的前端能力兼容。依赖 T184 已合并数据、T186 最终动作边界；先完成只读页和假 ag 拒绝测试，组合验证接口后才可合并。

事故依据：运行中从另一会话点击 prepare/submit/cancel/fetch 导致两位推进者；未知/损坏状态被当作未启用；浏览器隐藏按钮但 HTTP 仍能操作；新增整节点元数据使旧前端严格等值解析失败，整个操作模式无法启动。

## 允许路径

- `autog_frontend/api.py`、`actions.py`、`studies.py`；可新增 `autog_frontend/autonomy.py`：安全只读呈现、服务端操作预检、能力兼容。
- `web/src/api.ts`、`main.tsx`、`routing.ts`、`study-panels.tsx`、`actions.tsx`、`attempt-capacity.tsx`；可新增 `autonomy-view.tsx` 与对应 `web/src/ui/autonomy.css`，以及现有共享样式中必要连接。
- `tests/test_actions.py`、`tests/test_study_viewer.py`、`tests/study_fixture.py`、`web/tests/actions.spec.ts`、`study-viewer.spec.ts`、`pbs-nodes.spec.ts`、`node-selection.spec.ts`、`attempt-capacity.spec.ts` 及其合成 fixture；可新增 `tests/test_autonomy.py`、`tests/autonomy_fixture.py`、`web/tests/autonomy.spec.ts`。
- `README.md`、`docs/redesign-tasks/T196-autonomy-view-action-guard.md`。不修改 AGENTS；现行手动提交/取消确认仍交 ag。

## 要做的

1. 只读显示已保存的确认计划、运行/暂停/结束、当前轮与单次唤醒区别、计数及有效期/锁状态、日志摘要、待负责人决定、放宽输入提醒。只展示实际字段，缺失/未启用/不支持版本/损坏分别表示，不能估算预算或推导科学通过。
2. 安全读取沿用目录描述符/O_NOFOLLOW 与现有 study 根边界，大小/条数有界；不读任意引用路径，不泄露运行 token 等能力凭据。若通过 ag 查询，固定 argv/shell=False，只用本机选定 ag，不执行额外子进程或网络。缺少新后端能力时旧无自主目录 study 的只读与正常手动操作可保持；已经存在自主状态但无法核验时操作拒绝，不能回退当作未启用。
3. phase=running 时 UI 和服务端拒绝 prepare、submit、cancel、fetch，提示先暂停；不能依赖 lease 当前是否占用，唤醒间隙仍属于自主运行。暂停后也不得绕过尚有效的另一持锁会话；按 T186 实际单写者语义返回明确原因，等待当前唤醒释放。结束状态按正常手动规则。
4. 服务端在请求执行边界重读状态，覆盖直接 HTTP、旧页面、连续点击、状态变化与未知状态；不能只在页面加载时或 action context 时检查。前端预检不能代替 ag 最后边界核验，T186 未就绪时明确标待集成。已启动的 ag 不因前端超时被杀掉，也不重试。只读状态/证据查看可继续。
5. 不提供启动、继续、结束自主轮次或编辑计划/规则的按钮；暂停/恢复仍由负责人在对话中使用正式 ag 操作。前端不直接写自主状态、journal、manifest、study.md 或已有 Attempt。
6. 与 T188 统一读取 manifest.input_validation={mode:'relaxed',skipped_checks:[...],method_verified:false}。本页汇总实际已有提醒，不把缺标记的普通输入猜为放宽；T197 另做 Attempt 详情。不引入第二种字段。
7. 整节点兼容：当前 actions.settings 对旧 node_targeting 字典严格等值、validate_targets 只允许两比例。支持旧 ['1/2','1/4'] 与 T185 增加 '1' 的能力响应，默认仍1/2，展示可核对的实际核/内存；任何选择仍须命中后端当前候选和资源档位。不要无条件接受任意比例、数量或缺失能力。给出旧后端/新后端两组假 ag 验证，防止部署后操作模式整体失效。
8. 改动的 TS/TSX/CSS 文件用 Prettier 3.6.2 格式化，不全仓重排。大范围格式差异给出功能差异与等价检查，便于独立审阅。

## 验收与交付

只用合成 study/假 ag；不启动真实计算、不启用实际操作服务或修改正式配置。覆盖三状态、无目录、残缺/截断/哈希不符/链接/超长日志、过期租约但仍运行、运行→暂停→结束切换、四写操作零调用断言、直接 HTTP、请求后状态变化、旧 ag 不支持、旧/新节点能力。桌面与窄屏截图、相关 Python/浏览器与全量前端既有检查、构建、敏感扫描、当前 head CI。

前端浏览器固定端口由协调方安排，不能 kill 其它任务进程。后端 T186/T185/T188 组合检出只读使用，不能把其代码带进前端 PR；由协调方提供最终 SHA 做组合测试。PR 首行 `Task: T196`。开发对话不合并、不发布/部署；操作路径由协调方独立审阅，真实试点另行授权。

## 实施记录（2026-10-29）

- 新增只读 `GET /api/studies/{study}/autonomy` 及研究导航“自主运行”。保存文件校验与白名单投影不重放后端状态机；原始自主记录不进入通用文件阅读或证据列表，大小写变体同样拒绝。
- `running` 在唤醒间隙和租约过期时仍拒绝四项手动写操作；暂停有效租约继续拒绝。已有记录在执行前由选定 ag 的 `autonomy status` 核验，并在动作启动前重读，防旧页面、直接 HTTP 和草稿准备期间的状态变化。
- 私有状态输出最多保留 4 MiB，stdout/stderr 超时后继续按固定大小丢弃并持有操作锁，不终止、不重试；原始输出不发给浏览器。无自主目录保留旧 ag 手动兼容。
- 保存计划包括已知结构化 `submission_policy`，日志只保留已知事件的有限理由、摘要与快照来源；`snapshot` 引用只显示、不读取。未知约束、事件或版本明确拒绝。T188 提醒沿用同一 `input_validation` 标记。
- 整节点兼容只接受旧两比例或新增 `1` 的三比例集合，默认 `1/2`；候选、档位、核数和内存仍核对。
- 放宽输入与 T197 对齐：只有缺少标记字段才兼容旧记录；已存在但无法核实的三字段标记提示提醒不完整。无端口回归覆盖 null、未知模式、空或错误清单与非 false 确认值，并核对 Attempt 文件字节及修改时间不变。
- T186 实际接线投影按工单与 `public()` 的保存结构接入消费、dispatch、abort、waiting、边界失败和手动接管摘要；实际消费与意图计数分开，abort 不减消费，waiting 不代表调度器排队。内部 token、writer 身份和原租约对象不返回；前端不重放消费逻辑、重算阈值或核验全机预留。

### 早期模块配对与验收边界

只使用临时合成 study、假 ag 和显式提供的隔离后端源码。已以 T184 合并提交
`8ff90e3bcf5f8b99542b2425c65fa09af6bcafb5` 的精确导出源码生成真实本地记录，
核对初始化、确认计划、轮次、两次唤醒、意图计数、暂停和结束；此项只证明保存格式兼容，
不证明 T186 原子动作边界或真实 CLI、调度器行为。可选复现入口为
`T196_BACKEND_SOURCE='<EXPORTED_BACKEND>/ag/src' .venv/bin/python -B -m unittest tests.test_actions.PairedAutonomyTests -v`。

新增 `T196_SUBMISSION_BACKEND_SOURCE` 可选配对，由 T186 实际模块 API 产生消费、dispatch、
abort、boundary failure、waiting 和 manual takeover；不手工拼 state/journal。
读取前后核对整个临时 study 与登记目录的文件清单、字节及修改时间不变，且 raw/public/GET
安全投影一致。本轮使用基于 `25c51c9d88f8a680c7bc1cbda68a09e3dabff4c3` 的开发工作区快照，
源码集合 SHA-256 为 `e43b35c7713969d4713e7b79b85eaddcc714d0bc48792433d59bb9ab128cf107`；
它包含未提交改动，仅证明该快照的本地格式联调，不能替代最终已提交 SHA 的组合验证。

取消增量绑定 T187 提交 `8465a38513aa1c4905cf096c68fc584c9f4387ee` 的完整源码导出，
不包含其工作区后续未提交修改；源码集合 SHA-256 为
`9554760f20b7e29976bbd812d97981624465b628e0890ecec0a8687dc54c9c3c`。
仅接入 `cancel_consume` / `cancel_result` 和保存的取消消费、回执、改投链路消费。
`accepted` 不表示已停止；未定终止/改投资格事件不推测或补造。
`T196_CANCELLATION_BACKEND_SOURCE` 配对通过实际 T187 API 产生 state/journal，并核对前端 GET
不改变文件清单、字节及修改时间；它与 T186 完整模块配对分别运行，当时未完成最终组合配对；最终结果见下节。

上述早期模块配对不替代最终组合。前端预检不能消除最后一次读取之后的竞争；
最终副作用保护须由 ag 执行。最终冻结组合的离线配对已通过，不作为可部署或启用声明。

改动的 TS/TSX/CSS 均使用 Prettier 3.6.2。现有紧凑文件因此有较大格式差异；
对原始基线也运行同版 Prettier 后逐项比较，确认实际功能变化集中在自主类型、导航、
状态显示、按钮保护、节点比例及相应用例。变基到包含 T194/T195 的 `91fe199` 时，
API 与主导航冲突已分别核对，保留当前研究搜索范围。
随后无冲突变基到含 T197 的 `12af407`；5 个 T196 提交的补丁内容相同，
新旧树差异精确等于 T197 上游增量。变基针对验证 54 项及 TypeScript 构建通过，
未仅为变基重复本地全套浏览器。随后按下节最终冻结来源补齐实际 API 配对，
保留早期模块配对作为其各自固定来源的回归证据。

### 最终冻结组合的离线配对（2026-10-29）

最终组合固定于以下四个来源；使用协调方完整合并后的模块，未摘录实现或手工拼接保存状态。

| 来源 | 固定提交 |
| --- | --- |
| T186 | `b8167ee74282ac3a28004969630574b8d31d5b2b` |
| T185 | `47ac89867132d5271c996f6d56183f1935011af8` |
| T187 | `80e959938c8888bf1aefe853be43ca276fd81439` |
| T188 | `9bbebcc527d6864c79b7fd02a37599a332c3bdac` |

冻结清单 SHA-256 为 `1a6634318c51fef8e0a4770129a4b867454fb90e46f38f06a99ed0be4ab06735`，
其中 36 个组合文件的哈希全部匹配。完整 `ag` 复制到独立测试目录，75 个 `ag/src/` 文件
集合 SHA-256 为 `8ef6fd7577c2675172fce9a9b5eb37a6573deda64d397dbf35939c861610114e`。
集合哈希按相对路径排序，对每项 `path + NUL + sha256 + LF` 的 UTF-8 串计算 SHA-256。
副本上级的 `source-provenance.json` 中 `all_ag_files` 保存全部 `ag/` 相对路径到 SHA-256 的映射；
配对测试核对 254 个文件与该映射一致，并在结束时复核文件清单、哈希及修改时间未变。

可选复现入口（测试环境另外提供与后端一致的 `pytest==9.1.1`）：

```sh
T196_COMBINED_BACKEND_ROOT='<FROZEN_COMBINATION>/ag' \
  .venv/bin/python -B -m unittest tests.test_actions.PairedCombinedAutonomyTests -v
```

测试直接导入完整组合中的合成 fixture，通过实际 `submit`、`autonomous_cancel`、
`verify_stopped`、`prepare_autonomous` API 生成提交消费、取消消费及回执、停止证明和改投后继。
外部调度器、时间和身份使用合成值；禁止真实配置、网络、SSH 和子进程。
每阶段比较 raw/public/reader/HTTP GET，并核对整个临时 study、配置与全机登记目录的
文件清单、字节、修改时间不变。测试也检查 accepted 时旧占用仍保留、停止证明后才允许
创建后继，原 Attempt 不重提，保存的改投链路绑定原消费。

最终定向验证共 39 项通过、0 跳过：完整组合链路配对 1 项、指向同一最终组合的
T186 保存事件配对 1 项、读取器回归 37 项；在同一解释器顺序执行以检查模块隔离恢复。
配对本身仅增加测试与说明；最终收尾另将开发阶段提示改为“具体操作仍须通过当前 ag 的授权和资源核验。”，
保留前端预检不构成动作授权的说明，生产功能和依赖未变。该单句文案的定向浏览器用例 1/1 通过（含桌面与窄屏）、Prettier 3.6.2 与 TypeScript/Vite 构建通过，
其余沿用上一生产源码 head 的浏览器 453/453 结果，未重复本地全套浏览器。公开及私有词表扫描通过。

最终组合的自主事件集合与当前读取器一致。停止证明保存于 Attempt 的独立文件，
没有新增自主事件；本页仅展示取消回执和链路消费，不能声称展示了停止证明或改投资格。
前端预检仍不替代 ag 的最终副作用边界；页面不再保留已经过时的待组合验证文案。
本次离线配对已通过，也经协调方独立执行确认；真实运行尚未授权。
这不表示真实调度器验证、部署或启用自主运行；后续验收与合并由协调方决定。
