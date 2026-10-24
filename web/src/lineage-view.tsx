import {useState} from 'react';
import type {Study} from './api';
import {object} from './api';
import {comparisonObjects} from './quick-comparison';
import type {ComparedObject,EvidenceCatalog} from './quick-comparison';
import {routeHash} from './routing';
export function lineageObjects(data:Study,catalog:EvidenceCatalog|undefined):ComparedObject[]{
 const registered=comparisonObjects(catalog),assigned=new Set(registered.flatMap(o=>o.members)),remaining=new Set(data.attempts.map(a=>a.id).filter(id=>!assigned.has(id))),adj=new Map([...remaining].map(id=>[id,new Set<string>()]));
 for(const edge of data.graph.edges)if(remaining.has(edge.parent)&&remaining.has(edge.child)){adj.get(edge.parent)!.add(edge.child);adj.get(edge.child)!.add(edge.parent);}
 const groups:ComparedObject[]=[],used=new Set(registered.map(o=>o.id));
 while(remaining.size){const todo=[[...remaining].sort()[0]],members=new Set<string>();while(todo.length){const id=todo.pop()!;if(members.has(id))continue;members.add(id);todo.push(...adj.get(id)!);}
  members.forEach(id=>remaining.delete(id));let n=groups.length+1;while(used.has(`object-${n}`))n++;const id=`object-${n}`;used.add(id);
  groups.push({id,name:`未登记 · ${id}`,registered:false,status:'candidate',members:[...members].sort(),adopted:{},values:{}});
 }
 return [...registered,...groups];
}
export function LineageView({data,catalog}:{data:Study;catalog:EvidenceCatalog|undefined}){
 const objects=lineageObjects(data,catalog),[selected,setSelected]=useState(''),obj=objects.find(o=>o.id===selected)??objects[0];
 const members=new Set(obj?.members??[]),pending=new Set(members),placed=new Set<string>(),rows:string[][]=[],lanes=new Map<string,number>(),cycles:string[]=[];
 const parents=(id:string)=>data.graph.edges.filter(e=>e.child===id);
 const multiplicity=(id:string)=>{const f=data.attempts.find(a=>a.id===id)?.facts.data;return object(f)&&Number.isInteger(f.multiplicity)?String(f.multiplicity):'未知';};
 while(pending.size){let ready=[...pending].sort().filter(id=>parents(id).every(e=>!members.has(e.parent)||placed.has(e.parent)));
  if(!ready.length){ready=[[...pending].sort()[0]];cycles.push(ready[0]);}
  for(const id of ready){const p=parents(id).find(e=>placed.has(e.parent)),lane=p&&multiplicity(p.parent)===multiplicity(id)?lanes.get(p.parent):undefined;
   const target=lane!==undefined&&rows[lane].at(-1)===p?.parent?lane:rows.length;if(target===rows.length)rows.push([]);rows[target].push(id);lanes.set(id,target);placed.add(id);pending.delete(id);
  }
 }
 return <section className="lineage-view"><h3>来源关系</h3><label>对象 <select aria-label="来源对象" value={obj?.id??''} onChange={e=>setSelected(e.target.value)}>{objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><p>每次显示一个对象；未登记分组只按 parents 连通关系，不推断构象或电子态身份。框色表示审阅记录：绿色为有记录，黄色为待审，灰色为缺失，红色为不可读；有记录不代表科学通过。</p>
 {!obj?<p>暂无对象或 Attempt。</p>:<><h4>{obj.name}</h4>{cycles.length>0&&<p role="status">存在环：{cycles.join('、')}；仅展示关系，不推断顺序。</p>}
 <div className="lineage-rows">{rows.map((row,i)=><div className="lineage-row" key={i}><strong>链 {i+1} · 多重度 {multiplicity(row[0])}</strong><ol>{row.map(id=>{const a=data.attempts.find(a=>a.id===id),state=a?.review_state??'missing';return <li key={id}><div className="lineage-parents">{parents(id).map((p,j)=><span key={j}>{data.attempts.some(a=>a.id===p.parent)?<a href={routeHash([data.id,p.parent])}>{p.parent}</a>:<span>{p.parent}（缺失父节点）</span>} → {p.relation||'来源'}{!members.has(p.parent)&&'（对象外来源）'}</span>)}</div><a className={`lineage-node review-${state}${state==='missing'&&a?.state==='fetched'?' review-pending':''}`} href={routeHash([data.id,id])}><strong>{id}</strong><span>{a?.template??'未知'} · {a?.state??'缺失'}</span><span>审阅：{state==='present'?'有记录':state==='unreadable'?'不可读':state==='empty'?'空记录':'未记录'}</span></a></li>;})}</ol></div>)}</div></>}
 </section>;
}
