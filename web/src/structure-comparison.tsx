import {useEffect,useMemo,useState} from 'react';
import {endpoint,get,object} from './api';
import type {Attempt} from './api';
import {isGeometry} from './molecule-viewer';
import {alignGeometry,alignmentReason} from './geometry-alignment';
import {StructureCards} from './irc-structures';
import {compareAttempts} from './quick-comparison';
import {Drawer,ErrorNotice} from './ui';

type Source=Pick<Attempt,'id'|'facts'|'geometry'>;
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
export function StructureComparison({study,ids,onClose}:{study:string;ids:string[];onClose:()=>void}){
 const [sources,setSources]=useState<Source[]|null>(null),[error,setError]=useState(''),[align,setAlign]=useState(false),[text,setText]=useState('');
 const key=JSON.stringify(ids);
 useEffect(()=>{const c=new AbortController();setSources(null);setError('');
  if(ids.length<2||ids.length>3){setError('请选择同一 study 内的 2–3 个 Attempt。');return;}
  Promise.all(ids.map(id=>get<Source>(endpoint(study,'attempts',id,'comparison-structure'),c.signal))).then(data=>{if(!c.signal.aborted)setSources(data);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 },[study,key]);
 const comparison=useMemo(()=>sources?compareAttempts(sources):null,[sources]);
 const geometries=useMemo(()=>sources?.map(s=>isGeometry(s.geometry.data)?s.geometry.data:null)??[],[sources]);
 const reason=alignmentReason(geometries);
 let pairs:number[][]=[],pairError='';try{pairs=parseAtomPairs(text);if(pairs.some(pair=>geometries.some(g=>g&&pair.some(n=>n>g.atoms.length)))){pairError='原子编号超出至少一个结构；请核对各结构编号。';pairs=[];}}catch(e){pairError=(e as Error).message;}
 const cards=useMemo(()=>sources?.map((s,i)=>{
  const f=object(s.facts.data)?s.facts.data:{},g=geometries[i],row=comparison!.rows[i];
  const energy=f.program==='xtb'?f.total_energy:f.program==='crest'?f.best_energy:row.electronic;
  const method=typeof f.route==='string'?f.route:'未提供';
  return {key:s.id,title:`结构 ${i+1}`,testId:`structure-comparison-${i+1}`,attempt:s.id,geometry:align&&!reason&&g?alignGeometry(g,geometries[0]!):g,error:s.geometry.error,energy_hartree:typeof energy==='number'&&Number.isFinite(energy)?energy:null,cameraReference:align&&!reason?geometries[0]!:undefined,n_imag:row.nImag,method,
   ...(!comparison!.differences.length?{relative:row.relativeElectronic}:{})};
 })??[],[sources,geometries,comparison,align,reason]);
 return <Drawer open title="结构对比" onClose={onClose}><section className="structure-comparison irc-structures" aria-label="任意结构对比">
  {error?<ErrorNotice>{error}</ErrorNotice>:!sources?<p role="status">读取最终几何与 facts…</p>:<>
   <div className="comparison-controls"><label><input type="checkbox" checked={align&&!reason} disabled={!!reason} onChange={e=>setAlign(e.target.checked)}/>对齐到第 1 个</label><label>原子对 <input aria-label="对比原子对" placeholder="1-5,2-7" value={text} onChange={e=>setText(e.target.value)}/></label></div>
   <p className="comparison-notice">{reason??'全部原子 Kabsch 对齐仅用于显示。'} 距离为前端计算；不写入数据。</p>
   {pairError&&<ErrorNotice>{pairError}</ErrorNotice>}
   {comparison!.differences.length?<details className="comparison-differences" open><summary>口径不同，不给相对能</summary><ul>{comparison!.differences.map((d,i)=><li key={i}>{d}</li>)}</ul></details>:<p className="comparison-notice">相对电子能：前端计算、非正式；所选结构最低电子能为 0。</p>}
   <StructureCards cards={cards} pairs={pairs} study={study}/>
  </>}
 </section></Drawer>;
}
