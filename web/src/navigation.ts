import {useEffect,useRef,useState} from 'react';
import {readRoute} from './routing';
import type {Route} from './routing';

type ReturnLocation={href:string;scroll:number};
const detail=(r:Route)=>r.attempt?'a/'+r.attempt:r.ensemble?'ensemble/'+r.ensemble.join('/'):r.irc?'irc/'+r.irc.join('/'):r.structure?'file/'+r.structure.join('/'):r.report?'report/'+r.report:'';
const scrollValue=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
// Store only presentation context in browser history. This prevents a report-to-
// Attempt visit from losing the selected candidate, filters or reading position.
export function useHistoryRoute(){
 const [route,setRoute]=useState(readRoute);
 const current=useRef({href:window.location.href,route,y:window.scrollY,back:window.history.state?.agReturn as ReturnLocation|undefined});
 useEffect(()=>{
  const oldRestoration=history.scrollRestoration;history.scrollRestoration='manual';
  history.replaceState({...history.state,agEntry:true},'');
  const update=()=>{
   const next=readRoute(),href=location.href,previous=current.current;
   if(href===previous.href)return;
   if(!history.state?.agEntry){
    const sameDetail=next.study===previous.route.study&&detail(next)===detail(previous.route);
    const back=(next.study===previous.route.study||previous.route.server)&&detail(next)?sameDetail||next.attempt&&previous.route.attempt?previous.back:{href:previous.href,scroll:previous.y}:undefined;
    history.replaceState({...history.state,agEntry:true,agScroll:sameDetail?previous.y:0,agReturn:back},'');
   }
   current.current={href,route:next,y:scrollValue(history.state?.agScroll),back:history.state?.agReturn};setRoute(next);
  };
  const save=()=>{if(location.href!==current.current.href)return;current.current.y=window.scrollY;history.replaceState({...history.state,agScroll:window.scrollY},'');};
  window.addEventListener('hashchange',update);window.addEventListener('popstate',update);window.addEventListener('ag:location',update);window.addEventListener('scroll',save,{passive:true});
  return()=>{history.scrollRestoration=oldRestoration;window.removeEventListener('hashchange',update);window.removeEventListener('popstate',update);window.removeEventListener('ag:location',update);window.removeEventListener('scroll',save);};
 },[]);
 return route;
}
export function locationChanged(){window.dispatchEvent(new Event('ag:location'));}
export function returnLocation(fallback:string):ReturnLocation{
 const back=history.state?.agReturn;
 if(back&&typeof back.href==='string'){
  try{const url=new URL(back.href);if(url.origin===location.origin&&url.pathname===location.pathname&&url.hash.startsWith('#/'))return {href:url.href,scroll:scrollValue(back.scroll)};}catch{/* Use the local list fallback. */}
 }
 return {href:fallback,scroll:0};
}
export function goBackToList(fallback:string){
 const back=returnLocation(fallback);
 history.replaceState({...history.state,agScroll:window.scrollY},'');
 history.pushState({agEntry:true,agScroll:back.scroll},'',back.href);locationChanged();
}
export function useScrollRestore(route:Route,ready:boolean){
 useEffect(()=>{
  if(!ready||route.attemptFile)return;
  const target=scrollValue(history.state?.agScroll);let finished=false;
  const stop=()=>{finished=true;observer.disconnect();window.clearTimeout(timer);};
  const restore=()=>{if(finished)return;const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);if(max>=target){window.scrollTo(0,target);stop();}};
  const observer=new ResizeObserver(restore);observer.observe(document.getElementById('root')!);
  const timer=window.setTimeout(()=>{if(!finished){window.scrollTo(0,target);stop();}},3000);
  const frame=requestAnimationFrame(restore);
  window.addEventListener('wheel',stop,{passive:true});window.addEventListener('pointerdown',stop);
  return()=>{stop();cancelAnimationFrame(frame);window.removeEventListener('wheel',stop);window.removeEventListener('pointerdown',stop);};
 },[route,ready]);
}
