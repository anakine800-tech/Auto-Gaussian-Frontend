import {useEffect,useState} from 'react';

type Verdict='enough'|'queue'|'unknown'|'not_applicable';
type Advice={availability:Verdict;fits_total:boolean|null;reasons:string[];cpu_source:string|null;memory_source:string|null};
type Capacity=Advice&{cluster:string;tier:string;target_node:string|null;cores:number;mem_gb:number;sampled_at:string|null;valid_until:string|null;snapshot_fresh:boolean;capability_unavailable?:boolean;nodes:(Advice&{name:string})[]};
const labels:Record<Verdict,string>={enough:'当前容量足够',queue:'需要排队',unknown:'无法判断',not_applicable:'规格不适用'};

export function AttemptCapacity({cluster,tier,target,token,now}:{cluster:string;tier:string;target?:string;token:string;now:number}){
 const [refresh,setRefresh]=useState(0);
 const [state,setState]=useState<{key:string;refresh:number;data?:Capacity;error?:string}|null>(null);
 const key=JSON.stringify({cluster,tier,...(target===undefined?{}:{target_node:target})});
 const ready=!!cluster&&!!tier&&target!=='';
 useEffect(()=>{
  if(!ready)return;
  const controller=new AbortController();
  // Both the key and cleanup protect against old responses, including the render
  // before React has cleaned up the previous selection's effect.
  fetch('/api/attempt-capacity',{method:'POST',headers:{'Content-Type':'application/json','X-AG-Token':token},body:key,signal:controller.signal})
   .then(async response=>{
    const data=await response.json();
    if(response.status===403&&data.detail==='Invalid action token')throw Error('前端已重启，请刷新页面');
    if(!response.ok)throw Error('容量读取失败；未自动重试，可手动刷新容量。');
    const request=JSON.parse(key);
    if(data.cluster!==request.cluster||data.tier!==request.tier||data.target_node!==(request.target_node??null))throw Error('容量响应与当前选择不符；未采用此结果。');
    if(!controller.signal.aborted)setState({key,refresh,data});
   }).catch(e=>{if(!controller.signal.aborted)setState({key,refresh,error:e instanceof Error?e.message:'容量读取失败'});});
  return()=>controller.abort();
 },[key,ready,refresh,token]);
 const current=state?.key===key&&state.refresh===refresh?state:null,data=current?.data;
 const expired=!!data?.snapshot_fresh&&(!data.valid_until||Date.parse(data.valid_until)<=now);
 const verdict=data&&!expired?data.availability:'unknown';
 return <section className="attempt-capacity" aria-label="申请容量">
  <div className="attempt-capacity-heading"><h3>申请容量：{labels[verdict]}</h3><button type="button" disabled={!ready||!current||data?.capability_unavailable} onClick={()=>setRefresh(v=>v+1)}>刷新容量</button></div>
  <div aria-live="polite">
   {!ready?<p>请先明确选择入口、档位及所需目标节点。</p>:!current?<p>正在读取本地容量快照…</p>:current.error?<p>{current.error}</p>:<>
    {data?.capability_unavailable&&<p>容量能力不可用</p>}
    {expired?<p>容量数据已过期，请刷新容量；当前无法判断。</p>:data?.reasons.map((reason,i)=><p key={i}>{reason}</p>)}
    <p>数据时间：{data?.sampled_at??'未知'} · 有效至：{data?.valid_until??'未知'}</p>
    <p>核数来源：{data?.cpu_source??'未知'}；内存来源：{data?.memory_source??'未知'}</p>
    {!!data?.nodes.length&&<details><summary>节点判断明细（{data.nodes.length}）</summary><ul>{data.nodes.map((node,i)=><li key={i}>{node.name}：{labels[expired?'unknown':node.availability]} · {node.reasons.join('；')}</li>)}</ul></details>}
   </>}
  </div>
  <p>依据已有本地快照的单节点已分配资源判断；不代表实时 CPU 或 RSS。容量足够不保证立即启动，账号额度、节点限制和提交授权仍由 ag 核对。</p>
 </section>;
}
