# T132（前端）：catalog v2 只读展示——通道、候选台账与对象期望值

版本：v1（监督方，2026-10-26）。**开发机做。** 前端出一个 PR，PR 描述第一行写 `Task: T132 (frontend)`。

## 分支与目标

- 分支：`codex/t132-catalog-v2-view`。
- **开工条件：** 以前端 main（不早于 `6376dfe`，v4.5.1）为基线；后端 T131 已合并（main `21c27e1` 或其后）。字段契约以后端 `docs/ag-catalog-2.md` 为准，**本单不改契约**；发现契约有问题时停下，由监督方决定是否另开后端单。
- **目标：** 前端能读 `ag-catalog-state/2`，在研究页对象详情中只读展示通道、候选台账、期望组成与电荷、成员不一致和整体覆盖结论；`state/1` 的显示与现在完全相同。顺带修复 studies 根目录下以 `_` 开头的容器目录显示为“File not available”的问题。
- **负责人决定（10-26）：**
  - V1 只读：前端不写 catalog，不新增任何 POST 接口或 ag 调用。
  - V2 展示位置：研究页的对象详情（T121 计算链页中对象所在处）新增“通道与候选”面板。
  - V3 studies 根目录下以 `_` 或 `.` 开头的目录按容器处理，不列为 study，也不计入问题列表（`.` 开头的已经跳过，本单补 `_`）。
- **资料：** 后端 `docs/ag-catalog-2.md`（第 4、5 节字段与状态派生规则）；前端 `autog_frontend/studies.py`（`catalog` 299 起、`catalog_review_scope`、`list_studies` 275 起）、`web/src/catalog-data.ts`、`web/src/chains-view.tsx`；T121 任务单。
- **新增检查防的事故：** v4.5.x 前端遇到 state/2 时回退为“未登记”，看不到新的台账信息；在通道状态上混淆“暂定找到”和“已验证”。

## 允许改动的路径

- `autog_frontend/studies.py`：`catalog()` 支持 state/2 的校验和读取；`list_studies()` 跳过 `_` 开头的目录。
- `web/src/catalog-data.ts`：state/2 的类型与模型；`web/src/chains-view.tsx`：挂载新面板；新建 `web/src/catalog-ledger.tsx`；`web/src/ui/` 下的样式文件（如需新增，写明文件名）。
- 测试：`tests/test_catalog_view.py`、`tests/test_study_viewer.py` 中受影响的用例（PR 中逐个列出）；`tests/` 下新的合成 state/2 夹具；`web/tests/` 下新建 `catalog-ledger.spec.ts`；三尺寸截图放 `tests/catalog-fixtures/t132/`。
- 文档：`README.md` 的研究页一节；本单 `docs/redesign-tasks/T132-catalog-v2-view.md`、`docs/redesign-tasks/open-tasks.txt`。
- **不改** `actions.py`、`api.py` 的写接口、服务器页、`CHANGELOG.md`、版本号；不改后端仓库。

## 要做的

### 1. 读取与校验（`studies.py`）
- 同时接受 `ag-catalog-state/1` 和 `/2`。/1 的处理逻辑原样保留，结果逐字节不变。
- /2：在 /1 全部现有检查之外，按 `docs/ag-catalog-2.md` 逐个校验新字段的类型和取值（状态、来源、结果、归属等只能是契约列出的取值）。不合法时按现有方式回退为“未登记”并给出警告，不让页面崩溃。
- journal 哈希核对与现在相同；/2 不逐行回放 journal（与现行做法一致）。
- 未知的顶层字段或对象字段照旧忽略；未知 schema（例如 /3）显示“不支持的 catalog 版本”警告。

### 2. “通道与候选”面板（`catalog-ledger.tsx`）
- 只在对象带有 v2 字段时显示；/1 对象不显示这个面板，原有内容不变。
- **期望值**：期望组成、电荷、多重度，每项都显示状态（未提供 / 未知 / 值）；有 `member_mismatches` 时列出每条（Attempt、字段、期望、实际），提示为“只报告，未改动任何文件”。
- **通道表**：名称、定义、产物分支、状态徽标、候选数、各类结果计数。状态按契约的六个值显示中文：未尝试 / 已尝试未找到 / 暂定找到 / 已验证 / 待确认通道 / 低置信度排除。
  - **“已验证”和“低置信度排除”旁边显示负责人声明的原话和时间**（`declaration.quote`、`at`、`reason`）；
  - “暂定找到”的徽标注明“待负责人确认”，配色与“已验证”明显不同；
  - discovered 但未确认的通道注明“采样中新发现”。
