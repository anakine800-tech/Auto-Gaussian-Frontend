# T197：Attempt 放宽输入提醒

## 目标与分支

前端 `codex/t197-relaxed-input-notice`，一单一 PR，V4.8 W7 前端。基于 T194 后最新 main；后端字段与 T186/T188 协调一致。事故依据：用户看到已提交/正常结束会误以为方法口径已核验，或缺少跳过检查说明而将结果直接用于比较。

## 允许路径

- `web/src/attempt-facts.tsx`、`attempt-view.tsx`、`ui/attempt.css`：只读提醒与来源查看。
- `tests/results_fixture.py`、`tests/test_results.py`、`web/tests/attempt-detail.spec.ts`；可新增独立 `web/tests/relaxed-input.spec.ts` 与专用合成 fixture。
- `README.md`、`docs/redesign-tasks/T197-relaxed-input-notice.md`。

## 要做的

1. 使用统一顶层 `manifest.input_validation = {mode:'relaxed', skipped_checks:[...], method_verified:false}`；后端 T188 尚开发，字段最终形态由协调方确认。普通旧输入无该标记时保持既有显示，不推断为已核验或已放宽。
2. 对正确标记，在 Attempt 的明显位置显示“输入检查已放宽”“方法口径未核验”，列出实际保存的跳过项并可查看 manifest 来源。提醒该来源不能用于 ag scan-peak，解析/自定义基组/SCRF=Read 等原因可能使结果不能进入 ag profile；不要把“可能不支持”写成一律不可用，也不宣称底线已通过或科学验收通过。
3. 损坏、字段冲突、未知 mode、非字符串清单、method_verified=true 等不能静默显示普通/已核验。明确提示标记无法核实，保留来源供查看，不在前端修正原文件。跳过项只是文本，不渲染任意 HTML 或执行链接/命令。
4. submitted/running/fetched/failed 和缺 facts 时都按不可变 manifest 提醒，不依赖事实解析成功。保留振动完整性、现有方法/警告及跳转，不增加写操作或绕过确认。
5. 只做显示，不新增放宽输入的 GUI 编辑/开关或修改后端科学解析；T196 另做自主状态汇总，不重复实现。

## 验收与交付

使用合成数据覆盖有效放宽/多跳过项/空或错误清单/矛盾与未知标记/无标记旧Attempt/缺facts/长文本和转义；读取不改原文件，不调用真实 ag。提供桌面窄屏截图、相关 Python/浏览器测试、全量前端既有检查、构建、敏感扫描及新head CI。

改动 TS/TSX/CSS 用固定 Prettier 3.6.2，仅改动文件，不全仓重排。浏览器固定端口经协调方分配，不终止他人服务。PR首行 `Task: T197`；后端字段和组合验证尚未最终完成时保留 Draft 并如实说明，协调审阅后合并。开发对话不合并、发布、部署或运行真实计算。

## 实际后端生成物的离线组合验证

2026-10-29，使用后端 [T188 PR381](https://github.com/anakine800-tech/Auto-Gaussian/pull/381)
的干净提交 `9bbebcc527d6864c79b7fd02a37599a332c3bdac`，前端执行代码为
`7ade00e85d3be878366f0857fd827c6248f1fbcf`。核对了 Git HEAD 与实际模块导入位置；
本次仅补文档证据，不修改前端提醒实现。

在系统临时目录内直接构造合成配置，不加载本机默认配置。对象均为合成水分子，
电荷 0、多重度 1、8 核、输入内存 10 GB、合成档位内存 12 GB、walltime 00:30:00。
实际调用该后端的 `attempt.prepare` 与 `verified_files`，未调用 submit、status、fetch
或计算程序；这些资源值仅供本地输入校验，不代表任何真实入口可用性。

| 输入模式 | 完整 route 与附加内容 | 实际保存的 skipped_checks |
| --- | --- | --- |
| 默认严格 | `# HF/STO-3G SP` | 无 `input_validation` |
| 同输入显式 relaxed | `# HF/STO-3G SP` | `scientific_method` |
| Gen 显式附件 | `# HF/Gen SP`；主文件引用 `basis.inc`，显式收集的附件为 O/H 的 STO-3G 基组块 | `additional_section_semantics`、`general_basis_semantics`、`scientific_method` |
| SCRF=Read | `# HF/STO-3G SP SCRF=(PCM,Read)`；`eps=78.3553`、`epsinf=1.7778` | `additional_section_semantics`、`scientific_method`、`scrf_read_semantics` |

四例均通过以下检查：

- 严格输入保留源 GJF 字节，无 `science.sections` 或放宽 sidecar；旧形式 bundle 仅含 GJF 与 `job.pbs`，记录及哈希与原 bundle 算法一致。
- 三例放宽标记的键仅为 `mode`、`skipped_checks`、`method_verified`，值分别为 `relaxed`、上表清单、`false`。实际 sidecar 与 manifest 一致，Gen 附件字节和哈希一致，`verified_files` 重验通过。
- 前端 TestClient 读取列表、Attempt 详情及原始 manifest 来源，保留实际生成值和原始字节；四例均为 `prepared`、无 facts。所有文件在核验及读取前后的字节与 mtime 相同。
- 实际 `AttemptFacts` 组件经 SSR 构建和 React 渲染，三例显示方法未核验、每项原始跳过项、scan-peak 不可用、profile 可能不适用及来源按钮；严格输入无新提醒，不产生已核验推断。既有缺 facts 和振动完整性提示保留。
- 测试阻止默认配置读取、SSHTransport、子进程和 socket 连接；渲染阶段阻止网络连接及监听。成功运行的禁止操作调用数均为 0，无浏览器进程、无监听端口，不占用其他工单的浏览器窗口。

本次补齐的是指定 T188 head 的实际生成物到前端读取/渲染的离线组合证据。
来源按钮的点击/跳转和响应式布局沿用 T197 原有 55 项相关浏览器验证，本轮不重复启动浏览器。
T188 的自主提交集成、非研究现场验证及科学支持仍不由这些证据证明；PR58 保持 Draft，
待协调方确认，不合并、不部署、不运行真实计算。
