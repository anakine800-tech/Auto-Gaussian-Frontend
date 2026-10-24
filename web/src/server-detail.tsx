import {useRef,useState} from 'react';
import {amount,safeIdentity} from './jobs-data';
import type {Job,ServerModel} from './jobs-data';
import {routeHash} from './routing';
import {SnapshotProgress,WalltimeProgress} from './job-progress';
import {localTime,pauseReason} from './server-cards';
import {actionToken} from './actions';
import {retryMonitor} from './api';
import {Collapsible,DataTable,Drawer,ErrorNotice,readPreference,savePreference,StatusBadge} from './ui';
export function ServerDetail({model:m,revision,onRetry}:{model:ServerModel;revision:number;onRetry:()=>void}){
 const d=m.row.snapshot,c=d?.cluster,own=d?.own,summary=m.hasData?c?.job_summary:null;
 const preference='server-mine:'+m.row.name;
 const [onlyMine,setOnlyMine]=useState(()=>readPreference(preference,'false')==='true');
 const slurm=m.scheduler==='SLURM';
 const [confirm,setConfirm]=useState(false),[retryMessage,setRetryMessage]=useState(''),requestNumber=useRef(0);
 async function retry(authFixed:boolean){
  if(!actionToken)return;
  setConfirm(false);const request=++requestNumber.current;setRetryMessage('正在请求…');onRetry();
  try{
   const result=await retryMonitor(m.row.name,authFixed,actionToken);
   const message=result.result==='queued'?'已请求，等待采样':result.result==='already_queued'?'已在等待，结果见下一份快照':result.result==='in_progress'?'正在采样，结果见下一份快照':result.reason==='monitor_not_running'?'监控未运行，未登记请求':result.reason==='auth_confirmation_required'?'需要先确认已修复认证问题':`ag：${result.result}（${result.reason??'未提供原因'}）`;
   if(request===requestNumber.current)setRetryMessage(message);
  }catch(e){if(request===requestNumber.current)setRetryMessage(e instanceof Error?e.message:'重试请求失败');}
 }
 function jobTable(title:string,rows:Job[],running:boolean){
  const total=running?summary?.running_jobs:summary?.queued_jobs,cores=running?summary?.running_cores:summary?.queued_cores;
  const others=running?summary?.others_running_jobs:summary?.others_queued_jobs,otherCores=running?summary?.others_running_cores:summary?.others_queued_cores;
  return <section className="server-job-group" aria-label={title}><h3>{title} <span>{amount(total)} 个作业 / {amount(cores)} 核</span></h3>
   <p className="muted">{running?'核数为实际分配':'核数为申请值，按提交时间排序'}{onlyMine?' · 仅显示本人，标题为入口总量':''}</p>
   <DataTable label={title+'作业表'} rows={rows.filter(j=>!onlyMine||j.mine)} rowKey={j=>JSON.stringify([j.job_id,j.study,j.attempt])} columns={[
    {key:'user',label:'用户',render:j=><>{j.mine&&<span className="own-job"><StatusBadge tone="info">本人</StatusBadge> </span>}{j.user??'未知'}</>},
    {key:'name',label:'作业名',render:j=><>{j.name}{j.mine&&<small>{safeIdentity(j.study)&&safeIdentity(j.attempt)?<a href={routeHash([j.study,j.attempt])}>{j.attempt}</a>:'未关联本地 Attempt'}</small>}</>},
    {key:'cores',label:'核数',className:'numeric',render:j=>amount(j.cores)},
    {key:'memory',label:'内存',className:'numeric',render:j=>j.mem_gb==null?'未知':amount(j.mem_gb)+' GB'},
    {key:'time',label:'已运行 / walltime',render:j=><WalltimeProgress used={'elapsed_seconds' in j?j.elapsed_seconds:j.walltime_used} limit={'walltime_limit_seconds' in j?j.walltime_limit_seconds:j.walltime_limit}/>},
    {key:'queue',label:'队列',render:j=>j.queue},
    {key:'snapshot',label:'最近快照进度',render:j=>j.mine?<SnapshotProgress study={j.study} attempt={j.attempt} revision={revision}/>:<span className="muted">—</span>},
    {key:'job',label:'作业号',optional:true,render:j=>j.job_id},
   ]}/>
   {slurm&&!onlyMine&&<p className="other-users">其他用户：{amount(others)} 个作业 / {amount(otherCores)} 核</p>}
  </section>;
 }
 return <section className={'server-detail'+(m.old?' server-noncurrent':'')} aria-label={`集群 ${m.label} 详细信息`}>
  {c?.hardware?.error&&<ErrorNotice>硬件采样失败：{c.hardware.error}</ErrorNotice>}
  {m.sampling&&<div className={'sampling-detail sampling-'+m.sampling.state}>
   <p>{m.sampling.state==='paused'?`已暂停：${pauseReason(m.sampling.pause_reason)}`:m.sampling.state==='backoff'?'退避中':'正常'} · 连续失败 {m.sampling.consecutive_failures} 次 · 下次采样：{m.sampling.next_sample_at?localTime(m.sampling.next_sample_at):'—'}</p>
   {m.sampling.state==='paused'&&<p>检查密钥、隧道或 known_hosts，修复后再重试</p>}
  </div>}
  {actionToken&&<div className="server-retry"><button onClick={()=>m.sampling?.state==='paused'?setConfirm(true):void retry(false)}>立即重新采样</button><span role="status">{retryMessage}</span></div>}
  <Drawer open={confirm} title="确认重新采样" onClose={()=>setConfirm(false)}>
   <p>上次因 {pauseReason(m.sampling?.pause_reason??null)} 而暂停。请确认已经修复，再试一次；失败会继续暂停。</p>
   <div className="server-retry-confirm"><button onClick={()=>setConfirm(false)}>取消</button><button onClick={()=>void retry(true)}>确认重试</button></div>
  </Drawer>
  {m.old&&<p className="server-stale" role="status">非最新{m.stale?' · 数据已过期':''}。{m.row.ambiguous?'来源未确认；':!d?.ok?'采样失败；':''}{m.hasData?'以下为保留的采样记录，不能视为当前状态。':'暂无成功采样数据，不能据此判断服务器空闲。'}</p>}
  {m.warningCount>0&&<section className="server-warnings" aria-label="警告"><h3>{m.warningCount} 条警告</h3>
   {!!d?.warnings.length&&<ul>{d.warnings.map((w,i)=><li key={i}><span>{w.detail}</span>{safeIdentity(w.study)&&safeIdentity(w.attempt)&&<> · <a href={routeHash([w.study,w.attempt])}>{w.attempt}</a></>}</li>)}</ul>}
   {c?.storage_error&&<ErrorNotice>存储查询失败：{c.storage_error}</ErrorNotice>}
   {c?.expiry_warning&&<ErrorNotice>{c.expiry_warning}</ErrorNotice>}
  </section>}
  {m.row.error&&<ErrorNotice>{m.row.error}</ErrorNotice>}
  <div className="server-detail-heading"><h2>{m.label}</h2><label><input type="checkbox" checked={onlyMine} onChange={e=>{setOnlyMine(e.target.checked);savePreference(preference,String(e.target.checked));}}/>只看本人</label></div>
  {!c?.jobs&&<p className="muted">旧快照：全员作业、内存和硬件分段未知；以下保留已采集的本人作业。</p>}
  {jobTable('运行中',m.running,true)}{jobTable('排队中',m.queued,false)}
  {(c?.jobs_omitted??0)>0&&<p className="snapshot-notice">其余 {c!.jobs_omitted} 条未列出</p>}
  <Collapsible page="server" block={'nodes:'+m.key} title={slurm?'节点与队列 · 分区 CPU 汇总':`节点与队列 · 空闲节点 ${amount(m.freeNodes)} / 共 ${amount(m.totalNodes)} · 空闲 ${amount(m.freeCores)} 核`} defaultOpen={!slurm&&m.totalNodes===1}>
   {slurm?<p>分区 CPU：已分配 {amount(c?.hardware?.cores_allocated)} / 空闲 {amount(c?.hardware?.cores_idle)} / 其他 {amount(c?.hardware?.cores_other)} / 总数 {amount(c?.hardware?.cores_total)}</p>:<>
   <DataTable label="节点表" rows={m.hasData?c?.nodes??[]:[]} rowKey={n=>n.name} columns={[
    {key:'name',label:'节点',render:n=>n.name},{key:'state',label:'状态',render:n=>n.state},
    {key:'cores',label:'核数（已用 / 总）',render:n=><>{amount(n.cores_used)} / {amount(n.cores_total)}{n.cores_used!==null&&n.cores_total!==null&&n.cores_total>0&&<progress aria-label={n.name+' 核数使用'} value={n.cores_used} max={n.cores_total}/>}</>},
    {key:'memory',label:'内存（已分配 / 总）',render:n=>`${amount(n.mem_assigned_gb)} / ${amount(n.mem_total_gb)} GB`},
    {key:'jobs',label:'作业数',render:n=>amount(n.jobs)},
   ]}/>
   <DataTable label="队列表" rows={m.hasData?c?.queues??[]:[]} rowKey={q=>q.name} columns={[{key:'name',label:'队列',render:q=>q.name},{key:'running',label:'运行',render:q=>q.running},{key:'queued',label:'排队',render:q=>q.queued}]}/></>}
  </Collapsible>
  <Collapsible page="server" block={'limits:'+m.key} title="限额、档位与存储">
   <div className="server-limits"><p>单作业上限 {amount(own?.max_cores??own?.core_cap)} 核</p><p>总上限 {amount(m.group.cap)} 核</p><p>排队上限 {amount(m.group.queuedCap)} 核</p></div>
   {own?.scheduler_max_running_cores!==undefined&&<p>运行限额 {own.scheduler_max_running_cores} 核 · 由调度器执行，ag 未核实</p>}
   <DataTable label="档位表" rows={Object.entries(own?.tiers??{})} rowKey={r=>r[0]} columns={[{key:'name',label:'档位',render:r=>r[0]},{key:'cores',label:'核数',render:r=>r[1].cores},{key:'memory',label:'内存（GB）',render:r=>r[1].mem_gb}]}/>
   {!Object.keys(own?.tiers??{}).length&&<p>档位未知（后端未提供）</p>}
   <p>存储占用：{c?.storage_kib==null?'未知':amount(c.storage_kib/1024/1024)+' GB'} · 查询时间：{c?.storage_checked_at?localTime(c.storage_checked_at):'未知'} · 数据时间：{c?.storage_sampled_at?localTime(c.storage_sampled_at):'未知'}</p>
   {c?.storage_error&&<ErrorNotice>存储查询失败：{c.storage_error}；上方为保留值（非最新）。</ErrorNotice>}
   {c?.budget!=null&&<article aria-label="核时预算"><p>预算 {c.budget.core_hours} · 已用 {c.budget.used} · 预留 {c.budget.reserved} 核时</p><p className="muted">本地台账，不代表平台余额。</p></article>}
   {c?.expires!=null&&<p>到期日期：{c.expires}</p>}{c?.expiry_warning&&<ErrorNotice>{c.expiry_warning}</ErrorNotice>}
  </Collapsible>
 </section>;
}
