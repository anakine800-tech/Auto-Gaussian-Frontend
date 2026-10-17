import {useEffect,useRef,useState} from 'react';
import {endpoint,get,object} from './api';
import type {Document,Study} from './api';
import {analysisConclusion,analysisGroups,analysisLink,analysisType} from './analysis-summary';
import {Collapsible,EmptyState,ErrorNotice,Panel,StatusBadge} from './ui';

type Report=Study['analyses'][number];
function useReport(study:string,report:Report){
 const [doc,setDoc]=useState<Document|null>(null),anchor=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  const c=new AbortController();setDoc(null);
  if(analysisType(report.schema,report.name)==='file'||!report.name.endsWith('.json')||report.error)return;
  // Only visible conclusion rows need a body. Closed and off-screen lists keep
  // T96's metadata-only discovery; each request still uses the bounded API.
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){
   observer.disconnect();get<Document>(endpoint(study,'reports',...report.name.split('/')),c.signal).then(v=>{if(!c.signal.aborted)setDoc(v);}).catch(e=>{if(!c.signal.aborted)setDoc({data:null,error:e.message});});
  }});
  if(anchor.current)observer.observe(anchor.current);
  return()=>{observer.disconnect();c.abort();};
 },[study,report]);
 return {doc,anchor};
}
export function ReportConclusion({study,report}:{study:string;report:Report}){
 const {doc,anchor}=useReport(study,report);
 return <span ref={anchor} className="analysis-conclusion">{report.error||doc?.error?<span className="tone-warn">结论 — · {report.error??doc?.error}</span>:report.name.endsWith('/channel-suggestions.csv')?<StatusBadge tone="warn">建议，待确认</StatusBadge>:analysisConclusion(doc?.data,report.name)}</span>;
}
function ReportRow({study,report}:{study:string;report:Report}){
 const {doc,anchor}=useReport(study,report),data=object(doc?.data)?doc.data:{};
 return <li><a href={analysisLink(study,report.name,report.schema)}>{typeof data.label==='string'&&data.label?data.label:report.name}</a><span className="muted report-path">{typeof data.label==='string'&&data.label?report.name+' · ':''}{report.updated_at?<time dateTime={report.updated_at}>{new Date(report.updated_at).toLocaleString('zh-CN',{hour12:false})}</time>:'更新时间 —'}</span><span ref={anchor} className="analysis-conclusion">{report.name.endsWith('/channel-suggestions.csv')?<StatusBadge tone="warn">建议，待确认</StatusBadge>:analysisConclusion(doc?.data,report.name)}</span>{(report.error||doc?.error)&&<ErrorNotice>{report.error??doc?.error}</ErrorNotice>}</li>;
}
export function AnalysisLibrary({data}:{data:Study}){
 return <div className="analysis-library"><p className="muted">只读已保存报告。结论字段缺失显示 —；正式结果以 ag 报告及人工审阅为准。 <StatusBadge tone="warn">工具记录，待人工审阅</StatusBadge></p><div className="analysis-groups">{analysisGroups.filter(([id])=>id!=='file').map(([id,title])=>{const reports=data.analyses.filter(r=>analysisType(r.schema,r.name)===id);return <Panel title={title} key={id} className="analysis-group"><div role="region" aria-label={id==='ensemble'?'构象集合列表':id==='irc'?'IRC 报告列表':title+'列表'}>{reports.length?<ul className="analysis-report-list">{reports.map(r=><ReportRow key={r.name} study={data.id} report={r}/>)}</ul>:<EmptyState>暂无可识别报告</EmptyState>}</div></Panel>;})}</div><Collapsible page="analysis" block="other-files" title="其他文件" defaultOpen>{data.analyses.filter(r=>analysisType(r.schema,r.name)==='file').map(r=><p key={r.name}><a href={analysisLink(data.id,r.name,r.schema)}>{r.name}</a>{r.error&&<ErrorNotice>{r.error}</ErrorNotice>}</p>)}{!data.analyses.some(r=>analysisType(r.schema,r.name)==='file')&&<EmptyState>暂无其他文件</EmptyState>}</Collapsible></div>;
}
