import type {AttemptSummary,Document} from './api';
import {object} from './api';
import {capacityGroups} from './capacity-overview';
export type RetryStatus={version:1;entry:string;request_id:string;requested_at:string;state:'queued'|'running'|'finished'|'discarded';reason:null|'auth_confirmation_required'|'entry_removed'|'config_changed'|'monitor_restarted';finished_at:string|null;sampled_at:string|null;ok:boolean|null};
export type ClusterRow={name:string;source:string;ambiguous:boolean;snapshot:Monitor|null;error:string|null;retry_tracking_supported?:boolean;retry_status?:RetryStatus|null;retry_status_error?:string|null};
export function retryTerminal(status:RetryStatus){
 if(status.state==='finished')return status.ok?'本次采样完成':'本次采样失败，请查看采样错误';
 if(status.state!=='discarded')return null;
 return status.reason==='auth_confirmation_required'?'需先确认认证问题已修复':status.reason==='entry_removed'?'入口已移除':status.reason==='config_changed'?'配置已变化，旧请求未执行':'监控已重启，本次请求结果尚未确认';
}
export function clusterLabel(row:Pick<ClusterRow,'name'|'snapshot'>){
 const name=row.snapshot?.cluster?.display_name;
 return name?`${name}（${row.name}）`:row.name;
}
export type LocalAttempt={study:string;attempt:AttemptSummary};
export const resourceTierNames=['mini','simple','general','complex','max','ultra'] as const;
export function orderedResourceTiers<T>(tiers:Record<string,T>|undefined){
 return resourceTierNames.flatMap(name=>tiers?.[name]===undefined?[]:[[name,tiers[name]] as [string,T]]);
}
export function resourceWalltimeSeconds(value:unknown):number|null{
 if(typeof value!=='string'||value.trim()!==value||!/^[0-9]{2,4}:[0-5][0-9]:[0-5][0-9]$/.test(value))return null;
 const [hours,minutes,seconds]=value.split(':').map(Number),total=hours*3600+minutes*60+seconds;
 return total>0?total:null;
}
export function resourceWalltimeLabel(value:string|undefined){
 if(value===undefined)return '未配置（调度器仍可能限制）';
 if(resourceWalltimeSeconds(value)===null)return '未知（时限格式无效）';
 const [hours,minutes,seconds]=value.split(':').map(Number);
 return `${hours} 小时`+(minutes||seconds?` ${minutes} 分 ${seconds} 秒（${value}）`:'');
}
export const safeIdentity=(s:string|null):s is string=>!!s&&!['.','..'].includes(s)&&!/[\/\\\0]/.test(s);
export function sampleState(row:ClusterRow,now:number){
 const data=row.snapshot;
 const stale=!!data&&now-Date.parse(data.sampled_at)>(data.interval_seconds===null?600:3*data.interval_seconds)*1000;
 return {stale,old:!data||!data.ok||!!row.error||stale||row.ambiguous,hasData:!!data&&(data.ok||data.last_ok_at!==null)};
}
export function duration(value:unknown):number|null{
 if(typeof value!=='string')return null;
 const m=/^(?:(\d+)-)?(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
 if(!m)return null;
 const result=Number(m[1]??0)*86400+Number(m[2])*3600+Number(m[3])*60+Number(m[4]);
 return Number.isSafeInteger(result)?result:null;
}
export function finishedAttempts(rows:LocalAttempt[]){
 return rows.filter(r=>r.attempt.state==='finished').map(r=>{
  const hasManifest=!r.attempt.manifest.error&&object(r.attempt.manifest.data);
  const manifest=hasManifest?r.attempt.manifest.data as Record<string,unknown>:{};
  const status=object(r.attempt.status.data)?r.attempt.status.data:{};
  return {...r,cluster:hasManifest?(typeof manifest.cluster==='string'?manifest.cluster:manifest.cluster===undefined?'default':'—'):'—',cores:manifest.cores,elapsed:status.elapsed,walltime:manifest.walltime};
 });
}
export type Snapshot=Document&{name:string};
export function latestSnapshot(rows:Snapshot[]){
 const valid=rows.filter(r=>!r.error&&object(r.data)&&typeof r.data.created_at==='string'&&Number.isFinite(Date.parse(r.data.created_at)));
 valid.sort((a,b)=>Date.parse((b.data as Record<string,string>).created_at)-Date.parse((a.data as Record<string,string>).created_at)||a.name.localeCompare(b.name));
 return {latest:valid[0],unreadable:rows.length-valid.length};
}

export type Association={study:string|null;attempt:string|null};
export type Job=Association&{
 job_id:string;name:string;state:string;queue:string;cores:number|null;
 user?:string;mine?:boolean;cores_kind?:'allocated'|'requested';mem_gb?:number|null;
 elapsed_seconds?:number|null;elapsed_source?:'start_time'|'walltime_used'|null;
 walltime_limit_seconds?:number|null;start_time?:string|null;qtime?:string|null;
 mem?:string|null;walltime_used?:string|null;walltime_limit?:string|null;
};
export type Sampling={state:'normal'|'backoff'|'paused';consecutive_failures:number;current_interval_seconds:number|null;next_sample_at:string|null;pause_reason:null|'auth'|'host_key';trigger:'scheduled'|'manual'|'manual_auth_fixed';retry_pending:boolean};
export type Hardware={cores_total:number|null;cores_allocated:number|null;cores_idle:number|null;cores_other:number|null;mem_total_gb:number|null;mem_allocated_gb:number|null;source?:'pbsnodes'|'sinfo';error:string|null;notes?:string[]};
export type JobSummary={running_jobs:number|null;running_cores:number|null;queued_jobs:number|null;queued_cores:number|null;others_running_jobs:number|null;others_running_cores:number|null;others_queued_jobs:number|null;others_queued_cores:number|null};
export type Monitor={
 sampling?:Sampling;
 schema:'ag-monitor/1';sampled_at:string;interval_seconds:number|null;sample_duration_ms?:number|null;ok:boolean;error:string|null;last_ok_at:string|null;
 own:{cores_in_use:number;core_cap:number;cores_running?:number;cores_queued?:number;committed_cap?:number;max_queued_cores?:number;scheduler_max_running_cores?:number;max_cores?:number;max_walltime?:string;tiers?:Record<string,{cores:number;mem_gb:number}>;shared_with?:string[];mem_running_gb?:number|null;mem_queued_gb?:number|null;jobs:Job[]}|null;
 cluster:{scheduler?:string;name?:string;display_name?:string;display_order?:number|null;hardware_capacity_known?:boolean;budget?:{core_hours:number;used:number;reserved:number}|null;expires?:string|null;storage_kib?:number|null;storage_checked_at?:string|null;storage_sampled_at?:string|null;storage_error?:string|null;expiry_warning?:string|null;cores_total:number|null;cores_used:number|null;
  nodes:{name:string;state:string;cores_total:number|null;cores_used:number|null;mem_total_gb?:number|null;mem_assigned_gb?:number|null;jobs?:number|null}[];
  queues:{name:string;running:number;queued:number}[];jobs?:Job[];jobs_omitted?:number|null;job_summary?:JobSummary|null;hardware?:Hardware|null;
 }|null;
 warnings:(Association&{kind:string;job_id:string|null;detail:string})[];
};
export type Segments={total:number;mine:number;others:number;idle:number;other?:number}|null;
// PBS state and scheduler allocation are independent. Missing/inconsistent
// values cannot establish free capacity or a proportion (including 0/0).
export function nodeAllocation(total:number|null|undefined,assigned:number|null|undefined){
 const number=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
 const capacity=number(total),used=number(assigned);
 const inconsistent=capacity!==null&&used!==null&&used>capacity;
 const known=capacity!==null&&capacity>0&&used!==null&&!inconsistent;
 return {total:capacity,assigned:used,remaining:known?capacity-used:null,percent:known?100*used/capacity:null,inconsistent};
}
// A partial or inconsistent sample cannot establish an occupancy proportion.
export function segments(total:number|null|undefined,allocated:number|null|undefined,mine:number|null|undefined):Segments{
 if(total==null||allocated==null||mine==null||total<=0||mine<0||allocated<mine||allocated>total)return null;
 return {total,mine,others:allocated-mine,idle:total-allocated};
}
// sinfo Other is not Idle. Missing or contradictory CPU counts cannot
// establish free capacity, even when total minus allocated is positive.
function slurmSegments(h:Hardware|null|undefined,mine:number|null|undefined):Segments{
 if(!h)return null;
 const {cores_total:total,cores_allocated:allocated,cores_idle:idle,cores_other:other}=h;
 if([total,allocated,idle,other,mine].some(v=>typeof v!=='number'||!Number.isFinite(v)||!Number.isInteger(v)||v<0))return null;
 if(total===null||allocated===null||idle===null||other===null||mine==null||total<=0||mine>allocated||allocated+idle+other!==total)return null;
 return {total,mine,others:allocated-mine,idle,other};
}
export const entryKey=(row:ClusterRow)=>JSON.stringify([row.name,row.source]);
export const amount=(n:number|null|undefined)=>n==null?'未知':Number(n.toFixed(1)).toString();
export const isRunning=(job:Job)=>['R','E','RUNNING','COMPLETING'].includes(job.state);
export const isQueued=(job:Job)=>['Q','H','W','S','PENDING','SUSPENDED','CONFIGURING','REQUEUED','RESIZING'].includes(job.state);
export function schedulerLabel(row:ClusterRow){const c=row.snapshot?.cluster;return c?.scheduler?.toUpperCase()||(c?.hardware?.source==='pbsnodes'?'PBS':c?.hardware?.source==='sinfo'?'SLURM':'—');}
export function serverModels(rows:ClusterRow[],now:number){
 const groups=capacityGroups(rows,now);
 return [...rows].sort((a,b)=>{
  const x=a.snapshot?.cluster?.display_order,y=b.snapshot?.cluster?.display_order;
  if(x!=null||y!=null){if(x==null)return 1;if(y==null)return -1;if(x!==y)return x-y;}
  return Number(schedulerLabel(a)==='SLURM')-Number(schedulerLabel(b)==='SLURM')||a.name.localeCompare(b.name)||a.source.localeCompare(b.source);
 }).map(row=>{
  const state=sampleState(row,now),data=row.snapshot,cluster=data?.cluster,group=groups.find(g=>g.group.includes(row))!;
  const own=group.own,hardware=cluster?.hardware,scheduler=schedulerLabel(row);
  const usable=data?.ok&&!row.error&&!row.ambiguous&&cluster?.hardware_capacity_known!==false;
  const jobs:Job[]=state.hasData?(cluster?.jobs??(data?.own?.jobs??[]).map(job=>({...job,mine:true}))):[];
  // Slurm must never reveal other users even if a malformed producer includes them.
  const visible=scheduler==='SLURM'?jobs.filter(j=>j.mine):jobs;
  const sort=(items:Job[],field:'start_time'|'qtime')=>[...items].sort((a,b)=>Number(!!b.mine)-Number(!!a.mine)||(Date.parse(a[field]??'')||Infinity)-(Date.parse(b[field]??'')||Infinity)||a.job_id.localeCompare(b.job_id));
  const nodes=state.hasData?cluster?.nodes??[]:[],known=scheduler!=='SLURM'&&cluster?.hardware_capacity_known!==false&&nodes.length>0&&nodes.every(n=>nodeAllocation(n.cores_total,n.cores_used).remaining!==null);
  const free=nodes.filter(n=>n.state==='free');
  return {key:entryKey(row),row,label:clusterLabel(row)+(row.ambiguous?' · '+row.source:''),...state,group,scheduler,sampling:data?.sampling??null,notes:[...new Set(hardware?.notes??[])],
   warningCount:(data?.warnings.length??0)+(hardware?.error?1:0)+(cluster?.storage_error?1:0)+(cluster?.expiry_warning?1:0),
   cores:usable?(scheduler==='SLURM'?slurmSegments(hardware,own?.cores_running):segments(hardware?.cores_total,hardware?.cores_allocated,own?.cores_running)):null,
   memory:usable?segments(hardware?.mem_total_gb,hardware?.mem_allocated_gb,own?.mem_running_gb):null,
   running:sort(visible.filter(isRunning),'start_time'),queued:sort(visible.filter(isQueued),'qtime'),
   freeNodes:known?free.filter(n=>n.cores_used===0).length:null,totalNodes:nodes.length||null,
   freeCores:known?free.reduce((sum,n)=>sum+Math.max(0,n.cores_total!-n.cores_used!),0):null,
  };
 });
}
export type ServerModel=ReturnType<typeof serverModels>[number];
