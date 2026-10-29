import {useEffect,useMemo,useState} from 'react';
import {object} from './api';
import {COMPARE_LIMIT} from './compare-basket';
import {isGeometry} from './molecule-viewer';
import type {Geometry} from './molecule-viewer';
import {alignGeometry,alignmentReason} from './geometry-alignment';
import {StructureCards} from './irc-structures';
import {compareAttempts,loadComparisonSources} from './quick-comparison';
import type {CompareSource} from './quick-comparison';
import {Drawer,ErrorNotice} from './ui';

export function parseAtomPairs(text:string):number[][] {
 if(!text.trim())return [];
 return text.split(',').map(part=>{
  const match=/^\s*([1-9][0-9]*)\s*-\s*([1-9][0-9]*)\s*$/.exec(part);
  if(!match)throw Error('原子对格式应为 1-5,2-7（编号从 1 开始）。');
  const pair=match.slice(1).map(Number);
  if(pair.some(n=>!Number.isSafeInteger(n))||pair[0]===pair[1])throw Error('原子对需要两个不同的有效编号。');
  return pair;
 });
}

type Props={study:string;ids:string[];onClose?:()=>void;inline?:boolean;initialPairs?:string;loadedSources?:Record<string,CompareSource>};
export function StructureComparison({study,ids,onClose=()=>{},inline=false,initialPairs='',loadedSources}:Props){
 const [fetched,setFetched]=useState<Record<string,CompareSource>|null>(null),[error,setError]=useState(''),[align,setAlign]=useState(inline),[text,setText]=useState(initialPairs),[reference,setReference]=useState('');
 useEffect(()=>setText(initialPairs),[initialPairs]);
 const key=JSON.stringify([...new Set(ids)]);
 const selected=useMemo(()=>JSON.parse(key) as string[],[key]);
 const capacityError=selected.length<2||selected.length>COMPARE_LIMIT?`请选择同一 study 内的 2–${COMPARE_LIMIT} 个 Attempt。`:'';
 useEffect(()=>{
  if(loadedSources||capacityError)return;
  const c=new AbortController();setFetched(null);setError('');
  loadComparisonSources(study,selected,c.signal).then(data=>{if(!c.signal.aborted)setFetched(data);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});
  return()=>c.abort();
 },[study,selected,loadedSources,capacityError]);
 const sourceMap=loadedSources??fetched;
 const sources=useMemo(()=>sourceMap&&!capacityError?selected.map(id=>sourceMap[id]??{id,facts:{data:null,error:'来源未加载'},geometry:{data:null,error:'来源未加载'}}):null,[sourceMap,selected,capacityError]);
 const comparison=useMemo(()=>sources?compareAttempts(sources):null,[sources]);
 const geometries=useMemo(()=>sources?.map(s=>!s.geometry.error&&isGeometry(s.geometry.data)?s.geometry.data:null)??[],[sources]);
 const available=useMemo(()=>geometries.filter((g):g is Geometry=>g!==null),[geometries]);
 const referenceIndex=sources?.findIndex((s,i)=>s.id===reference&&geometries[i])??-1;
 const refIndex=referenceIndex>=0?referenceIndex:geometries.findIndex(g=>g!==null);
 const referenceGeometry=geometries[refIndex]??null;
 // Missing sources keep their own cards; the remaining geometries must still
 // pass the same all-atom number/order check before alignment is permitted.
 const reason=available.length<2?'至少需要两个完整几何，无法对齐。':alignmentReason(available);
 const aligned=useMemo(()=>geometries.map(g=>g&&!reason&&referenceGeometry?alignGeometry(g,referenceGeometry):null),[geometries,reason,referenceGeometry]);
 let pairs:number[][]=[],pairError='';try{pairs=parseAtomPairs(text);if(pairs.some(pair=>geometries.some(g=>g&&pair.some(n=>n>g.atoms.length)))){pairError='原子编号超出至少一个结构；请核对各结构编号。';pairs=[];}}catch(e){pairError=(e as Error).message;}
 const cards=useMemo(()=>sources?.map((s,i)=>{
  const f=object(s.facts.data)?s.facts.data:{},g=geometries[i],row=comparison!.rows[i];
  const energy=f.program==='xtb'?f.total_energy:f.program==='crest'?f.best_energy:row.electronic;
  const method=typeof f.route==='string'?f.route:'未提供';
  return {key:s.id,title:`结构 ${i+1}`,testId:`structure-comparison-${i+1}`,attempt:s.id,geometry:align&&aligned[i]?aligned[i]:g,error:s.geometry.error,energy_hartree:typeof energy==='number'&&Number.isFinite(energy)?energy:null,cameraReference:align&&!reason&&referenceGeometry?referenceGeometry:undefined,n_imag:row.nImag,method,
   ...(!comparison!.differences.length?{relative:row.relativeElectronic}:{})};
 })??[],[sources,geometries,comparison,align,aligned,reason,referenceGeometry]);
 const content=<section className="structure-comparison irc-structures" aria-label="任意结构对比">
  {capacityError||error?<ErrorNotice>{capacityError||error}</ErrorNotice>:!sources?<p role="status">读取最终几何与 facts…</p>:<>
   <div className="comparison-controls">
    <label>几何参照项 <select aria-label="几何参照项" value={sources[refIndex]?.id??''} disabled={!available.length} onChange={e=>setReference(e.target.value)}>
     {!available.length&&<option value="">没有可用几何</option>}{sources.map((s,i)=><option key={s.id} value={s.id} disabled={!geometries[i]}>结构 {i+1} · {s.id}{!geometries[i]?'（几何不可用）':''}</option>)}
    </select></label>
    <label><input type="checkbox" checked={align&&!reason} disabled={!!reason} onChange={e=>setAlign(e.target.checked)}/>{refIndex>=0?`对齐到第 ${refIndex+1} 个`:'对齐到参考结构'}</label>
    <label>原子对 <input aria-label="对比原子对" placeholder="1-5,2-7" value={text} onChange={e=>setText(e.target.value)}/></label>
   </div>
   <p className="comparison-notice">{reason??'全部原子 Kabsch 对齐仅用于显示。'} 距离为前端计算；不写入数据。</p>
   {available.length<sources.length&&<p className="comparison-notice">缺少几何的项不参与对齐与 RMSD，其余完整几何继续核对；缺失值不按零处理。</p>}
   {sources.filter(s=>s.facts.error).map(s=><p className="comparison-notice" role="status" key={s.id}>{s.id}：facts 不可用（{s.facts.error}）</p>)}
   {pairError&&<ErrorNotice>{pairError}</ErrorNotice>}
   {comparison!.differences.length?<details className="comparison-differences" open><summary>口径不同，不给相对能</summary><ul>{comparison!.differences.map((d,i)=><li key={i}>{d}</li>)}</ul></details>:<p className="comparison-notice">相对电子能：前端计算、非正式；所选结构最低电子能为 0。</p>}
   {!reason&&referenceGeometry&&<ul aria-label="Kabsch RMSD">{aligned.map((g,i)=>{
    if(!g)return <li key={sources[i].id}>{sources[i].id}：缺失几何，RMSD 未知</li>;
    const rmsd=Math.sqrt(g.atoms.reduce((sum,a,j)=>{const b=referenceGeometry.atoms[j];return sum+(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2;},0)/g.atoms.length);
    return <li key={sources[i].id}>{sources[i].id} → {sources[refIndex].id}：RMSD {rmsd.toFixed(6)} Å</li>;
   })}</ul>}
   <StructureCards cards={cards} pairs={pairs} study={study}/>
  </>}
 </section>;
 return inline?content:<Drawer open title="结构对比" onClose={onClose}>{content}</Drawer>;
}
