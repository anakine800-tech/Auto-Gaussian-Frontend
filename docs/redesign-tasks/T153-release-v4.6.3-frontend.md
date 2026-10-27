# T153 — 前端 v4.6.3 配套发布准备

版本：v1.0｜日期：2026-10-27｜执行环境：开发机的隔离开发工作区
仓库：Auto-Gaussian-Frontend｜PR 描述首行：`Task: T153`
状态：版本、文档、前端离线回归及 T152 合并源码配套已完成；最终 HEAD 的 CI 和监督复核状态见本单 PR。本单执行终点为发布准备 PR 交付监督复核；不含合并、tag、Release 或部署。

## 1. 分支、目标与开工条件

- 分支：`codex/t153-release-v4.6.3-frontend`；一单一分支一 PR。
- 导入位置：`docs/redesign-tasks/T153-release-v4.6.3-frontend.md`。只导入本单，不提交工单包说明或私有验证附件。
- 先读本仓 AGENTS.md、本单、README，以及后端 docs/DEVELOPING.md、docs/LESSONS.md；使用独立工作区，不切换运行中的前端检出。
- 编制时前端 main：`a65e4854c219cc819533fdfd6699080ee6b68a96`；已发布 v4.6.2 的提交：`d41dd8e99323542bc5f845929a239dd5ec9e9070`。
- 编制时后端 main：`8011bccce078439cc8c80bd0790ec532c40d1a04`，含 T148–T150；后端发布准备由 T152 独立负责。
- 可以先按上述前端 main 准备版本与文档。最终配套验收及本单交付应等待负责人合并 T152，使用其真实完整合并 SHA，不能以 T149 的旧合并 SHA 或浮动 main 代替。
- 开工重新核对 main、未合并 PR、任务编号与 v4.6.3 tag/Release。新增基线内容须证明仍在清单内；不能证明时停止报告，不覆盖他人工作。
- 防止的实际问题：Python 元数据、网页包与 runtime 版本不一致；旧待办和重启描述误导使用者；配套测试仍验证旧后端，遗漏发布候选之间的差异。

## 2. 负责人已决定与默认安排

负责人已选择配套 v4.6.3，本次包括 D01（前端运行时版本统一）、D04（已完成待办清理）及共同重启说明澄清，没有待补答的范围问题。

开发会话收到执行指示后按本单实现、测试并交付 PR；负责人合并，发布和部署仍分别按后续明确指示执行。两张发布单各一个 PR，不复用 T151 的已合并分支。T152 合并后最终配套，再审阅 T153；未来两个 tag 必须指向各自确切发布合并提交。

## 3. 允许改动的路径

| 路径 | 允许内容 |
|---|---|
| `pyproject.toml` | 仅项目版本改为 4.6.3 |
| `autog_frontend/__init__.py` | 仅 `__version__` 从历史 4.0.0 改为 4.6.3 |
| `web/package.json` | 仅项目版本改为 4.6.3 |
| `README.md` | 当前版本、配套与发布状态、已解决问题及版本核对 |
| `CHANGELOG.md` | 只新增 v4.6.3 段；旧版本段落逐字保留 |
| `docs/redesign-tasks/T151-monitor-retry-feedback.md` | 仅下述第 6 项文字澄清与追加修订记录 |
| `docs/redesign-tasks/T153-release-v4.6.3-frontend.md` | 本单及实际验收记录 |
| `docs/redesign-tasks/open-tasks.txt` | 移除已完成 T146、T147，保留文件约定与其他有效事项 |

共 8 个允许文件。现有 pnpm 锁文件不记录项目根版本，本次不修改锁文件、依赖、CI、功能源码、测试代码、AGENTS.md 或后端仓库。本单状态写入本单与 PR，不把已合并 T151 重新列为待开发。

## 4. 实施内容

### 4.1 同号版本与发布清单

核对 `git log v4.6.2..HEAD --first-parent`，本仓功能增量仅为：

