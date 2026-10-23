import {useEffect,useRef,useState} from 'react';
import {clearBasket,setCompared,useCompareBasket} from './compare-basket';
import {QuickComparison} from './quick-comparison-panel';
import {StructureComparison} from './structure-comparison';

export function CompareTray({study}:{study:string}){
 const tray=useRef<HTMLElement>(null);
 useEffect(()=>{const node=tray.current;if(!node)return;const observer=new ResizeObserver(()=>document.documentElement.style.setProperty('--compare-height',`${node.getBoundingClientRect().height}px`));observer.observe(node);return()=>{observer.disconnect();document.documentElement.style.setProperty('--compare-height','0px');};},[]);
 const {ids,message}=useCompareBasket(study),[open,setOpen]=useState(false),[structures,setStructures]=useState(false);
 return <>
 {open&&ids.length>=2&&<div className="tray-comparison"><QuickComparison study={study} ids={ids} onClose={()=>setOpen(false)}/></div>}
 {structures&&ids.length>=2&&ids.length<=3&&<div className="tray-comparison"><StructureComparison study={study} ids={ids} onClose={()=>setStructures(false)}/></div>}
 <aside ref={tray} className="compare-tray" aria-label="比较篮">
 <strong>比较篮 {ids.length} / 6</strong><div className="compare-items">{ids.map(id=><button key={id} aria-label={`移除 ${id}`} onClick={()=>setCompared(study,id,false)}>{id} ×</button>)}{!ids.length&&<span className="muted">在全部 Attempt 中勾选</span>}</div>
 <button disabled={ids.length<2} onClick={()=>setOpen(true)}>打开比较</button><button disabled={ids.length<2||ids.length>3} onClick={()=>setStructures(true)}>结构对比</button><button disabled={!ids.length} onClick={()=>clearBasket(study)}>清空</button>
 {message&&<p role="status">{message}</p>}
 </aside></>;
}
