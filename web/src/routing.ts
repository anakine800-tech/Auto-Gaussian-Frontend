type Route={study:string;attempt?:string;structure?:string[];error?:string};
export const routeHash=(parts:string[])=>'#/'+parts.map(encodeURIComponent).join('/');
export function readRoute():Route{
 if(!window.location.hash||window.location.hash==='#/')return {study:''};
 try{
  if(!window.location.hash.startsWith('#/'))throw Error();
  const parts=window.location.hash.slice(2).split('/').map(decodeURIComponent);
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\/\\\0]/.test(p)))throw Error();
  if(parts.length===1)return {study:parts[0]};
  if(parts.length===2)return {study:parts[0],attempt:parts[1]};
  if(parts.length===4&&parts[1]==='structures'||parts.length===3&&parts[1]==='analyses')return {study:parts[0],structure:parts.slice(1)};
 }catch{/* Invalid URLs remain visible as an error, not a file request. */}
 return {study:'',error:'无法打开链接：Study / Attempt / 结构文件路径格式不正确。'};
}
