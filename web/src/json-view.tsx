import {useState} from 'react';
import {object} from './api';
import {DataTableView} from './data-table-view';
const valueText=(value:unknown)=>typeof value==='string'?value:JSON.stringify(value)??'';
function JSONTree({value,name}:{value:unknown;name:string}){
 const [open,setOpen]=useState(false);
 if(!object(value)&&!Array.isArray(value))return <div className="json-leaf"><strong>{name}: </strong>{JSON.stringify(value)}</div>;
 const entries=Object.entries(value);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{name} · {Array.isArray(value)?'数组':'对象'} ({entries.length})</summary>{open&&<div className="json-children">{entries.map(([key,item])=><JSONTree key={key} name={key} value={item}/>)}</div>}</details>;
}
export function JSONView({value}:{value:unknown}){
 const [raw,setRaw]=useState(false);
 const objects=Array.isArray(value)&&value.length>0&&value.every(object);
 const keys=objects?[...new Set(value.flatMap(row=>Object.keys(row)))]:[];
 return <div className="json-view"><button aria-pressed={raw} onClick={()=>setRaw(v=>!v)}>{raw?'结构化显示':'格式化原文'}</button>{raw?<pre>{JSON.stringify(value,null,2)}</pre>:objects?<>{keys.length>30&&<p role="status">超过 30 列，仅显示前 30 列；完整内容可查看格式化原文。</p>}<DataTableView headers={keys.slice(0,30)} rows={value.map(row=>keys.slice(0,30).map(key=>Object.hasOwn(row,key)?valueText(row[key]):''))}/></>:Array.isArray(value)?<ol className="json-list">{value.map((item,i)=><li key={i}>{object(item)||Array.isArray(item)?<JSONTree name={String(i)} value={item}/>:<span>{JSON.stringify(item)}</span>}</li>)}</ol>:object(value)?<JSONTree name="JSON" value={value}/>:<pre>{JSON.stringify(value)}</pre>}</div>;
}