| 已合并任务 | PR / 合并提交 | 发布说明必须保留的边界 |
|---|---|---|
| T147 | [#46](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/46) / `aa8f2cfcfe3829f76b349fd584aa8f811ffdaba7` | Slurm 只用实际 Idle、Other 单列，矛盾/缺失资源保持未知；notes 去重；拒绝不加速轮询；过期计划显示等待下一轮；暂停文案修正 |
| T151 | [#47](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/47) / `a65e4854c219cc819533fdfd6699080ee6b68a96` | 基于明确能力追踪同一入口/来源/请求；匹配终态立即结束快速轮询；旧后端保留四键兼容并明确结果未精确确认；重启不误报未执行，不自动重新登记 |

将 Python 项目元数据、运行时 `__version__`、网页包版本统一到 4.6.3。只改现有常量；不新增版本服务、接口、构建注入机制或永久测试。

新 CHANGELOG 说明配套后端为 4.6.3，含 T148 监控准确性、T149 追踪/重读及 T150 新输入资源补齐。新输入补齐由 ag 执行，前端不自行补写旧 Attempt，也不因此新增任何自动操作。

README 顶部、Release status、版本核对与版本历史新增入口同步；当前已知问题中的 T147 五类修复和 D01 版本例外删除或改成已解决。串行采样/睡眠恢复、冷启动成本、未移除的依赖 override 等仍保留。旧 CHANGELOG 与版本历史中的旧事实不批量替换。

### 4.2 两仓共同说明的最小修正

仅把 T151“共用字段约定”第 6 项逐字替换为下面一段，与 T152 修改后的 T149 一致；其余共同字段块原文保留：

> 6. queued/running：后三项为 null，reason 为 null。finished：真实采样及快照发布完成后写入，finished_at、sampled_at 非空、ok 为本轮真实布尔值、reason 为 null。discarded：本条追踪请求已终止，不再继续处理或重放；finished_at 非空，sampled_at/ok 为 null，reason 必须为上述具体原因；不是作业取消。auth_confirmation_required、entry_removed、config_changed 表示待处理请求未执行。monitor_restarted 表示监控已重启，本次请求结果尚未确认；重启前已为 running 时可能已经查询，但没有可确认的发布完成结果，不能据此断言从未执行。

T151 追加一条由 T153 澄清语义的版本记录；保留原 v1.1 增量验收记录。页面当前文案已经正确，不修改 UI、适配层、状态枚举、字段、CLI 或 `docs/ag-monitor-1.md`。不能借本单重做 T151。

T152 合并后提取两张旧工单从“共用字段约定”标题到下一个同级标题前的完整块，逐字比较；把比较方法、双方 SHA 与结果写入本单验收和 PR。不另建协议/合同文档。

### 4.3 现状、发布与回退说明

说明这是发布准备，功能已合入但运行检出/服务未因合并自动更新。只有后续获准的同号 tag 和实际部署验收，才可记录对应机器已升级。

当前版本核对不再沿用 runtime 4.0.0 例外；使用 Python 包元数据、实际导入模块和网页包版本。现有部署备份、回退、节点绑定及 catalog 不可降级规则保留，不新增或转移 study，不凭历史发布文字判断当前机器是否已经验收。

## 5. 本单不做

不新增 UI 功能、HTTP 权限、直接控制文件写入、远程查询、自动重新登记或重试；不改变轮询上限、默认只读、来源/路径保护与 ag 操作方式；不新增打包框架或升级任何依赖。

不做 G02、C01/C02、D02/D03，不调整真实节点、资源、SSH、调度器或服务配置。不改任何 study、Attempt、manifest、catalog、研究数据或静态参考截图。

不合并、不推 main、不建 tag/Release、不部署或重启真实服务，不连接集群、不提交/取消计算。研究机维护复用既有计划，目标版本和窗口以后决定。

## 6. 离线验收与最终配套

使用 README/CI 约定的隔离环境和现有锁定依赖，测试只使用临时合成 study、假 ag/Transport 与本地临时服务。端口只用于隔离测试，不复用正式服务或真实 study 根。构建产物和测试截图不进入本 PR。

建议命令（在本单工作区执行；占位符须替换）：

```sh
.venv/bin/python -B -m unittest discover -s tests -t . -v
pnpm --dir web build
AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test
T151_BACKEND_SOURCE='<T152_MERGE_EXPORT>/ag/src' .venv/bin/python -B -m unittest tests.test_server_monitor.PairedBackendTests -v
```

`<T152_MERGE_EXPORT>` 必须是由已核对 T152 实际合并 SHA 导出的隔离源码；依赖真实本地 CLI 的现有配套测试仍注入假配置、假 Transport 和临时缓存，不读取正式配置，不运行正式 watch。记录实际 import 来源，不能把环境变量设置成功当作测试执行成功。

| 验收项 | 通过标准 |
|---|---|
| 三处版本 | 隔离安装的 `importlib.metadata.version("autog-frontend-readonly")`、实际模块 `__version__`、pyproject 和网页 package.json 均为 4.6.3；记录导入来源 |
| Python | 现有全量通过；默认 CI 中可选配套项跳过不算配套已验收 |
| 类型与构建 | 现有 build 内的 TypeScript 检查与生产构建通过，无依赖或锁文件改动 |
| 浏览器 | 全量 Playwright 通过；包含 T147、T151、四/五卡、PBS 节点、Slurm、既有研究/证据页面回归 |
| 实际后端配套 | 上述 PairedBackendTests 在 T152 合并 SHA 上实际执行，不能跳过；旧四键调用、新追踪、请求关联、四类丢弃与不造假快照沿用现有覆盖 |
| 重启与迟到状态 | 既有 running → monitor_restarted 用例通过，显示“监控已重启，本次请求结果尚未确认”，立即结束快速轮询，无自动重新登记；结果超时不伪报完成 |
| 文档与范围 | 两仓完整共同字段块一致；旧 CHANGELOG 段原样；过期 T146/T147 登记清理；仅表内 8 文件 |
| 安全与最终 CI | 有效本机词表全量/暂存扫描零命中、空白检查和 noreply 身份通过；最终 PR HEAD 的仓库必要 CI 全绿 |

版本检查采用现有环境的一次性检查，不为常量新增测试文件。推送前完成上述全量一次；之后按最终 HEAD CI 与实际增量决定复验。最终配套的任一端相关内容变更或 rebase 冲突影响到验证对象时，重新核对并补受影响检查，不沿用旧 SHA 结果。

若本地环境不能运行浏览器，可据同一最终 HEAD 的完整 CI 结果记录，并明确本地未运行原因；不能把失败/受限记为本地通过。配套测试因默认 CI 无后端而跳过时，仍须另交实际运行证据。

扫描采用本仓现有 `scripts/scan_public.py`，确认私有词表有效，执行全量与 `--staged` 扫描及 `git diff --cached --check`；不打印词表或匹配的私有内容。仅暂存本单文件。

## 7. 真实环境验证

本单不做真实环境验证，明确写“仅离线合成、构建和发布候选配套验证；未进行真实服务重启、集群验证或计算”。

后续部署按后端 OPERATIONS 和对应机器既有私有维护安排，核对实际加载版本、服务器页、一次获准的重新采样反馈及原有入口。不得为触发 monitor_restarted 或认证暂停而主动制造真实故障；已有合成用例是本单证据，现场观察另记。

## 8. 停止条件与交付

T152 未合并时可以先准备本仓内容，但不得声明最终配套完成。需要修改范围外源码/依赖/测试；旧/新后端兼容不符；共同字段有实际差异；编号/tag 冲突或额外 main 增量；同一问题两次仍未解决；误触真实环境或发生真实异常，均保存证据并报告。

PR 提交前端准确基线、最终 HEAD、T152 实际合并 SHA、逐项验收证据、运行/跳过的区别、字段块比较与扫描结果。读取并处理监督意见，无评论不等于批准；监督方按最终 HEAD 复核，负责人合并。

未来发布交接记录两仓实际发布合并 SHA、各自版本与 CHANGELOG 段；不得预填不存在的提交号。部分发布或单仓升级不能宣称配套部署完成。

## 9. 版本记录

- v1.0：准备前端 v4.6.3 发布单；纳入 T147/T151、D01/D04 清理及重启说明同步；最终配套依赖 T152 实际合并提交。


## 10. 实施与验收记录（2026-10-27）

### 基线与准备阶段状态

- 隔离分支：`codex/t153-release-v4.6.3-frontend`，基线 `a65e4854c219cc819533fdfd6699080ee6b68a96`；运行检出和真实服务未改动。
- `v4.6.2` 对应 `d41dd8e99323542bc5f845929a239dd5ec9e9070`。第一父链仅有 T147 #46 和 T151 #47，与第 4.1 节清单一致；开工时前端无未合并 PR，两仓均无 v4.6.3 tag/Release，未发现 T153 冲突。
- 准备阶段阻塞（环境/发布依赖，已于 2026-10-28 解除）：当时 T152 尚未合并，本阶段没有执行最终字段块比较或实际后端配套，也未创建 PR；未以 T149 或当时 main 替代。实际合并后的验证见第 11 节。
- 三处常量统一为 4.6.3；README/CHANGELOG 更新发布范围与当前状态；T151 仅替换共同字段块第 6 项并追加 v1.2 记录，原 v1.1 增量验收保留；open-tasks 仅删除 T146/T147 两行。

### 已完成的离线检查

| 项目 | 命令或方法 | 实际结果 |
|---|---|---|
| 版本和安装来源 | 独立 `.venv`，锁定 requirements 与 setuptools 83.0.0，`pip install --no-deps --no-build-isolation .`；`python -I -B` 一次性检查 | 元数据、实际安装模块、pyproject、网页包均为 4.6.3；安装导入来自该 `.venv/lib/python3.13/site-packages/autog_frontend/__init__.py`，普通测试导入来自本工作区 `autog_frontend/__init__.py`；完整本机路径只保存在私有日志 |
| Python 全量 | `.venv/bin/python -B -m unittest discover -s tests -t . -v` | 189 项：188 通过、独立配套项跳过 1；该跳过不算 T152 配套通过 |
| 类型与生产构建 | `pnpm --dir web build`，pnpm 11.19.0 | 通过；保留现有大于 500 kB 的 chunk 提示，未扩大范围调整构建 |
| 浏览器全量 | 一致源码临时副本中运行 `AUTOG_SOURCE_PYTHON=<本工作区隔离 Python> pnpm --dir web test` | 335 项全部通过（5.9 分钟）；包括 T147/T151、running → monitor_restarted、超时及迟到终态、四/五卡、PBS 节点、Slurm、研究/证据与跨页 HTTP 集成回归 |
| 文档与范围 | 与基线按原始字节比较历史段；逐文件核对 diff | 恰好 8 个允许文件；旧 CHANGELOG、旧版本历史原样；T151 除指定第 6 项及追加记录外原样，锁文件、依赖、功能源码及测试未改 |

环境：Python 3.13.13、Node.js 24.22.1、pnpm 11.19.0。最初 PATH 的 pnpm 为 11.25.0，安装后已用指定 11.19.0 重新执行 frozen-lockfile 安装、构建与浏览器命令；未改变锁文件。

全量浏览器测试使用本工作区的逐文件哈希一致临时源码副本及同一生产构建，副本独立执行 frozen-lockfile 安装。这样隔离既有 catalog 截图用例写出的文件，不覆盖工作区中的静态参考图；未修改测试代码。首次链接依赖的启动尝试在 pnpm 环境检查阶段失败，未开始测试；改为副本独立安装后重新运行，完整重跑 335 项通过。该环境启动失败记录与成功日志均仅留在本机，不将未启动尝试记为测试通过。

本机私有词表存在、非空且所有正则有效；全量扫描 305 文件、暂存扫描 8 文件均零命中（全量另跳过 105 个二进制文件），空白检查通过，author/committer 均为 noreply。逐字节核对工作区静态参考图未变化；浏览器源码快照与工作区的实现、测试、锁文件输入仍一致，之后仅追加本单验收文字。

完成前复核：前端 main 仍为 `a65e4854c219cc819533fdfd6699080ee6b68a96`，后端 main 仍为 `8011bccce078439cc8c80bd0790ec532c40d1a04`；T152 尚未合并，未以该后端 main 执行配套。

仅离线合成、构建和发布候选配套验证；未进行真实服务重启、集群验证或计算。本准备阶段未合并、未建 tag/Release、未部署；未提交/取消计算，未修改任何真实 study、Attempt、manifest 或 catalog。该阶段未使用未合并的 T152 进行配套；下一节记录解除依赖后的实际结果。

## 11. T152 合并后的最终配套（2026-10-28）

### 准确提交与字段块

- GitHub 后端 PR [#350](https://github.com/anakine800-tech/Auto-Gaussian/pull/350) 的 REST 记录为 `merged: true`、`state: closed`，合并时间 2026-10-28 00:48:33（Asia/Shanghai）。实际 `merge_commit_sha` 为 **`e24a5bd1d9045e3b783d8ef25f02e430ad4dc3c5`**；其父提交分别为原 main `8011bccce078439cc8c80bd0790ec532c40d1a04` 和 T152 HEAD `ca0a333ccfb38097200aa7d25fd2aab0d0174b1e`。后者不作为本次配套基线。
- 前端验证提交：`334bf4258784b2202350064d60723b3b474789b4`，基于 `a65e4854c219cc819533fdfd6699080ee6b68a96`。恢复执行时远端 main 仍是该基线，无其他未合并前端 PR，v4.6.3 tag/Release 未占用。此后仅补本单验收记录；实现、测试、依赖、锁文件及共用字段块未变，最终交付 HEAD 在 PR 中记录。
- 使用 `git show <后端完整合并SHA>:docs/redesign-tasks/T149-monitor-retry-reload.md` 与 `git show <前端完整SHA>:docs/redesign-tasks/T151-monitor-retry-feedback.md` 读取两个固定提交的原始字节。以包含“共用字段约定”的 `###` 标题为起点，在下一个 `###` 标题前结束；包含标题、全部条目、换行和尾部空行，不做 trim、空白或 Unicode 规范化。
- 两块各 **3,879 字节**，直接字节比较相等；共同 SHA-256：**`85c3d228fd3d2e9f09c3d14386f2e697e0ad8552986d0bdc80d17403a6de770b`**。第 6 项与本单指定替换原文一致；其余块内容保留。最终提交补记完成后再次按固定提交检查，结果在 PR 记录，不新增协议文档。

### 实际源码配套与导入核验

后端源码由 `git archive --format=tar e24a5bd1d9045e3b783d8ef25f02e430ad4dc3c5 ag docs/redesign-tasks/T149-monitor-retry-reload.md` 导出到独立临时目录；仅通过 `T151_BACKEND_SOURCE=<该导出目录>/ag/src` 注入现有 `tests.test_server_monitor.PairedBackendTests`。没有安装/部署后端或改变真实检出；没有把浮动 main、T149 旧合并提交或 T152 分支 HEAD 当作来源。

在同一测试进程中使用 unittest loader/runner 实际执行该类，断言 `testsRun == 1`、成功且 `skipped == []`，然后记录 `sys.modules` 中的导入路径并与该合并提交的 blob 逐字节核对：

| 导入模块 | 实际来源（导出目录相对路径） | 文件 SHA-256 |
|---|---|---|
| `ag` | `ag/src/ag/__init__.py` | `18a99186471aa22aa9182a3532258bf3e43a63ae00c47c8aeb1a6809404a29ac` |
| `ag.cli` | `ag/src/ag/cli.py` | `fa83f03a445479deb182896404b24d49d348845977eb13dd7c59098218f60fb3` |
| `ag.monitor` | `ag/src/ag/monitor.py` | `9f3468f66ad1255e49bcde6425f92f7ea12837ca9f393cfc2a7716e4e9b314c6` |

**1 项实际执行通过、0 跳过（1.521 秒）**，实际后端 `__version__ == 4.6.3`。完整路径与原始日志只保存在本机，公开记录仅写相对来源和哈希。

现有用例使用临时合成配置、假 Transport 与本地临时缓存；CLI 仅调用实际 `--version`、`clusters --json`、`monitor --retry`，配置加载被替身注入，不读取正式配置，不启动正式 watch。验证包含 legacy/named 来源、新追踪固定参数、queued/already_queued/in_progress 标识关联、真实本地采样发布与 finished、四种 discarded 且快照字节不变、入口移除后控制状态可读，以及旧四键调用兼容。

### 验收矩阵与交付边界

| 验收对象 | 本次采用的证据 |
|---|---|
| 版本、Python 全量、TypeScript/构建、浏览器全量 | 第 10 节实际结果；重新核对测试/实现/锁定依赖输入未变，只有本单验收文字追加。隔离安装四个版本读数再次全部为 4.6.3 |
| 新前端 + 旧后端调用形态 | 已有全量假 ag/浏览器回归：四键响应及无法精确确认提示，不自动回退重登记 |
| 新前端 + T152 合并源码；旧四键调用 + T152 合并源码 | 上述 PairedBackendTests 实际执行通过，0 跳过；不以默认 CI 的可选项跳过代替 |
| running → monitor_restarted、超时、迟到状态 | 第 10 节 335 项全量中的既有用例通过；未确认文案、立即停止快速轮询、无第二次登记及普通轮询接受迟到匹配终态 |
| 文档与范围 | 完整共同块字节一致；旧 CHANGELOG/版本历史原样；只改允许的 8 文件，无静态参考图或源码/测试/锁文件增量 |
| 安全与最终 CI | 有效本机词表全量、暂存扫描及空白/noreply 复核；最终准确 HEAD 的必要检查 `frontend-python`、`frontend-web` 及监督评论状态在 PR 更新，不借用旧功能 PR 的绿灯 |

配套依赖已解除，无实现或离线验收阻塞；交付仍须最终 HEAD 的必要 CI 全绿，监督方按该 HEAD 复核。无评论不等于批准；合并由负责人完成。**仅离线合成、构建和发布候选配套验证；未进行真实服务重启、集群验证或计算。** 未合并、未建 tag/Release、未部署，未提交/取消计算；不产生新的真实 study/catalog 写入授权。
