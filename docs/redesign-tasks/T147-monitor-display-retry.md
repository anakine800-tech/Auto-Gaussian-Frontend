# T147 — 服务器监控显示与重试体验修补

状态：开发与测试；独立前端 PR，待监督审阅。不合并、不发版、不部署。

## 基线与编号

2026-10-27 核对两仓任务目录、本地及远端分支、GitHub PR/Issue，未发现 T147 占用。
前端基线为正式 v4.6.2：d41dd8e99323542bc5f845929a239dd5ec9e9070。
隔离分支 codex/t147-monitor-display-retry；现有运行检出和服务不改动。

## 要解决的实际问题

- Slurm 资源条把 Other 计为空闲，可能误导容量判断；只能采用实际 Idle，矛盾字段保持未知。
- 核数及内存均未知时硬件说明重复显示。
- 手动采样拒绝/请求失败仍启动快速轮询，制造无意义读取。
- 已过期的计划时间被显示成未来采样时间。
- 暂停确认文字含多余空格、中文用语不统一。

## 允许路径

- web/src/jobs-data.ts
- web/src/server-cards.tsx
- web/src/server-detail.tsx
- web/src/server-monitor.tsx
- web/src/ui/server.css
- web/tests/server-page.spec.ts
- docs/redesign-tasks/T147-monitor-display-retry.md
- docs/redesign-tasks/open-tasks.txt（仅登记 T147）

只修改上述前端显示与重试体验及相应合成测试，不增加依赖。
保持五卡布局、PBS 九节点明细和定向节点选择不变。
不改 Python/后端、API、SSH 查询、提交或审批逻辑。

## 验证

合成测试覆盖 Slurm Other/Idle、未知及矛盾资源、说明去重、重试拒绝/错误/超时、已登记/排队/采样中的轮询、过期时间及中文确认。
运行前端 Python 全量测试、TypeScript 检查、构建和全部 Playwright 回归。
执行完整及暂存公开仓库保密扫描（含有效本机词表）、diff 检查和提交身份检查。
PR 记录实际 HEAD、CI 与实际阻塞；等待监督审阅。

## 真实环境验证

本轮仅开发与合成测试，不运行真实集群查询，不操作研究机，不修改开发机运行服务。
维护另用已经验收的 v4.6.2 正式 tag；本补丁不得进入此次维护部署。
私有维护准备只查已有记录并补充私有计划；无明确证据时写“原因未查明”，先确认无研究写入，先 doctor 再加载服务。