- **候选台账**：每个通道可以展开，列出候选；每个候选显示来源、父结构（Attempt 链接或文件哈希前 12 位）、目标通道、登记时间、全部结果（时间、Attempt 链接、结果、归属、是否有诊断）和最新归属。“undetermined”显示为“归属不能唯一确定”，并列出候选通道。另有“未关联通道的候选”一组。
- **整体覆盖结论**：`coverage` 为 stable 时显示“在声明的通道范围与采样预算内稳定”，附 scope、budget、原话和时间；withdrawn 时显示“已撤销”。
- `transform`、`diagnosis` 只以可折叠的 JSON 原样显示，不解释。
- 页面固定文字：“catalog 是登记视图，不是科学验收；状态由登记事件派生。”

### 3. 容器目录（V3）
- `list_studies()` 跳过名字以 `_` 开头的目录，不加入问题列表；README 写明这条约定。

### 4. 窄屏
- 表格在自己的框里横向滚动，整页没有横向滚动；面板可折叠。

## 不允许

- 不写 catalog，不调用 ag，不新增网络请求（仍用现有的读取接口）。
- 不在前端重新推导通道状态；只显示 state 里的 `status`，不另算。
- 不推断化学含义，不对诊断 JSON 做评分或高亮“好坏”。
- 测试和截图只用合成数据（水、正丁烷、虚构的 TS 对象和通道），不出现真实研究对象、结构、study 名、Attempt 编号。

## 测试

| 场景 | 预期 |
|---|---|
| 现有 state/1 夹具 | 页面与 main 完全相同；API 输出逐字节不变 |
| 合成 state/2：两个通道、三个候选（scan、manual、literature 来源） | 面板显示通道表、候选台账、期望值 |
| 六种通道状态各一个 | 徽标文字正确；“已验证”“低置信度排除”显示原话和时间；“暂定找到”标注待确认 |
| 候选含 undetermined 归属 | 显示“归属不能唯一确定”及候选通道 |
| 同一候选多次结果 | 全部列出，最新归属单独显示 |
| 有 member_mismatches | 列出每条，并显示“只报告”的提示 |
| coverage 为 stable / withdrawn / null | 分别正确显示 |
| state/2 字段非法（状态取值未知、类型不对） | 回退为未登记，显示警告，页面不崩溃 |
| schema 为 /3 | 显示“不支持的 catalog 版本” |
| journal 哈希不符 | 与现行 /1 行为一致 |
| studies 根目录下有 `_archive/`、`.ag-monitor/` | 不列为 study，也不计入问题列表 |
| 窄屏 390 px | 没有整页横向滚动 |

命令：`.venv/bin/python -B -m unittest discover -s tests -t . -v`、`pnpm --dir web build`、`AUTOG_SOURCE_PYTHON="$PWD/.venv/bin/python" pnpm --dir web test`、`python scripts/scan_public.py`（带本机词表）、`git diff --cached --check`。

**截图**：`tests/catalog-fixtures/t132/`，三个尺寸（1440×860、1280×720、390×844）各两张——通道表全貌、展开的候选台账。全部用合成数据，由 `catalog-ledger.spec.ts` 生成。

## 真实环境验证（合并前，开发机）

- 用 T131 的后端在**临时非研究 study** 里生成一份 state/2（含 T131 真实验证时用过的那类事件），用本分支在临时端口（不用 8765、8773、8774）只读打开，核对面板与 `ag catalog show --json` 一致。
- 再用本分支打开现有真实 studies 根目录（只读），确认所有 /1 catalog 的显示与现在相同，`_` 开头的目录不再报“File not available”。**不点任何操作。**
- 结束后停止临时实例。PR 里只写结果，不贴真实页面截图。

## 停止条件

- 契约字段不够用，或与 `docs/ag-catalog-2.md` 不一致。
- 需要改写接口或后端仓库。
- 同一问题修两次仍未解决。

## 合并前审阅与交付

