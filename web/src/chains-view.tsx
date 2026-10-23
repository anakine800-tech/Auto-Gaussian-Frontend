import {Fragment,useEffect,useState} from 'react';
import {display,endpoint,get} from './api';
import type {AttemptSummary,Study} from './api';
import {analysisLink} from './analysis-summary';
import {addObjectToBasket} from './compare-basket';
import {routeHash} from './routing';
import {ActionBar,DataTable,EmptyState,Panel,StatusBadge,statusTone} from './ui';
import {ENERGY_NOTICE} from './progress-definitions';
import {adoptionState,calculationType,catalogObjects,chainObjects,chainStatus,defaultBasis,electronicState,hasCatalog,keyReports,methodFromRoute,orderedMembers,record,relativeEnergies,representativeAttempt,roleLabels,routeOf} from './catalog-data';
import type {CatalogStudy,ChainObject,CompositionSource,EnergyBasis,EnergyRow} from './catalog-data';
import './ui/chains.css';

const reviewLabel=(a:AttemptSummary|undefined)=>!a?'Attempt 缺失':a.review_state==='present'?'有审阅记录':a.review_state==='unreadable'?'审阅不可读':a.state==='fetched'?'待审阅':'尚未取回';
function needsHandling(o:ChainObject,attempts:AttemptSummary[]){
 const ids=o.status==='adopted'?Object.values(o.adopted).map(a=>a?.attempt):o.members.map(m=>m.attempt);
 return o.status!=='retired'&&ids.some(id=>{const a=attempts.find(a=>a.id===id);return !a||['finished','unknown','failed','failed_presubmit','stalled','interrupted','error','unavailable','awaiting_second_observation'].includes(a.state)||a.review_state==='unreadable'||Boolean(a.manifest.error||a.status.error)||(a.state==='fetched'&&(a.review_state!=='present'||Boolean(a.facts.error)));});
}
function reviewSummary(o:ChainObject,attempts:AttemptSummary[]){
 const ids=o.status==='adopted'?Object.values(o.adopted).map(a=>a?.attempt):o.members.map(m=>m.attempt);
 return [...new Set(ids.map(id=>reviewLabel(attempts.find(a=>a.id===id))))].join(' / ')||'暂无审阅记录';
}
function factsText(a:AttemptSummary){const f=record(a.facts.data);return [
 `收敛 ${f.opt_converged===true?'是':f.opt_converged===false?'否':'—'}`,
 `虚频 ${display(f.n_imag)}`,`⟨S²⟩ ${display(f.s2)}`,`稳定性 ${display(f.wavefunction_stability)}`,`终止 ${display(f.termination)}`,
 ].join(' · ');}
function stepLabel(a:AttemptSummary|undefined,role:string){
 if(!a)return `${roleLabels[role]??role} · Attempt 缺失`;
 const f=record(a.facts.data),type=calculationType(a,role);
 if(role==='freq'&&typeof f.n_imag==='number')return `${type} ${f.n_imag} 虚频`;
 if((role==='opt'||role==='ts')&&f.opt_converged===true||role==='stable'&&f.wavefunction_stability==='stable'||role==='sp'&&f.termination==='normal')return `${type} ✓`;
 return `${type} · ${a.state}`;
}
export function EnergyCell({row}:{row:EnergyRow}){return <span className="chain-energy">{row.relative===null?'—':row.relative.toFixed(3)}{row.reason&&<small>（{row.reason}）</small>}{row.stateGap&&<small>电子态能差</small>}</span>;}
function useEnergies(data:CatalogStudy,objects:ChainObject[]){
 const [basis,setBasis]=useState<EnergyBasis>(()=>defaultBasis(data)),[reference,setReference]=useState('');
 const [loaded,setLoaded]=useState<{key:string;sources:Record<string,CompositionSource>}>({key:'',sources:{}});
 const ids=[...new Set(objects.filter(o=>o.status==='adopted').flatMap(o=>o.adopted.sp?[o.adopted.sp.attempt]:[]))].sort(),key=data.id+'/'+ids.join('/');
 useEffect(()=>{const c=new AbortController();setLoaded({key:'',sources:{}});
  Promise.all(ids.map(async id=>{try{return [id,await get<CompositionSource>(endpoint(data.id,'attempts',id,'comparison-structure'),c.signal)] as const;}catch{return [id,{error:'元素组成读取失败'}] as const;}})).then(entries=>{if(!c.signal.aborted)setLoaded({key,sources:Object.fromEntries(entries)});});
  return()=>c.abort();
 },[data,key]);
 const result=relativeEnergies(objects,data.attempts,loaded.key===key?loaded.sources:{},basis,reference);
 return {...result,basis,setBasis,setReference,loading:ids.length>0&&loaded.key!==key};
}
function EnergyControls({model,objects}:{model:ReturnType<typeof useEnergies>;objects:ChainObject[]}){return <>
 <p className="energy-notice">{ENERGY_NOTICE}</p><ActionBar label="能量换算选项">
 <label>口径 <select aria-label="能量口径" value={model.basis} onChange={e=>model.setBasis(e.target.value as EnergyBasis)}>{['E','E+ZPE','G'].map(b=><option key={b}>{b}</option>)}</select></label>
 <label>参照对象 <select aria-label="参照对象" value={model.referenceId} onChange={e=>model.setReference(e.target.value)}><option value="">自动：最低能已采用对象</option>{objects.filter(o=>o.registered&&o.status==='adopted').map(o=><option key={o.id} value={o.id}>{o.name} · {electronicState(o)}</option>)}</select></label>
 <button onClick={()=>model.setReference('')}>恢复最低能参照</button><span className="muted">相对能量 / kcal/mol{model.loading?' · 正在核对 SP 元素组成':''}</span>
 </ActionBar></>;}
