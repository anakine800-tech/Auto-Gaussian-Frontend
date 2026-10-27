import {useEffect,useRef,useState} from 'react';
import {ServerCards} from './server-cards';
import {ServerDetail} from './server-detail';
import {display,endpoint,get,retryMonitor} from './api';
import {actionToken} from './actions';
import type {Study} from './api';
import {routeHash} from './routing';
import {DataTable,EmptyState,ErrorNotice,Panel,StatusBadge} from './ui';
import {clusterLabel,finishedAttempts,retryTerminal,serverModels} from './jobs-data';
import type {ClusterRow,LocalAttempt,ServerModel} from './jobs-data';
import {WalltimeProgress} from './job-progress';
import './ui/server.css';
export type {Monitor} from './jobs-data';
export function ServerMonitor({revision}:{revision:number}){
 const [data,setData]=useState<{clusters:ClusterRow[]}|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now()),[tick,setTick]=useState(0);
 const [local,setLocal]=useState<LocalAttempt[]|null>(null),[localErrors,setLocalErrors]=useState<string[]>([]),[fastPolling,setFastPolling]=useState(false);
 const [messages,setMessages]=useState<Record<string,string>>({});
 const requestNumbers=useRef(new Map<string,number>());
 const retries=useRef(new Map<string,{sampled:string|null;expires:number;id:string|null;fast:boolean;resolved:boolean}>()),wake=useRef(()=>{});
 const message=(key:string,text:string)=>setMessages(old=>old[key]===text?old:{...old,[key]:text});
 async function retry(model:ServerModel,authFixed:boolean){
  if(!actionToken)return;
  const key=model.key,request=(requestNumbers.current.get(key)??0)+1;
  requestNumbers.current.set(key,request);retries.current.delete(key);message(key,'正在请求…');wake.current();
  try{
   const result=await retryMonitor(model.row.name,authFixed,actionToken);
   // Check before changing either tracking or text, including after card switches.
   if(requestNumbers.current.get(key)!==request)return;
   if(result.result==='refused'){
    message(key,result.reason==='monitor_not_running'?'监控未运行，未登记请求':result.reason==='auth_confirmation_required'?'需要先确认已修复认证问题':'入口不在当前配置中，未登记请求');return;
   }
   retries.current.set(key,{sampled:model.row.snapshot?.sampled_at??null,expires:Date.now()+120000,id:result.request_id??null,fast:true,resolved:false});
   const accepted=result.result==='queued'?'已登记，等待采样':result.result==='already_queued'?'沿用既有请求，等待采样':'已合并当前采样，等待结果';
   message(key,accepted+(result.request_id?'':'；旧后端无法精确追踪本次请求'));wake.current();
  }catch(e){if(requestNumbers.current.get(key)===request)message(key,e instanceof Error?e.message:'重试请求失败');}
 }
 useEffect(()=>{
  const c=new AbortController();let busy=false,poll:number|undefined,nextRecordsRead=0;
  const prune=()=>{for(const [key,target] of retries.current)if(target.fast&&Date.now()>=target.expires){target.fast=false;message(key,'等待超时，结果尚未确认');}};
  const schedule=()=>{
   if(c.signal.aborted)return;
   clearTimeout(poll);prune();const fast=[...retries.current.values()].some(target=>target.fast);setFastPolling(fast);
   poll=window.setTimeout(read,fast?3000:30000);
  };
  const read=async()=>{
   if(busy)return;busy=true;
   const pending=new Map(retries.current);
   const refreshRecords=Date.now()>=nextRecordsRead;
   if(refreshRecords)nextRecordsRead=Date.now()+30000;
   try{
    const value=await get<NonNullable<typeof data>>('/api/monitor',c.signal);
    if(!c.signal.aborted){
     setData(value);setError('');setNow(Date.now());
     for(const [key,target] of pending){
      if(retries.current.get(key)!==target||target.resolved)continue;
      const row=value.clusters.find(r=>JSON.stringify([r.name,r.source])===key);
      if(!row||row.ambiguous)continue;
      if(target.id){
       const status=row.retry_status;
       if(row.retry_status_error||!status||status.entry!==row.name)continue;
       if(status.request_id!==target.id){target.fast=false;message(key,'本次请求结果无法确认');continue;}
       const terminal=retryTerminal(status);
       if(terminal){target.fast=false;target.resolved=true;message(key,terminal);}
       else if(target.fast)message(key,status.state==='running'?'正在执行本次采样':'已登记，等待采样');
      }else if(row.snapshot&&row.snapshot.sampled_at!==target.sampled){
       target.fast=false;target.resolved=true;message(key,'已收到新采样，无法精确对应本次请求');
      }
     }
    }
   }catch(e){if(!c.signal.aborted){setError(e instanceof Error?e.message:'读取失败');}}
   finally{busy=false;if(!c.signal.aborted){if(refreshRecords)setTick(t=>t+1);schedule();}}
  };
  wake.current=schedule;void read();const clock=window.setInterval(()=>{
   setNow(Date.now());prune();setFastPolling([...retries.current.values()].some(target=>target.fast));
  },1000);
  return()=>{c.abort();clearTimeout(poll);clearInterval(clock);wake.current=()=>{};};
 },[revision]);
 useEffect(()=>{
  if(!tick)return;const c=new AbortController();
  void (async()=>{try{
   const list=await get<{studies:{id:string}[];issues:{path:string;error:string}[]}>('/api/studies',c.signal),rows:LocalAttempt[]=[],errors=list.issues.map(i=>`${i.path}：${i.error}`);
   // Read one local Study at a time; never fan out a large workspace into requests.
   for(const s of list.studies){try{const value=await get<Study>(endpoint(s.id),c.signal);rows.push(...value.attempts.map(attempt=>({study:s.id,attempt})));errors.push(...value.issues.map(i=>`${s.id} / ${i.path}：${i.error}`));}catch(e){if(c.signal.aborted)return;errors.push(`${s.id}：${e instanceof Error?e.message:'读取失败'}`);}}
   if(!c.signal.aborted){setLocal(rows);setLocalErrors(errors);}
  }catch(e){if(!c.signal.aborted){setLocal(null);setLocalErrors([e instanceof Error?e.message:'读取失败']);}}})();return()=>c.abort();
 },[tick]);
 const models=serverModels(data?.clusters??[],now);
 const [selected,setSelected]=useState('');
 const firstKey=models[0]?.key;
 useEffect(()=>{if(!selected&&firstKey)setSelected(firstKey);},[selected,firstKey]);
 const active=models.find(m=>m.key===selected)??models[0];
 const finished=finishedAttempts(local??[]);
 return <section className="jobs-page server-page" aria-label="服务器监控"><div className="jobs-heading"><h2>服务器</h2><span className="muted">{fastPolling?'每 3 秒读取本地采样；本地记录仍每 30 秒读取':'每 30 秒读取本地采样与记录'}</span></div>
 {error&&<ErrorNotice>{error}</ErrorNotice>}{!data?<p role="status">读取采样快照…</p>:models.length===0?<EmptyState>暂无集群采样。</EmptyState>:<>
 <ServerCards models={models} selected={active.key} onSelect={setSelected} now={now}/>
 <div className="server-tabs" role="tablist" aria-label="服务器详情">{models.map((m,i)=><button key={m.key} role="tab" id={'server-tab-'+i} aria-controls="server-detail" aria-selected={active.key===m.key} tabIndex={active.key===m.key?0:-1} onClick={()=>setSelected(m.key)} onKeyDown={e=>{
  const next=e.key==='ArrowRight'?(i+1)%models.length:e.key==='ArrowLeft'?(i+models.length-1)%models.length:e.key==='Home'?0:e.key==='End'?models.length-1:null;
  if(next!==null){e.preventDefault();setSelected(models[next].key);document.getElementById('server-tab-'+next)?.focus();}
 }}>{m.label}{' '}{m.warningCount>0&&<span className="server-warning-count">{m.warningCount} 条警告</span>}</button>)}</div>
 <div id="server-detail" role="tabpanel" aria-labelledby={'server-tab-'+models.indexOf(active)}><ServerDetail key={active.key} model={active} revision={tick} now={now} retryMessage={messages[active.key]??''} onRetry={authFixed=>void retry(active,authFixed)}/></div>
 </>}
 <Panel title="刚结束待取回" className="jobs-table"><p className="muted">仅列本地状态为 finished 的 Attempt；不按时间、队列消失或日志终止标记推断。请进入详情核对并取回。</p>
 {localErrors.map((e,i)=><ErrorNotice key={i}>{e}</ErrorNotice>)}{local===null?<p className="muted">{localErrors.length?'本地列表不可用':'读取本地 Attempt…'}</p>:<DataTable label="待取回作业表" rows={finished} rowKey={r=>r.study+':'+r.attempt.id} columns={[
  {key:'attempt',label:'Attempt',render:r=><a href={routeHash([r.study,r.attempt.id])}>{r.attempt.id}</a>},
  {key:'study',label:'Study',render:r=><a href={routeHash([r.study])}>{r.study}</a>},
  {key:'cluster',label:'集群',render:r=>{const matches=data?.clusters.filter(row=>row.name===r.cluster)??[];return matches.length===1?clusterLabel(matches[0]):r.cluster;}},
  {key:'state',label:'状态',render:()=> <StatusBadge tone="ok">finished</StatusBadge>},
  {key:'cores',label:'核数',className:'numeric',render:r=>display(r.cores)},
  {key:'time',label:'已用 / walltime',render:r=><WalltimeProgress used={r.elapsed} limit={r.walltime}/>},
 ]}/>}</Panel>
 </section>;
}
