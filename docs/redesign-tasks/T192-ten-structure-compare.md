# T192：十结构对比与来源复用

## 分支与目标

- 前端仓库，分支 `codex/t192-ten-structure-compare`；最新 main，一单一 PR。
- V4.8 W9 的独立功能。比较篮目前上限六项，结构叠合目前上限三项；统一支持最多十个结构，第十一个明确拒绝。
- 基线 `e6e72b20f1ab19acc2b6e8e4c13dac7b3cc0c766`，开工再核对。

## 允许改动的路径

- `web/src/compare-basket.ts`、`web/src/compare-tray.tsx`、`web/src/compare-page.tsx`：数量、恢复、选择与布局。
- `web/src/structure-comparison.tsx`、`web/src/quick-comparison.ts`、`web/src/quick-comparison-panel.tsx`：结构对比、来源加载和局部错误。
- `web/src/geometry-alignment.ts`、`web/src/ui/compare.css`、`web/src/molecule-layout.css`：必要的参考结构选择和多行/窄屏适配。
- `web/tests/compare-page.spec.ts`、`web/tests/frames-compare-capacity.spec.ts`、`web/tests/evidence.spec.ts`：合成回归。
- `tests/test_frames_compare_capacity.py`、`tests/ensemble_fixture.py`、`tests/results_fixture.py`、`tests/analysis_fixture.py`：仅支持本功能合成夹具。
- `README.md`、`docs/redesign-tasks/T192-ten-structure-compare.md`：功能说明与工单。

负责人补充授权：允许最小范围同步 `web/tests/shell-progress.spec.ts` 的容量断言和 `web/src/help-page.tsx` 的容量说明（2026-10-29）。

## 要做的

1. 比较篮、URL/sessionStorage 恢复、比较页和通用对比组件共同支持最多十项。第十一项由交互明确拒绝；超量历史链接/缓存明确说明截断，不能静默扩容或重复计数。
2. 几何对比参考结构可选；更换参考后对齐和 RMSD 一致更新。兼容既有默认参考和已有采用来源/方法口径警告。
3. 单项文件缺失或加载失败只影响该项；其余仍可查看，不把缺失当零。方法/组成/电荷等不兼容时保持既有比较限制。
4. 相同实际来源去重请求和解析，避免十个对象引用相同 opt/freq/sp 时重复加载。不要引入新的全局缓存框架。
5. 多行布局、横向数据表和窄屏可操作；选项文字不能遮住结构。保留原有 IRC 三卡的显示、选择语义和布局，不把所有使用三项的地方盲目替换成十项。
6. 仅格式化新文件和实际改动的文件；不做全仓重排。若需要新增格式化依赖，先报告最小方案与影响，不顺带升级依赖。

## 不允许

不改后端、能量计算口径、AGENTS、提交操作、运行服务；不引入真实 study、真实日志或新增计算。

## 测试

- 合成用例覆盖 2/3/6/10/11 项，URL 与 sessionStorage 恢复、重复来源、单项失败、参考切换、窄屏、旧 IRC 三卡。
- 按当前 README 运行必要 Python 单元测试、`pnpm --dir web build`；首次 PR 与合并前全量浏览器测试，后续仅受影响回归且满足仓库前提。测试用假 ag、独立合成目录与不冲突端口。
- 提供桌面与窄屏实际截图作功能验收，敏感扫描、暂存差异检查及 noreply 身份检查。

## 真实环境验证

只读前端功能，用合成 study 离线验收；不启动真实服务、不读取研究目录、不连接集群。

## 停止条件

需要范围外修改、同一问题两次未解决，或需要改变已有科学口径时先报告。

## 合并前审阅与交付

PR 首行 `Task: T192`。写清十结构行为、失败隔离、请求复用和 IRC 兼容的验证。协调会话审阅最终 head 和 CI 后按负责人授权合并；开发会话不合并。

## 本单实现与离线验收（2026-10-29）

- 比较篮、恢复和结构选择共用十项上限；第十一项拒绝，URL/缓存超量明确提示，重复 ID 不占名额。
- 每轮按实际来源 Attempt 读取和解析一次，采用层与结构卡复用同一结果；刷新重新读取，不建立跨页面全局缓存。
- 几何参照可切换，对齐与 RMSD 使用同一结果；首项缺几何时选择下一个完整几何。失败项保留错误与未知值，其余结构仍可查看。
- 桌面多行、窄屏单列；原 IRC 三卡布局和选择保持。方法/组成/电荷及能量口径未改变。
- Python 全量：`python -B -m unittest discover -s tests -t . -v`，205 项，203 通过、2 项跳过；跳过的是未提供独立后端源码的既有配套资源/monitor 测试。
- `pnpm --dir web build` 通过；Node 24.22.1、pnpm 11.19.0，依赖锁未改。保留现有超过 500 kB 的构建包提示。
- 首次 PR 全量浏览器：`pnpm --dir web test`，373 项通过；覆盖 2/3/6/10/11、恢复、共享来源请求/JSON 解析、错误隔离、参考切换、窄屏和 IRC。
- 桌面 1440px、窄屏 390px 合成截图随私下交付保存；截图不进入公开仓库。全部测试使用独立环境、临时合成目录和假 ag。
- 仅进行了合成离线验收；未操作研究 study、真实配置、集群或正式服务。合并和部署仍由协调会话分别处理。
