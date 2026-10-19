import {useLayoutEffect,useRef} from 'react';
import {MoleculeViewer} from './molecule-viewer';
import type {Geometry} from './molecule-viewer';
import {routeHash} from './routing';

type Structure={attempt:string|null;geometry:Geometry|null;energy_hartree:number|null;n_imag:number|null;error:string|null};
export type IRCStructuresData=Record<'reverse'|'ts'|'forward',Structure>;
const roles=['reverse','ts','forward'] as const;
const titles={reverse:'reverse 端点优化结构',ts:'TS 结构',forward:'forward 端点优化结构'};

export function IRCStructures({structures,pairs,study}:{structures:IRCStructuresData;pairs:number[][];study:string}){
 const root=useRef<HTMLElement>(null);
 // Fit the first screen using the actual shell, wrapped titles and card text.
 // Only the drawing area shrinks; expanded tools and long content stay scrollable.
 useLayoutEffect(()=>{
  const el=root.current!;let frame=0;
  const measure=()=>{
   cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    if(window.innerWidth<1024){el.style.removeProperty('--irc-scene-height');return;}
    if(el.querySelector('details[open]'))return;
    const grid=el.querySelector<HTMLElement>('.irc-structure-grid')!;
    const overhead=Array.from(grid.children).map(card=>{
     const scene=card.querySelector<SVGSVGElement>('[data-testid="molecule-scene"]');
     return card.getBoundingClientRect().height-(scene?.getBoundingClientRect().height??0);
    });
    const main=el.closest('main');
    const bottom=main?parseFloat(getComputedStyle(main).paddingBottom):0;
    const available=Math.floor(window.innerHeight-grid.getBoundingClientRect().top-window.scrollY-Math.max(...overhead)-bottom);
    el.style.setProperty('--irc-scene-height',`${Math.max(0,available)}px`);
   });
  };
  const observer=new ResizeObserver(measure);
  [el,...el.querySelectorAll('.irc-structure-card'),...document.querySelectorAll('.app-header,.context-bar')].forEach(node=>observer.observe(node));
  window.addEventListener('resize',measure);measure();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);};
 },[structures]);
 const highlighted=Array.from(new Set(pairs.flat()));
 return <section ref={root} className="irc-structures" aria-label="TS 与端点结构比对">
  <h3>TS 与端点结构比对</h3>
  <p className="muted">供人工比对；结论仍以四项判据表为准。编号保留文件顺序，橙色为跟踪原子。拖动独立旋转，Alt / Option + 滚轮缩放；连接仅按距离推测。</p>
  <div className="irc-structure-grid">
   {roles.map(role=>{
    const s=structures[role];
    return <section className="irc-structure-card" key={role} aria-label={titles[role]} data-testid={`irc-comparison-${role}`}>
     <h4>{titles[role]}<span>{s.attempt??'—'}</span></h4>
     {s.error?<p role="alert">结构不可用：{s.error}</p>:!s.attempt?<p role="status">报告未提供端点 Attempt</p>:s.geometry?<MoleculeViewer last={s.geometry} frameLabel="最终几何" highlightedAtoms={highlighted}/>:<p role="status">最终几何未知</p>}
     <dl className="irc-structure-facts"><dt>电子能 / Hartree</dt><dd>{s.energy_hartree===null?'未知':s.energy_hartree.toFixed(6)}</dd><dt>虚频数</dt><dd>{s.n_imag??'未知'}</dd></dl>
     {s.attempt&&<a href={routeHash([study,s.attempt])}>查看 Attempt {s.attempt}</a>}
     {s.geometry&&!s.error&&<div className="irc-structure-distances"><p>原子对距离 / Å（前端按最终几何计算）</p><ul>{pairs.map(([a,b])=>{
      const left=s.geometry!.atoms[a-1],right=s.geometry!.atoms[b-1];
      return <li key={`${a}-${b}`}><span>{a}-{b}</span><span>{Math.hypot(left.x-right.x,left.y-right.y,left.z-right.z).toFixed(4)}</span></li>;
     })}</ul></div>}
    </section>;
   })}
  </div>
 </section>;
}
