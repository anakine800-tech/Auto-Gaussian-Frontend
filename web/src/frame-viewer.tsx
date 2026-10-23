import {useMemo,useState} from 'react';
import {MoleculeViewer,isGeometry} from './molecule-viewer';
import type {Geometry} from './molecule-viewer';
import {alignGeometry,alignmentReason} from './geometry-alignment';

export function FrameViewer({geometry,frames,frameLabel,highlightedAtoms,reference,onReference,frameCount}: {
 geometry:unknown;frames?:unknown[];frameLabel:string;highlightedAtoms?:number[];
 reference?:Geometry|null;onReference?:(index:number)=>void;frameCount?:number;
}) {
 const [enabled,setEnabled]=useState(false),[index,setIndex]=useState(0);
 const all=frames?.map(g=>isGeometry(g)?g:null),current=isGeometry(geometry)?geometry:null;
 const selected=Math.min(index,Math.max(0,(frames?.length??frameCount??1)-1));
 const ref=all?.[selected]??reference??null;
 const reason=alignmentReason(all??[ref,current]);
 const shown=useMemo(()=>enabled&&!reason&&current&&ref?alignGeometry(current,ref):current,[enabled,reason,current,ref]);
 return <div className="frame-viewer">
  <div className="frame-alignment"><label><input type="checkbox" checked={enabled&&!reason} disabled={!!reason} onChange={e=>setEnabled(e.target.checked)}/>对齐到参考帧</label>
   <label>参考帧 <select aria-label="参考帧" value={selected} onChange={e=>{const next=Number(e.target.value);setIndex(next);onReference?.(next);}}>{Array.from({length:frames?.length??frameCount??1},(_,i)=><option key={i} value={i}>第 {i+1} 帧</option>)}</select></label>
   <span className="muted">{reason??'全部原子 Kabsch 对齐，仅用于显示。'}</span>
  </div>
  <MoleculeViewer last={shown} frameLabel={frameLabel} highlightedAtoms={highlightedAtoms}/>
 </div>;
}
