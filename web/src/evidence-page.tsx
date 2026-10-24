import {useEffect,useState} from 'react';
import type {Study} from './api';
import {endpoint,get} from './api';
import {FileReader} from './file-view';
import {StudyMarkdown} from './results-panels';
import {StructureFiles} from './preview-panels';
import {PagedLog} from './study-panels';
import {LineageView,lineageObjects} from './lineage-view';
import type {EvidenceCatalog} from './quick-comparison';
import {routeHash,evidenceHash} from './routing';
import {ErrorNotice} from './ui';
import './ui/evidence.css';
export type EvidenceFile={path:string;type:string;size_bytes:number;updated_at:string;attempts:string[];objects:string[];referenced_by:({kind:'markdown';path:string}|{kind:'adoption';object:string;role:string})[]};
export type Evidence={files:EvidenceFile[];truncated:boolean;issues:{path:string;error:string}[];catalog:EvidenceCatalog};
function InputPreview({study,attempt,name}:{study:string;attempt:string;name:string}){
 const [value,setValue]=useState<{text:string;size_bytes:number}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setValue(null);setError('');get<{text:string;size_bytes:number}>(endpoint(study,'attempts',attempt,'inputs',name),c.signal).then(v=>{if(!c.signal.aborted)setValue(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,name]);
 return <section><h3>{name}</h3>{error?<ErrorNotice>{error}</ErrorNotice>:value?<><p>{value.size_bytes} B</p><pre>{value.text}</pre></>:<p role="status">读取输入文件…</p>}</section>;
}
const types=[['report','报告'],['table','表格'],['json','JSON'],['image','图片'],['html','HTML'],['structure','结构'],['review','审阅意见'],['signature','签字记录'],['input-log','输入与日志']];
export function EvidencePage({data,tab='library',selected,revision}:{data:Study;tab?:string;selected?:string;revision:number}){
 const [result,setResult]=useState<Evidence|null>(null),[error,setError]=useState(''),[kind,setKind]=useState(''),[related,setRelated]=useState(''),[page,setPage]=useState(0);
 useEffect(()=>{const c=new AbortController();setResult(null);setError('');get<Evidence>(endpoint(data.id,'evidence'),c.signal).then(v=>{if(!c.signal.aborted)setResult(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[data.id,revision]);
 const objects=lineageObjects(data,result?.catalog);
 const match=(f:EvidenceFile)=>{
  if(!related)return true;
  if(related.startsWith('object:')){const id=related.slice(7);return f.objects.includes(id)||objects.find(o=>o.id===id)?.members.some(id=>f.attempts.includes(id))===true;}
  return f.attempts.includes(related.slice(8));
 };
 const associated=result?.files.filter(match)??[],filtered=associated.filter(f=>!kind||f.type===kind),current=Math.min(page,Math.max(0,Math.ceil(filtered.length/60)-1)),rows=filtered.slice(current*60,(current+1)*60);
 const choose=(path:string)=>{location.hash=evidenceHash(data.id,'library',path);};
 const file=result?.files.find(f=>f.path===selected),structure=data.structure_files.find(f=>f.parts.join('/')===selected),parts=selected?.split('/')??[],isInput=parts.length===4&&parts[0]==='attempts'&&parts[2]==='inputs',isLog=parts.length===4&&parts[0]==='attempts'&&parts[2]==='outputs'&&/\.(log|out)$/i.test(parts[3]);
 return <article className="evidence-page">{error&&<ErrorNotice>{error}</ErrorNotice>}{result?.catalog.warning&&<ErrorNotice>{result.catalog.warning}</ErrorNotice>}
 {tab==='document'?<StudyMarkdown doc={data.study}/>:!result?<p role="status">读取证据文件索引…</p>:tab==='lineage'?<LineageView data={data} catalog={result.catalog}/>:<>
 {result.truncated&&<p role="status" className="notice">文件列表已截断：达到目录深度或条目数量上限。</p>}{result.issues.length>0&&<details><summary>读取提示（{result.issues.length}）</summary>{result.issues.map((i,n)=><p key={n}>{i.path}：{i.error}</p>)}</details>}
 <div className="evidence-layout"><aside className="evidence-facets" aria-label="文件类型"><h3>文件库</h3><button aria-pressed={!kind} onClick={()=>{setKind('');setPage(0);}}>全部（{associated.length}）</button>{types.map(([id,label])=><button key={id} aria-pressed={kind===id} onClick={()=>{setKind(id);setPage(0);}}>{label}（{associated.filter(f=>f.type===id).length}）</button>)}<label>关联对象 / Attempt <select aria-label="关联对象或 Attempt" value={related} onChange={e=>{setRelated(e.target.value);setPage(0);}}><option value="">全部关联</option><optgroup label="对象">{objects.map(o=><option key={o.id} value={'object:'+o.id}>{o.name}</option>)}</optgroup><optgroup label="Attempt">{data.attempts.map(a=><option key={a.id} value={'attempt:'+a.id}>{a.id}</option>)}</optgroup></select></label></aside>
 <section className="evidence-list"><h3>文件 · {filtered.length}</h3><p className="muted">每个文件只列一次。“被谁引用”仅统计 analyses Markdown 本地相对链接与采用记录的 report。</p><div className="table-scroll"><table aria-label="证据文件列表"><thead><tr>{['文件','类型','关联对象 / Attempt','被谁引用','更新时间','大小'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(f=><tr key={f.path} aria-selected={f.path===selected}><td><button className="evidence-file" onClick={()=>choose(f.path)}>{f.path}</button></td><td>{types.find(t=>t[0]===f.type)?.[1]??f.type}</td><td>{f.objects.map(id=>objects.find(o=>o.id===id)?.name??id).join('、')}{f.attempts.map(id=><a key={id} href={routeHash([data.id,id])}>{id}</a>)}</td><td>{f.referenced_by.length?f.referenced_by.map((r,i)=>r.kind==='markdown'?<button key={i} className="evidence-file" onClick={()=>choose(r.path)}>{r.path}</button>:<span key={i}>{objects.find(o=>o.id===r.object)?.name??r.object} · 采用 {r.role.toUpperCase()}</span>):'—'}</td><td><time dateTime={f.updated_at}>{new Date(f.updated_at).toLocaleString()}</time></td><td>{f.size_bytes.toLocaleString()} B</td></tr>)}</tbody></table></div><div className="evidence-pagination"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页文件</button><span>{current+1} / {Math.max(1,Math.ceil(filtered.length/60))}</span><button disabled={(current+1)*60>=filtered.length} onClick={()=>setPage(current+1)}>下一页文件</button></div></section>
 <aside className="evidence-preview" aria-label="文件预览">{selected?file?<><a href={evidenceHash(data.id,'library',selected)}>文件链接</a>{isInput?<InputPreview study={data.id} attempt={parts[1]} name={parts[3]}/>:isLog?<PagedLog key={selected} study={data.id} attempt={parts[1]} log={parts[3]}/>:structure?<StructureFiles study={data.id} files={[structure]} selected={structure.parts} onSelect={p=>choose(p.join('/'))} revision={revision}/>:<FileReader key={selected+revision} study={data.id} path={selected} data={data}/>}<p>不支持的格式保留文件元数据；读取与预览沿用现有接口边界。</p></>:<ErrorNotice>所选文件不存在、不可安全读取或未列入截断结果。</ErrorNotice>:<p>选择文件以查看正文或结构。</p>}</aside>
 </div></>}
 </article>;
}
