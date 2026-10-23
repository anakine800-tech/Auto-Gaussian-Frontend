import {useEffect,useState} from 'react';
import {ServerCards} from './server-cards';
import {ServerDetail} from './server-detail';
import {display,endpoint,get} from './api';
import type {Study} from './api';
import {routeHash} from './routing';
import {DataTable,EmptyState,ErrorNotice,Panel,StatusBadge} from './ui';
import {clusterLabel,finishedAttempts,serverModels} from './jobs-data';
import type {ClusterRow,LocalAttempt} from './jobs-data';
import {WalltimeProgress} from './job-progress';
import './ui/server.css';
export type {Monitor} from './jobs-data';
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
 const models=serverModels(data?.clusters??[],now);
 const [selected,setSelected]=useState('');
 const active=models.find(m=>m.key===selected)??models[0];
 const finished=finishedAttempts(local??[]);
 return <section className="jobs-page server-page" aria-label="服务器监控"><div className="jobs-heading"><h2>服务器</h2><span className="muted">每 30 秒读取本地采样与记录</span></div>
 {error?<ErrorNotice>{error}</ErrorNotice>:!data?<p role="status">读取采样快照…</p>:models.length===0?<EmptyState>暂无集群采样。</EmptyState>:<>
 <ServerCards models={models} selected={active.key} onSelect={setSelected} now={now}/>
 <div className="server-tabs" role="tablist" aria-label="服务器详情">{models.map((m,i)=><button key={m.key} role="tab" id={'server-tab-'+i} aria-controls="server-detail" aria-selected={active.key===m.key} tabIndex={active.key===m.key?0:-1} onClick={()=>setSelected(m.key)} onKeyDown={e=>{
  const next=e.key==='ArrowRight'?(i+1)%models.length:e.key==='ArrowLeft'?(i+models.length-1)%models.length:e.key==='Home'?0:e.key==='End'?models.length-1:null;
  if(next!==null){e.preventDefault();setSelected(models[next].key);document.getElementById('server-tab-'+next)?.focus();}
 }}>{m.label}{' '}{m.warningCount>0&&<span className="server-warning-count">{m.warningCount} 条警告</span>}</button>)}</div>
 <div id="server-detail" role="tabpanel" aria-labelledby={'server-tab-'+models.indexOf(active)}><ServerDetail key={active.key} model={active} revision={tick}/></div>
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
