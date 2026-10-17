import {Fragment,useEffect,useId,useRef,useState} from 'react';
import type {Key,ReactNode} from 'react';

export const readPreference=(key:string,fallback:string)=>{try{return localStorage.getItem('ag-ui:'+key)??fallback;}catch{return fallback;}};
export const savePreference=(key:string,value:string)=>{try{localStorage.setItem('ag-ui:'+key,value);}catch{/* Preferences never block reading data. */}};
export type Tone='ok'|'warn'|'bad'|'info'|'neutral';
export function statusTone(value:string):Tone{
 if(['running','submitted','submitting','queued','R','Q'].includes(value))return 'info';
 if(['finished','completed','fresh'].includes(value))return 'ok';
 if(['error','failed','failed_presubmit','interrupted','not_met','mismatch','unavailable','unconverged'].includes(value))return 'bad';
 if(['unknown','fetched','stale','partial','tool_checks_passed','met','met_by_endpoint_optimization','pending','awaiting_second_observation','stalled'].includes(value))return 'warn';
 return 'neutral';
}
export function StatusBadge({children,tone='neutral'}:{children:ReactNode;tone?:Tone}){return <span className={`StatusBadge tone-${tone}`}>{children}</span>;}
export function Panel({title,children,className=''}:{title:string;children:ReactNode;className?:string}){return <section className={`Panel ${className}`} aria-label={title}><h2>{title}</h2>{children}</section>;}
export function KpiTile({label,value,detail,className=''}:{label:string;value:ReactNode;detail?:ReactNode;className?:string}){return <article className={`KpiTile ${className}`} aria-label={label}><h3>{label}</h3><strong className="kpi-value">{value}</strong>{detail&&<p className="muted">{detail}</p>}</article>;}
export type Fact={label:string;value:ReactNode;onLocate?:()=>void;sourceLabel?:string;emphasis?:boolean};
export function FactGrid({facts}:{facts:Fact[]}){return <dl className="FactGrid">{facts.map((f,i)=><Fragment key={i}><dt>{f.label}</dt><dd className={f.emphasis?'fact-emphasis':undefined}>{f.value}{f.onLocate&&<button className="fact-source" aria-label={f.sourceLabel??`定位${f.label}来源`} onClick={f.onLocate}>来源 ↗</button>}</dd></Fragment>)}</dl>;}
export function EmptyState({children}:{children:ReactNode}){return <p className="EmptyState">{children}</p>;}
export function ErrorNotice({children}:{children:ReactNode}){return <p className="ErrorNotice" role="alert">{children}</p>;}
export function ActionBar({children,label='页面操作',danger}:{children:ReactNode;label?:string;danger?:ReactNode}){return <div className="ActionBar" role="group" aria-label={label}>{children}{danger&&<div className="danger">{danger}</div>}</div>;}
export function Collapsible({page,block,...props}:{page:string;block:string;title:string;children:ReactNode;defaultOpen?:boolean}){return <Disclosure key={page+':'+block} storageKey={`collapse:${page}:${block}`} {...props}/>;}
function Disclosure({storageKey,title,children,defaultOpen=false}:{storageKey:string;title:string;children:ReactNode;defaultOpen?:boolean}){
 const [open,setOpen]=useState(()=>{const saved=readPreference(storageKey,'');return saved==='true'?true:saved==='false'?false:defaultOpen;});
 return <details className="Collapsible" open={open}><summary onClick={e=>{e.preventDefault();const value=!open;setOpen(value);savePreference(storageKey,String(value));}}>{title}</summary>{children}</details>;
}
export type TableColumn<Row>={key:string;label:string;render:(row:Row)=>ReactNode;optional?:boolean;defaultVisible?:boolean;onSort?:()=>void;sort?:'ascending'|'descending'|'none'};
export function DataTable<Row>({label,rows,columns,rowKey}:{label:string;rows:Row[];columns:TableColumn<Row>[];rowKey:(row:Row)=>Key}){
 const [choices,setChoices]=useState<Record<string,boolean>>({});
 const visible=columns.filter(c=>!c.optional||(choices[c.key]??c.defaultVisible??false));
 return <div className="DataTable">{columns.some(c=>c.optional)&&<details className="column-picker"><summary>显示列</summary><fieldset><legend>{label}的可选列</legend>{columns.filter(c=>c.optional).map(c=><label key={c.key}><input type="checkbox" checked={choices[c.key]??c.defaultVisible??false} onChange={e=>setChoices({...choices,[c.key]:e.target.checked})}/>{c.label}</label>)}</fieldset></details>}
 <div className="table-scroll"><table aria-label={label}><thead><tr>{visible.map(c=><th key={c.key} scope="col" aria-sort={c.sort}>{c.onSort?<button onClick={c.onSort}>{c.label}{c.sort==='ascending'?' ↑':c.sort==='descending'?' ↓':''}</button>:c.label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={rowKey(row)}>{visible.map(c=><td key={c.key}>{c.render(row)}</td>)}</tr>)}</tbody></table></div>{rows.length===0&&<EmptyState>暂无记录。</EmptyState>}</div>;
}
export function Drawer({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),id=useId();
 useEffect(()=>{const dialog=ref.current;if(!dialog||!open)return;const previous=document.activeElement;dialog.showModal();return()=>{dialog.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};},[open]);
 return <dialog ref={ref} className="Drawer" aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}}><div className="drawer-heading"><h2 id={id}>{title}</h2><button aria-label="关闭抽屉" onClick={onClose}>关闭</button></div>{children}</dialog>;
}
