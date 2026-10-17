import {useEffect,useState} from 'react';
import {display,endpoint,get} from './api';
import type {Study} from './api';
import {routeHash} from './routing';
import {Collapsible,DataTable,EmptyState,ErrorNotice,Panel,StatusBadge,statusTone} from './ui';
import {finishedAttempts,safeIdentity,sampleState} from './jobs-data';
import type {ClusterRow,LocalAttempt} from './jobs-data';
import {SnapshotProgress,WalltimeProgress} from './job-progress';
import './ui/jobs.css';
type Association={study:string|null;attempt:string|null};
type Job=Association&{job_id:string;name:string;state:string;queue:string;cores:number|null;mem:string|null;walltime_used:string|null;walltime_limit:string|null;start_time:string|null};
export type Monitor={schema:'ag-monitor/1';sampled_at:string;interval_seconds:number|null;ok:boolean;error:string|null;last_ok_at:string|null;own:{cores_in_use:number;core_cap:number;cores_running?:number;cores_queued?:number;committed_cap?:number;jobs:Job[]}|null;cluster:{scheduler?:string;name?:string;hardware_capacity_known?:boolean;budget?:{core_hours:number;used:number;reserved:number}|null;expires?:string|null;storage_kib?:number|null;expiry_warning?:string|null;cores_total:number|null;cores_used:number|null;nodes:{name:string;state:string;cores_total:number|null;cores_used:number|null}[];queues:{name:string;running:number;queued:number}[]}|null;warnings:(Association&{kind:string;job_id:string|null;detail:string})[]};

