import {PROGRESS,MILESTONES} from './progress-definitions';
import './ui/help.css';
const pages=[
 {id:'servers',name:'服务器',see:'服务器卡片、本人/他人/空闲资源分段、运行与排队作业，以及刚结束待取回记录。',actions:'选择服务器卡片或标签；筛选只看本人；点击 Attempt 阅读记录；展开节点、限额和存储信息。',source:'本机 .ag-monitor 快照。过期、失败和未知值保留提示；页面不直接查询集群。'},
 {id:'research',name:'研究',see:'进展数字、还缺什么、里程碑，以及全部 Attempt。',actions:'切换 Study；按状态或待审阅筛选；查看原文；勾选至比较篮。',source:'study.md、manifest.json、status.json、facts.json、review.md；有登记时核对 catalog 状态与日志哈希。'},
 {id:'chains',name:'研究 · 计算链',see:'登记的构象 × 电子态对象、每一步的方法与事实、当前采用结果和相对能量。',actions:'筛选电子态、计算类型和状态，隐藏历史；展开步骤；选择 E / E+ZPE / G 与参照对象；＋比较加入已采用 SP → Freq → Opt，未登记时取链上最后一个已取回 Attempt。',source:'catalog/state.json 与 journal.jsonl 哈希核对；不一致时警告并按 parents 自动成链。相对能仅用于已登记已采用对象：E=scf_h；E+ZPE=scf_h+zpe_h；G=scf_h+(g_h−freq_scf_h)。方法、基组、溶剂、元素组成或电荷不同时留空，缺失值不补算；多重度不同时标电子态能差。前端现场换算，正式数值以报告和登记为准。'},
 {id:'results',name:'结果 · 报告',see:'分类报告目录、Markdown/CSV/JSON 正文与表格、热化学、构象集合、IRC 与审阅报告。',actions:'排序报告表格、点击 Attempt 预览结构、打开本地引用文件；HTML/SVG 隔离阅读，HTTPS 外链在新标签打开；比较篮可打开快速比较或 2–3 项结构对比。',source:'analyses 中已有报告及其明确引用的数据；正式结论以 ag 报告和人的审阅为准。'},
 {id:'evidence',name:'证据',see:'研究说明、结构文件、关系图与其他分析文件。',actions:'切换现有标签；查看只读原文、结构与来源关系。',source:'study.md、structures、analyses 与 Attempt 的本地记录。'},
];
export function HelpPage(){return <article className="help-page"><span className="eyebrow">LOCAL STUDY VIEWER</span><h2>使用说明</h2><p>先选 Study，再从问题对应的入口开始。状态描述本地记录，不能替代科学审阅。</p>
 <nav aria-label="使用说明目录">{pages.map(p=><a href={'#/help?section='+p.id} key={p.id} onClick={e=>{e.preventDefault();document.getElementById('help-'+p.id)?.scrollIntoView();}}>{p.name}</a>)}<a href="#/help?section=rules" onClick={e=>{e.preventDefault();document.getElementById('help-rules')?.scrollIntoView();}}>状态口径</a></nav>
 {pages.map(p=><section id={'help-'+p.id} key={p.id}><h3>{p.name}</h3><div className="help-columns">{[['能看到什么',p.see],['常用操作',p.actions],['数据从哪来',p.source]].map(([label,text])=><div key={label}><h4>{label}</h4><p>{text}</p></div>)}</div></section>)}
 <section id="help-rules"><h3>状态口径</h3><div className="table-scroll"><table><thead><tr><th>词</th><th>口径</th></tr></thead><tbody>{[PROGRESS.running,PROGRESS.fetch,PROGRESS.review,PROGRESS.sign].map(r=><tr key={r.label}><th>{r.label}</th><td>{r.detail}</td></tr>)}<tr><th>无登记时的待审阅</th><td>{PROGRESS.reviewFallback}。{PROGRESS.reviewEvidence}。</td></tr><tr><th>最近改动的文件</th><td>{PROGRESS.recent}</td></tr><tr><th>里程碑</th><td>{Object.values(MILESTONES).join(' / ')}；无法识别时附行号与原文。</td></tr><tr><th>未知</th><td>未采到或格式无法识别；不当作 0，也不推定研究阶段。</td></tr></tbody></table></div></section>
 <section><h3>搜索与比较篮</h3><p>全局搜索覆盖本机所有 Study 的名称、标题、Attempt 编号、标签、模板及 analyses、结构文件名，不搜索文件正文。扫描达到读取量或耗时上限时会注明“索引未完成”。</p><p>同一个 Study 最多比较 6 项。选择保存在 sessionStorage 和链接的 cmp 参数中，链接优先；复制链接可在新标签页恢复。结构对比限 2–3 项，前端现场计算是非正式结果。</p></section>
 <section><h3>可操作模式</h3><p>默认只读。只有显式启用可操作模式后才显示经 ag 执行的操作；前端不直接连接服务器。提交和取消遵守 ag 的人工确认与批准核对，等待超时不自动重试。</p></section>
 <section><h3>页面不做的事</h3><p>不写研究计划或结论，不自动签字，不把工具检查完成当作科学通过，不自动重提失败或未知 Attempt，不替人挑选方法或采用结果。</p><p>统一比较页与证据库将在 T122 完成。当前保留现有报告和证据查看入口。</p></section>
 </article>;}
