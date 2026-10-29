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
