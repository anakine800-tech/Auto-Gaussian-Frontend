Task: T177

# T177：前端 v4.7.0 配套发布准备

## 分支与目标

- 仓库 Auto-Gaussian-Frontend，分支 `codex/t177-release-v4.7.0-frontend`，一个隔离工作树、一个 PR；首行 `Task: T177`。规划基线 fa48ab1a0c0d669233a189bb5457b143d07dd798。
- 用户要求全部遗留处理后准备发版；协调方按新增功能采用前后端同号 v4.7.0。此单只准备版本、文档和发布验证，不创建 tag/Release、不部署。先读本仓 AGENTS/README、后端 DEVELOPING/LESSONS、本单及 T153 作为现有发布验证范例。
- v4.6.3 后前端功能为已合并 T158 #49、T160 #50。重新核对实际 main、PR/版本未占用；不要把旧界面目录当成本仓。

## 允许改动的路径

- `pyproject.toml`、`autog_frontend/__init__.py`、`web/package.json`：仅版本改为 4.7.0。
- `README.md`：当前版本、配套和准确已知边界；历史版本记录保留。
- `CHANGELOG.md`：只新增 v4.7.0，历史段原样。
- `docs/redesign-tasks/T177-release-v4.7.0-frontend.md`（本单）、`docs/redesign-tasks/open-tasks.txt`：本任务状态与实际验收。

## 要做的

1. 核对 v4.6.3..HEAD 的真实合并清单与 T158 新 Attempt 档位/资源、T160 CREST 诊断显示，说明不改旧 Attempt、取回/解析仍由 ag、失败与缺证据分开；不宣称 frontend 能生成或查看新增 Hessian 功能。
2. 三处版本和安装元数据一致，README/CHANGELOG 准确标“发布准备”。后端配套由 T178 负责，等待其最终真实合并 SHA 后运行实际配套检查。可并行准备文字和前端离线检查，不能把当前后端 SHA 当最终候选。
3. 发版前一次全量跨页面浏览器回归，覆盖现有服务器、研究、结果、证据和本批新功能。只用隔离合成数据、假 ag、临时本地服务；不接生产服务/配置或集群。构建/截图留临时输出，不覆盖已跟踪静态参考图。
4. 发现真实回归保留失败证据并报告协调方，不能重跑到绿或改时间阈值掩盖；修复需要另单或明确范围扩展。历史排除的短时测试波动不自动升级为产品事故，但本次必需验证不得谎报通过。

## 测试和交付

- 复用已锁依赖；各工作树独立环境。`python -B -m unittest discover -s tests -t . -v`；`pnpm --dir web build`；`AUTOG_SOURCE_PYTHON=<本树解释器> pnpm --dir web test`。记录实际 Python/源码导入位置、完整 head、命令和通过/失败/跳过。
- 最终实际后端 T178 合并源码导出供现有 `T151_BACKEND_SOURCE` / PairedBackendTests；用合成配置/假 Transport，核对 testsRun 与 skipped，默认 CI 跳过不算配套通过。后端/前端相关内容后变更则补受影响验证，不无意义重复全量。
- 隔离安装核对包元数据、实际模块、pyproject 与网页 package.json 全为4.7.0。版本常量不另加测试。暂存仅7文件，现有有效私有词表全量/暂存扫描、diff --check、noreply 身份核对。
- 不改依赖/锁文件/功能源码/测试代码/CI/AGENTS/真实配置，不改后端。不推 main，不创建 tag/Release，不重启或部署服务，不操作研究数据。
- 纯版本/文档无新增真实集群验证；后端各功能实际现场结论由后端说明。独立审阅+最终 CI后交协调方合并；用户已授权本批合并，执行会话不自行合并。最终配套尚缺时保持 draft。

## 实施与验收记录（2026-10-29）

状态：版本、文档和前端一次完整离线回归完成；最终配套等待协调方提供 T178 的真实完整合并 SHA。保持 draft，未以当前后端 main 代替。

### 基线、来源与范围

