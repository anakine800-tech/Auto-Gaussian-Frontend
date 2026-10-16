import {Children,isValidElement,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import {display,endpoint,get,object} from './api';
import type {AttemptSummary,Document,Study} from './api';
import {Analyses} from './study-panels';
import {EnsembleList} from './ensemble-panels';
import {StructureFiles} from './preview-panels';
import {MoleculeViewer} from './molecule-viewer';

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
const columns=['Attempt','标签','状态','Route / 模板','终止类型','SCF / Eh','虚频数','最低频率 / cm⁻¹','G / Eh'];
function values(a:AttemptSummary){
 const facts=object(a.facts.data)?a.facts.data:{},energies=object(facts.energies)?facts.energies:{};
 // facts.frequencies_low is already ordered by the producer; display its first value.
 const low=Array.isArray(facts.frequencies_low)?facts.frequencies_low[0]:null;
 return [a.id,a.label,a.state,facts.route??a.template,facts.termination,energies.scf,facts.n_imag,low,energies.g].map(v=>typeof v==='string'||typeof v==='number'?v:null);
}
export function Results({data,onSelect,revision}:{data:Study;onSelect:(id:string)=>void;revision:number}){
 const [sort,setSort]=useState({column:0,direction:1});
 const files=data.structure_files.filter(f=>f.parts[0]==='analyses');
 const [selected,setSelected]=useState<string[]|null>(files.find(f=>!f.error)?.parts??null);
 const rows=data.attempts.map(a=>({a,cells:values(a)})).sort((a,b)=>{
  const x=a.cells[sort.column],y=b.cells[sort.column];
  if(x===null)return y===null?0:1;if(y===null)return -1;
  return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y)))*sort.direction;
 });
 return <section aria-label="结果总览"><h2>结果总览</h2><p className="muted">数值来自 facts.json；标签、模板和状态来自 manifest / status。空值表示未提供。</p>
 <div className="table-scroll"><table aria-label="Attempt 结果表"><thead><tr>{columns.map((c,i)=><th key={c} aria-sort={sort.column===i?(sort.direction===1?'ascending':'descending'):'none'}><button onClick={()=>setSort(s=>({column:i,direction:s.column===i?-s.direction:1}))}>{c}{sort.column===i?(sort.direction===1?' ↑':' ↓'):''}</button></th>)}</tr></thead><tbody>{rows.map(({a,cells})=><tr key={a.id} onClick={()=>onSelect(a.id)} className="result-row">{cells.map((v,i)=><td key={i}>{i===0?<button onClick={e=>{e.stopPropagation();onSelect(a.id);}}>{a.id}</button>:display(v)}</td>)}</tr>)}</tbody></table></div>
 {data.attempts.filter(a=>a.facts.error||a.manifest.error||a.status.error).map(a=><p className="muted" key={a.id}>{a.id}：{[a.facts.error,a.manifest.error,a.status.error].filter(Boolean).join(' · ')}</p>)}
 <EnsembleList study={data.id} revision={revision}/>
 <Analyses analyses={data.analyses.filter(a=>object(a.data)&&a.data.schema==='ag-thermo/1')}/>
 <StructureFiles study={data.id} files={files} selected={selected} onSelect={setSelected} revision={revision}/>
 </section>;
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
 <text x="16" y="20">ΔE / kcal·mol⁻¹（首步 = 0）</text><path d="M70 40 V215 H790" fill="none" stroke="#7b9395"/>
 <text x="8" y="55">{max.toFixed(3)}</text><text x="8" y="212">{min.toFixed(3)}</text>
 <polyline points={energies.map((v,i)=>`${x(i)},${y(v)}`).join(' ')} fill="none" stroke="#176c70" strokeWidth="3"/>
 {energies.map((v,i)=><g key={i}><circle cx={x(i)} cy={y(v)} r={selected===i?7:4} fill={selected===i?'#ba6529':'#176c70'} onClick={()=>onSelect(i)}><title>步 {i+1}: {v.toFixed(6)} kcal/mol</title></circle>{(steps.length<=20||i===selected)&&<text x={x(i)} y="237" textAnchor="middle">{i+1}</text>}</g>)}<text x="740" y="259">优化步</text></svg>;
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
 {step.geometry?<MoleculeViewer key={index} last={step.geometry} frameLabel={`优化段 ${segment.index} · 步 ${index+1}`}/>:<p className="notice">该步没有完整坐标，不复用其他步的结构。</p>}
 </>:<p>本段没有可识别的优化步（可能为单点或频率段）。</p>}</article>;
}
export function Optimization({study,attempt,log,revision}:{study:string;attempt:string;log:string;revision:number}){
 const [data,setData]=useState<OptimizationData|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<OptimizationData>(endpoint(study,'attempts',attempt,'optimization',log),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,log,revision]);
 return <section aria-label="优化过程"><h2>优化过程</h2><p className="muted">按日志打印值展示；能量差仅为作图换算。Link1 分段，频率段坐标不计入优化步。上限 32 MB。</p>{error?<p role="alert">{error}</p>:data?data.segments.length?data.segments.map(s=><OptimizationSegment key={log+revision+s.index} segment={s}/>):<p>没有可识别的优化过程。</p>:<p role="status">读取优化过程…</p>}</section>;
}
