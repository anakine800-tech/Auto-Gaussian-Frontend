import {useEffect,useState} from 'react';
import {coreHours,display,get,object} from './api';
import type {Attempt} from './api';
import {ActionBar,Drawer} from './ui';
import {routeHash} from './routing';
import {orderedResourceTiers,resourceWalltimeLabel,resourceWalltimeSeconds} from './jobs-data';

export const actionToken=document.querySelector<HTMLMetaElement>('meta[name="ag-token"]')?.content;
type Tier={cores:number;mem_mb:number};
type NodeOption={fraction:string;cores:number;mem_gb:number;tier:string|null};
type NodeRow={name:string;priority:number;status:string;reason:string;options:NodeOption[]};
type NodeTargets={fresh:boolean;valid_until?:string;nodes:NodeRow[];error?:string};
const nodeStates:Record<string,string>={available:'可选',occupied:'已占用',insufficient:'资源不足',stale:'数据过期',restricted:'特殊核限制待验证',forbidden:'不允许提交',unknown:'数据未知'};
type Cluster={node_targeting?:{default_fraction:'1/2';fractions:string[]};scheduler:string;tiers:Record<string,Tier>;max_walltime?:string;programs_enabled:{gaussian:boolean;xtb:boolean;crest:boolean}};
type Context={state:string;can_cancel:boolean;source:string|null;clusters:Record<string,Cluster>;manifest:Record<string,unknown>;node_targets?:Record<string,NodeTargets>};
export type ActionResult={stdout:string;stderr:string;exit_code:number|null;timed_out:boolean;notice?:string;new_attempt?:string};
function resources(input:string,tier:Tier){
 return `%nprocshared=${tier.cores}\n%mem=${tier.mem_mb}MB\n`+input.split('\n').filter(line=>!/^\s*%(nprocshared|mem)\s*=/i.test(line)).join('\n');
}
export function ActionOutput({result}:{result:ActionResult|null}){
 return result&&<section className="action-output" aria-label="ag 输出"><h2>ag 输出</h2><p>退出码：{result.exit_code??'未取得'}{result.timed_out?' · 页面等待已结束（未终止 ag）':''}</p>{result.notice&&<p role="alert">{result.notice}</p>}<h3>stdout</h3><pre data-testid="ag-stdout">{result.stdout}</pre><h3>stderr</h3><pre data-testid="ag-stderr">{result.stderr}</pre></section>;
}
export function AttemptActions({study,data,revision,busy,onBusy,onResult}:{study:string;data:Attempt;revision:number;busy:boolean;onBusy:(v:boolean)=>void;onResult:(r:ActionResult)=>void}){
 const [context,setContext]=useState<Context|null>(null),[error,setError]=useState(''),[editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false),[pending,setPending]=useState('');
 const [cluster,setCluster]=useState('');
 const [target,setTarget]=useState(''),[fraction,setFraction]=useState('1/2'),[now,setNow]=useState(Date.now());
 useEffect(()=>{if(!editing)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[editing]);
 const [input,setInput]=useState(''),[tier,setTier]=useState('simple'),[walltime,setWalltime]=useState('01:00:00'),[label,setLabel]=useState('modified'),[relation,setRelation]=useState('derived_from'),[basis,setBasis]=useState('');
 useEffect(()=>{const c=new AbortController();setContext(null);setError('');setConfirm(false);get<Context>(`/api/actions/${encodeURIComponent(study)}/${encodeURIComponent(data.id)}`,c.signal).then(value=>{if(!c.signal.aborted)setContext(value);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,data.id,revision]);
 async function run(action:string){
  if(busy)return;
  onBusy(true);setPending(action);setError('');setConfirm(false);
  try{
   const body={action,study,attempt:data.id,...(action==='prepare'?{cluster,input,tier,walltime,label,relation,method_basis:basis,...(context?.clusters[cluster]?.node_targeting?{target_node:target,node_fraction:fraction}:{})}:{})};
   const response=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-AG-Token':actionToken!},body:JSON.stringify(body)});
   const result=await response.json();
   if(response.status===403&&result.detail==='Invalid action token'){setError('前端已重启，请刷新页面');return;}
   if(!response.ok)throw Error(result.detail??`操作失败 (${response.status})`);
   onResult(result);
   if(result.exit_code===0)setEditing(false);
  }catch(e){setError((e instanceof Error?e.message:'请求失败')+'；请刷新状态核对，不会自动重试。');}
  finally{onBusy(false);setPending('');}
 }
 function edit(){
  if(!context?.source)return;
  setTarget('');setFraction('1/2');setNow(Date.now());
  const m=context.manifest,c=typeof m.cluster==='string'?m.cluster:'default',tiers=context.clusters[c]?.tiers??{},t=typeof m.tier==='string'&&tiers[m.tier]?m.tier:'simple';
  setCluster(context.clusters[c]?c:'');setTier(t);setInput(tiers[t]?resources(context.source,tiers[t]):context.source);setWalltime(typeof m.walltime==='string'?m.walltime:'01:00:00');
  const science=object(m.science)?m.science:{};setBasis(typeof science.method_basis==='string'?science.method_basis:'');setEditing(true);setConfirm(false);
 }
 const m=context?.manifest??{},science=object(m.science)?m.science:{},geometry=object(data.input_geometry.data)?data.input_geometry.data:{};
 const tiers=context?.clusters[cluster]?.tiers??{},parentCluster=typeof m.cluster==='string'?m.cluster:'default';
 const limit=context?.clusters[cluster]?.max_walltime,duration=resourceWalltimeSeconds(walltime),maximum=limit===undefined?null:resourceWalltimeSeconds(limit);
 const walltimeError=duration===null?'请输入正的 HH:MM:SS，小时为 2–4 位。':limit!==undefined&&maximum===null?'入口时限格式无效，请核对配置。':maximum!==null&&duration>maximum?'walltime 超过此入口的单作业时限上限。':'';
 const targeted=!!context?.clusters[cluster]?.node_targeting,targets=context?.node_targets?.[cluster];
 const fresh=targets?.fresh===true&&typeof targets.valid_until==='string'&&Date.parse(targets.valid_until)>now;
 const node=targets?.nodes.find(n=>n.name===target),option=node?.options.find(o=>o.fraction===fraction);
 const nodeReady=!targeted||(fresh&&node?.status==='available'&&!!option?.tier&&option.tier===tier);
 const canPrepare=nodeReady&&!!tiers[tier]&&context?.clusters[cluster]?.programs_enabled.gaussian&&!walltimeError;
 function selectCluster(name:string){
  const choices=context?.clusters[name]?.tiers??{},t=choices[tier]?tier:'simple';
  setTarget('');setFraction('1/2');setNow(Date.now());
  setCluster(name);setTier(t);if(choices[t])setInput(resources(input,choices[t]));
 }
 function chooseNode(name:string,ratio=fraction){
  setTarget(name);setFraction(ratio);
  const next=targets?.nodes.find(n=>n.name===name)?.options.find(o=>o.fraction===ratio);
  if(next?.tier&&tiers[next.tier]){setTier(next.tier);setInput(resources(input,tiers[next.tier]));}
 }
 return <section className="attempt-actions" aria-label="计算操作">
 {error&&<p role="alert">{error}</p>}
 {context&&<><ActionBar label="Attempt 操作" danger={context.can_cancel&&<button disabled={busy} onClick={()=>void run('cancel')}>取消计算</button>}><button disabled={busy} onClick={()=>void run('status')}>刷新状态</button>{context.state==='finished'&&<button disabled={busy} onClick={()=>void run('fetch')}>取回结果</button>}
 {context.source!==null&&<button disabled={busy} onClick={edit}>基于此新建</button>}
 {context.state==='prepared'&&<button disabled={busy} onClick={()=>{setConfirm(true);setEditing(false);}}>提交</button>}
 </ActionBar>
 <Drawer open={confirm} onClose={()=>setConfirm(false)} title="提交确认">{confirm&&<section aria-label="提交摘要"><h3>提交摘要</h3><a href={routeHash([study,data.id])} onClick={()=>{setConfirm(false);document.getElementById('attempt-structure')?.scrollIntoView();}}>查看结构预览</a>
 <dl>{[['集群',m.cluster??'default'],['估算核时',coreHours(m)],['电荷',geometry.charge??science.charge],['多重度',geometry.multiplicity??science.multiplicity],['完整 route',geometry.route??science.route],['档位',m.tier],['walltime',m.walltime],['bundle 哈希前 12 位',typeof m.bundle_sha256==='string'?m.bundle_sha256.slice(0,12):null],['方法依据',science.method_basis],['立体化学警告',science.stereochemistry_warning]].map(([name,value])=><div key={String(name)}><dt>{String(name)}</dt><dd>{display(value)}</dd></div>)}</dl>
 {object(m.node_target)&&<p>目标节点：{display(m.node_target.name)} · 比例 {display(m.node_target.fraction)} · {display(m.cores)} 核 / {display(m.mem_gb)} GB · 队列 {display(m.node_target.queue)}</p>}
 <button disabled={busy} onClick={()=>void run('submit')}>确认摘要并提交</button><button onClick={()=>setConfirm(false)}>返回</button></section>}</Drawer>
 <Drawer open={editing} onClose={()=>setEditing(false)} title="新建 Attempt">{editing&&<form aria-label="新建 Attempt" onSubmit={e=>{e.preventDefault();if(canPrepare)void run('prepare');}}><fieldset disabled={busy}><legend>从 {data.id} 新建 Gaussian Attempt</legend>
 <label>集群 <select required aria-label="集群" value={cluster} onChange={e=>selectCluster(e.target.value)}><option value="" disabled>请选择集群</option>{Object.entries(context.clusters).map(([name,value])=><option key={name} value={name}>{name} · {value.scheduler}{value.programs_enabled.gaussian?'':' · Gaussian 未启用'}</option>)}</select></label>
 {!context.clusters[parentCluster]&&<p role="alert">父 Attempt 集群 {parentCluster} 未配置，请明确选择目标集群。</p>}
 {cluster&&cluster!==parentCluster&&<p role="alert">同一能量曲线内的物种应在同一集群计算</p>}
 {cluster&&!context.clusters[cluster]?.programs_enabled.gaussian&&<p role="alert">此集群未启用 Gaussian。</p>}
 {targeted&&<fieldset aria-label="PBS 节点选择"><legend>指定 PBS 节点</legend>
 <p>排序仅供参考，请明确选择节点。slots 表示调度分配核数，不是 CPU 实时利用率。提交前将重新检查，节点变化时停止。</p>
 {!fresh&&<p role="alert">节点数据过期或不可用，请刷新状态。{targets?.error}</p>}
 <label>目标节点 <select required aria-label="目标节点" value={target} onChange={e=>chooseNode(e.target.value)}><option value="" disabled>请选择具体节点</option>{targets?.nodes.map(n=><option key={n.name} value={n.name} disabled={!fresh||n.status!=='available'}>{n.priority}. {n.name} · {nodeStates[n.status]??'数据未知'}</option>)}</select></label>
 <label>核数比例 <select aria-label="核数比例" value={fraction} onChange={e=>chooseNode(target,e.target.value)}><option value="1/2">1/2（默认）</option><option value="1/4">1/4</option></select></label>
 {target&&<p aria-live="polite">{option?.tier?`申请 ${option.cores} 核 / ${option.mem_gb} GB · ${option.tier}`:'此比例无可用档位或资源不足'}</p>}
 <ul>{targets?.nodes.map(n=><li key={n.name}>{n.name}：{fresh?(nodeStates[n.status]??'数据未知'):'非实时'} · {n.reason}</li>)}</ul>
 </fieldset>}
 <label>档位 <select disabled={targeted} aria-label="档位" value={tier} onChange={e=>{setTier(e.target.value);setInput(resources(input,tiers[e.target.value]));}}>{orderedResourceTiers(tiers).map(([name,value])=><option key={name} value={name}>{name} · {value.cores} 核 · {value.mem_mb} MB</option>)}</select></label>
 <label>walltime <input required aria-label="walltime" aria-describedby="attempt-walltime-limit" aria-invalid={!!walltimeError} value={walltime} pattern="[0-9]{2,4}:[0-5][0-9]:[0-5][0-9]" onChange={e=>setWalltime(e.target.value)}/></label>
 <p id="attempt-walltime-limit">单作业时限上限：{resourceWalltimeLabel(limit)}；提交时仍由 ag 核对资源限制。</p>
 {walltimeError&&<p role="alert">{walltimeError}</p>}
 <label>标签 <input required aria-label="标签" value={label} pattern="[a-z0-9][a-z0-9-]{0,79}" onChange={e=>setLabel(e.target.value)}/></label>
 <label>与父 Attempt 的关系 <input required aria-label="与父 Attempt 的关系" value={relation} pattern="[a-z0-9][a-z0-9_\\-]{0,79}" onChange={e=>setRelation(e.target.value)}/></label>
 <label>方法依据 <input required aria-label="方法依据" value={basis} onChange={e=>setBasis(e.target.value)}/></label>
 <p>%nprocshared 和 %mem 由档位填入；编辑这两行会自动恢复为档位值。内存采用档位上限的 80%（低于 ag 的 85% 上限）。</p>
 <label>输入全文 <textarea aria-label="输入全文" spellCheck={false} value={input} onChange={e=>setInput(tiers[tier]?resources(e.target.value,tiers[tier]):e.target.value)}/></label>
 <button type="submit" disabled={!canPrepare}>保存并新建</button><button type="button" onClick={()=>setEditing(false)}>收起表单</button></fieldset></form>}</Drawer></>}
 {pending&&<p role="status">{['submit','cancel'].includes(pending)?'请在 Mac 弹窗中确认':'正在等待 ag 返回'} · 页面等待最多 420 秒，之后 ag 继续运行</p>}
 </section>;
}
