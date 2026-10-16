type Route={study:string;server?:boolean;attempt?:string;structure?:string[];ensemble?:string[];candidate?:number;error?:string};
export const routeHash=(parts:string[])=>'#/'+parts.map(encodeURIComponent).join('/');
export function readRoute():Route{
 if(!window.location.hash||window.location.hash==='#/')return {study:''};
 try{
  if(window.location.hash==='#server')return {study:'',server:true};
  if(!window.location.hash.startsWith('#/'))throw Error();
  const [path,query]=window.location.hash.slice(2).split('?');
  const parts=path.split('/').map(decodeURIComponent);
  if(query!==undefined&&parts[1]!=='ensembles')throw Error();
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\/\\\0]/.test(p)))throw Error();
  if((parts.length===3||parts.length===4)&&parts[1]==='ensembles'){
   const params=new URLSearchParams(query),id=params.get('candidate');
   if([...params.keys()].some(k=>k!=='candidate')||params.getAll('candidate').length>1||id!==null&&(!/^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id))))throw Error();
   return {study:parts[0],ensemble:parts.slice(2),candidate:id===null?undefined:Number(id)};
  }
  if(parts.length===1)return {study:parts[0]};
  if(parts.length===2)return {study:parts[0],attempt:parts[1]};
  if(parts.length===4&&['structures','analyses'].includes(parts[1])||parts.length===3&&parts[1]==='analyses')return {study:parts[0],structure:parts.slice(1)};
 }catch{/* Invalid URLs remain visible as an error, not a file request. */}
 return {study:'',error:'无法打开链接：Study / Attempt / 结构文件路径格式不正确。'};
}
