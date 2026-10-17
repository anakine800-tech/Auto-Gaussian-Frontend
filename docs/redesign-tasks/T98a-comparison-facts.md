# T98a：快速比较显示终止状态与虚频数

负责人 2026-10-17 指定的 T98 后续前端单，来源为 PR #22 的非阻塞审阅建议。

- 分支：`codex/t98a-comparison-facts`；独立 PR，首行 `Task: T98a`。
- 快速比较表在 Attempt 后增加 `termination` 和 `n_imag` 两列，只取已读取的 facts 保存值；缺失显示 `—`，虚频数右对齐。
- 沿用现有令牌、DataTable、Drawer 与 StatusBadge，不改变比较口径、相对能量计算或原有拒绝规则；不把终止状态或虚频数当作科学验收。
- 范围：`web/src/quick-comparison.ts`、`web/src/quick-comparison-panel.tsx`、必要的 `web/src/ui/analysis.css` 布局、`web/tests/analysis.spec.ts`、本任务单及 `docs/t98a/` 合成截图与验证说明。
- 测试：正常 / error / incomplete / unknown、虚频数 0 与正值、缺失与无效值、不从 status 或频率列表推断；保留能量计算及拒绝行为断言。两个视口 1440×860、1280×720 的表格与表头完全可见、无横向滚动，HTTP 只读。
- 提交前运行前端全部离线测试、浏览器测试与构建；全程合成数据，不改变 Python 适配器、只读边界、动作流程或后端，不做真实环境验证。合并由负责人操作。
