# Changelog

## v4.2.0

配合 ag 4.2.0（后端 T61）使用。版本准备完成后仍需监督方审阅、负责人合并；
负责人在合并后与 T61 同步创建 v4.2.0 tag/release。

- T54：新增 `ag-ensemble/1` 构象集合列表、能量表、缩略图/三维联动、候选 URL
  和 CREST 输出逐帧查看；核对 XYZ 哈希，保留缺失与跨路线能量限制。
  [#12](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/12)
- T55：新增可选虚频审阅模式、归一化振幅、原子对距离/变化及来源信息，
  与同源 mode-review 报告逐方向对照；不代替 TS/IRC 科学验收。
  [#13](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/13)
- T57：补全 B、Cl、Br、P、Si、I 缩略图配色；增加合成 study 的跨页浏览器与
  HTTP 集成回归，覆盖缺失/损坏 facts、XYZ 被替换、异源报告、截断日志、大小/
  帧数/原子数限制、陈旧/失败快照、符号链接、只读无 POST 及 T52 fetch facts 输出。
  补全启动与浏览说明，Python 与网页包版本同步为 4.2.0。修复三维图部分离开视口时聚焦滚动导致原子点击丢失的问题，
  以及既有动画对照测试提前取值的时序问题。
  [#14](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/14)

离线验证只证明软件行为；真实 study 的只读可用性由负责人在合并后验证，
在 PR 评论中仅记录“可用 / 有问题（类别）”。不发布研究截图、数据或科学验收结论。

## v4.0.0

配合 ag 4.0.0 使用。本节对比 T7 改造前的旧前端，仅包含已合并的功能。
前端版本准备已由 [#8](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/8) 合并；本次补记 T7e，不创建 tag 或 release。以下 PR 均属于本前端仓库，另有明确标注的后端关联。

### 保留

- 保留分子三维旋转、缩放、成键显示和几何测量，以及独立的 Gaussian 振动位移解码能力；振动动画是显示辅助，不是 TS 验证。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)
- 保留本机访问边界、响应式浏览体验与只读科学结果展示目的，将数据来源改为 study 文件；不沿用旧查询接口。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)

### 重做与新增

- 以本地 study 目录重做查看器：study Markdown、Attempt 状态、facts、review、分页日志、热化学、构象帧与父子关系图；缺失数据保持未知，文件读取拒绝越界和符号链接。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)
- 新增提交前输入结构、参数与哈希预览、父 Attempt 输入对比、结构多帧、日志关键词/终止标记搜索及直接定位链接。[#5](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/5)
- 重做结果首页，增加优化过程能量/收敛/结构播放与服务器页。服务器数据来自 ag monitor 保存的快照；界面只读文件，不启动采样或连接集群。[#6](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/6)
- 增加默认关闭的 `--enable-actions`：固定本机 ag 入口、新建草稿、prepare、submit、status、fetch、cancel；随机 token、同源检查和单操作锁；提交/取消继续由 ag 弹出 Mac 确认。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)
- 420 秒页面等待结束不终止 ag，后台读取输出并持锁至进程退出；监控时间按本地时区显示，兼容运行/排队核数与总额度字段。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)

- T7e：操作模式通过 `ag clusters --json --verify-studies-root` 获取各集群档位、程序启用配置并核对根目录，不再直接解析 TOML；新建默认父集群，切换联动档位，prepare 显式传入 `--cluster`，摘要显示集群及估算核时。[#9](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/9)、[后端 #233](https://github.com/anakine800-tech/Auto-Gaussian/pull/233)
- T7e：服务器页分集群读取快照，兼容旧 default 位置；显示 Slurm 本地核时预算、到期与存储，缺失不当零、陈旧值明确标记。两个 default 来源并存时显示歧义，取消提示按 Attempt 集群匹配，仍由 ag 和 Mac 确认执行。[#9](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/9)

### 移除

- 移除旧 calculation-package、数据库、profile、任务队列、导入和查询服务的启动参数/API 依赖；旧 native/pre-v31/navigation 注册文档和发布来源映射退役。新查看器不导入旧后端运行时，也不提供旧数据自动迁移。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)

### 兼容边界

- T7e 已支持 ag 4.0.0 多集群查询和快照布局，操作模式要求包含 T19 接口的 ag；程序启用标记仅代表已配置，本地预算不等于平台余额。默认只读不调用 ag，所有计算副作用仍经显式操作模式委托 ag，科学验收由人完成。启动与快照路径见 [README](README.md)。[#9](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/9)、[后端 #233](https://github.com/anakine800-tech/Auto-Gaussian/pull/233)
