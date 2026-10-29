# T195：当前study的方法检索

## 分支与目标

前端 `codex/t195-study-method-search`；对应V4.8 W9，一单一PR。用户可在当前study按manifest记录的方法/route找到Attempt，保留原跨study搜索。

## 允许改动的路径

- `autog_frontend/search_index.py`、`autog_frontend/api.py`：有界manifest索引和可选study过滤。
- `web/src/ui/search.tsx`、`web/src/ui/index.tsx`、`web/src/main.tsx`、`web/src/ui/shell.css`：当前study/所有study选项及上下文接入。
- `tests/test_search_index.py`、`tests/test_study_viewer.py`、`web/tests/shell.spec.ts`、`web/tests/shell-continuity.spec.ts`：合成测试。
- `README.md`、`docs/redesign-tasks/T195-study-method-search.md`。

## 要做的

1. 对照实际manifest读取science.route/science.method_basis（确认实际字段后实现），将字符串纳入索引；非法类型和坏manifest保持部分索引/未知说明，不扫描日志或结果正文。
2. 当前study页面提供明确的当前study方法检索范围，跨study入口继续可选；切换study时范围和陈旧请求安全更新，不能显示前一study的结果。
3. 复用现有描述符安全读取、索引时间/文件/条数/字节上限、缓存指纹、截断提示。范围过滤在服务端实施，不能先无限扫所有研究再只在UI过滤。
4. 不把manifest字段当文件路径或命令，不泄露本机绝对路径。旧编号/标签/文件名搜索继续工作。
5. 格式化实际改动文件，避免无关布局或依赖更新。

## 测试

覆盖route/method_basis命中、字符串大小写、当前/跨study切换、同名Attempt、缓存失效、坏manifest/字段类型、索引部分完成、超时/结果上限和路径拒绝。Python相关单测、pnpm build、首次PR与合并前全量浏览器测试；固定端口串行。截图与精确暂存敏感扫描、差异检查、noreply身份。

## 真实环境验证与边界

只读本地索引；测试全为合成study，无真实配置/研究/集群访问。不得新增ag操作或修改研究记录；无需真实计算。范围外及同一问题两次未解决报告。

## 交付

PR首行 `Task: T195`。协调会话核查实际字段、搜索范围、安全边界和最终head CI后合并；开发会话不合并。README依前序前端任务顺序集成。

## 实现记录

- 已核对后端提交 `4fce3cf7305bd57eb31525e54bb3edcc70b71986`：
  [`attempt.prepare`](https://github.com/anakine800-tech/Auto-Gaussian/blob/4fce3cf7305bd57eb31525e54bb3edcc70b71986/ag/src/ag/attempt.py#L258)
  保存 `science.method_basis`；该值是方法依据字符串。
  [`gaussian_input.validate`](https://github.com/anakine800-tech/Auto-Gaussian/blob/4fce3cf7305bd57eb31525e54bb3edcc70b71986/ag/src/ag/gaussian_input.py#L306)
  返回 `science.route`；xTB/CREST 的 route 由 prepare 的参数渲染结果替换。
- `/api/search` 新增可选 `study`，直接安全打开指定目录，不枚举其他研究。
  原文件/条数/时间/字节上限保留；缓存指纹补充设备和 ctime，部分完成缓存会重试。
- 方法原文仅用于内存匹配，不进入响应详情或路径读取；缺失显示未知，坏类型和坏 JSON
  保留可用的编号、标签及方法字段，显示部分完成。
- Study 页面默认当前范围，保留所有 Study 选项；切换 Study 保留关键词并重置范围、
  关闭旧结果、取消旧请求，响应另按请求 URL 绑定。
- 格式化仅覆盖本单实际改动文件：TS/TSX/CSS/Markdown 使用临时固定 Prettier 3.6.2，
  Python 使用独立环境的 Ruff 0.17.3，均执行 `--check`；未更新产品依赖或 lockfile。
