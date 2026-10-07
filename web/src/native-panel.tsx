import {useEffect, useState} from 'react';
import {requestJSON} from './contract';
import type {Field} from './contract';
import './native.css';
type Fact = Field & {unit: string|null};
type NativeAttempt = {source_id:string; project_id:string; workflow_run_id:string; task_id:string; attempt_id:string; generation:Fact; program:Fact; bound_plan:Fact; input:Fact; artifacts:Fact; axes:Record<string,Fact>; facts:Record<string,Fact>; availability:string; reason:string|null; record_inventory:unknown[]; provenance:unknown; history:unknown[]};
type Project = {source_id:string; project_id:string; workflow_run_ids:string[]; identity_collision:boolean};
type Projects = {items:Project[];sources:{source_id:string;availability:string;reason:string|null}[]};
function decode(value:unknown,kind:string):unknown{
  if(!value || typeof value!=='object')throw Error('contract-mismatch');
  const v=value as {schema?:string;kind?:string;data?:unknown};
  if(v.schema!=='auto-g16-native-query/1'||v.kind!==kind||!v.data||typeof v.data!=='object')throw Error('contract-mismatch');
  return v.data;
}
const names:Record<string,string>={execution:'执行状态',capture:'捕获',result:'Result 记录',validation:'科学验证',review:'人工审阅',energy:'能量',geometry:'已归属结构块',frequencies:'已归属频率块',optimization:'优化标记',sampling:'采样事实'};
function Value({fact}:{fact:Fact}){return <div className="native-fact"><strong>{fact.availability==='available'?(typeof fact.value==='object'?JSON.stringify(fact.value):String(fact.value)):fact.availability==='missing'?'缺失 (missing)':'不可用 (unavailable)'}</strong>{fact.unit&&<span> · {fact.unit}</span>}<small>{fact.reason??fact.source}</small></div>}
function FrequencySummary({item}:{item:NativeAttempt}) {
 const provenance=item.provenance as {parsed_result?:Record<string,unknown>}|null;
 const p=provenance?.parsed_result;
 if(!p||p.frequency_unit!=='cm^-1')return null;
 const count=(key:string)=>p[key]===null?'未知 / unavailable':String(p[key]);
 return <div className="native-frequency-summary"><h3>Opt → Freq</h3><p>频率单位：cm^-1 · 模式数：{count('frequency_count')} · 负频：{count('imaginary_frequency_count')} · 零频：{count('zero_frequency_count')}</p><p>Opt Attempt：{String(p.optimization_attempt_id)} → Freq Attempt：{String(p.frequency_attempt_id)}</p><p>解析版本：{String(p.parser_version)}。两阶段机器证据不代表人工科学验收或热力学验收。</p></div>;
}
function Summary({item}:{item:NativeAttempt}){return <><p className="native-path">{item.source_id} / {item.project_id} → {item.workflow_run_id} → {item.task_id} → {item.attempt_id}</p><div className="native-grid"><div><h3>执行代际</h3><Value fact={item.generation}/></div><div><h3>程序</h3><Value fact={item.program}/></div>{Object.entries(item.axes).map(([key,fact])=><div key={key}><h3>{names[key]}</h3><Value fact={fact}/></div>)}</div><FrequencySummary item={item}/><p>事实可用性：{item.availability} {item.reason&&`· ${item.reason}`}</p><div className="native-grid">{Object.entries(item.facts).map(([key,fact])=><div key={key}><h3>{names[key]}</h3><Value fact={fact}/></div>)}</div></>}
function nativeRoute(hash:string){
 try {
  if(hash==='#/native')return {source:'',group:'',identity:'',kind:'projects'};
  const parts=hash.split('/');
  if(parts.length!==5||parts[0]!=='#'||parts[1]!=='native')return null;
  const [source,group,identity]=parts.slice(2).map(decodeURIComponent);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(source)||!identity||!['projects','attempts'].includes(group))return null;
  return {source,group,identity,kind:group==='projects'?'attempts':'attempt'};
 }catch{return null;}
}
export function NativePanel({token,hash}:{token:string;hash:string}){
 type Data=Projects|{items:NativeAttempt[]}|NativeAttempt|null;
 const [state,setState]=useState<{hash:string;data:Data;error:string}>({hash,data:null,error:''});
 const {data,error}=state.hash===hash?state:{data:null,error:''};
 const parsed=nativeRoute(hash);const {source,group,identity,kind}=parsed??{source:'',group:'',identity:'',kind:'invalid'};
 useEffect(()=>{setState({hash,data:null,error:''});if(!parsed){setState({hash,data:null,error:'invalid-route'});return;}const c=new AbortController();let path='/api/v1/native/projects';if(source&&identity)path=`/api/v1/native/sources/${encodeURIComponent(source)}/${group}/${encodeURIComponent(identity)}${group==='projects'?'/attempts':''}`;
 requestJSON(path,token,c.signal,'native-scientific-read').then(v=>{if(!c.signal.aborted)setState({hash,data:decode(v,kind) as Data,error:''});}).catch(e=>{if(!c.signal.aborted)setState({hash,data:null,error:e instanceof Error?e.message:'request-failed'});});return()=>c.abort()},[hash,token]);
 return <section className="panel native-panel"><div className="eyebrow">READ ONLY · NATIVE RECORDS</div><h1>原生计算结果</h1><p>按来源保留 Project → WorkflowRun → Task → Attempt。执行成功和结果存在不代表科学验收。历史档案仍在原入口。</p>{source&&<a href="#/native">← 全部原生来源</a>}{error?<p role="alert">读取失败：{error}。<button onClick={()=>location.reload()}>重试</button></p>:!data?<p role="status">正在读取…</p>:kind==='projects'?<>{(data as Projects).sources.map(s=><p key={s.source_id}>来源 {s.source_id}：{s.availability} {s.reason}</p>)}{(data as Projects).items.map(p=><article key={`${p.source_id}:${p.project_id}`}><h2><a href={`#/native/${encodeURIComponent(p.source_id)}/projects/${encodeURIComponent(p.project_id)}`}>{p.project_id}</a></h2><p>来源：{p.source_id} · {p.workflow_run_ids.length} 个 WorkflowRun {p.identity_collision&&' · 跨来源同名，保持独立'}</p></article>)}</>:kind==='attempts'?<>{(data as {items:NativeAttempt[]}).items.length===0&&<p>此项目尚无 Attempt。</p>}{(data as {items:NativeAttempt[]}).items.map(item=><article key={item.attempt_id}><h2><a href={`#/native/${encodeURIComponent(item.source_id)}/attempts/${encodeURIComponent(item.attempt_id)}`}>{item.attempt_id}</a></h2><Summary item={item}/></article>)}</>:<><Summary item={data as NativeAttempt}/><h2>来源追溯</h2><h3>精确绑定计划</h3><Value fact={(data as NativeAttempt).bound_plan}/><h3>输入</h3><Value fact={(data as NativeAttempt).input}/><h3>产物身份</h3><Value fact={(data as NativeAttempt).artifacts}/><details><summary>记录 ID 与契约</summary><pre>{JSON.stringify((data as NativeAttempt).record_inventory,null,2)}</pre></details><details><summary>Result 来源与历史</summary><pre>{JSON.stringify({provenance:(data as NativeAttempt).provenance,history:(data as NativeAttempt).history},null,2)}</pre></details></>}</section>
}
