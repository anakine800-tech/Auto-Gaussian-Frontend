export type AttemptFile={kind:'inputs'|'logs'|'record';name:string};
export type Route={study:string;file?:string;view?:'overview'|'attempts'|'analysis'|'files';fileTab?:string;server?:boolean;attempt?:string;attemptFile?:AttemptFile;structure?:string[];report?:string;ensemble?:string[];irc?:string[];direction?:'forward'|'reverse';point?:number;candidate?:number;error?:string};
const hash=(parts:string[])=>'#/'+parts.map(encodeURIComponent).join('/');
// Existing page links keep their object identity while adopting the new shell.
export function routeHash(parts:string[]):string{
 if(!parts.length)return '#/';
 const [study,kind,...rest]=parts;
 if(!kind)return hash(['s',study]);
 if(kind==='ensembles'||kind==='irc-reviews')return hash(['s',study,'analysis',kind==='ensembles'?'ensemble':'irc',...rest]);
 if(kind==='analyses'&&!rest.at(-1)?.endsWith('.xyz'))return hash(['s',study,'analysis','file',...rest]);
 if(kind==='structures'||kind==='analyses')return hash(['s',study,'files',kind,...rest]);
 return hash(['s',study,'a',kind]);
}
export const studyHash=(study:string,...parts:string[])=>hash(['s',study,...parts]);
export function readRoute():Route{
 const original=window.location.hash;
 if(!original||original==='#/')return {study:''};
 try{
  const cut=original.indexOf('?'),path=cut<0?original:original.slice(0,cut),query=cut<0?'':original.slice(cut);
  if(path==='#server'){window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+'#/jobs'+query);return {study:'',server:true};}
  if(!path.startsWith('#/'))throw Error();
  const parts=path.slice(2).split('/').map(decodeURIComponent);
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\/\\\0]/.test(p)))throw Error();
  if(parts.length===1&&parts[0]==='jobs')return {study:'',server:true};
  // T118 file viewer uses the existing document host; all old branches stay intact.
  if(parts.length>=3&&parts[1]==='file')return {study:parts[0],view:'files',fileTab:'document',file:parts.slice(2).join('/')};
  if(parts[0]!=='s'){
   const valid=parts.length<=2||(['ensembles','irc-reviews','analyses'].includes(parts[1])&&[3,4].includes(parts.length))||(parts[1]==='structures'&&parts.length===4);
   if(!valid)throw Error();
   const tab=new URLSearchParams(query||window.location.search).get('tab');
   const tabs:Record<string,string[]>={results:[],overview:['files','document'],attempts:['attempts'],graph:['files','graph'],structures:['files','structures'],analyses:['analysis'],ensembles:['analysis'],'irc-reviews':['analysis']};
   const target=parts.length===1&&tab&&Object.hasOwn(tabs,tab)?studyHash(parts[0],...tabs[tab]):routeHash(parts);
   window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+target+query);
   return readRoute();
  }
  const [,study,section,...rest]=parts;
  if(!study)throw Error();
  if(!section)return {study,view:'overview'};
  if(section==='attempts'&&!rest.length)return {study,view:'attempts'};
  if(section==='a'&&rest.length===1){
   const params=new URLSearchParams(query),kind=params.get('fileKind'),name=params.get('file');
   if(kind===null&&name===null)return {study,view:'attempts',attempt:rest[0]};
   if(params.getAll('fileKind').length!==1||params.getAll('file').length!==1||!['inputs','logs','record'].includes(kind??'')||!name||name==='.'||name==='..'||/[\/\\\0]/.test(name))throw Error();
   if(kind==='record'&&!['manifest.json','status.json','facts.json','review.md','final.xyz'].includes(name))throw Error();
   return {study,view:'attempts',attempt:rest[0],attemptFile:{kind:kind as AttemptFile['kind'],name}};
  }
  if(section==='analysis'){
   if(!rest.length)return {study,view:'analysis'};
   const fixedTS=rest.length===4&&rest[0]==='ts'&&rest[1]==='ts-labels'&&['labels.json','labels.md','channel-suggestions.csv'].includes(rest[3]);
   if(![2,3].includes(rest.length)&&!fixedTS)throw Error();
   const params=new URLSearchParams(query);
   if(rest[0]==='ensemble'){
    const id=params.get('candidate');
    if(params.getAll('candidate').length>1||id!==null&&(!/^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id))))throw Error();
    return {study,view:'analysis',ensemble:rest.slice(1),candidate:id===null?undefined:Number(id)};
   }
   if(rest[0]==='irc'){
    const direction=params.get('direction'),point=params.get('point');
    if(params.getAll('direction').length>1||params.getAll('point').length>1||direction!==null&&!['forward','reverse'].includes(direction)||point!==null&&(!/^(0|[1-9][0-9]*)$/.test(point)||!Number.isSafeInteger(Number(point))))throw Error();
    return {study,view:'analysis',irc:rest.slice(1),direction:(direction??'forward') as 'forward'|'reverse',point:point===null?0:Number(point)};
   }
   return {study,view:'analysis',report:rest.slice(1).join('/')};
  }
  if(section==='files'){
   if(!rest.length)return {study,view:'files',fileTab:'document'};
   if(rest.length===1&&['document','graph','structures','analyses'].includes(rest[0]))return {study,view:'files',fileTab:rest[0]};
   if(rest[0]==='structures'&&rest.length===3||rest[0]==='analyses'&&[2,3].includes(rest.length))return rest[0]==='analyses'&&!rest.at(-1)?.endsWith('.xyz')?{study,view:'files',fileTab:'analyses',report:rest.slice(1).join('/')}:{study,view:'files',fileTab:rest[0],structure:rest};
  }
 }catch{/* Invalid URLs remain visible as an error, not a file request. */}
 return {study:'',error:'无法打开链接：Study / Attempt / 结构文件路径格式不正确。'};
}
