import {useEffect,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {Document,Study} from './api';
import {display,endpoint,get,object} from './api';
import {analysisLink} from './analysis-summary';
import {CSVView,DataTableView,MarkdownTable,cellText} from './data-table-view';
import {JSONView} from './json-view';
import {MoleculeViewer} from './molecule-viewer';
import {routeHash,studyHash} from './routing';
import {ErrorNotice,StatusBadge} from './ui';
import './ui/report.css';

export const fileHash=(study:string,path:string)=>'#/'+[study,'file',...path.split('/')].map(encodeURIComponent).join('/');
export const fileURL=(study:string,path:string)=>endpoint(study,'files',...path.split('/'));
export function useReportStudy(study:string){
 const [data,setData]=useState<Study|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');if(study)get<Study>(endpoint(study),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study]);
 return {data,error};
}
type LocalTarget={path?:string;anchor?:string;external?:string;reason?:string};
export function localTarget(url:string,documentPath:string):LocalTarget{
 if(/^https?:\/\//i.test(url)){try{const parsed=new URL(url);if(['https:','http:'].includes(parsed.protocol))return {external:parsed.href};}catch{/* Invalid URL. */}return {reason:'链接地址无效'};}
 if(url.startsWith('#'))return {anchor:url.slice(1)};
 if(/^[a-z][a-z\d+.-]*:/i.test(url)||url.startsWith('/')||url.includes('\\')||/[\u0000-\u001f\u007f]/.test(url))return {reason:'不支持此协议或绝对路径'};
 const encoded=url.split(/[?#]/,1)[0];let path:string;
 try{path=decodeURIComponent(encoded);}catch{return {reason:'路径编码无效'};}
 if(path.startsWith('/')||path.includes('\\')||/^[a-z][a-z\d+.-]*:/i.test(path)||/[\u0000-\u001f\u007f]/.test(path))return {reason:'不支持此协议或绝对路径'};
 const parts=documentPath.split('/').slice(0,-1);
 for(const part of path.split('/')){if(part===''||part==='.')continue;if(part==='..'){if(!parts.length)return {reason:'链接越出本 study'};parts.pop();}else parts.push(part);}
 return parts.length?{path:parts.join('/')}:{reason:'链接没有指向文件'};
}
export function localHref(study:string,path:string,data:Study|null){
 const parts=path.split('/');
 if(parts[0]==='attempts'&&data?.attempts.some(a=>a.id===parts[1])){
  if(parts.length===2)return routeHash([study,parts[1]]);
  if(parts.length===3&&['manifest.json','status.json','facts.json','review.md','final.xyz'].includes(parts[2]))return routeHash([study,parts[1]])+'?'+new URLSearchParams({fileKind:'record',file:parts[2]});
 }
 if(data?.structure_files.some(file=>file.parts.join('/')===path))return routeHash([study,...parts]);
 if(parts[0]==='analyses'){
  const report=data?.analyses.find(report=>report.name===parts.slice(1).join('/'));
  if(report)return analysisLink(study,report.name,report.schema);
 }
 if(path==='study.md')return studyHash(study,'files','document');
 return fileHash(study,path);
}
export function ReportImage({study,path,alt}:{study:string;path:string;alt:string}){
 const [failed,setFailed]=useState(false),[reason,setReason]=useState('正在读取失败原因…');
 useEffect(()=>{
  const controller=new AbortController();
  if(failed)fetch(fileURL(study,path),{signal:controller.signal,cache:'no-store'}).then(response=>{
   if(!controller.signal.aborted)setReason(({404:'文件不存在',403:'路径不安全或文件不可读',413:'超过图片大小上限',400:'不支持的文件类型'} as Record<number,string>)[response.status]??(response.ok?'图片内容无效或浏览器无法解码':`读取失败 (${response.status})`));
  }).catch(()=>{if(!controller.signal.aborted)setReason('无法连接本地文件接口');});
  return()=>controller.abort();
 },[failed,study,path]);
 return failed?<span role="status">{alt||'图片'}（无法加载：{reason}）</span>:<img className="report-image" src={fileURL(study,path)} alt={alt} loading="lazy" onError={()=>setFailed(true)}/>;
}
const anchor=(text:string)=>text.trim().toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/\s+/g,'-');
export function MarkdownReport({text,study,path,data}:{text:string;study:string;path:string;data:Study|null}){
 const headingPrefix=path==='study.md'?'study-md-':'report-md-';
 return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url=>url} components={{
  table:({children})=><MarkdownTable>{children}</MarkdownTable>,
  a:({href='',children})=>{const target=localTarget(href,path);
   if(target.external)return <a href={target.external} target="_blank" rel="noopener noreferrer">{children}</a>;
   if(target.anchor!==undefined)return <a href={'#'+target.anchor} onClick={e=>{e.preventDefault();let id=target.anchor!;try{id=decodeURIComponent(id);}catch{/* Literal fragment. */}document.getElementById(headingPrefix+id)?.scrollIntoView();}}>{children}</a>;
   return target.path?<a href={localHref(study,target.path,data)}>{children}</a>:<span title={target.reason}>{children}</span>;
  },
  img:({src='',alt=''})=>{const target=localTarget(src,path);return target.path?<ReportImage key={target.path} study={study} path={target.path} alt={alt}/>:<span title={target.reason??'只显示本 study 内的相对图片'}>{alt}（图片未加载：{target.reason??'只显示本 study 内的相对图片'}）</span>;},
  h1:({children})=><h1 id={headingPrefix+anchor(cellText(children))}>{children}</h1>,
  h2:({children})=><h2 id={headingPrefix+anchor(cellText(children))}>{children}</h2>,
  h3:({children})=><h3 id={headingPrefix+anchor(cellText(children))}>{children}</h3>,
  h4:({children})=><h4 id={headingPrefix+anchor(cellText(children))}>{children}</h4>,
  h5:({children})=><h5 id={headingPrefix+anchor(cellText(children))}>{children}</h5>,
  h6:({children})=><h6 id={headingPrefix+anchor(cellText(children))}>{children}</h6>,
 }}>{text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'')}</ReactMarkdown></div>;
}
export function AttemptPreview({study,id}:{study:string;id:string|null}){
 const [source,setSource]=useState<{geometry:Document}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setSource(null);setError('');if(id)get<{geometry:Document}>(endpoint(study,'attempts',id,'comparison-structure'),c.signal).then(v=>{if(!c.signal.aborted)setSource(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,id]);
 return <aside className="report-preview" aria-label="报告结构预览"><h3>结构预览</h3>{id?<><a href={routeHash([study,id])}>打开 Attempt {id}</a>{error||source?.geometry.error?<ErrorNotice>{error||source?.geometry.error}</ErrorNotice>:source?<MoleculeViewer last={source.geometry.data} frameLabel={id}/>:<p role="status">读取结构…</p>}</>:<p className="muted">点击表格中的 Attempt 编号查看结构。</p>}</aside>;
}
export function SavedReport({doc,study,path,data}:{doc:Document;study:string;path:string;data:Study|null}){
 const value=object(doc.data)?doc.data:null,rows=value&&Array.isArray(value.rows)?value.rows:null;
 if(doc.error)return <ErrorNotice>{doc.error}</ErrorNotice>;
 if(value?.schema==='ag-thermo/1'&&rows)return <><p className="muted">只展示已保存的热化学结果；布居仅针对提供的构象集合。</p><div className="thermo-summary"><span>ensemble_G <strong>{display(value.ensemble_G)}</strong> Hartree</span><span>weighted_mean_G <strong>{display(value.weighted_mean_G)}</strong> Hartree</span></div><DataTableView label="热化学表" headers={['Attempt','简并度','E / Eh','ZPE / Eh','H / Eh','qh_H / Eh','qh_G / Eh','ΔG / kcal·mol⁻¹','布居']} rows={rows.filter(object).map(row=>[...['attempt_id','degeneracy','E','ZPE','H','qh_H','qh_G','relative_G_kcal'].map(k=>display(row[k])),typeof row.population==='number'?(row.population*100).toFixed(3)+'%':'—'])}/><details><summary>设置与完整结果</summary><pre>{JSON.stringify(value,null,2)}</pre></details></>;
 if(path.toLowerCase().endsWith('.json')){
  // Existing known schema reports retain their saved full-result view.
  if(value&&['ag-profile/1','ag-channel-coverage/1','ag-nci/1'].includes(String(value.schema))||/^analyses\/ts-labels\/[^/]+\/labels.json$/.test(path))return <pre>{JSON.stringify(doc.data,null,2)}</pre>;
  return <JSONView value={doc.data}/>;
 }
 if(path.toLowerCase().endsWith('.md'))return <MarkdownReport text={String(doc.data??'')} study={study} path={path} data={data}/>;
 if(path.toLowerCase().endsWith('.csv'))return <>{path.endsWith('/channel-suggestions.csv')&&<StatusBadge tone="warn">建议，待确认</StatusBadge>}<CSVView text={String(doc.data??'')}/></>;
 return <pre>{String(doc.data??'')}</pre>;
}
export function FileReader({study,path,data}:{study:string;path:string;data:Study|null}){
 const [doc,setDoc]=useState<Document|null>(null),[error,setError]=useState('');
 const suffix=path.split('.').at(-1)?.toLowerCase(),image=['png','jpg','jpeg','webp','svg'].includes(suffix??''),html=suffix==='html';
 useEffect(()=>{const c=new AbortController();setDoc(null);setError('');
  if(!image)get<Document>(fileURL(study,path)+'?document=true',c.signal).then(v=>{if(!c.signal.aborted)setDoc(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});
  return()=>c.abort();
 },[study,path,image]);
 return <article className="report-body" aria-label="报告正文"><h3>{path.startsWith('analyses/')?path.slice(9):path}</h3>{image?<ReportImage key={path} study={study} path={path} alt={path}/>:error?<ErrorNotice>{error}</ErrorNotice>:!doc?<p role="status">读取文件…</p>:doc.error?<ErrorNotice>{doc.error}</ErrorNotice>:html?<iframe title={path} src={fileURL(study,path)} sandbox="" className="report-html"/>:<SavedReport key={path} doc={doc} study={study} path={path} data={data}/>}</article>;
}
