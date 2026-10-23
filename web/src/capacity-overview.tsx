import type {ClusterRow} from './jobs-data';
import {sampleState} from './jobs-data';

// shared_with identifies one scheduler/account: never sum snapshots of it.
export function capacityGroups(rows:ClusterRow[],now:number){
 const remaining=[...rows],groups:ClusterRow[][]=[];
 while(remaining.length){
  const group=[remaining.shift()!],names=new Set<string>();
  let changed=true;
  while(changed){changed=false;for(const row of group){names.add(row.name);for(const name of row.snapshot?.own?.shared_with??[])names.add(name);}
   for(let i=remaining.length-1;i>=0;i--){const row=remaining[i];if(names.has(row.name)||(row.snapshot?.own?.shared_with??[]).some(n=>names.has(n))){group.push(...remaining.splice(i,1));changed=true;}}
  }
  groups.push(group.sort((a,b)=>a.name.localeCompare(b.name)));
 }
 return groups.map(group=>{
  const members=new Set(group.map(r=>r.name)),missing=group.flatMap(r=>r.snapshot?.own?.shared_with??[]).filter(n=>!members.has(n));
  const failed=group.some(r=>r.error||!r.snapshot?.ok||r.ambiguous)||missing.length>0;
  const stale=group.some(r=>sampleState(r,now).stale);
  const fresh=!failed&&!stale;
  const successTime=(row:ClusterRow)=>Date.parse((row.snapshot?.ok?row.snapshot.sampled_at:row.snapshot?.last_ok_at)??'')||0;
  const latest=[...group].sort((a,b)=>successTime(b)-successTime(a))[0];
  const own=sampleState(latest,now).hasData?latest.snapshot?.own:null;
  const caps=group.map(r=>r.snapshot?.own?.committed_cap),cap=caps.every((n):n is number=>n!==undefined)?Math.min(...caps):null;
  const running=own?.cores_running??null,queued=own?.cores_queued??null;
  const available=fresh&&cap!==null&&running!==null&&queued!==null?Math.max(0,cap-running-queued):null;
  const limits=group.map(r=>r.snapshot?.own?.max_queued_cores).filter((n):n is number=>n!==undefined);
  return {group,own,missing:[...new Set(missing)],status:failed?'失败':stale?'过期':'新鲜',fresh,cap,running,queued,available,queuedCap:limits.length?Math.min(...limits):null};
 });
}
