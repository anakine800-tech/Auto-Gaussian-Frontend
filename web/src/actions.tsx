import {useEffect,useState} from 'react';
import {coreHours,display,get,object} from './api';
import type {Attempt} from './api';
import {routeHash} from './routing';

export const actionToken=document.querySelector<HTMLMetaElement>('meta[name="ag-token"]')?.content;
type Tier={cores:number;mem_mb:number};
type Cluster={scheduler:string;tiers:Record<string,Tier>;programs_enabled:{gaussian:boolean;xtb:boolean;crest:boolean}};
type Context={state:string;can_cancel:boolean;source:string|null;clusters:Record<string,Cluster>;manifest:Record<string,unknown>};
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
 const [input,setInput]=useState(''),[tier,setTier]=useState('simple'),[walltime,setWalltime]=useState('01:00:00'),[label,setLabel]=useState('modified'),[relation,setRelation]=useState('derived_from'),[basis,setBasis]=useState('');
 useEffect(()=>{const c=new AbortController();setContext(null);setError('');setConfirm(false);get<Context>(`/api/actions/${encodeURIComponent(study)}/${encodeURIComponent(data.id)}`,c.signal).then(value=>{if(!c.signal.aborted)setContext(value);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,data.id,revision]);
 async function run(action:string){
  if(busy)return;
  onBusy(true);setPending(action);setError('');setConfirm(false);
  try{
   const body={action,study,attempt:data.id,...(action==='prepare'?{cluster,input,tier,walltime,label,relation,method_basis:basis}:{})};
   const response=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-AG-Token':actionToken!},body:JSON.stringify(body)});
   const result=await response.json();
   if(!response.ok)throw Error(result.detail??`操作失败 (${response.status})`);
   onResult(result);
   if(result.exit_code===0)setEditing(false);
  }catch(e){setError((e instanceof Error?e.message:'请求失败')+'；请刷新状态核对，不会自动重试。');}
  finally{onBusy(false);setPending('');}
 }
 function edit(){
  if(!context?.source)return;
  const m=context.manifest,c=typeof m.cluster==='string'?m.cluster:'default',tiers=context.clusters[c]?.tiers??{},t=typeof m.tier==='string'&&tiers[m.tier]?m.tier:'simple';
  setCluster(context.clusters[c]?c:'');setTier(t);setInput(tiers[t]?resources(context.source,tiers[t]):context.source);setWalltime(typeof m.walltime==='string'?m.walltime:'01:00:00');
  const science=object(m.science)?m.science:{};setBasis(typeof science.method_basis==='string'?science.method_basis:'');setEditing(true);setConfirm(false);
 }
 const m=context?.manifest??{},science=object(m.science)?m.science:{},geometry=object(data.input_geometry.data)?data.input_geometry.data:{};
 const tiers=context?.clusters[cluster]?.tiers??{},parentCluster=typeof m.cluster==='string'?m.cluster:'default';
 const canPrepare=!!tiers[tier]&&context?.clusters[cluster]?.programs_enabled.gaussian;
 function selectCluster(name:string){
  const choices=context?.clusters[name]?.tiers??{},t=choices[tier]?tier:'simple';
  setCluster(name);setTier(t);if(choices[t])setInput(resources(input,choices[t]));
 }
 return <section className="attempt-actions" aria-label="计算操作"><h3>通过本机 ag 操作</h3><p>study.md 中的计划和结论仍由 Codex 更新</p>
 {error&&<p role="alert">{error}</p>}
 {context&&<><div className="action-buttons"><button disabled={busy} onClick={()=>void run('status')}>刷新状态</button><button disabled={busy} onClick={()=>void run('fetch')}>取回结果</button>
 {context.source!==null&&<button disabled={busy} onClick={edit}>基于此新建</button>}
 {context.state==='prepared'&&<button disabled={busy} onClick={()=>{setConfirm(true);setEditing(false);}}>提交</button>}
 {context.can_cancel&&<button disabled={busy} onClick={()=>void run('cancel')}>取消计算</button>}</div>
 {confirm&&<section aria-label="提交摘要"><h3>提交摘要</h3><a href={routeHash([study,data.id])} onClick={()=>document.getElementById('attempt-structure')?.scrollIntoView()}>查看结构预览</a>
 <dl>{[['集群',m.cluster??'default'],['估算核时',coreHours(m)],['电荷',geometry.charge??science.charge],['多重度',geometry.multiplicity??science.multiplicity],['完整 route',geometry.route??science.route],['档位',m.tier],['walltime',m.walltime],['bundle 哈希前 12 位',typeof m.bundle_sha256==='string'?m.bundle_sha256.slice(0,12):null],['方法依据',science.method_basis],['立体化学警告',science.stereochemistry_warning]].map(([name,value])=><div key={String(name)}><dt>{String(name)}</dt><dd>{display(value)}</dd></div>)}</dl>
 <button disabled={busy} onClick={()=>void run('submit')}>确认摘要并提交</button><button onClick={()=>setConfirm(false)}>返回</button></section>}
 {editing&&<form aria-label="新建 Attempt" onSubmit={e=>{e.preventDefault();void run('prepare');}}><fieldset disabled={busy}><legend>从 {data.id} 新建 Gaussian Attempt</legend>
 <label>集群 <select required aria-label="集群" value={cluster} onChange={e=>selectCluster(e.target.value)}><option value="" disabled>请选择集群</option>{Object.entries(context.clusters).map(([name,value])=><option key={name} value={name}>{name} · {value.scheduler}{value.programs_enabled.gaussian?'':' · Gaussian 未启用'}</option>)}</select></label>
 {!context.clusters[parentCluster]&&<p role="alert">父 Attempt 集群 {parentCluster} 未配置，请明确选择目标集群。</p>}
 {cluster&&cluster!==parentCluster&&<p role="alert">同一能量曲线内的物种应在同一集群计算</p>}
 {cluster&&!context.clusters[cluster]?.programs_enabled.gaussian&&<p role="alert">此集群未启用 Gaussian。</p>}
 <label>档位 <select aria-label="档位" value={tier} onChange={e=>{setTier(e.target.value);setInput(resources(input,tiers[e.target.value]));}}>{Object.entries(tiers).map(([name,value])=><option key={name} value={name}>{name} · {value.cores} 核 · {value.mem_mb} MB</option>)}</select></label>
 <label>walltime <input required aria-label="walltime" value={walltime} pattern="[0-9]{1,3}:[0-5][0-9]:[0-5][0-9]" onChange={e=>setWalltime(e.target.value)}/></label>
 <label>标签 <input required aria-label="标签" value={label} pattern="[a-z0-9][a-z0-9-]{0,79}" onChange={e=>setLabel(e.target.value)}/></label>
 <label>与父 Attempt 的关系 <input required aria-label="与父 Attempt 的关系" value={relation} pattern="[a-z0-9][a-z0-9_\\-]{0,79}" onChange={e=>setRelation(e.target.value)}/></label>
 <label>方法依据 <input required aria-label="方法依据" value={basis} onChange={e=>setBasis(e.target.value)}/></label>
 <p>%nprocshared 和 %mem 由档位填入；编辑这两行会自动恢复为档位值。内存采用档位上限的 80%（低于 ag 的 85% 上限）。</p>
 <label>输入全文 <textarea aria-label="输入全文" spellCheck={false} value={input} onChange={e=>setInput(tiers[tier]?resources(e.target.value,tiers[tier]):e.target.value)}/></label>
 <button type="submit" disabled={!canPrepare}>保存并新建</button><button type="button" onClick={()=>setEditing(false)}>收起表单</button></fieldset></form>}</>}
 {pending&&<p role="status">{['submit','cancel'].includes(pending)?'请在 Mac 弹窗中确认':'正在等待 ag 返回'} · 页面等待最多 420 秒，之后 ag 继续运行</p>}
 </section>;
}
