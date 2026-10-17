import type {AttemptSummary,Document} from './api';
import {object} from './api';
import type {Monitor} from './server-monitor';
export type ClusterRow={name:string;source:string;ambiguous:boolean;snapshot:Monitor|null;error:string|null};
export type LocalAttempt={study:string;attempt:AttemptSummary};
export const safeIdentity=(s:string|null):s is string=>!!s&&!['.','..'].includes(s)&&!/[\/\\\0]/.test(s);
export function sampleState(row:ClusterRow,now:number){
 const data=row.snapshot;
 const stale=!!data&&now-Date.parse(data.sampled_at)>(data.interval_seconds===null?600:3*data.interval_seconds)*1000;
 return {stale,old:!data||!data.ok||stale||row.ambiguous,hasData:!!data&&(data.ok||data.last_ok_at!==null)};
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
