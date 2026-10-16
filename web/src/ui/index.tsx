import {useState} from 'react';
import type {ReactNode} from 'react';

export const readPreference=(key:string,fallback:string)=>{try{return localStorage.getItem('ag-ui:'+key)??fallback;}catch{return fallback;}};
export const savePreference=(key:string,value:string)=>{try{localStorage.setItem('ag-ui:'+key,value);}catch{/* Browser preferences never block reading data. */}};
export type Tone='ok'|'warn'|'bad'|'info'|'neutral';
export function statusTone(value:string):Tone{
 if(['running','submitted','submitting','queued'].includes(value))return 'info';
 if(['finished','completed'].includes(value))return 'ok';
 if(['error','failed_presubmit','interrupted','not_met','mismatch'].includes(value))return 'bad';
 if(['unknown','fetched','stale','partial','tool_checks_passed','met','met_by_endpoint_optimization','pending'].includes(value))return 'warn';
 return 'neutral';
}
export function StatusBadge({children,tone='neutral'}:{children:ReactNode;tone?:Tone}){return <span className={`StatusBadge tone-${tone}`}>{children}</span>;}
export function Panel({title,children}:{title:string;children:ReactNode}){return <section className="Panel" aria-label={title}><h2>{title}</h2>{children}</section>;}
export function EmptyState({children}:{children:ReactNode}){return <p className="EmptyState">{children}</p>;}
export function ErrorNotice({children}:{children:ReactNode}){return <p className="ErrorNotice" role="alert">{children}</p>;}
export function Collapsible({page,block,title,children,defaultOpen=false}:{page:string;block:string;title:string;children:ReactNode;defaultOpen?:boolean}){
 const key=`collapse:${page}:${block}`;
 const [open,setOpen]=useState(()=>readPreference(key,String(defaultOpen))==='true');
 return <details className="Collapsible" open={open} ><summary onClick={e=>{e.preventDefault();const value=!open;setOpen(value);savePreference(key,String(value));}}>{title}</summary>{children}</details>;
}
