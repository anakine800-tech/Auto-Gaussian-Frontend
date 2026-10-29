Task: T181

# T181：v4.7.0 前端发布状态文档收尾

## 目标与范围

从前端已发布提交 `f9c8143d4b30ff912140bcc4e2e931373754a84c` 创建独立工作树和 `codex/t181-v470-published-status` 分支，一单一 PR，描述首行 `Task: T181`。
只修改 `README.md`、`CHANGELOG.md` 与本任务单，共三个文件；修正当前发布、配套和部署状态，不新增交接文档或延期待办。
产品源码、版本、依赖、锁文件、测试、CI、AGENTS、T177 历史执行记录和 v4.6.3 及更早历史段保持原字节。

## 已核对的状态（2026-10-29）

- [前端 v4.7.0 Release](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/releases/tag/v4.7.0) 固定于 `f9c8143d4b30ff912140bcc4e2e931373754a84c`，[T177 #51](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/51) 已合并。
- [后端 v4.7.0 Release](https://github.com/anakine800-tech/Auto-Gaussian/releases/tag/v4.7.0) 固定于 `d2e6308e5f15964c363549d98e16239806650eb1`，[T178 #372](https://github.com/anakine800-tech/Auto-Gaussian/pull/372) 已合并。
- 两仓 2026-10-29 正式发布；最终独立审阅与 CI 通过，资源与监控两项实际后端配套均通过、0 跳过。后续文档提交不替代发布 tag，不移动 tag。
- 本机开发环境已按两个 tag 部署并验收：前后端元数据／runtime 与网页包均为 4.7.0，前端 setuptools 84.1.0；网页构建、五卡显示、三个 HTTP 200 检查通过。研究机尚未更新，不能泛化为所有机器已部署。
- 依据既有只读发布与部署核验记录整理脱敏摘要；具体机器、路径、账号、配置及原始输出只留私有记录。T177 与 tag 内发布准备文字是历史阶段记录，保持原样。

## 验证与交付

- 语义及链接核对：当前入口写已发布，两个完整发布 SHA 与已有证据一致，开发环境与研究机状态分开。
- 比较发布基线：仅三个允许文件变化；README 的 v4.6.3 及更早历史条目、CHANGELOG 的 v4.6.3 及更早章节、T177 工单及其余跟踪文件逐字节不变。
- 按仓库首次 PR 要求，在独立源码副本运行构建与全部现有浏览器测试；只用合成 study、假 ag 和临时回环服务，截图不写开发工作树。未修改 Skills，不新增测试。
- 确认本机私有词表有效后做全量和暂存扫描，核对 `git diff --check`、暂存范围及 author/committer noreply；最终 head 的既有 CI 和独立审阅结果记于 PR。
- 不做 T175/T157 额外现场补验，不开展新远程集群查询或计算，不改运行检出、不部署或重启；执行会话只提交分支和 PR，不自行合并。

## 执行结果（2026-10-29）

- README 顶部、英文 Release status 和 v4.7.0 历史入口已改为正式发布；CHANGELOG 只修 v4.7.0 状态，并给原 T177 范围说明加历史标签，原文仍保留。两 tag 核验、开发机既有入口回归与私有计划观察期、研究机维护窗口及独立验收条件保留。
- 四份既有发布／部署记录的日期、完整 SHA、版本和验收摘要核对通过；新增的 10 个 Markdown 链接目标核对通过。此项只读既有证据，不新增现场调用。
- 322 个非 README／CHANGELOG 的原有跟踪文件与发布基线逐字节相同；两份文档的 v4.6.3 及更早历史后缀相同。运行检出仍干净且停留发布 tag。
- 独立 Python 3.13.13 环境安装成功，`pip check` 通过，前端元数据／runtime 4.7.0、setuptools 84.1.0 和实际导入来源已核对。Python／网页锁文件与复用依赖的既有安装逐字节相同，依赖复制到独立环境。
- Node.js 24.22.1：按 package.json 的原命令执行 `node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vite/bin/vite.js build`，均通过，仅保留原有大 chunk 提示。首次 pnpm 入口因复制环境的自动依赖检查要求重建目录而在构建前退出；记录保留，随后直接执行同一已锁定工具，不改仓库配置或锁文件。
- 完整浏览器回归一次：设置独立 `AUTOG_SOURCE_PYTHON` 后执行 `node node_modules/@playwright/test/cli.js test`，362 通过、0 失败、0 跳过，6.0 分钟；单 worker、retries=0。仅临时副本内六张既有 T132 PNG 被测试生成，开发工作树全部参考图字节不变。后续只补文档措辞，产品／测试输入未变，未重复回归。
- 扫描器自测 5 项通过；有效本机私有词表全量 325 文件／暂存 3 文件均零命中（全量按既有规则跳过 110 个二进制文件），`git diff --check`、暂存差异与 noreply 身份核对通过。未修改 Skills；本地不重复 Python 产品全量，交既有 CI 执行。
- 本次没有重新执行两个实际后端配套或部署验收；其已通过结论引用发布证据。当前文档 head 的完整 SHA、CI 和独立审核结果在本 PR 记录，交协调方处理合并。
