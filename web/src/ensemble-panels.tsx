import {useEffect,useRef,useState} from 'react';
import {endpoint,get} from './api';
import {locationChanged} from './navigation';
import {ActionBar,Collapsible,EmptyState,ErrorNotice,Panel,StatusBadge,readPreference,savePreference} from './ui';
import {routeHash} from './routing';
import {MoleculeViewer} from './molecule-viewer';
import type {Atom} from './molecule-math';
import {drawThumbnail} from './thumbnail';

type Layer={attempts:string[];ambiguous:boolean;energy_hartree:number|null;relative_kcal:number|null;termination?:string|null;n_imaginary?:number|null};
type Local={dihedrals:number[];bins:string[];near_boundary:boolean;distances:number[]};
type Descriptors={dihedral_bins:{atoms:number[];boundaries:number[];names:string[]}[];distance_pairs:number[][]};
type Candidate={local?:Local;candidate:number;xyz_frame:number;sources:string[];route_members:{route:string;member:number;relative_kcal_within_route:number|null}[];xtb_relative_kcal:number|null;sp:Layer|null;opt:Layer|null;thermo:{attempt:string|null;qh_G:number|null;relative_G_kcal:number|null;population:number|null}|null;missing:string[];notes:string[]};
type Ensemble={manifest:{descriptors?:Descriptors;descriptor_error?:string;bin_summary?:{bins:string[];count:number;lowest_candidate:number|null;lowest_layer:string|null}[];label:string|null;energy_basis:string;warnings:string[];references:Record<string,number|null>;routes:{label:string;attempts:string[]}[];candidates:Candidate[];unmatched_attempts:{layer:string;attempt:string;reason:string}[]};frames:{geometry:{atoms:Atom[]};comment:string}[]};
const url=(study:string,parts:string[],candidate?:number)=>routeHash([study,'ensembles',...parts])+(candidate===undefined?'':`?candidate=${candidate}`);
const value=(n:number|null|undefined)=>n==null?'':String(n);
function Thumbnail({row,atoms,selected,onSelect}:{row:Candidate;atoms:Atom[];selected:boolean;onSelect:()=>void}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const canvas=ref.current;if(!canvas)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){drawThumbnail(canvas,atoms);observer.disconnect();}});observer.observe(canvas);return()=>observer.disconnect();},[atoms]);
 return <button aria-label={`候选 ${row.candidate} 缩略图`} aria-pressed={selected} onClick={onSelect} className="candidate-thumbnail"><canvas ref={ref} width={160} height={130}/>候选 {row.candidate}</button>;
}
type Filters={bins:string[][];near:boolean};
const dihedralLabel=(atoms:number[])=>`二面角 ${atoms.join('–')}`;
function readFilters(scope:string,definitions?:Descriptors):Filters{
 const params=new URLSearchParams(window.location.search),active=[scope,scope.replace('#/s/','#/').replace('/analysis/ensemble/','/ensembles/')].includes(params.get('ensembleScope')??'');
 return {bins:definitions?.dihedral_bins.map((d,i)=>active?params.getAll(`ensembleBin${i}`).filter(v=>d.names.includes(v)):[])??[],near:active&&params.get('ensembleNearBoundary')==='1'};
}
function EnsembleContent({data,study,parts,candidate}:{data:Ensemble;study:string;parts:string[];candidate?:number}){
 const m=data.manifest,scope=url(study,parts);
 const [filters,setFilters]=useState(()=>readFilters(scope,m.descriptors));
 useEffect(()=>{
  const restore=()=>{setFilters(readFilters(scope,m.descriptors));setPage(0);};
  window.addEventListener('popstate',restore);
  return()=>window.removeEventListener('popstate',restore);
 },[scope,m.descriptors]);
 const updateFilters=(next:Filters)=>{
  const location=new URL(window.location.href);
  for(const key of [...location.searchParams.keys()])if(key==='ensembleScope'||key==='ensembleNearBoundary'||/^ensembleBin[0-9]+$/.test(key))location.searchParams.delete(key);
  if(next.near||next.bins.some(b=>b.length)){
   location.searchParams.set('ensembleScope',scope);
   next.bins.forEach((names,i)=>names.forEach(name=>location.searchParams.append(`ensembleBin${i}`,name)));
   if(next.near)location.searchParams.set('ensembleNearBoundary','1');
  }
  window.history.pushState({...window.history.state,agScroll:window.scrollY},'',location);locationChanged();setFilters(next);setPage(0);
 };
 const [sort,setSort]=useState(()=>{const [key,direction]=readPreference('sort:'+scope,'candidate:1').split(':');return {key:['candidate','xtb','sp','opt','thermo'].includes(key)?key:'candidate',direction:direction==='-1'?-1:1};}),[page,setPage]=useState(0);
 const selected=candidate??m.candidates[0]?.candidate;
 const energy=(row:Candidate,key:string):number|null=>key==='xtb'?row.xtb_relative_kcal:key==='sp'?row.sp?.relative_kcal??null:key==='opt'?row.opt?.relative_kcal??null:key==='thermo'?row.thermo?.relative_G_kcal??null:row.candidate;
 const filtered=m.descriptors?m.candidates.filter(r=>(!filters.near||r.local!.near_boundary)&&filters.bins.every((names,i)=>!names.length||names.includes(r.local!.bins[i]))):m.candidates;
 const rows=[...filtered].sort((a,b)=>{const x=energy(a,sort.key),y=energy(b,sort.key);return x===null?(y===null?0:1):y===null?-1:(x-y)*sort.direction;});
 useEffect(()=>{const index=rows.findIndex(r=>r.candidate===selected);if(index>=0)setPage(Math.floor(index/50));},[selected,filters]);
 const currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));
 const shown=rows.slice(currentPage*50,(currentPage+1)*50),row=m.candidates.find(r=>r.candidate===selected);
 const choose=(id:number)=>{window.location.hash=url(study,parts,id);};
 const reason=(r:Candidate,layer?:Layer|null)=>[r.missing.length?'missing: '+r.missing.join(', '):'',layer?.ambiguous?'ambiguous: '+layer.attempts.join(', '):'',...r.notes].filter(Boolean).join(' · ')||'未提供';
 const sortButton=(key:string,label:string)=><button onClick={()=>{setSort(s=>{const next={key,direction:s.key===key?-s.direction:1};savePreference('sort:'+scope,`${key}:${next.direction}`);return next;});setPage(0);}}>{label}{sort.key===key?(sort.direction===1?' ↑':' ↓'):''}</button>;
 return <div role="region" aria-label="构象集合页"><Panel title={m.label??parts.at(-1)??'构象集合'}><StatusBadge tone="warn">工具记录，待人工审阅</StatusBadge> <a href={routeHash([study])}>返回结果</a>
 {m.descriptor_error&&<ErrorNotice>局部构象数据不可用：{m.descriptor_error}</ErrorNotice>}
 {m.warnings.map((warning,i)=><p role="note" className="notice" key={i}>{warning}</p>)}
 <p className="muted">能量差：kcal/mol · 布居：保存分数 × 100%。能量基准：{m.energy_basis}。参考候选：{Object.entries(m.references).map(([k,v])=>`${k}: ${v??'未提供'}`).join(' · ')}</p>
 {m.descriptors&&<section aria-label="局部构象筛选"><h3>局部构象筛选</h3>
 {m.descriptors.dihedral_bins.map((definition,i)=><fieldset key={i}><legend>{dihedralLabel(definition.atoms)} 分组（多选）</legend>{definition.names.map(name=><label key={name}><input type="checkbox" checked={filters.bins[i]?.includes(name)??false} onChange={e=>updateFilters({...filters,bins:filters.bins.map((names,j)=>j!==i?names:e.target.checked?[...names,name]:names.filter(n=>n!==name))})}/>{name}</label>)}</fieldset>)}
 <label><input type="checkbox" checked={filters.near} onChange={e=>updateFilters({...filters,near:e.target.checked})}/>只看近边界</label>
 <button onClick={()=>updateFilters({bins:m.descriptors!.dihedral_bins.map(()=>[]),near:false})}>清除局部筛选</button><p>符合筛选：{rows.length} / {m.candidates.length} 个候选</p>
 </section>}
 <div className="table-scroll"><table aria-label="构象能量表"><thead><tr><th>{sortButton('candidate','编号')}</th><th>来源路线</th><th>{m.energy_basis==='per_source_not_comparable'?'xTB · 各路线不可比较':sortButton('xtb','xTB 相对能')}</th><th>{sortButton('sp','SP 相对能')}</th><th>Opt 状态 / 虚频数</th><th>{sortButton('opt','Opt 相对能')}</th><th>{sortButton('thermo','qh_G 相对值')}</th><th>布居</th><th>缺失层 / 备注</th>{m.descriptors&&<>{m.descriptors.dihedral_bins.map((d,i)=><th key={`angle-${i}`}>{dihedralLabel(d.atoms)}</th>)}<th>近边界</th>{m.descriptors.distance_pairs.map((pair,i)=><th key={`distance-${i}`}>距离 {pair.join('–')}（Å）</th>)}</>}</tr></thead>
 <tbody>{shown.map(r=><tr key={r.candidate} data-candidate={r.candidate} aria-selected={selected===r.candidate} className={selected===r.candidate?'selected':'result-row'} onClick={()=>choose(r.candidate)}>
 <td><button onClick={e=>{e.stopPropagation();choose(r.candidate);}}>候选 {r.candidate}</button></td>
 <td>{r.sources.map(source=><div key={source}>{source}{m.routes.find(route=>route.label===source)?.attempts.map(id=><span key={id}> · <a href={routeHash([study,id])} onClick={e=>e.stopPropagation()}>{id}</a></span>)}</div>)}</td>
 <td title={reason(r)}>{m.energy_basis==='per_source_not_comparable'?<details onClick={e=>e.stopPropagation()}><summary>各路线不可比较</summary>{r.route_members.map((member,i)=><div key={i}>{member.route} · 帧 {member.member}: {value(member.relative_kcal_within_route)}</div>)}</details>:value(r.xtb_relative_kcal)}</td>
 <td title={reason(r,r.sp)}>{value(r.sp?.relative_kcal)}</td><td title={reason(r,r.opt)}>{r.opt?.termination??''}{r.opt?.n_imaginary!=null?` / ${r.opt.n_imaginary}`:''}{r.opt?.ambiguous?' ambiguous':''}</td><td title={reason(r,r.opt)}>{value(r.opt?.relative_kcal)}</td>
 <td title={reason(r)}>{value(r.thermo?.relative_G_kcal)}</td><td title={reason(r)}>{r.thermo?.population==null?'':`${r.thermo.population*100}%`}</td><td>{r.missing.join(', ')}{r.notes.length>0&&<details onClick={e=>e.stopPropagation()}><summary>备注</summary>{r.notes.map((note,i)=><p key={i}>{note}</p>)}</details>}</td>{m.descriptors&&<>{r.local!.bins.map((bin,i)=><td key={`angle-${i}`} title={`${r.local!.dihedrals[i]}°`}>{bin}</td>)}<td>{r.local!.near_boundary?'是 ⚑':'否'}</td>{r.local!.distances.map((distance,i)=><td key={`distance-${i}`}>{distance.toFixed(3)}</td>)}</>}</tr>)}</tbody></table></div>
 <ActionBar label="候选分页"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一组</button><span>第 {currentPage+1} / {Math.max(1,Math.ceil(rows.length/50))} 页 · 每页最多 50 个</span><button disabled={(currentPage+1)*50>=rows.length} onClick={()=>setPage(currentPage+1)}>下一组</button></ActionBar>
 <div role="group" aria-label="候选缩略图" className="thumbnail-grid">{shown.map(r=><Thumbnail key={r.candidate} row={r} atoms={data.frames[r.xyz_frame-1].geometry.atoms} selected={r.candidate===selected} onSelect={()=>choose(r.candidate)}/>)}</div>
 {row?<><h3>当前候选 {row.candidate}</h3><MoleculeViewer key={row.candidate} last={data.frames[row.xyz_frame-1].geometry} frameLabel={`候选 ${row.candidate} · 第 ${row.xyz_frame} 帧`}/></>:<p role="alert">{candidate===undefined?'清单没有候选。':'URL 中的候选不存在。'}</p>}
 {m.descriptors&&m.bin_summary&&<section aria-label="分组汇总"><h3>分组汇总</h3><p className="muted">完整清单的保存值，不随筛选重算；最低能候选不代表科学验收。</p><div className="table-scroll"><table aria-label="分组汇总表"><thead><tr><th>分组组合（按二面角列顺序）</th><th>候选数</th><th>最低能候选</th><th>所用层级</th></tr></thead><tbody>{m.bin_summary.map((group,i)=><tr key={i}><td>{group.bins.join(' / ')||'未定义二面角分组'}</td><td>{group.count}</td><td>{group.lowest_candidate===null?'未提供':<a href={url(study,parts,group.lowest_candidate)} onClick={()=>{updateFilters({bins:m.descriptors!.dihedral_bins.map(()=>[]),near:false});const index=rows.findIndex(r=>r.candidate===group.lowest_candidate);if(index>=0)setPage(Math.floor(index/50));}}>候选 {group.lowest_candidate}</a>}</td><td>{group.lowest_layer??'未提供'}</td></tr>)}</tbody></table></div></section>}
 <Collapsible page="ensemble" block="unmatched" title="未匹配的 Attempts" defaultOpen>{m.unmatched_attempts.length?<ul>{m.unmatched_attempts.map((a,i)=><li key={i}>{a.layer} · {a.attempt} · {a.reason}</li>)}</ul>:<EmptyState>无记录。</EmptyState>}</Collapsible>
 </Panel></div>;
}
export function EnsemblePage({study,parts,candidate,revision}:{study:string;parts:string[];candidate?:number;revision:number}){
 const [data,setData]=useState<Ensemble|null>(null),[error,setError]=useState('');const location=parts.join('/');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<Ensemble>(endpoint(study,'ensembles',...parts),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,location,revision]);
 return error?<p role="alert">{error}</p>:data?<EnsembleContent key={study+location+revision} data={data} study={study} parts={parts} candidate={candidate}/>:<p role="status">读取集合与 XYZ…</p>;
}
