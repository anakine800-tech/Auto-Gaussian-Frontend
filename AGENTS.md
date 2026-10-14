# Auto-Gaussian-Frontend 开发提示

开发前先读后端的 [DEVELOPING.md](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/DEVELOPING.md) 与 [LESSONS.md](https://github.com/anakine800-tech/Auto-Gaussian/blob/main/docs/LESSONS.md)，再读本仓库 README 和本次任务说明。

- 默认只读：读取本机 study 和监控快照；操作模式必须由人显式开启。
- 产品运行时的计算操作只能通过本机选定的 `ag` 执行，固定 argv、`shell=False`；不连服务器，不调用 ag 以外的子进程。开发测试使用假 ag。
- 不直接修改已有 Attempt、manifest、status、journal 或 study.md；新计算由 ag prepare 创建新 Attempt，状态和结果更新交给 ag。unknown/failed_presubmit 不提供重提入口。
- 提交和取消的人工确认留在 ag；前端等待超时不杀 ag、不重试，操作锁保持到 ag 自己退出。
- 路径按目录描述符逐级用 `O_NOFOLLOW` 打开，拒绝穿越、符号链接和非普通文件；草稿以 `O_EXCL | O_NOFOLLOW` 独占创建，不只靠字符串前缀检查。
- 测试只用临时合成 study、合成小分子和假 ag；脱敏样例保留真实输出形态，不导入研究数据，不启动真实计算。
- 一张任务单、一个 `codex/<任务名>` 分支、一个 PR；只改任务允许路径，PR 描述第一行写 `Task: Tn`。
- 监督方评论首行是 `<!-- ag-review head=... -->`；用 `gh pr view <编号> --comments` 读取，逐条处理并回复。涉及 remote/submit/cancel/status（包括前端操作接入）或 AGENTS.md 的改动，合并前等监督方审阅；AGENTS.md 修改需负责人明确批准。
- 冲突在本地 rebase 解决，不用网页编辑器；合并只由人操作，不直接推 main，不改分支保护。
- 提交前敏感扫描并检查 Git author/committer 使用 noreply 邮箱；文档、PR、样例不含真实主机名、路径、用户名、作业号或凭据。
- 真实环境验证在合并后另行授权并单独记录；CI 通过不等于实际计算或科学验收。新经验记后端 LESSONS，每周合并重复条目。