- 需要监督方审阅：页面部分**轻审**（三尺寸截图、测试结果、diff 概要）；`studies.py` 的 state/2 校验**逐行审**。合并只由负责人操作。
- PR 描述包括：V1–V3 对应的改动、契约字段逐项对照、测试表逐项结果、截图路径、真实验证记录。
- **合并后**：随 v4.6.0 部署。在 v4.6.0 部署到两台之前，真实研究 study 仍不写 v2 事件。

## 版本记录

- v1（2026-10-26，监督方）：依据 10-26 决定 V1–V3 起草；对应审计拆单建议中 T-B 的前端部分及原 C-2 顺带项。

## 开发与验证记录（2026-10-26）

- 基线：前端 main `3cb33cb`（含 `6376dfe`、v4.5.1）；后端契约/临时生成器为 T131 合并提交 `21c27e1`。分支 `codex/t132-catalog-v2-view`。
- V1：仅扩展既有 catalog 读取和显示，无新接口、网络请求或 ag 调用；保留 /1 路径与原字节。
- V2：对象计算步骤下方挂载可折叠面板；期望值、成员差异、六种状态、声明、完整候选历史、最新归属和整体覆盖均直接显示登记字段。
- V3：根目录的 `_` / `.` 容器在读取 study.md 前跳过，也不进入问题列表。
- 新样式文件：`web/src/ui/catalog-ledger.css`。不改其他页面样式；表格在自己的可聚焦滚动框内横向滚动。
- 多重度沿用契约的 nullable 正整数：null 标为“未提供 / 未知（原记录未区分）”，不虚构第二个状态字段。
- 校验只读 state 并保留原始 journal 字节哈希检查，不回放 journal、不重新派生状态/计数、不用今天的 facts 改判历史 checks。
- 两份夹具由已合并 T131 在临时非研究 study 中实际生成，只有合成水、虚构通道/Attempt 和明确标注的合成原话。候选路径使用相对文件名。

### 契约字段对照

| 契约字段 | 校验与显示 |
| --- | --- |
| schema / journal_sha256 / generated_at / objects / report_kinds | 接受 /1、/2；原始日志哈希；/2 UTC 时间；保留旧对象/报告检查；未知顶层与对象字段忽略；未知版本提示 |
| expected.formula / expected.charge | unset/unknown 对应 null；set 对应规范 Hill 字符串/整数，拒绝 bool 冒充整数；显示三态 |
| multiplicity / member_mismatches | nullable 正整数；逐条 Attempt、formula/charge/multiplicity、期望/实际；只报告 |
| channels.id/name/definition/product_branch/discovered/confirmed | ID、必需文字、nullable 分支、严格 boolean；未确认的发现来源明确显示 |
| channels.status/declaration | 六个状态直接显示；原话/时间/理由与声明枚举校验；暂定找到注明待负责人确认、与已验证区分配色 |
| channels.candidate_ids/outcome_counts | 本对象候选引用、去重、结果枚举与整数计数；不重新派生、不跨通道求总和 |
| candidates.id/file/sha256/n_atoms/formula/origin | ID、相对哈希存档路径、SHA-256、正整数、Hill 组成、六种来源 |
| candidates.parent/transform/target_channel/literature/note/registered_at | 父 Attempt/文件摘要、JSON 对象、对象内通道、DOI/SI、nullable 备注、UTC 时间；transform 折叠原样显示 |
| candidates.results | 全部 candidate-result 字段：schema/seq/at/op/prev_sha256/object/candidate/outcome/attempt/diagnosis/assignment/quote/note/checks；保留每次结果与诊断原始 JSON |
| candidates.latest_assignment | none/tentative/verified/undetermined 的通道数量与引用检查，与最后保存的结果一致；单独显示，歧义列出候选通道 |
| coverage | null 或 stable/withdrawn，原样 scope/budget/quote/at；稳定声明严格限定在给出的范围和预算内 |

### 测试环境的负责人/监督方批准

本会话先后收到“允许，继续完成验证”和监督方四项要求：仅使用与锁文件完全一致的本机工具，
不改依赖/锁文件/.npmrc；记录标准命令两次失败与实际等价命令；最终以 CI 标准命令为准；截图仍由 spec 生成入库。

