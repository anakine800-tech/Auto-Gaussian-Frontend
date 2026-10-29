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

状态：发布准备进行中；最终配套等待协调方提供 T178 的真实完整合并 SHA。保持 draft，未以当前后端 main 代替。
