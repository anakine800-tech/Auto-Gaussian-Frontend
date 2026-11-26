# T235 前端 v4.8.2 配套发布

## 范围

前端基线为 v4.8.1 的提交 `136c0ecd165a60c10059d7b4cc93db820c13e9d6`，也是本单开始时的 main。与后端 T234 配对发布。分支为 `codex/t235-release-v4.8.2-frontend`，PR 首行为 `Task: T235`。

更新 `pyproject.toml`、`autog_frontend/__init__.py`、`web/package.json`、Python 和浏览器自主状态合成样例中的配套版本，以及 README、CHANGELOG 和本工单。核对所有用户文档和构建入口中的版本。保留以往正式发行、部署、协议和第三方依赖的原版本。

## 验收

- Python 发行元数据、实际导入模块和网页包均为 4.8.2。README 包含同号安装、版本核对和配对后端运维入口。
- 查验 v4.8.1 至基线的 Git 差异。此次前端仅作配对发版，离线振动模式导出与具名 PBS 本地预留审计均由后端 CLI 提供。[后端 T233](https://github.com/anakine800-tech/Auto-Gaussian/pull/411)
- 使用锁定的 Python 依赖和 setuptools 84.1.0，核对 wheel 和 sdist 的元数据及隔离安装。使用 pnpm 11.19.0 冻结安装、TypeScript 检查、Vite 构建和 Chrome 全量测试。pnpm 锁文件仅记录依赖。
- 检查公开及本机私有敏感词扫描、改动范围及 PR CI。完整源码用于配套安装，网页构建、Python 包和校验值供复核。

## 真实环境验证

本单在隔离环境使用合成 study、假 ag 与测试端口。各机器的部署、监控参数和实际计算按各自的运维记录验收。
