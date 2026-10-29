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
