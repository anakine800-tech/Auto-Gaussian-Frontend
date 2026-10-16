import {useState} from 'react';
import type {Study} from '../api';
import {routeHash,studyHash} from '../routing';

type Hit={label:string;detail:string;href:string};
export function GlobalSearch({studies}:{studies:Study[]}){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
 const needle=query.trim().toLocaleLowerCase(),hits:Hit[]=[];
 if(needle)for(const study of studies){
  for(const a of study.attempts)if(`${a.id} ${a.label??''}`.toLocaleLowerCase().includes(needle))hits.push({label:a.id,detail:`${study.id} · ${a.label??'Attempt'}`,href:routeHash([study.id,a.id])});
  for(const f of study.structure_files)if(f.parts.join('/').toLocaleLowerCase().includes(needle))hits.push({label:f.parts.at(-1)!,detail:study.id+' · '+f.parts.join('/'),href:routeHash([study.id,...f.parts])});
  for(const f of study.analyses)if(f.name.toLocaleLowerCase().includes(needle))hits.push({label:f.name,detail:study.id+' · 分析文件',href:studyHash(study.id,'analysis','file',...f.name.split('/'))});
  if('study.md'.includes(needle))hits.push({label:'study.md',detail:study.id,href:studyHash(study.id,'files')});
 }
 return <div className="global-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
 <span aria-hidden="true" className="search-symbol">⌕</span><input aria-label="全局搜索" placeholder="搜索 Attempt、标签、文件名" value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}/>
 {open&&needle&&<div className="search-results" role="region" aria-label="搜索结果"><p className="muted">已读取的 {studies.length} 个 Study · {hits.length} 项</p>{hits.slice(0,30).map((hit,i)=><a key={i} href={hit.href} onClick={()=>setOpen(false)}><strong>{hit.label}</strong><small>{hit.detail}</small></a>)}{!hits.length&&<p>没有匹配项。只搜索已读取的 Study。</p>}{hits.length>30&&<p>显示前 30 项，请缩小关键词范围。</p>}</div>}
 </div>;
}
