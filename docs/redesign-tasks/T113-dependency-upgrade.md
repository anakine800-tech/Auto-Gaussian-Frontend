# T113：前端依赖安全升级（Vite、source-map-js、certifi、setuptools）

版本：v1（监督方，2026-10-24）。**开发机做。** 前端出一个 PR，PR 描述第一行写 `Task: T113 (frontend)`。

## 分支与目标

- 分支：`codex/t113-dependency-upgrade`。
- **开工条件：** 以前端 main（不早于 T122 合并后的提交）为基线。不改功能代码，可以和其他单并行；锁文件如有冲突，以最新 main 为准重新生成。
- **依据：** 2026-10-24 19:29（北京时间）的 Dependabot 只读复查：前端 15 条 open 警报，按公告去重为 9 条，与 10-23 手动核查一致；`remark-gfm` 及其传递依赖没有命中公告；后端 open 为 0。
- **负责人决定：**
  - D1 本单放进 v4.5.0。
  - D2 升级到首个修复版本，不跨到更新的大版本：

    | 包 | 当前 → 目标 | 用途 |
    |---|---|---|
    | Vite | 8.3.1 → 8.3.3 | 开发 / 构建 / 测试 |
    | source-map-js | 1.2.1 → 1.2.2 | Vite → PostCSS 传递依赖，只改锁文件 |
    | certifi | 2026.7.22 → 2026.10.19 | 测试依赖链（httpx）引入 |
    | setuptools | 82.0.1 → 83.0.0 | 跨大版本，只影响打包 |

  - D3 setuptools 一起升。如果升级后构建或打包失败，**不硬修**：把它从本单拆出来，在 PR 里写明失败现象，另开小单处理，其余三项照常合并。
  - D4 不改任何功能代码。

## 允许改动的路径

- `web/package.json`、`web/pnpm-lock.yaml`。
- 先核实 certifi 和 setuptools 的版本**实际锁定在哪里**（`pyproject.toml` 的版本范围、CI 工作流的安装步骤，或其他约束文件），只改实际锁定版本的那一处，在 PR 里写明。
- 本单 `docs/redesign-tasks/T113-dependency-upgrade.md`、`docs/redesign-tasks/open-tasks.txt`；`README.md` 只在写有版本号的地方改。

## 要做的

1. Vite：在 `package.json` 改为 8.3.3，用仓库指定的 pnpm 版本重新生成锁文件。确认 source-map-js 随之解析为 ≥ 1.2.2；没有的话，用 pnpm 的 overrides 精确限定，并在 PR 里说明。
2. certifi、setuptools：按核实的结果，在实际锁定的位置改到目标版本。
3. **锁文件差异核对**：对比升级前后的 `pnpm-lock.yaml`，列出所有版本有变化的包。只应出现 Vite、source-map-js 和它们必要的传递依赖；出现别的变化时逐个说明原因，说明不了就停下。
4. 升级后再查一次 Dependabot 对应的公告，确认这 9 条都已经覆盖到。

## 不允许

- 不改功能代码、测试逻辑、构建配置（除非 Vite 补丁版本明确要求，并在 PR 里说明）。
- 不升级 D2 以外的包，不跨大版本（setuptools 按 D3 处理）。
- 不关闭或忽略 Dependabot 警报（合并后由 GitHub 自动关闭）。

## 测试

| 场景 | 预期 |
|---|---|
| Python 测试 | 全部通过 |
| 浏览器测试 | 全部通过 |
| TypeScript 检查与 Vite 构建 | 通过；构建产物大小与升级前相近（写出前后数值） |
| setuptools 83 下的打包（CI 现有的打包步骤） | 通过；不通过就按 D3 处理 |
| 锁文件差异 | 只涉及要做的第 3 条列出的范围 |

推送前本地跑 Python 测试、浏览器测试和构建各一次，之后以 CI 为准；同时运行 `python scripts/scan_public.py` 和 `git diff --cached --check`。

## 真实环境验证

- 不需要。合并后开发机重建前端，两个常驻服务各重启一次，打开几页自查。

## 停止条件

- 锁文件出现说明不了的版本变化；需要改功能代码；同一问题修两次仍未解决。

## 合并前审阅与交付

- 监督方**轻审**：看锁文件差异清单、测试结果和 9 条公告的对照。合并只由负责人操作。
- PR 描述包括：每个包的升级前后版本、版本实际锁定的位置、锁文件差异清单、公告对照、测试和构建结果；setuptools 如按 D3 拆出，写明原因。
- **合并后：** 开发机重建前端，重启两个常驻服务；Dependabot 自动关闭对应警报后，在 PR 里补一句"open 警报已归零"（或列出剩下的）。

## 版本记录

- v1（2026-10-24，监督方）：依据 10-23 手动核查和 10-24 Dependabot 复查起草。

## 实施记录（2026-10-24）

- 基线：前端 main `5d060c7`，已包含 T122 合并；分支为 `codex/t113-dependency-upgrade`。
- certifi 实际锁定于 `requirements.lock.txt`；setuptools 实际同时锁定于
  `pyproject.toml` 的 build-system 和 `.github/workflows/frontend-offline.yml` 的两个安装步骤。
  因 CI 使用 `--no-build-isolation`，只改 build-system 无法升级 CI 的打包器，需同步更新现存精确版本；
  README 只改对应的 setuptools 安装版本。没有新增约束文件。
