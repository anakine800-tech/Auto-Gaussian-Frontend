import {useEffect,useRef,useState} from 'react';
export type StudyOption={id:string;title:string;type:'research'|'validation'|'test'};
const key='ag:recent-studies';
function recentStudies():string[]{try{const value=JSON.parse(localStorage.getItem(key)??'[]');return Array.isArray(value)?value.filter(v=>typeof v==='string').slice(0,20):[];}catch{return [];}}
export function StudySwitcher({studies,selected,onSelect}:{studies:StudyOption[];selected:string;onSelect:(id:string)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[tests,setTests]=useState(false),[recent,setRecent]=useState(recentStudies);
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!selected)return;const next=[selected,...recentStudies().filter(id=>id!==selected)].slice(0,20);setRecent(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{/* No persistence is required for navigation. */}},[selected]);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{if(!open)return;input.current?.focus();const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 const filtered=studies.filter(s=>(s.id+' '+s.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>{const rank=(id:string)=>recent.includes(id)?recent.indexOf(id):Infinity;return rank(a.id)-rank(b.id)||a.title.localeCompare(b.title);});
 const group=(validation:boolean)=>filtered.filter(s=>(s.type==='validation'||s.type==='test')===validation).map(s=><button role="option" aria-selected={selected===s.id} key={s.id} onClick={()=>{onSelect(s.id);close();}}><strong>{s.title}</strong><small>{s.id}{recent.includes(s.id)?' · 最近打开':''}</small></button>);
 return <div className="study-switcher">
 <button ref={trigger} className="study-switcher-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(v=>!v);setQuery('');}}><span>Study ▾</span><strong>{studies.find(s=>s.id===selected)?.title??'选择 Study'}</strong></button>
 {open&&<div ref={panel} role="dialog" aria-label="切换 Study" className="study-switcher-panel" onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();close();return;}
  const focusable=[...e.currentTarget.querySelectorAll<HTMLElement>('input,button')],index=focusable.indexOf(document.activeElement as HTMLElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();focusable[(index+(e.key==='ArrowDown'?1:focusable.length-1))%focusable.length]?.focus();}
  if(e.key==='Tab'&&(e.shiftKey&&index===0||!e.shiftKey&&index===focusable.length-1)){e.preventDefault();focusable[e.shiftKey?focusable.length-1:0]?.focus();}
 }}>
 <input ref={input} aria-label="筛选 Study" placeholder="名称或标题" value={query} onChange={e=>setQuery(e.target.value)}/>
 <div role="listbox" aria-label="研究"><h3>研究</h3>{group(false)}</div>
 <button className="study-group-toggle" aria-expanded={tests} onClick={()=>setTests(v=>!v)}>验证与测试 {tests?'▴':'▾'}（{filtered.filter(s=>s.type==='validation'||s.type==='test').length}）</button>
 {tests&&<div role="listbox" aria-label="验证与测试">{group(true)}</div>}
 {!filtered.length&&<p>没有匹配的 Study</p>}<button onClick={close}>关闭切换器</button>
 </div>}
 </div>;
}
