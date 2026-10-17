import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AttemptActions,actionToken} from './actions';
import type {ActionResult} from './actions';
import {display,endpoint,get,object} from './api';
import type {Attempt} from './api';
import type {AttemptFile} from './routing';
import {InputFiles,InputSummary} from './preview-panels';
import {Optimization} from './results-panels';
import {FileView,PagedLog} from './study-panels';
import {ModeReviewViewer} from './mode-panels';
import type {ReviewModes} from './mode-panels';
import {Collapsible,EmptyState,ErrorNotice,Panel} from './ui';
import {AttemptFacts} from './attempt-facts';
import type {FactLocation} from './attempt-facts';
import {Snapshots} from './snapshots';

export function AttemptView({study,id,revision,busy,onBusy,onResult,autoCompare,selectedFile,onLoaded}:{selectedFile?:AttemptFile;onLoaded:(study:string,data:Attempt)=>void;study:string;id:string;revision:number;busy:boolean;onBusy:(v:boolean)=>void;onResult:(r:ActionResult)=>void;autoCompare:boolean}){
 const [data,setData]=useState<Attempt|null>(null),[error,setError]=useState(''),[log,setLog]=useState(''),[modes,setModes]=useState<ReviewModes|null>(null),[modeError,setModeError]=useState(''),[selected,setSelected]=useState<number|null>(null),[decode,setDecode]=useState(false),[geometrySource,setGeometrySource]=useState('input');
 const [reveals,setReveals]=useState<Record<string,number>>({}),[locate,setLocate]=useState<FactLocation|null>(null),[reviewTarget,setReviewTarget]=useState<HTMLDivElement|null>(null);
 const container=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const node=container.current,main=node?.closest('main');if(!node||!main)return;
  const measure=()=>{
   const first=node.querySelector('.attempt-first-screen'),actions=node.querySelector('.attempt-actions');if(!first)return;
   const style=actions?getComputedStyle(actions):null;
   const actionHeight=actions?actions.getBoundingClientRect().height+parseFloat(style!.marginTop)+parseFloat(style!.marginBottom):0;
   const prefix=first.getBoundingClientRect().top-main.getBoundingClientRect().top-actionHeight;
   node.style.setProperty('--attempt-prefix-height',`${prefix}px`);
   node.style.setProperty('--attempt-actions-height',`${actionHeight}px`);
  };
  const observer=new ResizeObserver(measure);
  [main.querySelector('.section-nav'),node.querySelector('.attempt-heading'),node.querySelector('.attempt-actions')].forEach(el=>el&&observer.observe(el));
  measure();window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[data]);
 const page=`${study}/${id}`;
 const reveal=(block:string)=>setReveals(v=>({...v,[block]:(v[block]??0)+1}));
 useEffect(()=>{const c=new AbortController();setData(null);setError('');setLog('');setModes(null);setSelected(null);setDecode(false);setLocate(null);get<Attempt>(endpoint(study,'attempts',id),c.signal).then(v=>{if(!c.signal.aborted){setData(v);onLoaded(study,v);setLog(v.logs[0]??'');const state=object(v.status.data)?v.status.data.state:'';setGeometrySource(['prepared','submitting'].includes(String(state))||!v.geometry.data?'input':'final');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,id,revision]);
 useEffect(()=>{const c=new AbortController();setModes(null);setModeError('');setSelected(null);if(decode&&log)get<ReviewModes>(endpoint(study,'attempts',id,'vibrations',log),c.signal).then(v=>{if(!c.signal.aborted)setModes(v);}).catch(e=>{if(!c.signal.aborted)setModeError(e.message);});return()=>c.abort();},[decode,log,study,id,revision]);
 useEffect(()=>{
  if(!data||!selectedFile)return;
  const block=selectedFile.kind==='inputs'?'inputs':selectedFile.kind==='logs'?'logs':'provenance';reveal(block);
  if(selectedFile.kind==='logs'){setLog(data.logs.includes(selectedFile.name)?selectedFile.name:'');setDecode(false);setSelected(null);setLocate(null);}
  if(selectedFile.name==='final.xyz')setGeometrySource('final');
  const frame=requestAnimationFrame(()=>document.getElementById(selectedFile.name==='final.xyz'?'attempt-structure':selectedFile.kind==='record'?`record-${selectedFile.name}`:`attempt-${block}`)?.scrollIntoView({block:'start'}));
  return()=>cancelAnimationFrame(frame);
 },[data,selectedFile?.kind,selectedFile?.name]);
 if(error)return <ErrorNotice>{error}</ErrorNotice>;if(!data)return <p role="status">读取 Attempt…</p>;
 const vibration=selected!==null?modes?.modes[selected]:undefined;
 const changeLog=(name:string)=>{setLog(name);setDecode(false);setSelected(null);setLocate(null);};
 const logSelect=(label:string)=><label>{label} <select aria-label={label} value={log} onChange={e=>changeLog(e.target.value)}>{data.logs.map(l=><option key={l}>{l}</option>)}</select></label>;
 return <section ref={container} className="attempt-detail">
 <div className="attempt-heading"><h2>{id}</h2><span className="muted">所属集群：{display(object(data.manifest.data)?data.manifest.data.cluster??'default':null)}</span></div>
 {actionToken&&<AttemptActions study={study} data={data} revision={revision} busy={busy} onBusy={onBusy} onResult={onResult}/>}
 <div className="attempt-first-screen">
 <AttemptFacts data={data} onInspect={name=>{reveal(name==='inputs'?'inputs':'provenance');requestAnimationFrame(()=>document.getElementById(name==='inputs'?'attempt-inputs':`record-${name}`)?.scrollIntoView({block:'start'}));}} onLocate={value=>{setLocate(old=>({...value,id:(old?.id??0)+1}));reveal('logs');requestAnimationFrame(()=>document.getElementById('attempt-logs')?.scrollIntoView({block:'start'}));}}/>
 <Panel title="三维结构" className="attempt-structure"><div id="attempt-structure"><label>预览结构 <select aria-label="预览结构" value={geometrySource} onChange={e=>{setGeometrySource(e.target.value);setSelected(null);}}><option value="input">输入结构</option><option value="final" disabled={!data.geometry.data}>最终结构 · final.xyz</option></select></label>
 <ModeReviewViewer study={study} attempt={id} log={log} packet={modes} revision={revision} reviewTarget={reviewTarget} key={vibration?'vibration':geometrySource} last={vibration?modes?.reference_geometry:geometrySource==='input'?data.input_geometry.data:data.geometry.data} frameLabel={vibration?'Gaussian 振动参考坐标':geometrySource==='input'?'输入结构':'最终结构 · final.xyz'} vibration={vibration} onClearVibration={()=>setSelected(null)}/>
 {geometrySource==='input'&&data.input_geometry.error&&<p className="muted">{data.input_geometry.error}</p>}{geometrySource==='final'&&data.geometry.error&&<p className="muted">final.xyz：{data.geometry.error}</p>}</div></Panel>
 </div>
 <Collapsible page={page} block="optimization" title="优化过程" reveal={reveals.optimization}>{data.logs.length?<>{logSelect('优化日志')}{log&&<Optimization key={log+revision} study={study} attempt={id} log={log} revision={revision}/>}</>:<EmptyState>尚无 outputs 日志。</EmptyState>}</Collapsible>
 <Collapsible page={page} block="frequency" title="频率与虚频审阅"><p className="muted">振动使用所选日志中的 Standard orientation 与原始打印位移。显示动画不代表过渡态验收。</p>{data.logs.length?<>{logSelect('振动日志')}<button onClick={()=>setDecode(true)} disabled={decode}>解析振动位移</button>{modeError&&<ErrorNotice>{modeError}</ErrorNotice>}{decode&&!modes&&!modeError&&<p role="status">解析振动…</p>}{modes&&<label>振动模式 <select aria-label="振动模式" value={selected??''} onChange={e=>setSelected(e.target.value===''?null:Number(e.target.value))}><option value="">返回所选结构</option>{modes.modes.map((m,i)=><option key={i} value={i}>模式 {m.mode_number} · {m.frequency_cm1} cm⁻¹</option>)}</select></label>}</>:<EmptyState>尚无 outputs 日志，无法读取振动。</EmptyState>}<div ref={setReviewTarget}/></Collapsible>
 <Collapsible page={page} block="logs" title="日志搜索" reveal={reveals.logs}><section id="attempt-logs">{data.logs.length?<>{logSelect('输出日志')}{selectedFile?.kind==='logs'&&!data.logs.includes(selectedFile.name)&&<ErrorNotice>指定日志不存在：{selectedFile.name}</ErrorNotice>}{log&&<PagedLog key={log+revision} study={study} attempt={id} log={log} locate={locate}/>}</>:<EmptyState>尚无 outputs 日志。</EmptyState>}</section></Collapsible>
 <Collapsible page={page} block="inputs" title="输入文件" reveal={reveals.inputs} defaultOpen={autoCompare}><div id="attempt-inputs"><InputSummary input={data.input_geometry} manifest={data.manifest}/><InputFiles requestedName={selectedFile?.kind==='inputs'?selectedFile.name:undefined} study={study} attempt={id} data={data} autoCompare={autoCompare}/></div></Collapsible>
 <Collapsible page={page} block="provenance" title="来源与哈希" reveal={reveals.provenance}><p className="muted">manifest 中保存的输入与 bundle 哈希；核对文件字节请展开输入文件。</p><div className="columns"><FileView title="status.json" doc={data.status}/><FileView title="manifest.json" doc={data.manifest}/></div><FileView title="facts.json" doc={data.facts}/><FileView title="review.md" doc={data.review}/>{data.issues.map((x,i)=><ErrorNotice key={i}>{x.path}：{x.error}</ErrorNotice>)}</Collapsible>
 <Collapsible page={page} block="snapshots" title="快照 · 运行中快照，不是结果"><Snapshots study={study} attempt={id} revision={revision}/></Collapsible>
 </section>;
}
