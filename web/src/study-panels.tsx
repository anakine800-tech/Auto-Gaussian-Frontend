import {analysisLink} from './analysis-summary';
import {ReportPage} from './analysis-panels';
import {useEffect,useState} from 'react';
import {endpoint,get} from './api';
import type {Document} from './api';
import type {FactLocation} from './attempt-facts';
import {ActionBar,ErrorNotice} from './ui';

export function FileView({title,doc}:{title:string;doc:Document}){
 return <section className="file-view" id={`record-${title}`}><h3>{title}</h3>{doc.error?<p role="status" className="notice">{doc.error}</p>:<pre>{typeof doc.data==='string'?doc.data:JSON.stringify(doc.data,null,2)}</pre>}</section>;
}
export function Analyses({study,analyses,selected=false}:{study:string;analyses:(Document&{name:string;schema?:string|null})[];selected?:boolean}){
 if(selected&&analyses[0])return <ReportPage study={study} name={analyses[0].name}/>;
 return <section><h2>分析结果</h2>{analyses.length?analyses.map(a=><p key={a.name}><a href={analysisLink(study,a.name,a.schema)}>{a.name}</a>{a.error&&<ErrorNotice>{a.error}</ErrorNotice>}</p>):<p>尚无分析报告。</p>}</section>;
}
type LogPage={name:string;start:number;limit:number;total_lines:number;text:string};
export function PagedLog({study,attempt,log,locate}:{study:string;attempt:string;log:string;locate?:FactLocation|null}){
 const [start,setStart]=useState(0),[data,setData]=useState<LogPage|null>(null),[error,setError]=useState('');
 const [query,setQuery]=useState(''),[match,setMatch]=useState<number|null>(null),[message,setMessage]=useState(''),[search,setSearch]=useState<{query:string;start:number;last:boolean;id:number;end?:number}|null>(null),[searching,setSearching]=useState(false);
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<LogPage>(endpoint(study,'attempts',attempt,'logs',log)+`?start=${start}&limit=120`,c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,log,start]);
 useEffect(()=>{const c=new AbortController();if(search){setSearching(true);setMessage('');const params=new URLSearchParams({query:search.query,start:String(search.start),last:String(search.last)});get<{line:number|null;matches:number}>(endpoint(study,'attempts',attempt,'log-search',log)+'?'+params,c.signal).then(v=>{if(!c.signal.aborted){if(search.end!==undefined&&v.line!==null&&v.line>search.end){setMatch(null);setMessage('记录的来源区间内没有匹配；请核对 facts 与当前日志。');return;}setMatch(v.line);setMessage(v.line===null?'未找到下一处匹配。':`找到第 ${v.line+1} 行 · 全文 ${v.matches} 个匹配行`);if(v.line!==null)setStart(Math.max(0,v.line-3));}}).catch(e=>{if(!c.signal.aborted)setMessage(e.message);}).finally(()=>{if(!c.signal.aborted)setSearching(false);});}return()=>c.abort();},[study,attempt,log,search]);
 useEffect(()=>{if(locate){setQuery(locate.query);setSearch({query:locate.query,start:locate.start,last:false,id:locate.id,end:locate.end});setMatch(null);}},[locate]);
 const logLines=data?.text.split('\n')??[];
 const find=(text:string,last=false)=>{if(text)setSearch(s=>({query:text,start:last?0:match===null?start:match+1,last,id:(s?.id??0)+1}));};
 return <section aria-label="日志分页"><h3>{log}</h3>
 {locate&&<p className="muted">在当前日志 {log} 中查找事实值{locate.scoped?`（记录区间 ${locate.start+1}–${locate.end!+1} 行）`:'（未记录来源区间）'}；匹配仅供核对，不自动证明来源对应。多份日志请先选择正确文件。</p>}
 <div className="log-search"><label>关键词 <input aria-label="日志关键词" value={query} maxLength={256} onChange={e=>{setQuery(e.target.value);setMatch(null);setSearch(null);setSearching(false);setMessage('');}} onKeyDown={e=>{if(e.key==='Enter')find(query);}}/></label><button disabled={!query||searching} onClick={()=>find(query)}>搜索下一处</button><button disabled={searching} onClick={()=>find('Error termination',true)}>最后一次 Error termination</button><button disabled={searching} onClick={()=>find('Normal termination',true)}>最后一次 Normal termination</button></div>
 {searching?<p role="status">搜索日志…</p>:message&&<p role="status">{message}</p>}
 {error?<p role="alert">{error}</p>:data?<><p>共 {data.total_lines} 行 · {data.total_lines?data.start+1:0}–{Math.min(data.start+data.limit,data.total_lines)} 行</p><ActionBar label="日志分页操作"><button disabled={start===0} onClick={()=>{setStart(Math.max(0,start-120));setMatch(null);}}>上一页</button><button disabled={start+120>=data.total_lines} onClick={()=>{setStart(start+120);setMatch(null);}}>下一页</button></ActionBar><pre data-testid="raw-log">{data.text?logLines.map((line,i)=><span className={start+i===match?'log-match':undefined} key={i}>{line}{i<logLines.length-1?'\n':''}</span>):'日志为空。'}</pre></>:<p role="status">读取日志…</p>}</section>;
}
