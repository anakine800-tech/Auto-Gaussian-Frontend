import {analysisLink} from './analysis-summary';
import {useEffect,useId,useState} from 'react';
import {display,endpoint,get,object} from './api';
import type {Document,Graph} from './api';
import type {FactLocation} from './attempt-facts';
import {ActionBar,DataTable,ErrorNotice,StatusBadge} from './ui';

export function FileView({title,doc}:{title:string;doc:Document}){
 return <section className="file-view" id={`record-${title}`}><h3>{title}</h3>{doc.error?<p role="status" className="notice">{doc.error}</p>:<pre>{typeof doc.data==='string'?doc.data:JSON.stringify(doc.data,null,2)}</pre>}</section>;
}
export function RelationshipGraph({graph,onSelect}:{graph:Graph;onSelect:(id:string)=>void}){
 const marker=useId();const count=graph.nodes.length;
 const points=new Map(graph.nodes.map((n,i)=>[n.id,{x:460+330*Math.cos(2*Math.PI*i/Math.max(1,count)),y:270+195*Math.sin(2*Math.PI*i/Math.max(1,count))}]));
 return <section><h2>Attempt 关系图</h2><p className="muted">箭头由 parent 指向 child，标签来自 manifest.parents[].relation。缺失父节点保留显示。</p>{count===0?<p>暂无 Attempt。</p>:<>
 <div className="graph-scroll"><svg className="graph" viewBox="0 0 920 540" role="img" aria-label="Attempt 关系图"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="var(--accent)"/></marker></defs>
 {graph.edges.map((e,i)=>{const a=points.get(e.parent)!,b=points.get(e.child)!;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;return <g key={i}><line x1={a.x} y1={a.y} x2={b.x-18*dx/d} y2={b.y-18*dy/d} stroke="var(--accent)" strokeWidth="2" markerEnd={`url(#${marker})`}/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2-7} textAnchor="middle">{e.relation}</text></g>;})}
 {graph.nodes.map(n=>{const p=points.get(n.id)!;return <g key={n.id}><circle cx={p.x} cy={p.y} r="17" fill={n.missing?'var(--warn)':'var(--accent)'}/><text x={p.x} y={p.y+35} textAnchor="middle">{n.id}</text><text x={p.x} y={p.y+52} textAnchor="middle" className="muted">{n.state}</text></g>;})}</svg></div>
 <ul className="graph-nodes">{graph.nodes.map(n=><li key={n.id}>{n.missing?<span>{n.id} · 缺失父节点</span>:<button onClick={()=>onSelect(n.id)}>{n.id} · {n.state}</button>}</li>)}</ul>
 <DataTable label="Attempt 关系列表" rows={graph.edges.map((edge,i)=>({...edge,key:i}))} rowKey={edge=>edge.key} columns={[{key:'parent',label:'Parent',render:e=>e.parent},{key:'relation',label:'Relation',render:e=>e.relation||'—'},{key:'child',label:'Child',render:e=>e.child}]}/></> }</section>;
}
export function Analyses({study,analyses,selected=false}:{study:string;analyses:(Document&{name:string;schema?:string|null})[];selected?:boolean}){
 const name=selected?analyses[0]?.name:undefined;
 const [doc,setDoc]=useState<Document|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setDoc(null);setError('');if(name)get<Document>(endpoint(study,'reports',...name.split('/')),c.signal).then(v=>{if(!c.signal.aborted)setDoc(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,name]);
 if(!selected)return <section><h2>分析结果</h2>{analyses.length?analyses.map(a=><p key={a.name}><a href={analysisLink(study,a.name,a.schema)}>{a.name}</a>{a.error&&<ErrorNotice>{a.error}</ErrorNotice>}</p>):<p>尚无 dedup、cluster 或 thermo 结果。</p>}</section>;
 if(error)return <ErrorNotice>{error}</ErrorNotice>;
 if(!doc)return <p role="status">读取报告正文…</p>;
 return <AnalysisDocuments analyses={[{...doc,name:name!}]}/>;
}
function AnalysisDocuments({analyses}:{analyses:(Document&{name:string})[]}){
 return <section><h2>分析结果</h2>{analyses.length===0&&<p>尚无 dedup、cluster 或 thermo 结果。</p>}{analyses.map(a=>{
 const data=object(a.data)?a.data:null;const rows=data&&Array.isArray(data.rows)?data.rows:null;
 return <article key={a.name}><h3>{a.name}</h3>{a.name.startsWith('ts-labels/')&&a.name.endsWith('/channel-suggestions.csv')&&<StatusBadge tone="warn">建议，待确认</StatusBadge>}{a.error?<p className="notice">{a.error}</p>:data?.schema==='ag-thermo/1'&&rows?<>
 <p className="muted">只展示已保存的热化学结果；布居仅针对提供的构象集合。</p>
 <div className="thermo-summary"><span>ensemble_G <strong>{display(data.ensemble_G)}</strong> Hartree</span><span>weighted_mean_G <strong>{display(data.weighted_mean_G)}</strong> Hartree</span></div>
 <div className="table-scroll"><table aria-label="热化学表"><thead><tr>{['Attempt','简并度','E / Eh','ZPE / Eh','H / Eh','qh_H / Eh','qh_G / Eh','ΔG / kcal·mol⁻¹','布居'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=>object(r)?<tr key={i}>{['attempt_id','degeneracy','E','ZPE','H','qh_H','qh_G','relative_G_kcal'].map(k=><td key={k}>{display(r[k])}</td>)}<td>{typeof r.population==='number'?(r.population*100).toFixed(3)+'%':'—'}</td></tr>:null)}</tbody></table></div>
 <details><summary>设置与完整结果</summary><pre>{JSON.stringify(data,null,2)}</pre></details></>:<pre>{typeof a.data==='string'?a.data:JSON.stringify(a.data,null,2)}</pre>}</article>;
 })}</section>;
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
