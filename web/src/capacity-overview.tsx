import type {ClusterRow} from './jobs-data';
import {clusterLabel,sampleState} from './jobs-data';

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
  return {group,missing:[...new Set(missing)],status:failed?'失败':stale?'过期':'新鲜',fresh,cap,running,queued,available,queuedCap:limits.length?Math.min(...limits):null};
 });
}
const value=(n:number|null|undefined)=>n??'未提供';
function time(text:string|null|undefined){return text?<time dateTime={text} title={text}>{new Date(text).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</time>:'尚无成功采样';}
export function CapacityOverview({rows,now}:{rows:ClusterRow[];now:number}){
 const groups=capacityGroups(rows,now);
 return <section className="capacity-overview" aria-label="集群容量总览"><h3>集群容量总览</h3>
  <p>仅供参考；选择集群还需遵守 study 的平台规定（例如同一物种的优化与频率尽量放在同一集群）。</p>
  <div className="table-scroll"><table aria-label="集群容量总览表"><thead><tr><th>集群 / 采样</th><th>本人运行 / 排队</th><th>总上限 / 剩余可提交</th><th>排队上限</th><th>单作业上限</th><th>档位 · 核 / GB</th><th>PBS 空闲节点 / 核</th></tr></thead><tbody>
   {groups.map(g=><tr key={g.group.map(r=>r.name+':'+r.source).join('|')}>
    <td><strong>{g.group.map(clusterLabel).join(' / ')}</strong><span>{g.group.length>1?'共享一组 · ':''}{g.status}</span>{g.group.map(r=><small key={r.name+':'+r.source}>{g.group.length>1?clusterLabel(r)+'：':''}{time(r.snapshot?.last_ok_at)}</small>)}{g.missing.length>0&&<small>缺少入口采样：{g.missing.join('、')}</small>}</td>
    <td>{value(g.running)} / {value(g.queued)}{!g.fresh&&<small>非最新或未知</small>}</td>
    <td>{value(g.cap)} / <strong data-testid="remaining-cores">{g.available??'未知'}</strong></td>
    <td>{value(g.queuedCap)}</td>
    <td>{g.group.map(r=><div key={r.name+':'+r.source}>{g.group.length>1?clusterLabel(r)+'：':''}{value(r.snapshot?.own?.max_cores??r.snapshot?.own?.core_cap)}</div>)}</td>
    <td>{g.group.map(r=>{const tiers=r.snapshot?.own?.tiers;return <div key={r.name+':'+r.source}>{g.group.length>1&&<strong>{clusterLabel(r)}：</strong>}{tiers&&Object.keys(tiers).length?Object.entries(tiers).map(([name,tier])=><span className="capacity-tier" key={name}>{name} {tier.cores} 核 / {tier.mem_gb} GB</span>):'未知（后端未提供）'}</div>;})}</td>
    <td>{g.group.map(r=>{const c=r.snapshot?.cluster,nodes=c?.nodes??[],known=sampleState(r,now).hasData&&c?.scheduler!=='slurm'&&c?.hardware_capacity_known!==false&&nodes.length>0&&nodes.every(n=>n.cores_total!==null&&n.cores_used!==null);const free=nodes.filter(n=>n.state==='free');return <div key={r.name+':'+r.source}>{g.group.length>1?clusterLabel(r)+'：':''}{known?`${free.filter(n=>n.cores_used===0).length} / ${free.reduce((sum,n)=>sum+Math.max(0,n.cores_total!-n.cores_used!),0)}`:'未提供'}{known&&!g.fresh&&<small>非最新</small>}</div>;})}</td>
   </tr>)}
  </tbody></table></div>
 </section>;
}