- 开工核对远端 main 为 `fa48ab1a0c0d669233a189bb5457b143d07dd798`；正式运行检出干净且未修改。T177 分支及 v4.7.0 tag/Release 未占用，前端无其他打开的 PR。
- `v4.6.3..main --first-parent` 仅有 T158 #49（`d09868c43a6131cb8ea6452cb132a0e5a6d34d04`）和 T160 #50（`fa48ab1a0c0d669233a189bb5457b143d07dd798`），两项 GitHub PR 均为 merged。
- 本次完整离线验证源码提交为 `43fe6f421d327335e9d287b947f4e505917462e8`。后续仅调整 README/CHANGELOG 的当前 CREST 现场边界及追加本单验收；功能实现、测试、版本、依赖、锁文件输入不变，未无意义重跑全量。交付准确 HEAD 记录在 PR。
- 协调方 2026-10-29 的 T159 最新复核确认：旧普通 PBS 与 Slurm 正式取回兼容已满足原任务最低要求；所用相关代码 blob/AST 与已验证执行源核对相同。保留早前 PBS 失败，不宣称新集合、mdopt、不完整取回或真实错误诊断已现场通过；补强方案不追加为原工单强制门槛。本单没有执行这些现场操作。
- 严格七个允许文件。三处版本文件除 4.6.3 → 4.7.0 外逐字不变；旧 CHANGELOG、旧版本历史逐字保留。open-tasks 保留 T177，因为最终实际配套未完成。

### 已完成的离线验证

环境为 Python 3.13.13、Node.js 24.22.1、pnpm 11.19.0；使用独立 `.venv`、setuptools 83.0.0 和现有 requirements/pnpm 锁定依赖。原 PATH 的 pnpm 11.25.0 与首次离线缺包仅发生在准备环境阶段，没有执行产品测试；就绪指定版本后使用 frozen-lockfile 安装，锁文件未改。

| 检查 | 实际命令／方法 | 本次结果 |
|---|---|---|
| 隔离安装 | `python -m pip install --no-deps --no-build-isolation .`；`python -I -B` 核对安装 | 元数据、实际模块、pyproject、网页 package.json 均为 4.7.0；安装导入为该独立 `.venv/lib/python3.13/site-packages/autog_frontend/__init__.py` |
| Python 全量，一次 | `.venv/bin/python -B -m unittest discover -s tests -t . -v` | 205 项：203 通过、2 跳过，82.363 秒；源码导入来自本工作树 `autog_frontend/__init__.py` |
| 类型／生产构建，一次 | `pnpm --dir web build` | 通过；保留既有大于 500 kB chunk 提示，未改阈值或构建设置 |
| 浏览器全量，一次 | `AUTOG_SOURCE_PYTHON=<本树解释器> pnpm --dir web test` | 362 项全部通过，0 失败、0 跳过，6.0 分钟；1 worker、retries=0，原有超时阈值不变 |
| 范围及静态图 | 323 个跟踪文件的 SHA-256 清单，测试前后核对 | 实现、测试和锁文件相同；工作树静态参考图无变化，截图仅写临时副本／测试输出 |

两项 Python 跳过分别是 `tests.test_server_monitor.PairedBackendTests` 与 `tests.test_actions.PairedResourceTests`，因为没有提供其指定的实际后端环境。**两项均不计作本次最终配套通过。**

浏览器源码由上述完整提交导出，开始前 323 个文件逐项 SHA-256 与工作树一致，并独立安装冻结依赖。测试使用同一独立 Python，实际前端模块来自临时副本的 `autog_frontend/__init__.py`；完整解释器与导入绝对路径仅存本机日志。只启动 18765–18769 临时回环测试服务，使用合成 study 与假 ag，结束后释放；未读取生产配置或研究数据。

覆盖既有服务器四/五卡、PBS/Slurm、重试／迟到状态、研究、结果、证据、报告阅读、构象及振动、跨页实际本地 HTTP 集成；也包含 T158 默认档位、手选保留、容量未知、节点/比例与旧 CLI 路径，以及 T160 四种诊断状态、哈希不符、缺来源、惰性读取、分页及移动端。另目检本次合成的窄屏资源表单与桌面诊断来源截图。临时副本的六张既有 T132 参考 PNG 被测试更新，工作树原图逐字节不变，不提交生成图。

### 最终配套与交付状态

- 等待协调方提供 T178 **真实完整合并 SHA** 后，核对 GitHub merged 记录并从该提交导出实际后端源码；按现有 `T151_BACKEND_SOURCE` / PairedBackendTests 实际运行，记录 testsRun、skipped、模块来源和后端版本。当前后端 main、分支 HEAD 和历史功能配套均不替代。
- 本次有效私有词表已确认存在、非空且正则有效；全量扫描 323 文件（110 个二进制跳过）、暂存扫描 7 文件均零命中，`git diff --check` 与 author/committer noreply 核对通过；交付前再核对最终暂存内容。
- 最终准确 HEAD 的 CI、独立审阅及配套未齐前保持 draft，不自行合并。前后端相关内容若再变，补受影响检查。
- 仅离线合成、构建和发布候选配套验证；未进行真实服务重启、集群验证或计算。未创建 tag/Release、未部署、未推 main；未修改研究数据、旧 Attempt 或生产配置。
