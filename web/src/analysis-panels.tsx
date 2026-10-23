import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {TableAttempts} from './data-table-view';
import {AttemptPreview,FileReader,useReportStudy} from './file-view';
import {endpoint,get,object} from './api';
import type {Document,Study} from './api';
import {analysisConclusion,analysisLink,analysisType,reportCategory,reportGroups} from './analysis-summary';
import {ErrorNotice,StatusBadge} from './ui';

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
 return <li><a href={analysisLink(study,report.name,report.schema)}>{typeof data.label==='string'&&data.label?data.label:report.name}</a><small className="muted report-path">{reportCategory(report).basis} · {report.name.split('.').at(-1)?.toUpperCase()} · {typeof data.label==='string'&&data.label?report.name+' · ':''}{report.updated_at?<time dateTime={report.updated_at}>{new Date(report.updated_at).toLocaleString('zh-CN',{hour12:false})}</time>:'更新时间 —'}</small><span ref={anchor} className="analysis-conclusion">{report.name.endsWith('/channel-suggestions.csv')?<StatusBadge tone="warn">建议，待确认</StatusBadge>:analysisConclusion(doc?.data,report.name)}</span>{(report.error||doc?.error)&&<ErrorNotice>{report.error??doc?.error}</ErrorNotice>}</li>;
}
export function ReportDirectory({data}:{data:Study}){
 return <nav className="report-directory" aria-label="报告目录"><h3>报告目录</h3>{reportGroups.map(([kind,title])=>{
  const reports=data.analyses.filter(report=>reportCategory(report).kind===kind);
  if(!reports.length)return null;
  const folders=kind==='other'?[...new Set(reports.map(report=>report.name.includes('/')?report.name.split('/').slice(0,-1).join('/'):'根目录'))]:[];
  return <section key={kind} aria-label={kind==='irc'?'IRC 报告列表':title+'列表'}><h4>{title} <span className="muted">({reports.length})</span></h4>{kind==='other'?folders.map(folder=><div key={folder}><h5>{folder}</h5><ul className="analysis-report-list">{reports.filter(report=>(report.name.includes('/')?report.name.split('/').slice(0,-1).join('/'):'根目录')===folder).map(report=><ReportRow key={report.name} study={data.id} report={report}/>)}</ul></div>):<ul className="analysis-report-list">{reports.map(report=><ReportRow key={report.name} study={data.id} report={report}/>)}</ul>}</section>;
 })}{!data.analyses.length&&<p>尚无报告。</p>}</nav>;
}
function ReportLayout({data,name,children}:{data:Study;name?:string;children:ReactNode}){
 const [selected,setSelected]=useState<string|null>(null);
 useEffect(()=>setSelected(null),[data.id,name]);
 return <TableAttempts.Provider value={{study:data.id,ids:new Set(data.attempts.map(a=>a.id)),select:setSelected}}><div className="report-layout"><ReportDirectory data={data}/><div className="report-content">{children}</div><AttemptPreview study={data.id} id={selected}/></div></TableAttempts.Provider>;
}
export function ReportPage({study,name}:{study:string;name:string}){
 const {data,error}=useReportStudy(study);
 return error?<ErrorNotice>{error}</ErrorNotice>:!data?<p role="status">读取报告目录…</p>:<ReportLayout data={data} name={name}><FileReader key={name} study={study} path={'analyses/'+name} data={data}/></ReportLayout>;
}
export function AnalysisLibrary({data}:{data:Study}){
 return <ReportLayout data={data}><section className="report-welcome"><h3>阅读已保存的报告</h3><p>从左侧目录选择报告。Markdown、CSV 和 JSON 对象数组支持按列排序。</p><p className="muted">表格中的 Attempt 编号可打开结构预览。类别来自 schema、报告声明或文件类型。</p><StatusBadge tone="warn">工具记录，待人工审阅</StatusBadge><p className="muted">正式结果以 ag 报告及人工审阅为准。</p></section></ReportLayout>;
}
