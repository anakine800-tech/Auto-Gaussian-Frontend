# T179：前端构建依赖 setuptools 安全更新

## 分支与目标

- 仓库 Auto-Gaussian-Frontend，分支 `codex/t179-frontend-setuptools-security`；从最新 main（规划基线 fa48ab1a0c0d669233a189bb5457b143d07dd798）新建隔离工作树，一单一 PR，首行 `Task: T179`。
- 先读本仓 AGENTS/README、本单、后端 DEVELOPING/LESSONS。
- T177 发布推送发现 Dependabot #16，GHSA-xmj3-9gf7-h52w。当前 pyproject、CI 与安装说明固定83.0.0；上游受影响范围>=38.2.2,<84.1.0，84.1.0已修复Windows legacy wheel namespace_packages.txt路径越界。没有发现本机被利用；macOS测试不能冒称Windows漏洞复现通过。
- 来源：https://github.com/pypa/setuptools/security/advisories/GHSA-xmj3-9gf7-h52w 和 https://github.com/pypa/setuptools/releases/tag/v84.1.0 。核对补丁版本与Python3.11–3.13兼容。

## 允许改动的路径

- `pyproject.toml`：仅 build-system.requires 中 setuptools 从83.0.0精确更新84.1.0，产品版本由T177管理。
- `.github/workflows/frontend-offline.yml`：仅现有两处安装setuptools版本到84.1.0，不增删检查、不改权限。
- `README.md`：仅当前构建依赖说明和安装命令两处83.0.0到84.1.0，旧发布历史不改。
- `docs/redesign-tasks/T179-frontend-setuptools-security.md`（本单）、`docs/redesign-tasks/open-tasks.txt`：自己的记录。
- 当前 `requirements.lock.txt` 实际没有setuptools，勿为了告警路径显示而添加新运行时依赖。若重新核查有其他当前有效pin，列出确切文件及必要性报协调方后再扩范围。

## 要做的与不允许

1. 核对当前依赖图/实际固定位置，仅更新构建工具，不升级其他库、不改运行时代码/前端UI/测试/锁文件，不dismiss安全告警或弱化扫描。
2. 新隔离venv按84.1.0安装/构建本包；核对实际setuptools/产品元数据和模块来源、wheel内容、CLI帮助及现有离线测试。不得替换生产venv或重启服务。
3. 以明确补丁版本解除受影响pin。可静态核对上游补丁的路径检查；不为此连接Windows/研究机或执行真实恶意输入，不把macOS验证称Windows现场验证。
4. T177已完成原依赖下全量浏览器；本单因构建依赖改变仍完成本仓首次PR必需验证，之后T177整合保留结果的版本/源码对应，不无理由再反复跑全量。

## 验证与审阅

- 现有全量Python、TypeScript/生产构建、全量Playwright一次（隔离合成源码副本，假ag，临时回环服务，参考图不覆盖）。对比升级前后的wheel文件清单和入口，实际安装元数据检查与 `pip check`；如果上游发行移除所用接口，停止并报告，不降级回受影响版本掩盖。
- 扫描真实有效私有词表及暂存差异，diff --check、noreply身份。记录实际head、环境、通过/失败/跳过；默认可选后端配套跳过仍不算配套通过（T177负责最终配套）。
- 纯构建依赖，不需要真实集群验证。不连接集群、不运行化学计算、不部署、不tag/Release、不改AGENTS/冻结目录或生产配置。
- 独立审阅、当前CI通过后交协调方按用户本批授权合并。T177再rebase本单并补最终后端配套和受影响核对；本单不自行合并。合并后协调方只读核查Dependabot是否更新，不手动关闭仍真实存在的告警。


## 执行记录（2026-10-29）

- 基线为最新 `main`：`fa48ab1a0c0d669233a189bb5457b143d07dd798`，独立分支为 `codex/t179-frontend-setuptools-security`。
- 现行固定位置只有 `pyproject.toml` 1 处、CI 2 处、README 2 处，全部精确更新为 `84.1.0`。历史工单和 CHANGELOG 中的 `83.0.0` 保留为历史记录。
- `requirements.lock.txt` 未包含 setuptools；运行依赖、网页锁文件、产品代码、测试与产品版本 `4.6.3` 均未变。T177 的 `4.7.0` 发布变更另行 rebase 整合。

