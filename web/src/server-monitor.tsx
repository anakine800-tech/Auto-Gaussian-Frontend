import {useEffect,useState} from 'react';
import {display,get} from './api';
import {routeHash} from './routing';
type Association={study:string|null;attempt:string|null};
type Job=Association&{job_id:string;name:string;state:string;queue:string;cores:number|null;mem:string|null;walltime_used:string|null;walltime_limit:string|null;start_time:string|null};
export type Monitor={schema:'ag-monitor/1';sampled_at:string;interval_seconds:number|null;ok:boolean;error:string|null;last_ok_at:string|null;own:{cores_in_use:number;core_cap:number;cores_running?:number;cores_queued?:number;committed_cap?:number;jobs:Job[]}|null;cluster:{scheduler?:string;name?:string;hardware_capacity_known?:boolean;budget?:{core_hours:number;used:number;reserved:number}|null;expires?:string|null;storage_kib?:number|null;expiry_warning?:string|null;cores_total:number|null;cores_used:number|null;nodes:{name:string;state:string;cores_total:number|null;cores_used:number|null}[];queues:{name:string;running:number;queued:number}[]}|null;warnings:(Association&{kind:string;job_id:string|null;detail:string})[]};
const SINGLE_SAMPLE_STALE_SECONDS=10*60;
function ageText(seconds:number){
 if(seconds<60)return `${seconds} 秒`;
 const minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
 return `${days} 天 ${hours%24} 小时 ${minutes%60} 分`;
}
function localTime(value:string){
 return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'}).format(new Date(value));
}
function AssociationLinks({study,attempt}:Association){
 const safe=(s:string|null):s is string=>!!s&&!['.','..'].includes(s)&&!/[\/\\\0]/.test(s);
 return <>{safe(study)?<a href={routeHash([study])}>{study}</a>:display(study)}{attempt&&<> / {safe(study)&&safe(attempt)?<a href={routeHash([study,attempt])}>{attempt}</a>:attempt}</>}</>;
}
export function ServerMonitor({revision}:{revision:number}){
 const [data,setData]=useState<{clusters:{name:string;source:string;ambiguous:boolean;snapshot:Monitor|null;error:string|null}[]}|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  const c=new AbortController();let busy=false;
  const read=async()=>{if(busy)return;busy=true;try{const value=await get<NonNullable<typeof data>>('/api/monitor',c.signal);if(!c.signal.aborted){setData(value);setError('');setNow(Date.now());}}catch(e){if(!c.signal.aborted){setData(null);setError(e instanceof Error?e.message:'读取失败');}}finally{busy=false;}};
  void read();const poll=window.setInterval(read,30000),clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{c.abort();clearInterval(poll);clearInterval(clock);};
 },[revision]);
 return <section aria-label="服务器监控"><h2>服务器监控</h2><p className="muted">每 30 秒读取本地采样快照。</p>{error?<p role="alert">{error}</p>:!data?<p role="status">读取采样快照…</p>:data.clusters.map(row=><section className="cluster-monitor" key={row.name+row.source} aria-label={`集群 ${row.name}${row.ambiguous?' · '+row.source:''}`}><h3>集群 {row.name}{row.ambiguous?` · ${row.source==='legacy'?'旧位置':'命名位置'}`:''}</h3>
 {row.ambiguous&&<p role="alert">检测到两份 default 快照，来源未确认；请核对采样时间和监控进程，不能视为当前状态。</p>}
 {row.error?<p role="alert">{row.error}</p>:row.snapshot&&<ClusterSnapshot data={row.snapshot} now={now} ambiguous={row.ambiguous}/>}</section>)}</section>;
}
function ClusterSnapshot({data,now,ambiguous}:{data:Monitor;now:number;ambiguous:boolean}){
 const age=Math.max(0,Math.floor((now-Date.parse(data.sampled_at))/1000));
 const stale=now-Date.parse(data.sampled_at)>(data.interval_seconds===null?SINGLE_SAMPLE_STALE_SECONDS:3*data.interval_seconds)*1000;
 const old=!data.ok||stale||ambiguous;
 const cluster=data.cluster,hasData=data.ok||data.last_ok_at!==null;
 return <>
 <p>采样时间：<time dateTime={data.sampled_at} title={data.sampled_at}>{localTime(data.sampled_at)}</time>（本地时间） · 距今 {ageText(age)}{data.interval_seconds===null?' · 单次采样':` · 采样间隔 ${data.interval_seconds} 秒`}</p>
 {stale&&<p className="expired" role="status">数据已过期</p>}
 {!data.ok&&<div role="alert"><strong>采样失败：{data.error??'未提供错误说明'}</strong><p>last_ok_at：{data.last_ok_at?localTime(data.last_ok_at):'尚无成功采样'}</p><p>{hasData?'下方为上一次成功的数据（非最新）。':'尚无成功采样，当前占用与硬件容量未知。'}</p></div>}
 <article><h3>本人占用核数{old?' · 非最新':''}</h3><p className="core-count">{data.own&&hasData?data.own.cores_running!==undefined&&data.own.cores_queued!==undefined&&data.own.committed_cap!==undefined?`运行 ${data.own.cores_running} · 排队 ${data.own.cores_queued} · 总上限 ${data.own.committed_cap}`:`${data.own.cores_in_use} / ${data.own.core_cap}`:'—'}</p></article>
 <article><h3>本人作业</h3>{data.own&&hasData?<div className="table-scroll"><table aria-label="本人作业表"><thead><tr>{['作业号','名称','状态','队列','核数','内存','已用时长 / 上限','开始时间','Study / Attempt'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.own.jobs.map((j,i)=><tr key={i}><td>{j.job_id}</td><td>{j.name}</td><td>{j.state}</td><td>{j.queue}</td><td>{display(j.cores)}</td><td>{display(j.mem)}</td><td>{display(j.walltime_used)} / {display(j.walltime_limit)}</td><td>{display(j.start_time)}</td><td><AssociationLinks {...j}/></td></tr>)}</tbody></table>{data.own.jobs.length===0&&<p>暂无本人作业。</p>}</div>:<p>暂无成功采样数据。</p>}</article>
 {cluster&&<>
 {cluster.budget!=null&&<article aria-label="核时预算"><h3>核时预算{old?' · 非最新':''}</h3><p>预算 {cluster.budget.core_hours} · 已用 {cluster.budget.used} · 预留 {cluster.budget.reserved} 核时</p><p className="muted">本地台账，不代表平台余额。</p></article>}
 {cluster.expires!=null&&<p>到期日期：{cluster.expires}</p>}
 {cluster.expiry_warning&&<p role="alert">{cluster.expiry_warning}</p>}
 {cluster.storage_kib!=null&&<p>存储占用{old?' · 非最新':''}：{cluster.storage_kib} KiB</p>}
 </>}
 <article><h3>节点</h3>{data.cluster&&hasData?<>{data.cluster.hardware_capacity_known===false||data.cluster.scheduler==='slurm'?<p>集群硬件容量未知</p>:<p>集群核数：{display(data.cluster.cores_used)} / {display(data.cluster.cores_total)}</p>}<div className="table-scroll"><table aria-label="节点表"><thead><tr><th>节点</th><th>状态</th><th>已用核数 / 总核数</th></tr></thead><tbody>{data.cluster.nodes.map((n,i)=><tr key={i}><td>{n.name}</td><td>{n.state}</td><td>{display(n.cores_used)} / {display(n.cores_total)}</td></tr>)}</tbody></table></div></>:<p>暂无成功采样数据。</p>}</article>
 <article><h3>队列</h3>{data.cluster&&hasData?<div className="table-scroll"><table aria-label="队列表"><thead><tr><th>队列</th><th>运行</th><th>排队</th></tr></thead><tbody>{data.cluster.queues.map((q,i)=><tr key={i}><td>{q.name}</td><td>{q.running}</td><td>{q.queued}</td></tr>)}</tbody></table></div>:<p>暂无成功采样数据。</p>}</article>
 <article><h3>警告</h3>{data.warnings.length?<ul>{data.warnings.map((w,i)=><li key={i}><p className="warning-detail">{w.detail}</p><small>{w.kind} · {display(w.job_id)} · <AssociationLinks {...w}/></small></li>)}</ul>:<p>暂无警告。</p>}</article>
 </>;
}
