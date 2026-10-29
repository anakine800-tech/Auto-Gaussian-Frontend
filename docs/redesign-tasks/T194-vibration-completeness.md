# T194：振动模式完整性显示

## 分支与目标

前端 `codex/t194-vibration-completeness`；V4.8 W9，一单一PR。把facts已有的振动完整性信息明确显示，避免只看到虚频数就误以为模式齐全。

## 允许改动的路径

- `web/src/attempt-facts.tsx`、`web/src/mode-panels.tsx`、`web/src/ui/attempt.css`：显示与必要样式。
- `tests/results_fixture.py`、`tests/test_results.py`、`web/tests/attempt-detail.spec.ts`、`web/tests/mode-review.spec.ts`：合成用例。
- `README.md`、`docs/redesign-tasks/T194-vibration-completeness.md`。

## 要做的

1. 只读取facts的 `n_vibrational_modes`、`expected_vibrational_modes`、`vibrational_modes_complete`、`frequency_unavailable_reason`，显示已读/预期模式数与完整/不完整/未知。
2. 缺字段、旧facts、部分计数和原因缺失分别说明；false不能被当成缺值，null不能当零。不能由原子数自行推算并填充预期模式数。
3. 保留现有虚频、方向审阅、模式动画和缺失原因，不把完整性标签写成TS/科学验收通过。提供facts来源查看。
4. 格式化实际改动文件，不做全仓重排。

## 测试

覆盖true/false/null/缺字段、0值、计数与标志不一致、缺失原因、无facts等合成情况。Python相关单测、pnpm build、首次PR及合并前全量浏览器测试；固定端口与其他前端工单串行。桌面/窄屏截图；精确暂存、敏感扫描、差异检查、noreply身份。

## 真实环境验证与边界

不改后端解析、不改facts、不读真实研究、不操作集群或服务；合成离线验证足够。范围外/同一问题修两次未解决则报告。

## 交付

PR首行 `Task: T194`；由协调会话审阅最终head与CI并合并，开发会话不合并。README按前序前端任务依次集成。

## 实现与离线核对（2026-10-29）

- 关键事实新增可展开的振动模式摘要，来源按钮打开已有 facts.json。计数和标志分别显示，计数冲突不覆盖保存的标志；完整标签使用中性色。
- 缺字段、null、空原因、部分计数和旧 facts 分别说明。保留虚频、原因、日志解析与模式审阅；动画数据不补齐 facts。
- 合成矩阵含 13 组 facts；包括计数相等但标志为 null / 缺失时仍显示未知。API 回归核对原值、类型、文件字节与 mtime，不生成缺失 facts。
- `.venv/bin/python -B -m unittest tests.test_results tests.test_mode_reports -q`：26 项通过。
- 临时固定 Prettier 3.6.2 格式化本单改动的 TSX、CSS、浏览器测试及 Markdown，`--check` 通过；Ruff 0.17.3 的 `format --check` 核对两份改动 Python 文件通过。没有改依赖声明或 lockfile，没有全仓重排。
- pnpm 11.19.0 的 `pnpm --dir web build` 通过。浏览器用例涵盖来源查看、只读请求、原动画 / 方向审阅及桌面和 390px 窄屏；完整浏览器执行结果与最终 head 在 PR 记录。
- 只修改本单允许路径；真实研究、集群、部署与科学验收均不在本单范围。T192 → T193 → T194 的最终集成及合并前全量复核由协调会话处理。
