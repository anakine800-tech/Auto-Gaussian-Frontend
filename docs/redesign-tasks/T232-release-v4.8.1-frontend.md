# T232 前端 v4.8.1 配套发布

## 目标与范围

以 `b2dee2a5d85e2cc1c02915c04bdd9bac8ebfe9f9` 为基线，与后端 T231 配对发布。更新 `pyproject.toml`、`autog_frontend/__init__.py`、`web/package.json`、`README.md`、`CHANGELOG.md` 及本工单。检查 `tests/autonomy_fixture.py`、`web/tests/autonomy.spec.ts` 的合成版本字段：表达本版的样例同步，专门覆盖旧版的样例保留其语义。分支 `codex/t232-release-v4.8.1-frontend`，一个 PR，首行 `Task: T232`。

## 验收

- Python 包、运行时和网页产品版本均为 4.8.1，安装与配套后端链接指向同一版本；逐项检查 UI、锁文件、发行说明及用户看得到的当前版本信息。
- 说明本次前端是后端补丁的配套发布，归入本仓已合并的许可变化。保留旧版许可分界与真实部署记录；本版的发布与现场升级分别记录。
- 核对 wheel、sdist 的元数据、冻结锁文件的网页构建、Python 与浏览器测试、私有词表及公开扫描、diff 和本次 PR 的 CI。合并前由协调方对照两仓正式版本与变更范围审阅。

## 真实环境验证

本单变更版本、样例和说明。在隔离目录使用测试入口，使用假 ag；本单的验证不需要现场计算或正式服务。

## 版本与验证来源

两份自主状态样例随测试生成合成计划，均采用配套 ag 4.8.1。页面的 ag 版本取自该计划保存的字段。网页产品版本来自 `web/package.json`，pnpm 锁文件仅记录依赖版本。旧发布、部署与配对实测记录保留其原版本。

Python 构建使用 setuptools 84.1.0。网页使用 pnpm 11.19.0 按冻结锁文件安装，并执行 TypeScript 检查和 Vite 构建。隔离安装、Python 与 Chrome 全量测试的结果及 CI 见本单 PR。
