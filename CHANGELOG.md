# Changelog

## v4.0.0

配合 ag 4.0.0 使用。本节对比 T7 改造前的旧前端，仅包含已合并的功能。
发布 PR 待负责人确认验收后合并；本次不创建 tag 或 release。以下 PR 均属于本前端仓库，另有明确标注的后端关联。

### 保留

- 保留分子三维旋转、缩放、成键显示和几何测量，以及独立的 Gaussian 振动位移解码能力；振动动画是显示辅助，不是 TS 验证。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)
- 保留本机访问边界、响应式浏览体验与只读科学结果展示目的，将数据来源改为 study 文件；不沿用旧查询接口。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)

### 重做与新增

- 以本地 study 目录重做查看器：study Markdown、Attempt 状态、facts、review、分页日志、热化学、构象帧与父子关系图；缺失数据保持未知，文件读取拒绝越界和符号链接。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)
- 新增提交前输入结构、参数与哈希预览、父 Attempt 输入对比、结构多帧、日志关键词/终止标记搜索及直接定位链接。[#5](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/5)
- 重做结果首页，增加优化过程能量/收敛/结构播放与服务器页。服务器数据来自 ag monitor 保存的快照；界面只读文件，不启动采样或连接集群。[#6](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/6)
- 增加默认关闭的 `--enable-actions`：固定本机 ag 入口、新建草稿、prepare、submit、status、fetch、cancel；随机 token、同源检查和单操作锁；提交/取消继续由 ag 弹出 Mac 确认。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)
- 420 秒页面等待结束不终止 ag，后台读取输出并持锁至进程退出；监控时间按本地时区显示，兼容运行/排队核数与总额度字段。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)

### 移除

- 移除旧 calculation-package、数据库、profile、任务队列、导入和查询服务的启动参数/API 依赖；旧 native/pre-v31/navigation 注册文档和发布来源映射退役。新查看器不导入旧后端运行时，也不提供旧数据自动迁移。[#4](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/4)

### 兼容边界

- T7d 的操作配置及服务器页仍面向旧单集群布局。ag 4.0.0 多集群快照位于各集群子目录，当前前端尚未适配；多集群动作请走 ag CLI，具体路径占位符和启动方式见 README。[#7](https://github.com/anakine800-tech/Auto-Gaussian-Frontend/pull/7)、[后端 #229](https://github.com/anakine800-tech/Auto-Gaussian/pull/229)
