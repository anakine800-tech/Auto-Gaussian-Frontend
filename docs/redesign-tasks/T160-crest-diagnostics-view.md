# T160：CREST 错误摘要、片段与完整本地日志查看

## 分支与目标

- 仓库：Auto-Gaussian-Frontend；分支：`codex/t160-crest-diagnostics-view`；PR 首行 `Task: T160`。
- 规划基线：前端 `19bc0c9fe31abdc37beb77602c70a2f83068d472`。开工读本仓 AGENTS.md、README、后端现行 DEVELOPING.md/LESSONS.md 和本单。
- 目标：在 CREST Attempt 详情默认展示 T159 的错误摘要，可展开相关 stderr 片段，并能继续查看完整本地日志；不触发取回、重算或远程操作。
- 依赖：可以用合成夹具先开发独立展示；最终接口和联调须基于已合并 T159。T158 先合并；本单触及 `api.py`、`studies.py`、`web/src/api.ts` 等共有文件时再 rebase，不同时改资源表单。
- 现状：`AttemptFacts` 只显示 `error_hint` 等字符串；`Studies.attempt` 与 `log_parts` 仅支持 `.log/.out`，Slurm 固定 `.err` 文件尚不能通过同一分页入口打开。
- 防的事故：原始 stderr 被当作已证实根因；链接指向另一日志或不同字节；扩展错误日志展示时放开任意本地文件。

## 允许改动的路径

- `autog_frontend/studies.py`、`autog_frontend/api.py`：本 Attempt 错误诊断读取、固定日志名、分页及来源核验；复用现有描述符路径检查。
- `autog_frontend/crest_diagnostics.py`（可新建）：仅本功能的结构/来源适配，不调用 ag 或计算库。
- `web/src/attempt-facts.tsx`、`web/src/attempt-view.tsx`、`web/src/api.ts`：详情接入及类型。
- `web/src/crest-diagnostics.tsx`（新建）、`web/src/style.css`：摘要和片段折叠展示；样式只限定本组件。
- `tests/test_attempt_detail.py`、`tests/test_crest_diagnostics.py`（新建）、`tests/study_fixture.py`；`tests/fixtures/crest-diagnostics/`（新建）：合成来源、读取边界。
- `web/tests/attempt-detail.spec.ts`、`web/tests/crest-diagnostics.spec.ts`（新建）：浏览器行为与布局。
- `README.md`、`docs/redesign-tasks/T160-crest-diagnostics-view.md`、`docs/redesign-tasks/open-tasks.txt`。

## 要做的

1. 消费 T159 最终合并的可选 `facts.crest_diagnostics`：`summary`、`status`（`identified` / `unresolved` / `none` / `unavailable`）、`sources` 中 outputs 白名单文件、SHA-256 和 1 基行范围。此处是两单共同约定，字段最终修订须同步本单，不自行维护另一套错误规则。
2. 默认仅显示摘要及“错误证据／原因未明确／未发现匹配错误／错误输出不可用”等准确状态。`identified` 不标成“根因已证明”；非空 stderr 和一般 warning 不自动染成计算失败。
3. 展开时按来源读取有界片段，显示文件名、行范围、截断信息和来源是否匹配；空、缺失、不支持、读取失败或哈希不符分别提示。哈希不符不得展示成原诊断的命中证据，也不得改写 facts。
4. 复用本地分页日志读取器开放固定的 `job.slurm.err`，并保留 `job.pbs.out` / `job.slurm.out`。只允许本 Attempt `outputs` 下真实普通文件；不因 facts 里的路径开放任意文件，不开放通用 `.err` 文件系统浏览。
5. “查看完整日志”进入现有分页文本查看，完整文件仍留本地；沿用现有文件/行大小边界，超限解释原因，不在首屏加载全文。日志按纯文本转义，禁止 HTML/脚本执行。
6. 错误片段不能串到 Gaussian 振动或优化解析；普通日志选择、定位和页面后退继续可用。没有新字段的旧 facts 继续显示旧 `error_hint`，说明没有结构化来源；不要求用户先刷新事实才能看原详情。
7. 保持所有查看操作只读，不调用 ag、不触发 SSH、fetch、facts refresh、retry 或计算操作。只读模式与操作模式均可查看已有日志。

## 不允许

- 不修改 `actions.py` 或新建任务资源逻辑；不扩大 POST 操作，不改令牌、确认、锁或超时规则。
- 不修改 study、Attempt、facts、输入和日志；不读取源字段中的任意绝对路径或越界路径。
- 不增加依赖、版本号、部署脚本或服务器页控件；不导入真实研究夹具或截图。

## 测试

- Python：正常/空/缺失错误输出，旧 facts、新字段不完整、非法类型、跨 Attempt、穿越、符号链接替换、特殊文件、哈希不符、越界行范围、超大文件和超长行；所有读取前后文件字节与 mtime 不变。
- 浏览器：摘要默认可见、展开/收起、匹配来源定位、完整分页、未知与失败提示、HTML转义、移动/桌面布局、只读模式不出现修复/重试操作；保留普通日志搜索与振动选择。
- 合成后端样例来自 T159 最终字段，不在前端重实现诊断。T159 合并后用其真实代码在临时合成 study 产生 facts，再验本地 API/页面，明确这不是现场计算验收。
- 命令按已核实 README：`.venv/bin/python -B -m unittest discover -s tests -t . -v`；`pnpm --dir web build`；`AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test`。
- 首次开 PR 和合并前跑全部浏览器测试；中间复测按影响范围加构建，rebase 引入额外改动时扩大复测。提交前运行本仓敏感扫描、`git diff --cached --check` 并检查 Git 身份和 PR 文本。

## 真实环境验证

- 本单不连接集群、不提交测试计算、不改变生产服务。合并前完成隔离合成数据与 T159 实际后端输出配套检查。
- 实际研究目录页面观察按本仓规则在合并后另行授权；没有观察就不写“现场通过”。T159 的远程取回证据由 T159 单独交付，不由前端截图替代。

## 停止条件

- T159 字段与本单约定不一致且不能在已允许范围适配；需要范围外文件、新依赖或增加计算操作。
- 需要放宽路径/文件检查；同一问题修两次仍未解决。真实环境意外立即报告。

## 合并前审阅与交付

- 需要监督方审阅；不修改 AGENTS.md。报告前端实际 HEAD、T159 配套提交、合成样例、关键截图、测试结果及未覆盖项。
- T159、T158 先合并，本单再合并；不把未合并开发 HEAD 写成正式支持版本。
- 用 `gh pr view <编号> --comments` 处理绑定 HEAD 的审阅意见；本地 rebase，合并由负责人操作。发布和部署不在本单。