- 使用 Node.js 24.19.0、pnpm 11.19.0；Python 本地为 3.12.14，CI 保持 3.13.13。
- setuptools 83.0.0 下原 CI 的 `pip install --no-deps --no-build-isolation .` 已成功构建并安装 wheel；
  `pip check` 通过，未触发 D3 拆单。Python 全量 160 项通过。
- Vite 8.3.3 的 rolldown 依赖范围从 `~1.2.9` 提高为 `~1.2.11`，原锁定 1.2.10 已不满足；
  pnpm 解析为 1.2.15。该版本精确依赖 `@oxc-project/types@0.155.0` 与同版平台 binding。
  PostCSS、React、remark-gfm、TypeScript、Playwright 及其余包保持原锁定版本。
- 范围补充（负责人在本次会话于 2026-10-24 确认：“允许这两行配置（推荐）”）：
  仅在 `web/pnpm-workspace.yaml` 增加 `overrides: { source-map-js: 1.2.2 }` 两行配置。
  pnpm 11 已不读取 package.json 的 pnpm 字段；按批准增加覆盖后，source-map-js 精确解析到 1.2.2。
- 最终锁文件共 19 个包版本变化，全部属于 Vite、source-map-js 及 Vite 必要传递依赖；无其他版本变化。
- 本地验证全部通过：Python 160 项、浏览器 240 项、TypeScript 检查、Vite 构建及 setuptools 83 打包；
  `pip check`、公开扫描及扫描器 5 项自测通过。PR/CI、监督方轻审与负责人合并待完成。
  合并、重建常驻前端、重启两个服务及 Dependabot 自动关闭核对留待人工合并后执行。

### 最终锁文件版本差异

| 包 | 升级前 | 升级后 | 原因 |
|---|---|---|---|
| `@oxc-project/types` | 0.151.0 | 0.155.0 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-android-arm-eabi` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-android-arm64` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-darwin-arm64` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-darwin-x64` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-freebsd-x64` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-arm64-musl` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-x64-gnu` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-linux-x64-musl` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-openharmony-arm64` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `@rolldown/binding-win32-x64-msvc` | 1.2.10 | 1.2.15 | rolldown 1.2.15 精确依赖 |
| `rolldown` | 1.2.10 | 1.2.15 | 满足 Vite 新范围 `~1.2.11`，原版不满足 |
| `source-map-js` | 1.2.1 | 1.2.2 | 工单指定安全修复 |
| `vite` | 8.3.1 | 8.3.3 | 工单指定安全修复 |

### 九条公告对照

升级后再次查询，main 尚有 15 条 open 警报、去重为 9 条公告。
下列目标均达到对应首个修复版本，且已核对不在受影响范围内；未关闭或忽略警报。
setuptools 的警报归在 requirements.lock.txt，但该文件没有 setuptools 条目，实际精确锁定位置见上文。

| 公告 | 包 | 受影响范围 | 首个修复版本 / 本次目标 | 对应警报 |
|---|---|---|---|---|
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | vite | `>= 8.3.0, <= 8.3.2` | 8.3.3 | `4`, `11` |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | source-map-js | `>= 1.0.0, < 1.2.2` | 1.2.2 | `9` |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | vite | `>= 8.3.0, <= 8.3.2` | 8.3.3 | `3`, `10` |
| [GHSA-6q48-6c7w-9gw2](https://github.com/advisories/GHSA-6q48-6c7w-9gw2) | certifi | `>= 2019.03.09, < 2026.10.19` | 2026.10.19 | `2` |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | vite | `>= 8.3.0, <= 8.3.2` | 8.3.3 | `8`, `15` |
| [GHSA-h35f-9h28-mq5c](https://github.com/advisories/GHSA-h35f-9h28-mq5c) | setuptools | `< 83.0.0` | 83.0.0 | `1` |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | vite | `>= 8.3.0, <= 8.3.2` | 8.3.3 | `5`, `12` |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | vite | `>= 8.3.0, <= 8.3.2` | 8.3.3 | `7`, `14` |
| [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) | vite | `>= 8.3.0, <= 8.3.2` | 8.3.3 | `6`, `13` |

### 构建产物比较

同一源码基线、Node.js 与 pnpm 版本，仅依赖变化。`pnpm --dir web build` 同时包含 TypeScript 检查。

| 产物 | 升级前（字节） | 升级后（字节） | 差值 |
|---|---:|---:|---:|
| JavaScript | 606,755 | 606,621 | -134 |
| CSS | 48,486 | 48,486 | +0 |
| SVG | 244 | 244 | +0 |
| HTML | 539 | 539 | +0 |
| 合计 | 656,024 | 655,890 | -134（−0.0204%） |

Vite 输出的主 JS gzip 大小为 192.47 → 192.46 kB。
两次构建均出现同一条大于 500 kB 的分块提示；构建成功，不调整构建配置。
