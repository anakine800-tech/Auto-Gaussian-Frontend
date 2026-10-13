import {useEffect,useState} from 'react';
import {display,get} from './api';
import {routeHash} from './routing';
type Association={study:string|null;attempt:string|null};
type Job=Association&{job_id:string;name:string;state:string;queue:string;cores:number|null;mem:string|null;walltime_used:string|null;walltime_limit:string|null;start_time:string|null};
export type Monitor={schema:'ag-monitor/1';sampled_at:string;interval_seconds:number|null;ok:boolean;error:string|null;last_ok_at:string|null;own:{cores_in_use:number;core_cap:number;cores_running?:number;cores_queued?:number;committed_cap?:number;jobs:Job[]}|null;cluster:{cores_total:number|null;cores_used:number|null;nodes:{name:string;state:string;cores_total:number|null;cores_used:number|null}[];queues:{name:string;running:number;queued:number}[]}|null;warnings:(Association&{kind:string;job_id:string|null;detail:string})[]};
function localTime(value:string){
 return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'}).format(new Date(value));
}
function AssociationLinks({study,attempt}:Association){
 const safe=(s:string|null):s is string=>!!s&&!['.','..'].includes(s)&&!/[\/\\\0]/.test(s);
 return <>{safe(study)?<a href={routeHash([study])}>{study}</a>:display(study)}{attempt&&<> / {safe(study)&&safe(attempt)?<a href={routeHash([study,attempt])}>{attempt}</a>:attempt}</>}</>;
}
export function ServerMonitor({revision}:{revision:number}){
 const [data,setData]=useState<Monitor|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  const c=new AbortController();let busy=false;
  const read=async()=>{if(busy)return;busy=true;try{const value=await get<Monitor>('/api/monitor',c.signal);if(!c.signal.aborted){setData(value);setError('');setNow(Date.now());}}catch(e){if(!c.signal.aborted){setData(null);setError(e instanceof Error?e.message:'读取失败');}}finally{busy=false;}};
  void read();const poll=window.setInterval(read,30000),clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{c.abort();clearInterval(poll);clearInterval(clock);};
 },[revision]);
 const age=data?Math.max(0,Math.floor((now-Date.parse(data.sampled_at))/1000)):0;
 const stale=data?.interval_seconds!==null&&data?.interval_seconds!==undefined&&now-Date.parse(data.sampled_at)>3*data.interval_seconds*1000;
 return <section aria-label="服务器监控"><h2>服务器监控</h2><p className="muted">每 30 秒读取本地采样快照。</p>{error?<p role="alert">{error}</p>:!data?<p role="status">读取采样快照…</p>:<>
 <p>采样时间：<time dateTime={data.sampled_at} title={data.sampled_at}>{localTime(data.sampled_at)}</time>（本地时间） · 距今 {age} 秒{data.interval_seconds===null?' · 单次采样':` · 采样间隔 ${data.interval_seconds} 秒`}</p>
 {stale&&<p className="expired" role="status">数据已过期</p>}
 {!data.ok&&<div role="alert"><strong>采样失败：{data.error??'未提供错误说明'}</strong><p>last_ok_at：{data.last_ok_at?localTime(data.last_ok_at):'尚无成功采样'}</p><p>下方为上一次成功的数据（非最新）。</p></div>}
 <article><h3>本人占用核数{!data.ok?' · 非最新':''}</h3><p className="core-count">{data.own?data.own.cores_running!==undefined&&data.own.cores_queued!==undefined&&data.own.committed_cap!==undefined?`运行 ${data.own.cores_running} · 排队 ${data.own.cores_queued} · 总上限 ${data.own.committed_cap}`:`${data.own.cores_in_use} / ${data.own.core_cap}`:'— / 44'}</p></article>
 <article><h3>本人作业</h3>{data.own?<div className="table-scroll"><table aria-label="本人作业表"><thead><tr>{['作业号','名称','状态','队列','核数','内存','已用时长 / 上限','开始时间','Study / Attempt'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.own.jobs.map((j,i)=><tr key={i}><td>{j.job_id}</td><td>{j.name}</td><td>{j.state}</td><td>{j.queue}</td><td>{display(j.cores)}</td><td>{display(j.mem)}</td><td>{display(j.walltime_used)} / {display(j.walltime_limit)}</td><td>{display(j.start_time)}</td><td><AssociationLinks {...j}/></td></tr>)}</tbody></table>{data.own.jobs.length===0&&<p>暂无本人作业。</p>}</div>:<p>暂无成功采样数据。</p>}</article>
 <article><h3>节点</h3>{data.cluster?<><p>集群核数：{display(data.cluster.cores_used)} / {display(data.cluster.cores_total)}</p><div className="table-scroll"><table aria-label="节点表"><thead><tr><th>节点</th><th>状态</th><th>已用核数 / 总核数</th></tr></thead><tbody>{data.cluster.nodes.map((n,i)=><tr key={i}><td>{n.name}</td><td>{n.state}</td><td>{display(n.cores_used)} / {display(n.cores_total)}</td></tr>)}</tbody></table></div></>:<p>暂无成功采样数据。</p>}</article>
 <article><h3>队列</h3>{data.cluster?<div className="table-scroll"><table aria-label="队列表"><thead><tr><th>队列</th><th>运行</th><th>排队</th></tr></thead><tbody>{data.cluster.queues.map((q,i)=><tr key={i}><td>{q.name}</td><td>{q.running}</td><td>{q.queued}</td></tr>)}</tbody></table></div>:<p>暂无成功采样数据。</p>}</article>
 <article><h3>警告</h3>{data.warnings.length?<ul>{data.warnings.map((w,i)=><li key={i}><p className="warning-detail">{w.detail}</p><small>{w.kind} · {display(w.job_id)} · <AssociationLinks {...w}/></small></li>)}</ul>:<p>暂无警告。</p>}</article>
 </>}</section>;
}
