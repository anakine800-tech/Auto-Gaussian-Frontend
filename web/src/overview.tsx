import {useState} from 'react';
import {object} from './api';
import type {AttemptSummary,Study,StudySection} from './api';
import {routeHash,studyHash} from './routing';
import {StudyMarkdown} from './results-panels';
import {Collapsible,Drawer,EmptyState,ErrorNotice,KpiTile,Panel,StatusBadge} from './ui';

// Presence of a review record never means scientific acceptance.
export const pendingReview=(a:AttemptSummary)=>a.state==='fetched'&&object(a.facts.data)&&['missing','empty'].includes(a.review_state);
export const needsAttention=(a:AttemptSummary)=>pendingReview(a)||['finished','unknown','failed','failed_presubmit','stalled','interrupted','error','unavailable','awaiting_second_observation'].includes(a.state)||a.review_state==='unreadable'||Boolean(a.manifest.error||a.status.error)||(a.state==='fetched'&&Boolean(a.facts.error));
const emptySection:StudySection={present:false,text:'',entries:[]};
export function StudyOverview({data}:{data:Study}){
 const [source,setSource]=useState<{title:string;line?:number}|null>(null);
 const section=(title:string)=>data.sections[title]??emptySection;
 const milestones=section('里程碑签字'),pending=milestones.entries.filter(e=>e.state==='pending');
 const unreviewed=data.attempts.filter(pendingReview),running=data.attempts.filter(a=>a.state==='running');
 const reports=[...data.analyses].sort((a,b)=>(b.updated_at??'').localeCompare(a.updated_at??'')||a.name.localeCompare(b.name)).slice(0,6);
 const sourceButton=(title:string,line?:number,text=title)=><button className="source-link" onClick={()=>setSource({title,line})}>{text} ↗</button>;
 const entries=(title:string)=>{
  const s=section(title);
  return <div className="overview-group"><h3>{sourceButton(title)}</h3>{!s.present?<p className="muted">study.md 中没有此节</p>:!s.entries.length?<p className="muted">此节暂无条目</p>:<ul className="overview-list">{s.entries.map((entry,i)=><li key={i}>{sourceButton(title,entry.line,entry.text)}</li>)}</ul>}</div>;
 };
 return <div className="study-overview">
 <div className="overview-kpis" aria-label="Study 指标">
 <KpiTile label="阶段 / 里程碑" value={pending[0]?.label??'见签字记录'} detail="按 study.md 记录，不推定研究阶段" className="milestone-kpi"/>
 <KpiTile label="在跑" value={<a href={studyHash(data.id,'attempts')+'?status=running'}>{running.length}</a>} detail="本地状态为 running"/>
 <KpiTile label="待审" value={<a href={studyHash(data.id,'attempts')+'?review=1'}>{unreviewed.length}</a>} detail="已取回、有 facts、尚无 review 内容"/>
 <KpiTile label="待签" value={milestones.present&&milestones.entries.length?sourceButton('里程碑签字',undefined,String(pending.length)):'—'} detail={milestones.present?'明确待签的记录数':'study.md 中没有此节'}/>
 </div>
 {data.study.error&&<ErrorNotice>study.md：{data.study.error}</ErrorNotice>}
 <div className="overview-columns">
 <Panel title="要处理的事">
 {entries('当前阻塞')}{entries('待你决定')}
 <div className="overview-group"><h3>算完未审 Attempt <StatusBadge tone="warn">{unreviewed.length}</StatusBadge></h3>{unreviewed.length?<ul className="overview-list">{unreviewed.map(a=><li key={a.id}><a href={routeHash([data.id,a.id])}>{a.id}</a><span className="muted"> {a.label} · 待审阅</span></li>)}</ul>:<p className="muted">没有符合待审规则的 Attempt</p>}</div>
 <div className="overview-group"><h3>{sourceButton('里程碑签字')}</h3>{!milestones.present?<p className="muted">study.md 中没有此节</p>:!milestones.entries.length?<p className="muted">此节暂无可识别的里程碑条目</p>:<ul className="overview-list">{milestones.entries.map((e,i)=><li key={i}>{sourceButton('里程碑签字',e.line,e.label??e.text)} <StatusBadge tone={e.state==='pending'||e.state==='unknown'?'warn':'neutral'}>{e.state==='pending'?'待签':e.state==='recorded'?'已有签字记录':e.state==='not_applicable'?'不适用':'状态未明'}</StatusBadge></li>)}</ul>}</div>
 </Panel>
 <Panel title="关键结果"><p className="muted">最近更新的分析文件 · 仅显示已有报告</p>{reports.length?<ul className="report-list">{reports.map(r=><li key={r.name}><a href={routeHash([data.id,object(r.data)&&r.data.schema==='ag-ensemble/1'?'ensembles':object(r.data)&&r.data.schema==='ag-irc-review/1'?'irc-reviews':'analyses',...r.name.split('/')])}>{r.name}</a><span className="muted">{r.updated_at?<time dateTime={r.updated_at}>{new Date(r.updated_at).toLocaleString('zh-CN',{hour12:false})}</time>:'更新时间未知'}{r.error?' · 文件读取异常':''}</span></li>)}</ul>:<EmptyState>暂无分析报告</EmptyState>}<a href={studyHash(data.id,'analysis')}>查看全部分析 →</a></Panel>
 </div>
 <Collapsible page={data.id} block="study-description" title="研究说明"><StudyMarkdown doc={data.study}/></Collapsible>
 <Collapsible page={data.id} block="progress-log" title="进度日志">{section('进度日志').present?<StudyMarkdown doc={{data:section('进度日志').text,error:null}}/>:<EmptyState>study.md 中没有此节</EmptyState>}</Collapsible>
 <Drawer open={source!==null} onClose={()=>setSource(null)} title={source?.title??'study.md'}>{source&&<><p className="muted">study.md{source.line?` · 第 ${source.line} 行`:''} · 只读原文</p>{section(source.title).present?<pre className="section-source">{section(source.title).text||'此节暂无内容'}</pre>:<EmptyState>study.md 中没有此节</EmptyState>}</>}</Drawer>
 </div>;
}
