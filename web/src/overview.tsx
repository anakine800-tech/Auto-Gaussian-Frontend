import {AdoptionResults} from './chains-view';
import {analysisLink} from './analysis-summary';
import {useState} from 'react';
import {object} from './api';
import type {AttemptSummary,CatalogReview,Study,StudySection} from './api';
import {routeHash,studyHash} from './routing';
import {StudyMarkdown} from './results-panels';
import {Collapsible,Drawer,EmptyState,ErrorNotice,KpiTile,Panel,StatusBadge} from './ui';
import {MILESTONES,PROGRESS} from './progress-definitions';

// Presence of a review record never means scientific acceptance.
export const pendingReview=(a:AttemptSummary,catalog?:CatalogReview)=>a.state==='fetched'&&object(a.facts.data)&&['missing','empty'].includes(a.review_state)&&(!catalog?.available||catalog.attempts.includes(a.id));
export const needsAttention=(a:AttemptSummary)=>pendingReview(a)||['finished','unknown','failed','failed_presubmit','stalled','interrupted','error','unavailable','awaiting_second_observation'].includes(a.state)||a.review_state==='unreadable'||Boolean(a.manifest.error||a.status.error)||(a.state==='fetched'&&Boolean(a.facts.error));
const emptySection:StudySection={present:false,text:'',entries:[]};
export function StudyOverview({data}:{data:Study}){
 const [source,setSource]=useState<{title:string;line?:number}|null>(null),[showPending,setShowPending]=useState(false);
 const section=(title:string)=>data.sections[title]??emptySection;
 const milestones=section('里程碑签字'),pending=milestones.entries.filter(e=>e.state==='pending');
 const unreviewed=data.attempts.filter(a=>pendingReview(a,data.catalog_review)),running=data.attempts.filter(a=>a.state==='running'),finished=data.attempts.filter(a=>a.state==='finished');
 const reports=[...data.analyses].sort((a,b)=>(b.updated_at??'').localeCompare(a.updated_at??'')||a.name.localeCompare(b.name)).slice(0,6);
 const reviewRule=data.catalog_review?.available?PROGRESS.review.detail:PROGRESS.reviewFallback;
 const sourceButton=(title:string,line?:number,text=title)=><button className="source-link" onClick={()=>setSource({title,line})}>{text} ↗</button>;
 const sourceGroup=(title:string)=>{const s=section(title);return <><h3>{sourceButton(title)}</h3>{!s.present?<p className="muted">study.md 中没有此节</p>:!s.entries.length?<p className="muted">此节暂无条目</p>:<ul className="overview-list">{s.entries.map((entry,i)=><li key={i}>{sourceButton(title,entry.line,entry.text)}<small>来源：study.md 第 {entry.line} 行</small></li>)}</ul>}</>;};
 const attempts=(items:AttemptSummary[],kind:string)=><>{items.length?<ul className="overview-list">{items.map(a=><li key={a.id}><a href={routeHash([data.id,a.id])}>{a.id}</a> {a.label}<small>来源：{kind==='待取回'?'status.json · finished':'status.json、facts.json、review.md'}{data.catalog_review?.available&&kind==='待审阅'?'、catalog/state.json（日志哈希已核对）':''}</small></li>)}</ul>:<p className="muted">没有符合{kind}规则的 Attempt</p>}</>;
 const logs=section('进度日志').entries;
 return <div className="study-overview">
 <div className="overview-kpis" aria-label="Study 指标">
 <KpiTile label={PROGRESS.running.label} value={<a href={studyHash(data.id,'attempts')+'?status=running'}>{running.length}</a>} detail={PROGRESS.running.detail}/>
 <KpiTile label={PROGRESS.fetch.label} value={<a href={studyHash(data.id,'attempts')+'?status=finished'}>{finished.length}</a>} detail={PROGRESS.fetch.detail}/>
 <KpiTile label={PROGRESS.review.label} value={<a href={studyHash(data.id,'attempts')+'?review=1'}>{unreviewed.length}</a>} detail={reviewRule}/>
 <KpiTile label={PROGRESS.sign.label} value={milestones.present?<button className="source-link" onClick={()=>{setShowPending(true);requestAnimationFrame(()=>document.getElementById('milestones')?.scrollIntoView({block:'center'}));}}>{pending.length}</button>:'—'} detail={milestones.present?PROGRESS.sign.detail:'study.md 中没有里程碑签字节，数量未知'}/>
 </div>
 {data.study.error&&<ErrorNotice>study.md：{data.study.error}</ErrorNotice>}
 {data.catalog_review?.warning&&<p className="notice" role="status">{data.catalog_review.warning}</p>}
 <p className="muted">{PROGRESS.reviewEvidence}。</p>
 <div className="overview-columns">
 <Panel title="还缺什么"><ol className="missing-list">
 <li>{sourceGroup('当前阻塞')}</li>
 {finished.length>0&&<li><h3><a href={studyHash(data.id,'attempts')+'?status=finished'}>待取回（{finished.length}）</a></h3>{attempts(finished,'待取回')}</li>}
 {unreviewed.length>0&&<li><h3><a href={studyHash(data.id,'attempts')+'?review=1'}>待审阅（{unreviewed.length}）</a></h3>{attempts(unreviewed,'待审阅')}</li>}
 <li>{sourceGroup('待你决定')}</li>
 {(!milestones.present||pending.length>0)&&<li><h3>待签字（{milestones.present?pending.length:'未知'}）</h3>{pending.length?<ul className="overview-list">{pending.map((e,i)=><li key={i}>{sourceButton('里程碑签字',e.line,e.label??e.text)}<small>来源：study.md 第 {e.line} 行</small></li>)}</ul>:<p className="muted">study.md 中没有此节</p>}</li>}
 </ol></Panel>
 <div id="milestones"><Panel title="里程碑">
 <p className="muted">来源：{sourceButton('里程碑签字')}；按记录显示，不推定研究阶段。</p>
 {showPending&&<p><StatusBadge>仅待签</StatusBadge> <button onClick={()=>setShowPending(false)}>显示全部里程碑</button></p>}
 {!milestones.present?<p className="muted">study.md 中没有此节</p>:!milestones.entries.length?<p className="muted">此节暂无条目</p>:<ul className="overview-list">{(showPending?pending:milestones.entries).map((e,i)=><li key={i}>{sourceButton('里程碑签字',e.line,e.label??e.text)} <StatusBadge tone={e.state==='pending'||e.state==='unknown'?'warn':'neutral'}>{MILESTONES[e.state??'unknown']}</StatusBadge>{(!e.state||e.state==='unknown')&&<small>{sourceButton('里程碑签字',e.line,`第 ${e.line} 行原文：${e.text}`)}</small>}</li>)}</ul>}
 </Panel></div>
 </div>
 <AdoptionResults data={data}/>
 <Collapsible page={data.id} block="recent-files" title="最近改动的文件"><p className="muted">{PROGRESS.recent}</p>{reports.length?<ul className="report-list">{reports.map(r=><li key={r.name}><a href={analysisLink(data.id,r.name,r.schema)}>{r.name}</a><span className="muted">{r.updated_at?<time dateTime={r.updated_at}>{new Date(r.updated_at).toLocaleString('zh-CN',{hour12:false})}</time>:'更新时间未知'}{r.error?' · 文件读取异常':''}</span></li>)}</ul>:<EmptyState>暂无分析文件</EmptyState>}<a href={studyHash(data.id,'analysis')}>查看全部报告 →</a></Collapsible>
 <Collapsible page={data.id} block="study-description" title="研究说明"><StudyMarkdown doc={data.study}/></Collapsible>
 <Collapsible page={data.id} block="progress-log" title="进度日志">{!section('进度日志').present?<EmptyState>study.md 中没有此节</EmptyState>:<><p className="muted">按 study.md 中的记录顺序，显示最后 3 条。</p><ul>{logs.slice(-3).map(e=><li key={e.line}>{sourceButton('进度日志',e.line,e.text)}</li>)}</ul>{logs.length>3&&<details><summary>更早的 {logs.length-3} 条</summary><ul>{logs.slice(0,-3).map(e=><li key={e.line}>{sourceButton('进度日志',e.line,e.text)}</li>)}</ul></details>}</>}</Collapsible>
 <Drawer open={source!==null} onClose={()=>setSource(null)} title={source?.title??'study.md'}>{source&&<><p className="muted">study.md{source.line?` · 第 ${source.line} 行`:''} · 只读原文</p>{section(source.title).present?<pre className="section-source">{section(source.title).text||'此节暂无内容'}</pre>:<EmptyState>study.md 中没有此节</EmptyState>}</>}</Drawer>
 </div>;
}
