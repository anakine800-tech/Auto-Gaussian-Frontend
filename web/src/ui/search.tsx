import {useEffect,useState} from 'react';
import {get} from '../api';
type Results={groups:{study:string;title:string;hits:{label:string;detail:string;href:string}[]}[];incomplete:boolean;truncated:boolean;message:string|null};
export function GlobalSearch(){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[results,setResults]=useState<Results|null>(null),[error,setError]=useState('');
 const needle=query.trim();
 useEffect(()=>{
  setResults(null);setError('');if(!needle)return;
  const controller=new AbortController();
  const timer=window.setTimeout(()=>get<Results>('/api/search?q='+encodeURIComponent(needle),controller.signal).then(v=>{if(!controller.signal.aborted)setResults(v);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}),180);
  return()=>{clearTimeout(timer);controller.abort();};
 },[needle]);
 return <div className="global-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
 <span aria-hidden="true" className="search-symbol">⌕</span><input maxLength={256} aria-label="全局搜索" placeholder="搜索本机 Study、编号、标签或文件名" value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}/>
 {open&&needle&&<div className="search-results" role="region" aria-label="搜索结果"><p className="muted">本机所有 Study · 仅名称与索引元数据</p>
 {error?<p role="alert">{error}</p>:!results?<p role="status">搜索中…</p>:<>
 {results.incomplete&&<p role="status">{results.message??'索引未完成'}</p>}
 {results.groups.map(group=><section key={group.study} aria-label={group.title}><h3>{group.title}</h3>{group.hits.map(hit=><a key={hit.href} href={hit.href} onClick={()=>setOpen(false)}><strong>{hit.label}</strong><small>{group.study} · {hit.detail}</small></a>)}</section>)}
 {!results.groups.length&&<p>本机 study 中没有匹配的编号、标签或文件名{results.incomplete?'（仅限已完成索引的范围）':''}</p>}
 {results.truncated&&<p>最多显示 50 条，请缩小关键词范围。</p>}</>}
 </div>}
 </div>;
}