function ageText(seconds:number){
 if(seconds<60)return `${seconds} 秒`;
 const minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
 return `${days} 天 ${hours%24} 小时 ${minutes%60} 分`;
}
function localTime(value:string){return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'}).format(new Date(value));}
function AssociationLinks({study,attempt}:Association){return <>{safeIdentity(study)?<a href={routeHash([study])}>{study}</a>:display(study)}{attempt&&<> / {safeIdentity(study)&&safeIdentity(attempt)?<a href={routeHash([study,attempt])}>{attempt}</a>:attempt}</>}</>;}
function State({value}:{value:string}){const normalized=({RUNNING:'running',PENDING:'queued',COMPLETING:'running',COMPLETED:'completed',FAILED:'failed',TIMEOUT:'error',H:'queued',S:'queued',C:'completed',E:'running'} as Record<string,string>)[value]??value;return <StatusBadge tone={statusTone(normalized)}>{value}</StatusBadge>;}
export function ServerMonitor({revision}:{revision:number}){
 const [data,setData]=useState<{clusters:ClusterRow[]}|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now()),[tick,setTick]=useState(0);
 const [local,setLocal]=useState<LocalAttempt[]|null>(null),[localErrors,setLocalErrors]=useState<string[]>([]);
 useEffect(()=>{
  const c=new AbortController();let busy=false;
  const read=async()=>{if(busy)return;busy=true;try{const value=await get<NonNullable<typeof data>>('/api/monitor',c.signal);if(!c.signal.aborted){setData(value);setError('');setNow(Date.now());}}catch(e){if(!c.signal.aborted){setData(null);setError(e instanceof Error?e.message:'读取失败');}}finally{busy=false;if(!c.signal.aborted)setTick(t=>t+1);}};
  void read();const poll=window.setInterval(read,30000),clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{c.abort();clearInterval(poll);clearInterval(clock);};
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
 const jobs=(data?.clusters??[]).flatMap(row=>sampleState(row,now).hasData?(row.snapshot?.own?.jobs??[]).map((job,i)=>({row,job,key:JSON.stringify([row.name,row.source,job.job_id,job.study,job.attempt,i])})):[]);
 const finished=finishedAttempts(local??[]);
 return <section className="jobs-page" aria-label="服务器监控"><div className="jobs-heading"><h2>服务器监控</h2><span className="muted">每 30 秒读取本地采样与记录</span></div>
 {error?<ErrorNotice>{error}</ErrorNotice>:!data?<p role="status">读取采样快照…</p>:data.clusters.length===0?<EmptyState>暂无集群采样。</EmptyState>:<div className="capacity-list">{data.clusters.map(row=><ClusterCapacity key={row.name+row.source} row={row} now={now}/>)}</div>}
 <Panel title="本人作业" className="jobs-table"><p className="muted">采样中的全部本人作业；过期、失败或来源歧义的数据保持非最新标记。</p><DataTable label="本人作业表" rows={jobs} rowKey={r=>r.key} columns={[
  {key:'attempt',label:'Attempt',render:({job:j})=><>{safeIdentity(j.study)&&safeIdentity(j.attempt)?<a href={routeHash([j.study,j.attempt])}>{j.attempt}</a>:<span>未关联</span>}<small>{j.name}</small></>},
  {key:'study',label:'Study',render:({job:j})=>safeIdentity(j.study)?<a href={routeHash([j.study])}>{j.study}</a>:display(j.study)},
  {key:'cluster',label:'集群',render:({row})=><>{row.name}{row.ambiguous&&<small>{row.source} · 来源未确认</small>}{sampleState(row,now).old&&<small className="snapshot-notice">非最新</small>}</>},
  {key:'state',label:'状态',render:({job:j})=><State value={j.state}/>},
  {key:'cores',label:'核数',className:'numeric',render:({job:j})=>display(j.cores)},
  {key:'time',label:'已用 / walltime',render:({job:j})=><WalltimeProgress used={j.walltime_used} limit={j.walltime_limit}/>},
  {key:'snapshot',label:'最近快照进度',render:({job:j})=><SnapshotProgress study={j.study} attempt={j.attempt} revision={tick}/>},
  {key:'job',label:'作业号',optional:true,render:({job:j})=>j.job_id},
  {key:'queue',label:'队列',optional:true,render:({job:j})=>j.queue},
  {key:'mem',label:'内存',optional:true,render:({job:j})=>display(j.mem)},
  {key:'start',label:'开始时间',optional:true,render:({job:j})=>display(j.start_time)},
 ]}/>{data&&jobs.length===0&&<p className="muted">{data.clusters.every(r=>sampleState(r,now).hasData)?'暂无本人作业。':'暂无成功采样数据或没有本人作业；不能据此判断集群空闲。'}</p>}</Panel>
 <Panel title="刚结束待取回" className="jobs-table"><p className="muted">仅列本地状态为 finished 的 Attempt；不按时间、队列消失或日志终止标记推断。请进入详情核对并取回。</p>
 {localErrors.map((e,i)=><ErrorNotice key={i}>{e}</ErrorNotice>)}{local===null?<p className="muted">{localErrors.length?'本地列表不可用':'读取本地 Attempt…'}</p>:<DataTable label="待取回作业表" rows={finished} rowKey={r=>r.study+':'+r.attempt.id} columns={[
  {key:'attempt',label:'Attempt',render:r=><a href={routeHash([r.study,r.attempt.id])}>{r.attempt.id}</a>},
  {key:'study',label:'Study',render:r=><a href={routeHash([r.study])}>{r.study}</a>},
  {key:'cluster',label:'集群',render:r=>r.cluster},
  {key:'state',label:'状态',render:()=> <State value="finished"/>},
  {key:'cores',label:'核数',className:'numeric',render:r=>display(r.cores)},
  {key:'time',label:'已用 / walltime',render:r=><WalltimeProgress used={r.elapsed} limit={r.walltime}/>},
 ]}/>}</Panel>
 {(data?.clusters??[]).map(row=><Collapsible key={row.name+row.source} page="jobs" block={'details:'+row.name+':'+row.source} title={`集群 ${row.name}${row.ambiguous?' · '+row.source:''} · 节点、队列与警告`}><ClusterDetails row={row} now={now}/></Collapsible>)}
 </section>;
}
function ClusterCapacity({row,now}:{row:ClusterRow;now:number}){
 const d=row.snapshot,{stale,old,hasData}=sampleState(row,now),own=hasData?d?.own:null;
 const full=own&&own.cores_running!==undefined&&own.cores_queued!==undefined&&own.committed_cap!==undefined;
 const used=own?(full?own.cores_running!+own.cores_queued!:own.cores_in_use):null,cap=own?(full?own.committed_cap!:own.core_cap):null;
 return <section className="capacity-row" aria-label={`集群 ${row.name}${row.ambiguous?' · '+row.source:''}`}><div className="capacity-title"><h3>集群 {row.name}</h3><StatusBadge tone={row.error||!d?'bad':old?'warn':'ok'}>{row.error||!d?'不可用':row.ambiguous?'来源未确认':stale?'数据已过期':!d.ok?'采样失败':'新鲜'}</StatusBadge></div>
 <div className="capacity-value"><span className="muted">本人占用核数{old?' · 非最新':''}</span><p className="core-count">{own?full?`运行 ${own.cores_running} · 排队 ${own.cores_queued} · 总上限 ${own.committed_cap}`:`${own.cores_in_use} / ${own.core_cap}`:'—'}</p>{used!==null&&cap!==null&&cap>0&&<progress aria-label={`集群 ${row.name} 本人核数占上限`} value={Math.min(used,cap)} max={cap}/>} {used!==null&&cap!==null&&used>cap&&<span className="snapshot-notice">已超过本人上限</span>}</div>
 <div className="capacity-time">{d&&<><span>采样时间：<time dateTime={d.sampled_at} title={d.sampled_at}>{localTime(d.sampled_at)}</time>（本地时间）</span><small>距今 {ageText(Math.max(0,Math.floor((now-Date.parse(d.sampled_at))/1000)))}{d.interval_seconds===null?' · 单次采样':` · 采样间隔 ${d.interval_seconds} 秒`}</small></>}</div>
 {row.ambiguous&&<p className="capacity-message notice">检测到两份 default 快照，来源未确认；不能视为当前状态。</p>}{row.error&&<div className="capacity-message"><ErrorNotice>{row.error}</ErrorNotice></div>}
 {d&&!d.ok&&<div className="capacity-message"><ErrorNotice>采样失败：{d.error??'未提供错误说明'} · last_ok_at：{d.last_ok_at?localTime(d.last_ok_at):'尚无成功采样'} · {hasData?'下方为上一次成功的数据（非最新）。':'尚无成功采样，当前占用与硬件容量未知。'}</ErrorNotice></div>}
 </section>;
}
function ClusterDetails({row,now}:{row:ClusterRow;now:number}){
 const data=row.snapshot,{old,hasData}=sampleState(row,now),cluster=hasData?data?.cluster:null;
 return <section aria-label={`集群 ${row.name} 详细信息`}>{cluster&&<>
 {cluster.budget!=null&&<article aria-label="核时预算"><h3>核时预算{old?' · 非最新':''}</h3><p>预算 {cluster.budget.core_hours} · 已用 {cluster.budget.used} · 预留 {cluster.budget.reserved} 核时</p><p className="muted">本地台账，不代表平台余额。</p></article>}
 {cluster.expires!=null&&<p>到期日期：{cluster.expires}</p>}{cluster.expiry_warning&&<ErrorNotice>{cluster.expiry_warning}</ErrorNotice>}{cluster.storage_kib!=null&&<p>存储占用{old?' · 非最新':''}：{cluster.storage_kib} KiB</p>}
 </>}
 <Panel title="节点">{cluster?<>{cluster.hardware_capacity_known===false||cluster.scheduler==='slurm'?<p>集群硬件容量未知</p>:<p>集群核数：{display(cluster.cores_used)} / {display(cluster.cores_total)}</p>}<DataTable label="节点表" rows={cluster.nodes} rowKey={n=>n.name} columns={[{key:'name',label:'节点',render:n=>n.name},{key:'state',label:'状态',render:n=>n.state},{key:'cores',label:'已用核数 / 总核数',render:n=>`${display(n.cores_used)} / ${display(n.cores_total)}`}]}/></>:<EmptyState>暂无成功采样数据。</EmptyState>}</Panel>
 <Panel title="队列">{cluster?<DataTable label="队列表" rows={cluster.queues} rowKey={q=>q.name} columns={[{key:'name',label:'队列',render:q=>q.name},{key:'running',label:'运行',className:'numeric',render:q=>q.running},{key:'queued',label:'排队',className:'numeric',render:q=>q.queued}]}/>:<EmptyState>暂无成功采样数据。</EmptyState>}</Panel>
 <Panel title="警告">{data?.warnings.length?<ul>{data.warnings.map((w,i)=><li key={i}><p className="warning-detail">{w.detail}</p><small>{w.kind} · {display(w.job_id)} · <AssociationLinks {...w}/></small></li>)}</ul>:<EmptyState>暂无警告。</EmptyState>}</Panel>
 </section>;
}
