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
 // The hash query is the source of truth, including reload, shared links and back.
 const query=new URLSearchParams(location.hash.split('?')[1]??'');
 const sort=fields.some(([key])=>key===query.get('sort'))?query.get('sort')!:'id',direction=query.get('order')==='asc'?1:-1;
 const status=query.get('status')??'',type=query.get('type')??'',attention=query.get('attention')==='1';
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(query);for(const [key,value] of Object.entries(values))value?next.set(key,value):next.delete(key);location.hash=location.hash.split('?')[0]+(next.size?'?'+next:'');};
 const review=query.get('review')==='1';
 const rows=data.attempts.filter(a=>(!status||a.state===status)&&(!type||a.template===type)&&(!attention||needsAttention(a))&&(!review||pendingReview(a))).map(row).sort((a,b)=>{
  const x=a.values[sort],y=b.values[sort];if(x===null)return y===null?a.attempt.id.localeCompare(b.attempt.id):1;if(y===null)return -1;
  return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true}))*direction||a.attempt.id.localeCompare(b.attempt.id);
 });
 const columns:TableColumn<Row>[]=fields.map(([key,label],index)=>({key,label,optional:index>=9,sort:sort===key?(direction===1?'ascending':'descending'):'none',onSort:()=>change({sort:key,order:sort===key&&direction===1?'desc':'asc'}),render:r=>{
  const value=r.values[key],a=r.attempt;
  if(key==='id')return <a href={routeHash([data.id,a.id])}>{a.id}</a>;
  if(key==='status')return <><StatusBadge tone={statusTone(a.state)}>{a.state}</StatusBadge>{pendingReview(a)&&<span className="attention-note">待审阅</span>}</>;
  if(key==='method')return <span className="method-abbreviation" title={display(value)}>{display(value)}</span>;
  if(key==='convergence')return value?<StatusBadge tone={value==='✓'?'ok':'bad'}>{value}</StatusBadge>:'—';
  return display(value);
 }}));
 const statuses=[...new Set(data.attempts.map(a=>a.state))].sort(),types=[...new Set(data.attempts.map(a=>a.template).filter((v):v is string=>Boolean(v)))].sort();
 const problems=data.attempts.flatMap(a=>[a.manifest.error&&`${a.id} · manifest.json：${a.manifest.error}`,a.status.error&&`${a.id} · status.json：${a.status.error}`,a.facts.error&&`${a.id} · facts.json：${a.facts.error}`,a.review_state==='unreadable'&&`${a.id} · review.md：不可读取，审阅状态未知`].filter(Boolean));
 return <Panel title="Attempt 表" className="attempt-table">
 <ActionBar label="Attempt 筛选"><label>状态 <select aria-label="状态筛选" value={status} onChange={e=>change({status:e.target.value})}><option value="">全部状态</option>{[...new Set([...statuses,...(status?[status]:[])])].map(v=><option key={v}>{v}</option>)}</select></label><label>类型 <select aria-label="类型筛选" value={type} onChange={e=>change({type:e.target.value})}><option value="">全部类型</option>{[...new Set([...types,...(type?[type]:[])])].map(v=><option key={v}>{v}</option>)}</select></label><label><input type="checkbox" checked={attention} onChange={e=>change({attention:e.target.checked?'1':''})}/>需要我处理</label><button onClick={()=>change({status:'',type:'',attention:'',sort:'',order:'',review:''})}>重置</button><span className="muted">{rows.length} / {data.attempts.length} 个 Attempt</span></ActionBar>
 {review&&<p><StatusBadge tone="warn">仅待审 Attempt</StatusBadge> <button onClick={()=>change({review:''})}>显示其他 Attempt</button></p>}
 <p className="muted">状态来自本地记录；能量与优化收敛来自 facts.json。缺失值为 —，不推算。</p>
 <DataTable label="Attempt 结果表" columns={columns} rows={rows} rowKey={r=>r.attempt.id}/>
 <Collapsible page={data.id} block="attempt-rules" title="字段与处理规则"><p>类型取 manifest.template；方法缩写取 science.method_basis，缺失时截短显示已有 route，悬停可读全文。收敛仅取 opt_converged，不以正常终止推断。</p><p>待审：状态为 fetched、facts.json 是可读 JSON 对象，且 review.md 缺失或为空。已有 review 内容不代表科学验收。“需要我处理”还包含 finished 待取回、未知或异常状态，以及必要记录读取异常。用时取 status.elapsed；提交时间仅取明确的 status.submitted_at，不用创建或修改时间代替。</p></Collapsible>
 {problems.length>0&&<Collapsible page={data.id} block="attempt-issues" title={`记录读取提示（${problems.length}）`}>{problems.map((p,i)=><p key={i} className="muted">{p}</p>)}</Collapsible>}
 </Panel>;
}
