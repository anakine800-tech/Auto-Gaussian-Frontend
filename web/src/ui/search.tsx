import {useState} from 'react';
import type {Attempt,Study} from '../api';
import {routeHash,studyHash} from '../routing';

export type AttemptIndex={study:string;id:string;files:{kind:'inputs'|'logs'|'record';name:string}[]};
export function indexAttempt(study:string,data:Attempt):AttemptIndex{
 const files:AttemptIndex['files']=[...data.input_files.map(f=>({kind:'inputs' as const,name:f.name})),...data.logs.map(name=>({kind:'logs' as const,name}))];
 for(const [name,doc] of [['manifest.json',data.manifest],['status.json',data.status],['facts.json',data.facts],['review.md',data.review],['final.xyz',data.geometry]] as const)if(doc.data!==null)files.push({kind:'record',name});
 return {study,id:data.id,files};
}
type Hit={label:string;detail:string;href:string};
export function GlobalSearch({studies,attempts}:{studies:Study[];attempts:AttemptIndex[]}){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
 const needle=query.trim().toLocaleLowerCase(),hits:Hit[]=[];
 if(needle)for(const study of studies){
  for(const a of study.attempts)if(`${a.id} ${a.label??''}`.toLocaleLowerCase().includes(needle))hits.push({label:a.id,detail:`${study.id} · ${a.label??'Attempt'}`,href:routeHash([study.id,a.id])});
  for(const f of study.structure_files)if(f.parts.join('/').toLocaleLowerCase().includes(needle))hits.push({label:f.parts.at(-1)!,detail:study.id+' · '+f.parts.join('/'),href:routeHash([study.id,...f.parts])});
  for(const f of study.analyses)if(f.name.toLocaleLowerCase().includes(needle))hits.push({label:f.name,detail:study.id+' · 分析文件',href:studyHash(study.id,'analysis','file',...f.name.split('/'))});
  if('study.md'.includes(needle))hits.push({label:'study.md',detail:study.id,href:studyHash(study.id,'files')});
  for(const a of attempts.filter(a=>a.study===study.id&&study.attempts.some(row=>row.id===a.id)))for(const f of a.files)if(f.name.toLocaleLowerCase().includes(needle))hits.push({label:f.name,detail:`${study.id} / ${a.id} · ${f.kind}`,href:routeHash([study.id,a.id])+'?'+new URLSearchParams({fileKind:f.kind,file:f.name})});
 }
 const unique=[...new Map(hits.map(h=>[h.href,h])).values()];
 return <div className="global-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
 <span aria-hidden="true" className="search-symbol">⌕</span><input aria-label="全局搜索" placeholder="搜索 Attempt、标签、文件名" value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}/>
 {open&&needle&&<div className="search-results" role="region" aria-label="搜索结果"><p className="muted">已读取的 {studies.length} 个 Study · {unique.length} 项</p>{unique.slice(0,30).map(hit=><a key={hit.href} href={hit.href} onClick={()=>setOpen(false)}><strong>{hit.label}</strong><small>{hit.detail}</small></a>)}{!unique.length&&<p>没有匹配项。只搜索已读取的 Study。</p>}{unique.length>30&&<p>显示前 30 项，请缩小关键词范围。</p>}</div>}
 </div>;
}
