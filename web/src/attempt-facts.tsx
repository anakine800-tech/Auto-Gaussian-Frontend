import {display,object} from './api';
import type {Attempt} from './api';
import {EmptyState,FactGrid,Panel,StatusBadge,statusTone} from './ui';

export type FactLocation={query:string;start:number;end?:number;id:number;scoped:boolean};
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const energy=(v:unknown)=>number(v)!==null?<span title={String(v)}>{(v as number).toFixed(6)}</span>:'—';
const convergence=(v:unknown)=>typeof v==='boolean'?<StatusBadge tone={v?'ok':'bad'}>{v?'✓':'✗'}</StatusBadge>:'—';
export function AttemptFacts({data,onLocate,onInspect}:{data:Attempt;onInspect:(name:string)=>void;onLocate:(v:Omit<FactLocation,'id'>)=>void}){
 const f=object(data.facts.data)?data.facts.data:{},m=object(data.manifest.data)?data.manifest.data:{},s=object(data.status.data)?data.status.data:{},input=object(data.input_geometry.data)?data.input_geometry.data:{},science=object(m.science)?m.science:{},e=object(f.energies)?f.energies:{};
 const sources=object(f.fact_sources)?f.fact_sources:{},sections=Array.isArray(f.job_sections)?f.job_sections.filter(object):[];
 const locate=(key:string,query:string)=>data.logs.length?()=>{const section=sections.find(v=>v.index===sources[key]);const start=number(section?.start_line),end=number(section?.end_line);const scoped=start!==null&&end!==null&&start>0&&end>=start;onLocate({query,start:scoped?start-1:0,end:scoped?end-1:undefined,scoped});}:undefined;
 const imaginary=Array.isArray(f.frequencies_low)?f.frequencies_low.filter((v):v is number=>number(v)!==null&&(v as number)<0):[];
 const route=display(f.route??input.route??science.route),method=display(science.method_basis??f.route??input.route??science.route);
 const electronic=m.template==='xtb'?f.total_energy:e.scf;
 return <Panel title="关键事实" className="attempt-facts">
 <FactGrid facts={[
  {label:'状态',value:<StatusBadge tone={statusTone(display(s.state))}>{display(s.state)}</StatusBadge>,onLocate:()=>onInspect('status.json')},
  {label:'方法 / 基组 / 溶剂',value:<span className="fact-method" title={`${method} · ${route}`}>{route==='—'?method:route}</span>,onLocate:()=>onInspect(f.route?'facts.json':input.route?'inputs':'manifest.json')},
  {label:'电荷 / 多重度',value:`${display(f.charge??input.charge??science.charge)} / ${display(f.multiplicity??input.multiplicity??science.multiplicity)}`,onLocate:()=>onInspect(f.charge!==undefined||f.multiplicity!==undefined?'facts.json':input.charge!==undefined?'inputs':'manifest.json')},
  {label:'电子能 / Eh',value:energy(electronic),emphasis:true,onLocate:number(electronic)!==null?locate('energies.scf',String(electronic)):undefined},
  {label:'自由能 / Eh',value:energy(e.g),emphasis:true,onLocate:number(e.g)!==null?locate('energies.g',String(e.g)):undefined},
  {label:'虚频数 / cm⁻¹',value:<>{display(f.n_imag)}{imaginary.length>0&&<span className="muted"> · {imaginary.join(', ')}</span>}</>,onLocate:number(f.n_imag)!==null?locate('n_imag','Frequencies --'):undefined},
  {label:'优化 / 频率收敛',value:<>{convergence(f.opt_converged)} / {convergence(f.freq_step_converged)}</>,onLocate:()=>onInspect('facts.json')},
  {label:'已用 / walltime',value:`${display(s.elapsed)} / ${display(m.walltime)}`,onLocate:()=>onInspect('status.json')},
 ]}/>
 {!data.facts.data&&<EmptyState>尚无可读 facts；未取回的结果不推算。</EmptyState>}
 <div className="fact-warnings"><button className="fact-source" onClick={()=>onInspect('facts.json')}>记录与警告 ↗</button><StatusBadge tone="warn">工具记录，待人工审阅</StatusBadge>{[f.parser_warning,f.error_hint,f.frequency_unavailable_reason,science.stereochemistry_warning].filter(v=>typeof v==='string'&&v).map((v,i)=><p key={i}>{String(v)}</p>)}</div>
 </Panel>;
}
