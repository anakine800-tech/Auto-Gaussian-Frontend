import {Children,isValidElement,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import {display,endpoint,get} from './api';
import type {Document} from './api';
import {FrameViewer} from './frame-viewer';

const plain=(children:ReactNode):string=>Children.toArray(children).map(c=>isValidElement<{children?:ReactNode}>(c)?plain(c.props.children):String(c)).join('');
const anchor=(text:string)=>text.trim().toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/\s+/g,'-');
export function StudyMarkdown({doc}:{doc:Document<string>}){
 return <section className="file-view markdown"><h3>study.md</h3>{doc.error?<p className="notice">{doc.error}</p>:<ReactMarkdown skipHtml urlTransform={url=>/^#[^/\s][^\s]*$/.test(url)?url:''} components={{
  img:()=>null,
  a:({href,children})=>href?<a href={href} onClick={e=>{e.preventDefault();let id=href.slice(1);try{id=decodeURIComponent(id);}catch{/* Keep literal fragment. */}document.getElementById('study-md-'+id)?.scrollIntoView();}}>{children}</a>:<span>{children}</span>,
  h1:({children})=><h1 id={'study-md-'+anchor(plain(children))}>{children}</h1>,
  h2:({children})=><h2 id={'study-md-'+anchor(plain(children))}>{children}</h2>,
  h3:({children})=><h3 id={'study-md-'+anchor(plain(children))}>{children}</h3>,
  h4:({children})=><h4 id={'study-md-'+anchor(plain(children))}>{children}</h4>,
  h5:({children})=><h5 id={'study-md-'+anchor(plain(children))}>{children}</h5>,
  h6:({children})=><h6 id={'study-md-'+anchor(plain(children))}>{children}</h6>,
 }}>{doc.data??''}</ReactMarkdown>}</section>;
}
type Metric={label:string;value:number;threshold:number;result:string};
type Step={index:number;printed_step:number|null;scf_hartree:number;metrics:Metric[];geometry:unknown;line:number};
type Segment={index:number;reason:string;route:string|null;steps:Step[];termination:string;optimization:string};
export type OptimizationData={name:string;segments:Segment[]};
function EnergyChart({steps,selected,onSelect}:{steps:Step[];selected:number;onSelect:(i:number)=>void}){
 const energies=steps.map(s=>(s.scf_hartree-steps[0].scf_hartree)*627.5094740631);
 const min=Math.min(...energies),max=Math.max(...energies),span=max-min||1;
 const x=(i:number)=>70+i*700/Math.max(1,steps.length-1),y=(v:number)=>210-(v-min)/span*160;
 return <svg viewBox="0 0 820 265" className="energy-chart" role="img" aria-label="优化相对能量折线图">
 <text x="16" y="20">ΔE / kcal·mol⁻¹（首步 = 0）</text><path d="M70 40 V215 H790" fill="none" stroke="var(--muted)"/>
 <text x="8" y="55">{max.toFixed(3)}</text><text x="8" y="212">{min.toFixed(3)}</text>
 <polyline points={energies.map((v,i)=>`${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="3"/>
 {energies.map((v,i)=><g key={i}><circle cx={x(i)} cy={y(v)} r={selected===i?7:4} fill={selected===i?'var(--warn)':'var(--accent)'} onClick={()=>onSelect(i)}><title>步 {i+1}: {v.toFixed(6)} kcal/mol</title></circle>{(steps.length<=20||i===selected)&&<text x={x(i)} y="237" textAnchor="middle">{i+1}</text>}</g>)}<text x="740" y="259">优化步</text></svg>;
}
function OptimizationSegment({segment}:{segment:Segment}){
 const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false);
 useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>setIndex(i=>{if(i>=segment.steps.length-1){setPlaying(false);return i;}return i+1;}),800);return()=>clearInterval(timer);},[playing,segment.steps.length]);
 const step=segment.steps[index];
 return <article aria-label={`优化段 ${segment.index}`}><h3>第 {segment.index} 段 · {segment.steps.length} 步</h3><p className="muted">{segment.route??segment.reason} · 优化：{segment.optimization} · 终止：{segment.termination}</p>{step?<>
 <EnergyChart steps={segment.steps} selected={index} onSelect={i=>{setIndex(i);setPlaying(false);}}/>
 <div className="frame-controls"><button disabled={index===0} onClick={()=>{setIndex(i=>i-1);setPlaying(false);}}>上一步</button><label>优化步 <input aria-label={`第 ${segment.index} 段优化步`} type="number" min={1} max={segment.steps.length} value={index+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=segment.steps.length){setIndex(n-1);setPlaying(false);}}}/> / {segment.steps.length}</label><button disabled={index===segment.steps.length-1} onClick={()=>{setIndex(i=>i+1);setPlaying(false);}}>下一步</button><button disabled={segment.steps.length<2} onClick={()=>{if(index===segment.steps.length-1)setIndex(0);setPlaying(v=>!v);}}>{playing?'暂停优化播放':'播放优化过程'}</button></div>
 <p>SCF：{step.scf_hartree} Eh · 日志第 {step.line} 行 · 打印步号：{step.printed_step??'—'}</p>
 <div className="table-scroll"><table aria-label={`第 ${segment.index} 段收敛表`}><thead><tr><th>判据</th><th>值</th><th>阈值</th><th>YES / NO</th></tr></thead><tbody>{['Maximum Force','RMS Force','Maximum Displacement','RMS Displacement'].map(label=>{const m=step.metrics.find(m=>m.label===label);return <tr key={label}><td>{label}</td><td>{display(m?.value)}</td><td>{display(m?.threshold)}</td><td>{m?.result??'未打印'}</td></tr>;})}</tbody></table></div>
 <FrameViewer geometry={step.geometry} frames={segment.steps.map(s=>s.geometry)} frameLabel={`优化段 ${segment.index} · 步 ${index+1}`}/>
 </>:<p>本段没有可识别的优化步（可能为单点或频率段）。</p>}</article>;
}
export function Optimization({study,attempt,log,revision}:{study:string;attempt:string;log:string;revision:number}){
 const [data,setData]=useState<OptimizationData|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<OptimizationData>(endpoint(study,'attempts',attempt,'optimization',log),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,log,revision]);
 return <section aria-label="优化过程"><h2>优化过程</h2><p className="muted">按日志打印值展示；能量差仅为作图换算。Link1 分段，频率段坐标不计入优化步。上限 32 MB。</p>{error?<p role="alert">{error}</p>:data?data.segments.length?data.segments.map(s=><OptimizationSegment key={log+revision+s.index} segment={s}/>):<p>没有可识别的优化过程。</p>:<p role="status">读取优化过程…</p>}</section>;
}
