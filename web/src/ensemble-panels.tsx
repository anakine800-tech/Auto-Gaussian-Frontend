import {useEffect,useRef,useState} from 'react';
import {endpoint,get} from './api';
import {routeHash} from './routing';
import {MoleculeViewer} from './molecule-viewer';
import type {Atom} from './molecule-math';
import {drawThumbnail} from './thumbnail';

type Layer={attempts:string[];ambiguous:boolean;energy_hartree:number|null;relative_kcal:number|null;termination?:string|null;n_imaginary?:number|null};
type Candidate={candidate:number;xyz_frame:number;sources:string[];route_members:{route:string;member:number;relative_kcal_within_route:number|null}[];xtb_relative_kcal:number|null;sp:Layer|null;opt:Layer|null;thermo:{attempt:string|null;qh_G:number|null;relative_G_kcal:number|null;population:number|null}|null;missing:string[];notes:string[]};
type Ensemble={manifest:{label:string|null;energy_basis:string;warnings:string[];references:Record<string,number|null>;routes:{label:string;attempts:string[]}[];candidates:Candidate[];unmatched_attempts:{layer:string;attempt:string;reason:string}[]};frames:{geometry:{atoms:Atom[]};comment:string}[]};
type Listing={ensembles:{name:string;group:string|null;label:string|null;candidate_count:number;created_at:string}[];issues:{name:string;error:string}[]};
const url=(study:string,parts:string[],candidate?:number)=>routeHash([study,'ensembles',...parts])+(candidate===undefined?'':`?candidate=${candidate}`);
const value=(n:number|null|undefined)=>n==null?'':String(n);
export function EnsembleList({study,revision}:{study:string;revision:number}){
 const [data,setData]=useState<Listing|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<Listing>(endpoint(study,'ensembles'),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,revision]);
 return <section aria-label="构象集合列表"><h2>构象集合</h2>{error?<p role="alert">{error}</p>:data?<><ul>{data.ensembles.map(e=><li key={`${e.group}/${e.name}`}><a href={url(study,[...(e.group?[e.group]:[]),e.name])}>{e.label??e.name}</a> · {e.group?e.group+'/':''}{e.name} · {e.candidate_count} 个候选 · {e.created_at}</li>)}</ul>{!data.ensembles.length&&<p>暂无 ag-ensemble/1 清单。</p>}{data.issues.map((e,i)=><p role="alert" key={i}>{e.name}：{e.error}</p>)}</>:<p role="status">读取构象集合…</p>}</section>;
}
function Thumbnail({row,atoms,selected,onSelect}:{row:Candidate;atoms:Atom[];selected:boolean;onSelect:()=>void}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const canvas=ref.current;if(!canvas)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){drawThumbnail(canvas,atoms);observer.disconnect();}});observer.observe(canvas);return()=>observer.disconnect();},[atoms]);
 return <button aria-label={`候选 ${row.candidate} 缩略图`} aria-pressed={selected} onClick={onSelect} style={{padding:6,border:selected?'3px solid #176c70':'3px solid transparent',background:'#f3f7f6',color:'#243e40',borderRadius:8}}><canvas ref={ref} width={160} height={130} style={{display:'block',maxWidth:'100%'}}/>候选 {row.candidate}</button>;
}
function EnsembleContent({data,study,parts,candidate}:{data:Ensemble;study:string;parts:string[];candidate?:number}){
 const m=data.manifest;
 const [sort,setSort]=useState({key:'candidate',direction:1}),[page,setPage]=useState(0);
 const selected=candidate??m.candidates[0]?.candidate;
 const energy=(row:Candidate,key:string):number|null=>key==='xtb'?row.xtb_relative_kcal:key==='sp'?row.sp?.relative_kcal??null:key==='opt'?row.opt?.relative_kcal??null:key==='thermo'?row.thermo?.relative_G_kcal??null:row.candidate;
 const rows=[...m.candidates].sort((a,b)=>{const x=energy(a,sort.key),y=energy(b,sort.key);return x===null?(y===null?0:1):y===null?-1:(x-y)*sort.direction;});
 useEffect(()=>{const index=rows.findIndex(r=>r.candidate===selected);if(index>=0)setPage(Math.floor(index/50));},[selected]);
 const shown=rows.slice(page*50,(page+1)*50),row=m.candidates.find(r=>r.candidate===selected);
 const choose=(id:number)=>{window.location.hash=url(study,parts,id);};
 const reason=(r:Candidate,layer?:Layer|null)=>[r.missing.length?'missing: '+r.missing.join(', '):'',layer?.ambiguous?'ambiguous: '+layer.attempts.join(', '):'',...r.notes].filter(Boolean).join(' · ')||'未提供';
 const sortButton=(key:string,label:string)=><button onClick={()=>{setSort(s=>({key,direction:s.key===key?-s.direction:1}));setPage(0);}}>{label}{sort.key===key?(sort.direction===1?' ↑':' ↓'):''}</button>;
 return <section aria-label="构象集合页"><h2>{m.label??parts.at(-1)}</h2><a href={routeHash([study])}>返回结果</a>
 {m.warnings.map((warning,i)=><p role="note" className="notice" key={i}>{warning}</p>)}
 <p className="muted">能量差：kcal/mol · 布居：保存分数 × 100%。能量基准：{m.energy_basis}。参考候选：{Object.entries(m.references).map(([k,v])=>`${k}: ${v??'未提供'}`).join(' · ')}</p>
 <div className="table-scroll"><table aria-label="构象能量表"><thead><tr><th>{sortButton('candidate','编号')}</th><th>来源路线</th><th>{m.energy_basis==='per_source_not_comparable'?'xTB · 各路线不可比较':sortButton('xtb','xTB 相对能')}</th><th>{sortButton('sp','SP 相对能')}</th><th>Opt 状态 / 虚频数</th><th>{sortButton('opt','Opt 相对能')}</th><th>{sortButton('thermo','qh_G 相对值')}</th><th>布居</th><th>缺失层 / 备注</th></tr></thead>
 <tbody>{shown.map(r=><tr key={r.candidate} data-candidate={r.candidate} aria-selected={selected===r.candidate} className={selected===r.candidate?'selected':'result-row'} onClick={()=>choose(r.candidate)}>
 <td><button onClick={e=>{e.stopPropagation();choose(r.candidate);}}>候选 {r.candidate}</button></td>
 <td>{r.sources.map(source=><div key={source}>{source}{m.routes.find(route=>route.label===source)?.attempts.map(id=><span key={id}> · <a href={routeHash([study,id])} onClick={e=>e.stopPropagation()}>{id}</a></span>)}</div>)}</td>
 <td title={reason(r)}>{m.energy_basis==='per_source_not_comparable'?<details onClick={e=>e.stopPropagation()}><summary>各路线不可比较</summary>{r.route_members.map((member,i)=><div key={i}>{member.route} · 帧 {member.member}: {value(member.relative_kcal_within_route)}</div>)}</details>:value(r.xtb_relative_kcal)}</td>
 <td title={reason(r,r.sp)}>{value(r.sp?.relative_kcal)}</td><td title={reason(r,r.opt)}>{r.opt?.termination??''}{r.opt?.n_imaginary!=null?` / ${r.opt.n_imaginary}`:''}{r.opt?.ambiguous?' ambiguous':''}</td><td title={reason(r,r.opt)}>{value(r.opt?.relative_kcal)}</td>
 <td title={reason(r)}>{value(r.thermo?.relative_G_kcal)}</td><td title={reason(r)}>{r.thermo?.population==null?'':`${r.thermo.population*100}%`}</td><td>{r.missing.join(', ')}{r.notes.length>0&&<details onClick={e=>e.stopPropagation()}><summary>备注</summary>{r.notes.map((note,i)=><p key={i}>{note}</p>)}</details>}</td></tr>)}</tbody></table></div>
 <div className="frame-controls" aria-label="候选分页"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>上一组</button><span>第 {page+1} / {Math.max(1,Math.ceil(rows.length/50))} 页 · 每页最多 50 个</span><button disabled={(page+1)*50>=rows.length} onClick={()=>setPage(p=>p+1)}>下一组</button></div>
 <div role="group" aria-label="候选缩略图" style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(172px,1fr))',gap:12,margin:'16px 0'}}>{shown.map(r=><Thumbnail key={r.candidate} row={r} atoms={data.frames[r.xyz_frame-1].geometry.atoms} selected={r.candidate===selected} onSelect={()=>choose(r.candidate)}/>)}</div>
 {row?<><h3>当前候选 {row.candidate}</h3><MoleculeViewer key={row.candidate} last={data.frames[row.xyz_frame-1].geometry} frameLabel={`候选 ${row.candidate} · 第 ${row.xyz_frame} 帧`}/></>:<p role="alert">{candidate===undefined?'清单没有候选。':'URL 中的候选不存在。'}</p>}
 <h3>未匹配的 Attempts</h3>{m.unmatched_attempts.length?<ul>{m.unmatched_attempts.map((a,i)=><li key={i}>{a.layer} · {a.attempt} · {a.reason}</li>)}</ul>:<p>无记录。</p>}
 </section>;
}
export function EnsemblePage({study,parts,candidate,revision}:{study:string;parts:string[];candidate?:number;revision:number}){
 const [data,setData]=useState<Ensemble|null>(null),[error,setError]=useState('');const location=parts.join('/');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<Ensemble>(endpoint(study,'ensembles',...parts),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,location,revision]);
 return error?<p role="alert">{error}</p>:data?<EnsembleContent key={study+location+revision} data={data} study={study} parts={parts} candidate={candidate}/>:<p role="status">读取集合与 XYZ…</p>;
}
