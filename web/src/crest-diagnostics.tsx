import {useEffect,useState} from 'react';
import {endpoint,get} from './api';
import type {CrestDiagnostics as Diagnostic,CrestExcerpt,CrestSource} from './api';

const states={identified:'错误证据',unresolved:'原因未明确',none:'未发现匹配错误',unavailable:'错误输出不可用'};
const messages:Record<string,string>={
 unavailable:'没有可用的结构化来源。',stale:'诊断记录已变化；请刷新页面后重新核对。',
 invalid_source:'来源记录格式无效，无法核对。',unsupported:'不支持的来源文件；仅允许固定 outputs 日志。',
 invalid_range:'来源行范围无效或超出文件，未展示命中证据。',empty:'日志为空，没有可展示的命中行。',
 missing:'来源文件缺失或尚未取回。',unreadable:'来源无法安全读取：权限、符号链接或文件类型不支持。',
 mismatch:'SHA-256 不符；当前文件不是原诊断的命中证据。',changed:'日志读取期间发生变化；未展示命中证据。',
 too_large:'日志超过 256 MiB 查看上限，完整文件仍保留在本地。',line_too_long:'日志单行超过 1 MiB 查看上限，完整文件仍保留在本地。',
};
function Source({study,attempt,token,source,onFull}:{study:string;attempt:string;token:string;source:CrestSource;onFull:(name:string)=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<CrestExcerpt|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');if(open&&!source.error)get<CrestExcerpt>(endpoint(study,'attempts',attempt,'crest-diagnostics',String(source.index))+'?'+new URLSearchParams({token}),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[open,study,attempt,token,source.index,source.error]);
 return <details className="crest-source" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>{source.file??`来源 ${source.index+1}`}{source.line_start!==undefined&&` · 第 ${source.line_start}–${source.line_end} 行`}</summary>
  {open&&<>
   {source.findings.map((finding,i)=><p key={i}>{({error:'错误证据',warning:'警告',info:'信息',unknown:'未识别'} as Record<string,string>)[finding.level]}：{finding.message}</p>)}
   {source.sha256&&<p className="crest-hash">记录 SHA-256：{source.sha256}</p>}
   {source.error?<p role="status">{messages[source.error]??'来源不可用。'}</p>:error?<p role="alert">片段读取失败：{error}</p>:!data?<p role="status">核对来源并读取片段…</p>:data.status!=='matched'?<p role="status">{messages[data.status]??'片段不可用。'}</p>:<>
    <p>来源匹配（完整文件 SHA-256）；{data.shown_lines?`片段 ${data.start!+1}–${data.start!+data.shown_lines!} 行`:'片段文本超过显示上限'}，共 {data.total_lines} 行。</p>
    {data.truncated&&<p role="status">片段已截断（最多 120 行 / 64 KiB）；请查看完整日志。</p>}
    <pre aria-label="诊断来源片段">{data.text?data.text.split(/(?<=\n)/).map((line,i)=><span key={i} className={data.start!+i+1>=source.line_start!&&data.start!+i+1<=source.line_end!?'crest-hit':undefined}><span className="crest-line">{data.start!+i+1} </span>{line}</span>):'片段达到显示上限，未返回文本。'}</pre>
   </>}
   {source.file&&!source.error&&<button onClick={()=>onFull(source.file!)}>查看完整日志 · {source.file}</button>}
  </>}
 </details>;
}

export function CrestDiagnostics({study,attempt,diagnostic,onFull}:{study:string;attempt:string;diagnostic:Diagnostic|null|undefined;onFull:(name:string)=>void}){
 return <section className="crest-diagnostics" aria-label="CREST 诊断">
  <h3>CREST 诊断</h3>
  {!diagnostic?<p>没有结构化来源；保留原 error_hint（如有）。可查看已有本地日志。</p>:!diagnostic.available?<p role="status">{diagnostic.error}</p>:<>
   <p className="crest-state">{states[diagnostic.status]}</p><p>{diagnostic.summary}</p>
   <p className="crest-note">诊断状态、解析完成或 facts 存在都不代表计算成功；错误证据不能证明根因。</p>
   {diagnostic.parse_status==='incomplete'&&<p>解析未完成：{diagnostic.parse_error??'详见原 facts。'}</p>}
   {diagnostic.summary_truncated&&<p>摘要已截断。</p>}
   {diagnostic.scan_truncated&&<p>后端扫描跳过了超长行，诊断可能不完整。</p>}
   <details><summary>查看诊断来源（{diagnostic.sources.length}）</summary>
    <p className="crest-note">展开单个来源后才核对本地文件并读取片段。完整日志显示当前本地文本，不自动作为原诊断证据。</p>
    {diagnostic.sources.map(source=><Source key={diagnostic.token+':'+source.index} study={study} attempt={attempt} token={diagnostic.token} source={source} onFull={onFull}/>)}
    {!diagnostic.sources.length&&<p>没有可定位的命中行。</p>}
    {diagnostic.missing_sources.length>0&&<p>来源缺失／未取回：{diagnostic.missing_sources.join('、')}</p>}
    {diagnostic.files.filter(file=>file.error||!diagnostic.sources.some(s=>s.file===file.file)).map((file,i)=><div key={i} className="crest-file">{file.error?<p>{messages[file.error]}</p>:<><p>记录：{file.file} · {file.size===0?'空文件':`${file.size} 字节`}{!diagnostic.sources.some(s=>s.file===file.file)&&' · 没有命中行范围'}</p><button onClick={()=>onFull(file.file!)}>查看完整日志 · {file.file}</button></>}</div>)}
   </details>
  </>}
 </section>;
}
