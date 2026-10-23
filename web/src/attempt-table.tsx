import {catalogObjects,calculationType,electronicState} from './catalog-data';
import {setCompared,useCompareBasket} from './compare-basket';
import {PROGRESS} from './progress-definitions';
import {useState} from 'react';
import {StructureComparison} from './structure-comparison';
import {QuickComparison} from './quick-comparison-panel';
import {display,object} from './api';
import type {AttemptSummary,Study} from './api';
import {routeHash} from './routing';
import {needsAttention,pendingReview} from './overview';
import {ActionBar,Collapsible,DataTable,Panel,StatusBadge,statusTone} from './ui';
import type {TableColumn} from './ui';

type Value=string|number|null;
type Row={attempt:AttemptSummary;values:Record<string,Value>};
const scalar=(v:unknown):Value=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)?v:null;
function row(a:AttemptSummary):Row{
 const m=object(a.manifest.data)?a.manifest.data:{},s=object(a.status.data)?a.status.data:{},f=object(a.facts.data)?a.facts.data:{};
 const energies=object(f.energies)?f.energies:{},science=object(m.science)?m.science:{};
 return {attempt:a,values:{id:a.id,label:a.label,type:a.template,status:a.state,method:scalar(science.method_basis??f.route??science.route),energy:scalar(a.template==='xtb'?f.total_energy:energies.scf),free:scalar(energies.g),imag:scalar(f.n_imag),convergence:f.opt_converged===true?'✓':f.opt_converged===false?'✗':null,cluster:scalar(m.cluster),cores:scalar(m.cores),elapsed:scalar(s.elapsed),parents:Array.isArray(m.parents)?m.parents.filter(object).map(p=>scalar(p.attempt_id)).filter(Boolean).join(', ')||null:null,submitted:scalar(s.submitted_at)}};
}
const fields=[['id','编号'],['label','标签'],['type','类型'],['status','状态'],['method','方法缩写'],['energy','电子能 / Eh'],['free','自由能 / Eh'],['imag','虚频数'],['convergence','收敛'],['cluster','集群'],['cores','核数'],['elapsed','用时'],['parents','父 Attempt'],['submitted','提交时间']];
export function AttemptTable({data}:{data:Study}){
 const {ids:selected}=useCompareBasket(data.id);
 const [comparing,setComparing]=useState(false),[structures,setStructures]=useState(false);
 // The hash query is the source of truth, including reload, shared links and back.
 const query=new URLSearchParams(location.hash.split('?')[1]??'');
 const sort=fields.some(([key])=>key===query.get('sort'))?query.get('sort')!:'id',direction=query.get('order')==='asc'?1:-1;
 const status=query.get('status')??'',type=query.get('type')??'',attention=query.get('attention')==='1';
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(query);for(const [key,value] of Object.entries(values))value?next.set(key,value):next.delete(key);location.hash=location.hash.split('?')[0]+(next.size?'?'+next:'');};
 const review=query.get('review')==='1';
 const rows=data.attempts.filter(a=>(!status||a.state===status)&&(!type||a.template===type)&&(!attention||needsAttention(a))&&(!review||pendingReview(a,data.catalog_review))).map(row).sort((a,b)=>{
  const x=a.values[sort],y=b.values[sort];if(x===null)return y===null?a.attempt.id.localeCompare(b.attempt.id):1;if(y===null)return -1;
  return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true}))*direction||a.attempt.id.localeCompare(b.attempt.id);
 });
 const objects=catalogObjects(data);
 const columns:TableColumn<Row>[]=fields.map(([key,label],index)=>({key,label,className:['energy','free','imag','cores'].includes(key)?'numeric':undefined,optional:index>=9,sort:sort===key?(direction===1?'ascending':'descending'):'none',onSort:()=>change({sort:key,order:sort===key&&direction===1?'desc':'asc'}),render:r=>{
  const value=r.values[key],a=r.attempt;
  if(key==='id')return <a href={routeHash([data.id,a.id])}>{a.id}</a>;
  if(key==='status')return <><StatusBadge tone={statusTone(a.state)}>{a.state}</StatusBadge>{pendingReview(a,data.catalog_review)&&<span className="attention-note">待审阅</span>}</>;
  if(['energy','free'].includes(key)&&typeof value==='number')return <span title={String(value)}>{value.toFixed(6)}</span>;
  if(key==='method')return <span className="method-abbreviation" title={display(value)}>{display(value)}</span>;
  if(key==='convergence')return value?<StatusBadge tone={value==='✓'?'ok':'bad'}>{value}</StatusBadge>:'—';
  return display(value);
 }}));
 columns.splice(2,0,{key:'object',label:'对象 · 电子态',render:r=>objects.filter(o=>o.members.some(m=>m.attempt===r.attempt.id)).map(o=>`${o.name} · ${electronicState(o)}`).join(' / ')||'未登记'},
 {key:'role',label:'计算类型',render:r=>{const members=objects.flatMap(o=>o.members.filter(m=>m.attempt===r.attempt.id));return members.length?[...new Set(members.map(m=>calculationType(r.attempt,m.role)))].join(' / '):calculationType(r.attempt);}});
 columns.unshift({key:'selection',label:'比较',render:r=><input type="checkbox" aria-label={`比较 ${r.attempt.id}`} checked={selected.includes(r.attempt.id)} onChange={e=>setCompared(data.id,r.attempt.id,e.target.checked)}/>});
 const statuses=[...new Set(data.attempts.map(a=>a.state))].sort(),types=[...new Set(data.attempts.map(a=>a.template).filter((v):v is string=>Boolean(v)))].sort();
 const problems=data.attempts.flatMap(a=>[a.manifest.error&&`${a.id} · manifest.json：${a.manifest.error}`,a.status.error&&`${a.id} · status.json：${a.status.error}`,a.facts.error&&`${a.id} · facts.json：${a.facts.error}`,a.review_state==='unreadable'&&`${a.id} · review.md：不可读取，审阅状态未知`].filter(Boolean));
 return <Panel title="Attempt 表" className="attempt-table">
 <ActionBar label="Attempt 筛选"><label>状态 <select aria-label="状态筛选" value={status} onChange={e=>change({status:e.target.value})}><option value="">全部状态</option>{[...new Set([...statuses,...(status?[status]:[])])].map(v=><option key={v}>{v}</option>)}</select></label><label>类型 <select aria-label="类型筛选" value={type} onChange={e=>change({type:e.target.value})}><option value="">全部类型</option>{[...new Set([...types,...(type?[type]:[])])].map(v=><option key={v}>{v}</option>)}</select></label><label><input type="checkbox" checked={attention} onChange={e=>change({attention:e.target.checked?'1':''})}/>需要我处理</label><button onClick={()=>change({status:'',type:'',attention:'',sort:'',order:'',review:''})}>重置</button><button disabled={selected.length<2} onClick={()=>setComparing(true)}>快速比较（{selected.length}）</button><button disabled={selected.length<2||selected.length>3} onClick={()=>setStructures(true)}>结构对比（{selected.length}）</button><span className="muted">{rows.length} / {data.attempts.length} 个 Attempt</span></ActionBar>
 {review&&<p><StatusBadge tone="warn">仅待审 Attempt</StatusBadge> <button onClick={()=>change({review:''})}>显示其他 Attempt</button></p>}
 <p className="muted">状态来自本地记录；能量与优化收敛来自 facts.json。缺失值为 —，不推算。</p>
 {structures&&<StructureComparison study={data.id} ids={selected} onClose={()=>setStructures(false)}/>}
 {comparing&&<QuickComparison study={data.id} ids={selected} onClose={()=>setComparing(false)}/>}
 <DataTable label="Attempt 结果表" columns={columns} rows={rows} rowKey={r=>r.attempt.id}/>
 <Collapsible page={data.id} block="attempt-rules" title="字段与处理规则"><p>类型取 manifest.template；方法缩写取 science.method_basis，缺失时截短显示已有 route，悬停可读全文。收敛仅取 opt_converged，不以正常终止推断。</p><p>{data.catalog_review?.available?PROGRESS.review.detail:PROGRESS.reviewFallback}。{PROGRESS.reviewEvidence}。“需要我处理”还包含 finished 待取回、未知或异常状态，以及必要记录读取异常。用时取 status.elapsed；提交时间仅取明确的 status.submitted_at，不用创建或修改时间代替。</p></Collapsible>
 {problems.length>0&&<Collapsible page={data.id} block="attempt-issues" title={`记录读取提示（${problems.length}）`}>{problems.map((p,i)=><p key={i} className="muted">{p}</p>)}</Collapsible>}
 </Panel>;
}