function CompareObject({data,obj}:{data:Study;obj:ChainObject}){const id=representativeAttempt(obj,data.attempts);return <button disabled={!id} title={id?`代表 Attempt：${id}`:'没有可用的代表 Attempt'} onClick={()=>addObjectToBasket(data.id,obj,data.attempts)}>＋比较</button>;}
export function ChainsView({data}:{data:CatalogStudy}){
 const objects=chainObjects(data),model=useEnergies(data,objects);
 const [state,setState]=useState(''),[type,setType]=useState(''),[status,setStatus]=useState(''),[hideHistory,setHideHistory]=useState(true),[attention,setAttention]=useState(false),[expanded,setExpanded]=useState<string[]>([]);
 const find=(id:string)=>data.attempts.find(a=>a.id===id);
 const filtered=model.rows.filter(({object:o})=>(!state||electronicState(o)===state)&&(!type||o.members.some(m=>calculationType(find(m.attempt)??{template:null} as AttemptSummary,m.role)===type))&&(!status||chainStatus(o,data.attempts)===status)&&(!hideHistory||o.status!=='retired')&&(!attention||needsHandling(o,data.attempts)));
 const types=[...new Set(objects.flatMap(o=>o.members.map(m=>calculationType(find(m.attempt)??{template:null} as AttemptSummary,m.role))))].sort();
 return <Panel title="计算链" className="chains-view">
 {data.catalog?.warning&&<p className="notice" role="alert">{data.catalog.warning}</p>}
 {!hasCatalog(data)&&<CatalogEmpty/>}
 <p className="muted">每行来自登记的构象 × 电子态对象；未登记时仅按 parents 连通分组，不推定构象或电子态相同。步骤 ✓ 仅表示对应事实记录，不代表科学验收。</p>
 <EnergyControls model={model} objects={objects}/>
 <ActionBar label="计算链筛选"><label>电子态 <select aria-label="电子态筛选" value={state} onChange={e=>setState(e.target.value)}><option value="">全部</option>{[...new Set(objects.map(electronicState))].map(s=><option key={s}>{s}</option>)}</select></label><label>计算类型 <select aria-label="计算类型筛选" value={type} onChange={e=>setType(e.target.value)}><option value="">全部</option>{types.map(t=><option key={t}>{t}</option>)}</select></label><label>状态 <select aria-label="计算链状态筛选" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部</option>{['已采用','候选','待取回','历史'].map(s=><option key={s}>{s}</option>)}</select></label><label><input type="checkbox" checked={hideHistory} onChange={e=>setHideHistory(e.target.checked)}/>隐藏历史</label><label><input type="checkbox" checked={attention} onChange={e=>setAttention(e.target.checked)}/>只看需要我处理</label></ActionBar>
 <div className="table-scroll"><table className="chains-table" aria-label="对象计算链"><thead><tr>{['对象 · 电子态','计算链','相对能量 / kcal/mol','状态','审阅情况','比较'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{filtered.map(row=>{const o=row.object,open=expanded.includes(o.id);return <Fragment key={o.id}><tr>
 <th><button className="chain-expand" aria-expanded={open} onClick={()=>setExpanded(open?expanded.filter(id=>id!==o.id):[...expanded,o.id])}>{open?'▾':'▸'} {o.name}</button><small>{electronicState(o)}{!o.registered?' · 未登记':''}</small></th>
 <td><div className="chain-steps">{orderedMembers(o,data.attempts).map((m,i)=>{const a=find(m.attempt);return <Fragment key={m.attempt}>{i>0&&<span aria-hidden="true">→</span>}<StatusBadge tone={['fetched','finished'].includes(a?.state??'')?'neutral':statusTone(a?.state??'unavailable')}>{stepLabel(a,m.role)}</StatusBadge></Fragment>;})}</div></td>
 <td><EnergyCell row={row}/></td><td><StatusBadge tone={o.status==='retired'?'neutral':needsHandling(o,data.attempts)?'warn':'info'}>{chainStatus(o,data.attempts)}</StatusBadge></td><td>{reviewSummary(o,data.attempts)}</td><td><CompareObject data={data} obj={o}/></td>
 </tr>{open&&<tr><td colSpan={6}><DataTable label={`${o.name}的计算步骤`} rows={orderedMembers(o,data.attempts)} rowKey={m=>m.attempt} columns={[
 {key:'id',label:'Attempt',render:m=>find(m.attempt)?<a href={routeHash([data.id,m.attempt])}>{m.attempt}</a>:m.attempt+'（缺失）'},
 {key:'type',label:'计算类型',render:m=>calculationType(find(m.attempt)??{template:null} as AttemptSummary,m.role)},
 {key:'method',label:'方法（route）',render:m=>{const a=find(m.attempt);return a?methodFromRoute(routeOf(a))??'—':'—';}},
 {key:'server',label:'服务器',render:m=>display(record(find(m.attempt)?.manifest.data).cluster)},
 {key:'status',label:'状态',render:m=>find(m.attempt)?.state??'缺失'},
 {key:'facts',label:'关键事实（facts）',render:m=>{const a=find(m.attempt);return a?factsText(a):'—';}},
 {key:'review',label:'审阅情况',render:m=>reviewLabel(find(m.attempt))},
 ]}/></td></tr>}</Fragment>;})}</tbody></table></div>
 {!filtered.length&&<EmptyState>没有符合筛选的对象。</EmptyState>}
 {data.graph.nodes.some(n=>n.missing)&&<p className="notice">缺失父节点：{data.graph.nodes.filter(n=>n.missing).map(n=>n.id).join('、')}；未将缺失节点作为分组桥梁。</p>}
 </Panel>;
}
export function CatalogEmpty(){return <p className="muted">尚未登记采用结果。可在终端使用 <code>ag catalog suggest &lt;study&gt;</code> 查看分组建议，再由人核对登记。</p>;}
export function AdoptionResults({data}:{data:CatalogStudy}){
 const objects=catalogObjects(data),model=useEnergies(data,objects),reports=keyReports(data,objects);
 const attemptLink=(id?:string)=>id?<a href={routeHash([data.id,id])}>{id}</a>:'—';
 return <><Panel title="当前采用的结果" className="chains-view">
 {!hasCatalog(data)?<CatalogEmpty/>:<><EnergyControls model={model} objects={objects}/><DataTable label="当前采用的结果" rows={model.rows.filter(r=>r.object.status==='adopted')} rowKey={r=>r.object.id} columns={[
 {key:'object',label:'对象 · 电子态',render:r=>`${r.object.name} · ${electronicState(r.object)}`},
 ...(['opt','freq','sp'] as const).map((role,i)=>({key:role,label:['结构来源','频率来源','能量来源'][i],render:(r:EnergyRow)=>attemptLink(r.object.adopted[role]?.attempt)})),
 {key:'energy',label:`Δ${model.basis} / kcal/mol`,render:r=><EnergyCell row={r}/>},
 {key:'reports',label:'依据报告',render:r=><>{[...new Set(Object.values(r.object.adopted).flatMap(a=>a?.report?[a.report]:[]))].map(name=>{const report=data.analyses.find(a=>a.name===name);return <div key={name}>{report?<a href={analysisLink(data.id,name,report.schema)}>{name}</a>:name+'（未找到）'}</div>;})}</>},
 {key:'status',label:'状态',render:r=><StatusBadge>{adoptionState(r.object,data)}</StatusBadge>},
 {key:'compare',label:'比较',render:r=><CompareObject data={data} obj={r.object}/>},
 ]}/><p className="muted">已采用不等于已签；只有里程碑明确引用依据报告时才显示对应的已签 / 待签状态。</p></>}
 </Panel><Panel title="关键报告">{!hasCatalog(data)?<CatalogEmpty/>:reports.length?<ol className="report-list">{reports.map(({report,reason})=><li key={report.name}><a href={analysisLink(data.id,report.name,report.schema)}>{report.name}</a><span className="muted">{reason}</span></li>)}</ol>:<EmptyState>暂无正式结论、采用引用或待签引用报告。</EmptyState>}</Panel></>;
}