### 上游与兼容范围

- [上游安全公告](https://github.com/pypa/setuptools/security/advisories/GHSA-xmj3-9gf7-h52w)列出受影响范围 `>=38.2.2,<84.1.0`，修复版本为 `84.1.0`。
- [84.1.0 发行](https://github.com/pypa/setuptools/releases/tag/v84.1.0)与 [PyPI 元数据](https://pypi.org/project/setuptools/84.1.0/)已核对；`Requires-Python: >=3.10` 覆盖本包 `>=3.11,<3.14`。本地实际执行 Python `3.13.13`，没有冒称实跑 3.11/3.12 矩阵。
- 静态核对[该版本 wheel.py](https://github.com/pypa/setuptools/blob/v84.1.0/setuptools/wheel.py)：`_resolve_namespace_dir` 先验证各点分模块组件为标识符，再校验规范路径位于目标目录；`_fix_namespace_packages` 使用此函数。新环境安装源码也含同一检查。
- 没有执行恶意 wheel，也没有连接 Windows；本轮 macOS 安装和测试不作为 Windows 漏洞现场复现。

### 本地验证

测试从同一基线加上述 5 处替换的临时源码副本执行，保留逐文件 SHA-256 对照。测试生成的参考图和报告仅写入副本，开发工作树原有文件字节保持不变。完整待审 head、CI 和独立审阅结果在 PR 登记。

| 检查 | 实际结果 |
| --- | --- |
| 环境 | macOS 26.6.2 x86_64；Python 3.13.13；Node 24.22.1；pnpm 11.19.0；Chrome 156.0.8078.73。CI 仍使用原定 Node 24.19.0。 |
| 独立打包 | 分别新建 setuptools 83.0.0 / 84.1.0 环境，以 `pip wheel --no-deps --no-build-isolation` 构建基线/更新后的包，均成功。 |
| wheel 对照 | 两者均为 `autog_frontend_readonly-4.6.3-py3-none-any.whl`；23 个文件条目一致，18 个产品模块、METADATA 与入口字节一致；只有 WHEEL 的构建器版本与 RECORD 校验值变化。未新增 UI 打包资源，仍采用既有显式 UI 构建目录。 |
| 实际安装 | 新环境 `pip install --no-deps --no-build-isolation .` 成功；`python -I -B` 确认 setuptools 84.1.0、产品 4.6.3 和模块来自该环境的 site-packages；CLI 入口保持 `autog-readonly = autog_frontend.__main__:main`，`autog-readonly --help` 与 `pip check` 通过。 |
| Python 全量 | `python -B -m unittest discover -s tests -t . -v`：205 项，203 通过、2 跳过、0 失败（93.898 秒）。跳过的是未提供独立后端源码的资源/监控配套项，不算配套通过；由 T177 完成最终配套。 |
| TypeScript / 生产构建 | 冻结锁安装后 `pnpm --dir web build` 通过；保留既有大于 500 kB 分块提示，无构建错误。 |
| Playwright 全量 | `pnpm --dir web test`：362 项全部通过（6.5 分钟），一次全量、单 worker、无重试；合成 study、假 ag 和临时回环服务。 |
| 敏感扫描 / 身份 | 扫描器自测 5 项通过；使用已验证有效的本机私有词表，全量 323 文件及暂存 5 文件扫描均 0 命中（全量 110 个二进制文件按既有规则跳过）；人工审阅本单文本差异，`git diff --check`、暂存差异与 author/committer noreply 核对通过。 |

升级前 wheel SHA-256：`c9dd226534d1515a1639b479b49d9770e8366ab947e072f55edb3145de3aa07e`。
升级后 wheel SHA-256：`87f32578edfeb29f4647a575a7369294748a0ab8ba9530b1bc22a1471247198b`。

本单不连接集群、研究数据或 Windows，不提交计算，不部署、重启、打 tag 或创建 Release。执行会话不合并；当前 head 的独立审阅和 CI 通过后由协调方按本批授权处理。Dependabot 的最终状态由合并后只读核查，不手动关闭真实告警。