已逐个核对 `web/pnpm-lock.yaml` 与实际安装包：TypeScript **7.0.2**、Vite **8.3.3**、Playwright **1.63.0**，全部完全一致。
两次 `pnpm --dir web build`（第二次带临时环境变量调整）均在构建脚本执行前失败：
`ERR_PNPM_META_FETCH_FAIL`、`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。
本机 pnpm 在运行前触发依赖重装，网络读取失败且无交互终端确认；前置离线安装另报 `ERR_PNPM_NO_OFFLINE_TARBALL`。
标准 `pnpm --dir web test` 未执行；经上述批准改用锁文件对应的 Playwright CLI。最终以 CI 的标准 build/test 结果为准。

实际等价命令如下；`$NODE` 和 `$FRONTEND` 仅替换不公开的本机可执行文件/检出绝对路径，参数不变：

```sh
# 工作目录 web
"$NODE" node_modules/typescript/bin/tsc --noEmit
"$NODE" node_modules/vite/bin/vite.js build
AUTOG_SOURCE_PYTHON="$FRONTEND/.venv/bin/python" "$NODE" node_modules/@playwright/test/cli.js test
```

构建通过，只有既有 bundle 大小提示。浏览器首次启动受沙箱本机端口限制，经执行权限放行后运行。
专项首轮功能断言通过，清理 hook 将正常 SIGTERM 误认为退出失败；已让合成服务器完成字节/mtime 核对后正常退出。

### 兼容性与本机只读验证

- Python 全量：172 项通过（60.49 秒）；原有断言未修改，只新增下列测试。
- 浏览器全量：270 项通过（5.3 分钟）；截图调整后的 T132 专项 14 项通过（20.2 秒）。
- 全仓敏感扫描：276 个文件、0 个错误、88 个二进制文件跳过；暂存区扫描及提交前路径/空白检查通过。
- 合成 /1 的完整 study API 与 main 逐字节一致；浏览器经 HTTP 读取的 /1 响应字节、展开后的计算链 DOM 均与 main 一致。
- 在不含容器目录的同一合成 /1 根目录，1440×860、1280×720、390×844 三尺寸截图与 main **PNG 字节完全一致**。
  含 `_archive` 的整页对照会按 V3 消除原警告，这是本单预期变化；未据此宣称整页不变。
- 临时非研究 study 使用 T131 写入 /1 前缀、升级期望值、两个通道、scan/manual/literature 三候选、诊断/undetermined 结果、excluded 后 cleared、覆盖声明；再扩展为六种状态。
- 使用本分支在临时端口只读打开，API state 与实际 `ag catalog show --json` 完全一致，面板通道名称/状态/数量一致；零写请求、零页面错误。
- 现用前端配置的真实 studies 根目录已在临时端口只读打开；`_` 容器不列为 study/问题，原来的一条容器问题消失。没有点击任何计算操作，没有修改研究文件。
- 该真实根目录当前没有可用的 state/1 catalog，所以真实 /1 样本对照 **不适用/缺样本**；上述 /1 字节、DOM 和像素证据均来自合成夹具，不能称为真实 /1 验证。
- 使用 18770–18773 临时端口，不使用 8765/8773/8774；全部临时实例已停止。真实页面未截图、未上传。

### 现有测试文件中的新增用例

`tests/test_catalog_view.py`：
- `test_v1_api_bytes_match_existing_snapshot_and_ignore_unknown_fields`
- `test_v2_producer_fixtures_preserve_all_fields_and_read_only_bytes`
- `test_v2_optional_values_unknown_fields_and_status_are_not_rederived`
- `test_v2_invalid_nested_fields_fall_back_without_crashing`
- `test_v2_missing_required_fields_fail_closed`
- `test_v2_hash_mismatch_and_unsupported_version_are_explicit`

`tests/test_study_viewer.py`：
- `test_container_directories_are_neither_studies_nor_issues`

`web/tests/catalog-ledger.spec.ts` 使用真实本机 HTTP 适配器和临时合成 study，
覆盖六态、历史/最新归属、声明原话、coverage 三态、非法字段/版本/哈希、容器、只读流量和窄屏。
六张截图由该 spec 生成，位于 `tests/catalog-fixtures/t132/channels-{1440,1280,390}.png` 与 `ledger-{1440,1280,390}.png`，尺寸分别为 1440×860、1280×720、390×844。

本地开发与验证完成；CI 的标准命令结果记录在 PR。当前阻塞（科学审阅）：待监督方按 PR head 逐行审阅 `studies.py` 的 /2 校验，并轻审页面、截图与验证证据；负责人合并。随 v4.6.0 部署，不单独发布。
