import {useEffect,useState} from 'react';
import {endpoint,get,object} from './api';
import type {Study} from './api';
import {COMPARE_LIMIT,useCompareBasket} from './compare-basket';
import {loadComparisonSources,comparisonEntries,comparisonObjects,comparisonEnergy,energyMetrics,inspectProtocol,protocolKeys,thermoKeys} from './quick-comparison';
import type {CompareSource,EvidenceCatalog} from './quick-comparison';
import {parseAtomPairs,StructureComparison} from './structure-comparison';
import {isGeometry} from './molecule-viewer';
import {routeHash} from './routing';
import {ErrorNotice} from './ui';
import {ComparisonTable,comparisonTitle} from './quick-comparison-panel';
import './ui/compare.css';
const rec=(v:unknown)=>object(v)?v:{};
const shown=(v:unknown):string=>v===true?'通过':v===false?'未通过':typeof v==='number'&&Number.isFinite(v)||typeof v==='string'?String(v):v&&typeof v==='object'?JSON.stringify(v):'缺失';
export function ComparePage({data,revision}:{data:Study;revision:number}){
 const {ids}=useCompareBasket(data.id),key=ids.join('/');
 const [sources,setSources]=useState<Record<string,CompareSource>|null>(null),[catalog,setCatalog]=useState<EvidenceCatalog>(),[error,setError]=useState(''),[reference,setReference]=useState(''),[differences,setDifferences]=useState(false),[pairText,setPairText]=useState(''),[overlays,setOverlays]=useState<string[]>([]);
 useEffect(()=>{const c=new AbortController();setSources(null);setCatalog(undefined);setError('');setOverlays(ids);
  get<{catalog:EvidenceCatalog}>(endpoint(data.id,'evidence'),c.signal).then(async result=>{
   const objects=comparisonObjects(result.catalog),needed=new Set(ids);
   for(const o of objects)if(o.members.some(id=>ids.includes(id))||Object.values(o.adopted).some(id=>ids.includes(id)))Object.values(o.adopted).forEach(id=>needed.add(id));
   const loaded=await loadComparisonSources(data.id,[...needed],c.signal);
   if(!c.signal.aborted){setCatalog(result.catalog);setSources(loaded);}
  }).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 },[data.id,key,revision]);
 const entries=comparisonEntries(ids,comparisonObjects(catalog),sources??{}),ref=entries.find(e=>e.id===reference)??entries[0];
 let pairs:number[][]=[],pairError='';try{pairs=parseAtomPairs(pairText);}catch(e){pairError=(e as Error).message;}
 const table=(label:string,rows:{name:string;values:string[]}[])=><ComparisonTable label={label} rows={rows} columns={entries} onlyDifferences={differences}/>;
 const properties=[['n_imag','虚频数'],['lowest_imaginary','最低虚频 / cm⁻¹'],['s2','⟨S²⟩'],['s2_after_annihilation','湮灭后 ⟨S²⟩'],['wavefunction_stability','稳定性结论'],['opt_converged','优化收敛'],['freq_step_converged','频率收敛'],['freq_step_review','频率审阅判据'],['freq_step_convergence','频率四项判据'],['termination','程序终止']] as const;
 const propertySources=(entry:typeof entries[number])=>[['篮中 Attempt',sources?.[entry.id]],...Object.entries(entry.layers)] as [string,CompareSource|undefined][];
 const propertyRows:{name:string;values:string[]}[]=properties.map(([key,name])=>({name,values:entries.map(e=>propertySources(e).map(([layer,source])=>{
  const f=rec(source?.facts.data);
  const frequencies=Array.isArray(f.frequencies_low)?f.frequencies_low.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n<0):[];
  const value=key==='lowest_imaginary'?(frequencies.length?String(Math.min(...frequencies)):f.n_imag===0?'无':'缺失'):shown(f[key]);
  return `${layer.toUpperCase()}：${value}`;
 }).join('\n')||'缺失')}));
 propertyRows.push({name:'审阅状态（有记录不代表通过）',values:entries.map(e=>propertySources(e).map(([layer,s])=>`${layer.toUpperCase()}：${data.attempts.find(a=>a.id===s?.id)?.review_state??'缺失'}`).join('\n'))});
 propertyRows.push({name:'来源 Attempt',values:entries.map(e=>propertySources(e).map(([layer,s])=>`${layer.toUpperCase()}：${s?.id??'缺失'}`).join('\n'))});
 return <article className="compare-page"><h2>{comparisonTitle}</h2><p>各层独立核对；登记对象只使用被采用的 Opt / Freq / SP，未登记条目只用自己的 facts。E+ZPE = SP + ZPE；G = SP + (Freq G − Freq SCF)，登记值使用 catalog 快照。缺失留空，不回填，不做布居、不换温度。</p>
 {catalog?.warning&&<ErrorNotice>{catalog.warning}</ErrorNotice>}{error&&<ErrorNotice>{error}</ErrorNotice>}
 {ids.length<2?<p>请从比较篮选择至少 2 个 Attempt。</p>:!sources?<p role="status">读取采用来源，核对比较口径…</p>:<>
 <div className="comparison-controls"><label>参照项 <select aria-label="参照项" value={ref?.id??''} onChange={e=>setReference(e.target.value)}>{entries.map(e=><option value={e.id} key={e.id}>{e.label}</option>)}</select></label><label><input type="checkbox" checked={differences} onChange={e=>setDifferences(e.target.checked)}/>只看有差异的行</label></div>
 <h3>口径核对</h3>{(['opt','sp','freq'] as const).map(layer=>{const inspected=entries.map(e=>inspectProtocol(e.layers[layer],layer==='freq'));return <section key={layer}><h4>{layer.toUpperCase()} 层</h4>{table(`${layer} 口径核对`,[...protocolKeys,...(layer==='freq'?thermoKeys:[])].map(name=>{const values=inspected.map(s=>s.spec[name]??'缺失'),status=values.includes('缺失')?'缺失':new Set(values).size===1?'一致':'不同';return {name:`${name} · ${status}`,values};}))}{inspected.map((s,i)=>s.errors.length>0&&<p key={entries[i].id} className="notice">{entries[i].id}：{s.errors.join('；')}</p>)}</section>;})}
 <h3>能量</h3><p>Δ 值相对所选参照项，单位 kcal/mol；多重度不同标为电子态能差。方法、基组、色散、溶剂、版本、组成或电荷不符时，该格留空并说明原因。</p>
 {table('分层能量',energyMetrics.map(([metric,name])=>({name,values:entries.map(e=>{const cell=comparisonEnergy(e,ref,metric);return cell.reason?`—（${cell.reason}）`:`${cell.value!.toFixed(6)} Eh · Δ ${cell.delta!.toFixed(3)} kcal/mol${cell.stateGap?' · 电子态能差':''}`;})})))}
 <h3>性质</h3>{table('性质',propertyRows)}
 <div className="comparison-sources">{entries.map(e=><div key={e.id}><strong>{e.label}</strong>{e.error&&<p role="status">{e.error}</p>}{Object.entries(e.layers).map(([layer,s])=>s&&<a key={layer} href={routeHash([data.id,s.id])}>{layer.toUpperCase()}：{s.id}</a>)}</div>)}</div>
 <h3>几何</h3><label>原子对 <input aria-label="比较原子对" placeholder="1-2,2-3" value={pairText} onChange={e=>setPairText(e.target.value)}/></label>{pairError&&<ErrorNotice>{pairError}</ErrorNotice>}
 <p>距离取比较篮条目的最终结构，编号不重排。</p>{table('几何距离',pairs.map(([a,b])=>({name:`${a}-${b} / Å`,values:entries.map(e=>{const g=sources[e.id]?.geometry.data;if(!isGeometry(g))return '缺失几何';const l=g.atoms[a-1],r=g.atoms[b-1];return l&&r?Math.hypot(l.x-r.x,l.y-r.y,l.z-r.z).toFixed(4):'原子编号超出结构';})})))}
 <h3>结构叠合</h3><fieldset><legend>从比较篮选择 2–{COMPARE_LIMIT} 个结构</legend>{ids.map(id=><label key={id}><input type="checkbox" checked={overlays.includes(id)} disabled={!overlays.includes(id)&&overlays.length>=COMPARE_LIMIT} onChange={e=>setOverlays(e.target.checked?[...overlays,id]:overlays.filter(v=>v!==id))}/>{id}</label>)}</fieldset>
 {overlays.length>=2?<StructureComparison study={data.id} ids={overlays} loadedSources={sources} inline initialPairs={pairText}/>:<p>至少选择两个结构以显示 Kabsch 对齐与 RMSD。</p>}
 </>}
 </article>;
}
