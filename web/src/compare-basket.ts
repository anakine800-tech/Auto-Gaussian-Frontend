import {useSyncExternalStore} from 'react';

type Basket={ids:string[];message:string};
const baskets=new Map<string,Basket>();
const event='ag:compare-basket',limit=6;
const valid=(id:unknown):id is string=>typeof id==='string'&&Boolean(id)&&id!=='.'&&id!=='..'&&!/[\/\\\0]/.test(id);
function normalize(ids:unknown):string[]{return Array.isArray(ids)?[...new Set(ids.filter(valid))]:[];}
function read(study:string):Basket{
 if(!baskets.has(study)){
  let ids:string[]=[];try{ids=normalize(JSON.parse(sessionStorage.getItem('ag:cmp:'+study)??'[]'));}catch{/* Storage is optional. */}
  baskets.set(study,{ids:ids.slice(0,limit),message:''});
 }
 return baskets.get(study)!;
}
function save(study:string,basket:Basket){
 baskets.set(study,basket);
 try{sessionStorage.setItem('ag:cmp:'+study,JSON.stringify(basket.ids));}catch{/* URL remains usable. */}
 window.dispatchEvent(new Event(event));
}
function writeURL(ids:string[]){
 const [path,query='']=location.hash.split('?'),params=new URLSearchParams(query);
 params.set('cmp',ids.join(','));
 history.replaceState(history.state,'',location.pathname+location.search+path+'?'+params);
}
export function syncBasketURL(study:string){
 if(!study)return;
 const params=new URLSearchParams(location.hash.split('?')[1]??'');
 if(params.has('cmp')){
  const ids=normalize((params.get('cmp')??'').split(','));
  const basket={ids:ids.slice(0,limit),message:ids.length>limit?'比较篮最多 6 项；链接中超过上限的项未加入。':''};
  if(JSON.stringify(read(study))!==JSON.stringify(basket))save(study,basket);
  if(ids.length>limit)writeURL(basket.ids);
 }else if(read(study).ids.length)writeURL(read(study).ids);
}
export function setCompared(study:string,id:string,checked:boolean){
 const current=read(study);
 if(!valid(id))return;
 if(checked&&!current.ids.includes(id)&&current.ids.length>=limit){save(study,{...current,message:'比较篮最多 6 项，请先移除一项。'});return;}
 const ids=checked?normalize([...current.ids,id]):current.ids.filter(v=>v!==id);
 save(study,{ids,message:''});writeURL(ids);
 window.dispatchEvent(new Event('ag:location'));
}
export function clearBasket(study:string){save(study,{ids:[],message:''});writeURL([]);window.dispatchEvent(new Event('ag:location'));}
const subscribe=(notify:()=>void)=>{window.addEventListener(event,notify);return()=>window.removeEventListener(event,notify);};
export function useCompareBasket(study:string){return useSyncExternalStore(subscribe,()=>read(study));}
