import type {Segments,ServerModel} from './jobs-data';
import {amount} from './jobs-data';
import {StatusBadge} from './ui';
export function localTime(value:string|null|undefined){return value?new Date(value).toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'尚无成功采样';}
export function ageText(seconds:number){
 if(seconds<60)return `${seconds} 秒`;
 const minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
 if(hours>=24)return `${Math.floor(hours/24)} 天 ${hours%24} 小时`;
 if(hours>=1)return `${hours} 小时 ${minutes%60} 分`;
 return `${minutes} 分 ${seconds%60} 秒`;
}
export const pauseReason=(reason:string|null)=>reason==='auth'?'SSH 认证失败':reason==='host_key'?'主机指纹变化':'原因未提供';
export const sampleTime=(value:string)=>new Date(value).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
export function nextSampleText(value:string|null|undefined,now:number,format=sampleTime){
 const at=Date.parse(value??'');
 return !Number.isFinite(at)?'—':at<=now?'等待下一轮':format(value!);
}
export function SamplingStatus({model:m,now}:{model:ServerModel;now:number}){const s=m.sampling;if(!s)return null;return <span className={'sampling-status sampling-'+s.state}>{s.state==='paused'?`已暂停：${pauseReason(s.pause_reason)}`:s.state==='backoff'?`退避中 · 连续失败 ${s.consecutive_failures} 次 · 下次采样：${nextSampleText(s.next_sample_at,now)}`:s.next_sample_at?`下次采样：${nextSampleText(s.next_sample_at,now)}`:null}</span>;}
export function ResourceBar({label,value,unit=''}:{label:string;value:Segments;unit?:string}){
 const text=value?`本人 ${amount(value.mine)}，他人 ${amount(value.others)}，空闲 ${amount(value.idle)}${value.other?`，其他状态 ${amount(value.other)}`:''}，共 ${amount(value.total)}${unit?' '+unit:''}`:'未知';
 return <span className="resource"><span className="resource-label"><strong>{label}</strong><span>{value?`${amount(value.mine+value.others)} / ${amount(value.total)} ${unit}`:'未知'}</span></span>
 <svg viewBox="0 0 100 10" preserveAspectRatio="none" className={'resource-track'+(value?'':' resource-unknown')} role="img" aria-label={`${label}：${text}`}>
 {value&&<><rect className="resource-mine" x="0" y="0" height="10" width={100*value.mine/value.total}/><rect className="resource-others" x={100*value.mine/value.total} y="0" height="10" width={100*value.others/value.total}/><rect className="resource-idle" x={100*(value.mine+value.others)/value.total} y="0" height="10" width={100*value.idle/value.total}/>{!!value.other&&<rect className="resource-other" x={100*(value.mine+value.others+value.idle)/value.total} y="0" height="10" width={100*value.other/value.total}/>}</>}</svg>
 <span className="resource-caption">{text}</span></span>;
}
export function ServerCards({models,selected,onSelect,now}:{models:ServerModel[];selected:string;onSelect:(key:string)=>void;now:number}){
 return <><div className="resource-legend" aria-label="资源颜色图例">{[['mine','深色 = 本人'],['others','浅色 = 他人'],['idle','空白 = 空闲'],...(models.some(m=>(m.cores?.other??0)>0)?[['other','灰色 = 其他状态']]:[]),['unknown','斜纹 = 未知']].map(([kind,label])=><span key={kind}><i className={'legend-'+kind}/>{label}</span>)}</div><div className={'server-cards'+(models.length===5?' server-cards-five':'')}>{models.map(m=>{
  const d=m.row.snapshot,c=d?.cluster,failed=!!m.row.error||!d?.ok,summary=m.hasData?c?.job_summary:null;
  const ownKnown=!!d?.ok&&m.group.own!=null;
  const shared=[...m.group.group.filter(r=>r.name!==m.row.name).map(r=>models.find(x=>x.row===r)?.label??r.name),...m.group.missing];
  return <section key={m.key} aria-label={`集群 ${m.label}`}><button className="server-card" aria-label={`选择服务器 ${m.label}`} aria-pressed={selected===m.key} onClick={()=>onSelect(m.key)}>
   <span className="server-card-heading"><strong>{m.label}</strong><span>{m.scheduler}</span></span>
   <span className="server-card-status"><StatusBadge tone={failed?'bad':m.old?'warn':'ok'}>{failed?'采样失败':m.old?'非最新':'新鲜'}</StatusBadge><SamplingStatus model={m} now={now}/>{m.warningCount>0&&<span>{m.warningCount} 条警告</span>}</span>
   <span className="server-age">{d?<><time dateTime={d.sampled_at} title={d.sampled_at}>{localTime(d.sampled_at)}</time> · 距今 {ageText(Math.max(0,Math.floor((now-Date.parse(d.sampled_at))/1000)))}<small>{d.interval_seconds===null?'单次采样':`采样间隔 ${d.interval_seconds} 秒`}</small></>:'尚无采样'}</span>
   <ResourceBar label="核数" value={m.cores}/><ResourceBar label="内存" value={m.memory} unit="GB"/>{(!m.cores||!m.memory)&&m.notes.map((note,i)=><small className="hardware-note" key={i}>{note}</small>)}
   <span className="server-job-count">运行 {amount(summary?.running_jobs)} 个作业 · 排队 {amount(summary?.queued_jobs)} 个作业 / {amount(summary?.queued_cores)} 核</span>
   <span>本人：运行 {amount(ownKnown?m.group.running:null)} · 排队 {amount(ownKnown?m.group.queued:null)} / 总上限 {amount(m.group.cap)} 核</span>
   {shared.length>0&&<small>与 {shared.join('、')} 共享总上限（只计一次）</small>}
   {m.row.ambiguous&&<small className="snapshot-notice">来源未确认；不能视为当前状态。</small>}
   {failed&&<small className="snapshot-notice">采样失败：{m.row.error??d?.error??'未提供错误说明'} · 上次成功：{localTime(d?.last_ok_at)} · 当前占用与硬件容量未知</small>}
  </button></section>;
 })}</div></>;
}
