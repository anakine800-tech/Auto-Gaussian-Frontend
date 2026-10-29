import {useEffect,useRef} from 'react';
import {COMPARE_LIMIT,clearBasket,setCompared,useCompareBasket} from './compare-basket';
import {compareHash} from './routing';

export function CompareTray({study}:{study:string}){
 const tray=useRef<HTMLElement>(null);
 useEffect(()=>{const node=tray.current;if(!node)return;const observer=new ResizeObserver(()=>document.documentElement.style.setProperty('--compare-height',`${node.getBoundingClientRect().height}px`));observer.observe(node);return()=>{observer.disconnect();document.documentElement.style.setProperty('--compare-height','0px');};},[]);
 const {ids,message}=useCompareBasket(study);
 return <>
 <aside ref={tray} className="compare-tray" aria-label="比较篮">
 <strong>比较篮 {ids.length} / {COMPARE_LIMIT}</strong><div className="compare-items">{ids.map(id=><button key={id} aria-label={`移除 ${id}`} onClick={()=>setCompared(study,id,false)}>{id} ×</button>)}{!ids.length&&<span className="muted">在全部 Attempt 中勾选</span>}</div>
 <button disabled={ids.length<2} onClick={()=>{location.hash=compareHash(study,ids);}}>打开比较</button><button disabled={!ids.length} onClick={()=>clearBasket(study)}>清空</button>
 {message&&<p role="status">{message}</p>}
 </aside></>;
}
