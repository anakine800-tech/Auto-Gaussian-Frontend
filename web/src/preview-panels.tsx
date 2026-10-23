import {useEffect,useState} from 'react';
import {display,endpoint,get,object} from './api';
import type {Attempt,Document,StructureFile} from './api';
import {FrameViewer} from './frame-viewer';
import {isGeometry} from './molecule-viewer';
import {Collapsible,FactGrid} from './ui';

type InputFile={name:string;text:string;sha256:string;size_bytes:number;manifest_sha256:string|null;hash_matches:boolean|null};
type Diff={lines:string[];truncated:boolean;identical:boolean;parent_final_newline:boolean;input_final_newline:boolean};
export function InputSummary({input,manifest}:{input:Document;manifest:Document}){
 const data=object(input.data)?input.data:null,m=object(manifest.data)?manifest.data:{};
 return <section className="input-summary" aria-label="输入参数"><h3>输入参数 · 与确认摘要对照</h3>{data?<>
 <FactGrid facts={[['输入文件',data.name],['分子式',data.formula],['原子数',data.n_atoms],['电荷',data.charge],['多重度',data.multiplicity],['%nprocshared',data.nprocshared],['%mem',data.mem],['完整 route',data.route],['资源档位',m.tier],['档位核数',m.cores],['档位内存 / GB',m.mem_gb],['walltime',m.walltime]].map(([name,value])=>({label:String(name),value:display(value)}))}/>
 {!data.route&&<p>XYZ 的电荷/多重度由 manifest.template_params 提供；Gaussian route 与 Link0 不适用。</p>}
 <Collapsible page="attempt" block="input-hashes" title="输入哈希与提交摘要"><p>文件 SHA-256：<code>{display(data.sha256)}</code></p><p>manifest SHA-256：<code>{display(data.manifest_sha256)}</code></p><p>bundle SHA-256：<code>{display(m.bundle_sha256)}</code></p><p>远程相对目录：{display(m.remote_dir)}</p><pre>{JSON.stringify(m.science??m.template_params??{},null,2)}</pre></Collapsible>
 <p className={data.hash_matches===false?'notice':'muted'}>{data.hash_matches===true?'输入文件哈希与 manifest 一致。':data.hash_matches===false?'输入文件哈希与 manifest 不一致，请核对确认摘要。':'manifest 未记录可核对的输入哈希。'}</p></>:<p className="notice" role="status">{input.error??'无法预览：输入信息缺失'}</p>}</section>;
}
export function InputFiles({study,attempt,data,autoCompare=false,requestedName}:{requestedName?:string;study:string;attempt:string;data:Attempt;autoCompare?:boolean}){
 const [name,setName]=useState(requestedName??(autoCompare?data.input_files.find(f=>f.name.endsWith('.gjf')):null)?.name??data.input_files[0]?.name??''),[file,setFile]=useState<InputFile|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(requestedName)setName(requestedName);},[requestedName]);
 const manifest=object(data.manifest.data)?data.manifest.data:{};
 const parents=Array.isArray(manifest.parents)?manifest.parents.filter(object).map(p=>p.attempt_id).filter((p):p is string=>typeof p==='string'):[];
 const [compare,setCompare]=useState(autoCompare),[parent,setParent]=useState(parents[0]??''),[parentData,setParentData]=useState<Attempt|null>(null),[parentFile,setParentFile]=useState(''),[diff,setDiff]=useState<Diff|null>(null),[diffError,setDiffError]=useState('');
 useEffect(()=>{const c=new AbortController();setFile(null);setError('');if(name)get<InputFile>(endpoint(study,'attempts',attempt,'inputs',name),c.signal).then(v=>{if(!c.signal.aborted)setFile(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,name]);
 useEffect(()=>{const c=new AbortController();setParentData(null);setParentFile('');setDiff(null);setDiffError('');if(compare&&parent)get<Attempt>(endpoint(study,'attempts',parent),c.signal).then(v=>{if(!c.signal.aborted){setParentData(v);setParentFile(v.input_files.some(f=>f.name===name)?name:v.input_files[0]?.name??'');}}).catch(e=>{if(!c.signal.aborted)setDiffError(e.message);});return()=>c.abort();},[study,parent,compare,name]);
 useEffect(()=>{const c=new AbortController();setDiff(null);if(compare&&name&&parent&&parentFile){setDiffError('');const query=new URLSearchParams({parent,parent_file:parentFile});get<Diff>(endpoint(study,'attempts',attempt,'input-diff',name)+'?'+query,c.signal).then(v=>{if(!c.signal.aborted)setDiff(v);}).catch(e=>{if(!c.signal.aborted)setDiffError(e.message);});}return()=>c.abort();},[study,attempt,name,parent,parentFile,compare]);
 return <><section aria-label="输入文件"><h3>输入文件</h3>{data.input_files.length?<>
 <label>文件 <select aria-label="输入文件" value={name} onChange={e=>setName(e.target.value)}>{data.input_files.map(f=><option key={f.name} value={f.name}>{f.name}{f.error?' · 不可读':''}</option>)}</select></label>
 {error?<p role="alert">{error}</p>:file?<><p className="muted">{file.size_bytes} bytes · SHA-256 <code>{file.sha256}</code></p><pre data-testid="input-text">{file.text}</pre></>:<p role="status">读取输入文件…</p>}
 {parents.length>0&&<button onClick={()=>setCompare(v=>!v)} aria-expanded={compare}>与父 Attempt 输入对比</button>}
 {compare&&<div className="input-diff"><label>父 Attempt <select aria-label="父 Attempt" value={parent} onChange={e=>setParent(e.target.value)}>{parents.map((p,i)=><option key={i}>{p}</option>)}</select></label>
 {parentData&&<label>父输入文件 <select aria-label="父输入文件" value={parentFile} onChange={e=>setParentFile(e.target.value)}>{parentData.input_files.map(f=><option key={f.name}>{f.name}</option>)}</select></label>}
 {parentData?.input_files.length===0&&<p>父 Attempt 没有输入文件。</p>}
 {diffError?<p role="alert">{diffError}</p>:diff?<><p>{diff.identical?'文件字节完全一致。':'− 为父输入，+ 为当前输入。'}</p>{diff.parent_final_newline!==diff.input_final_newline&&<p>文件末尾换行不同：父输入 {String(diff.parent_final_newline)}，当前输入 {String(diff.input_final_newline)}。</p>}{diff.truncated&&<p className="notice">差异超过 2000 行，仅显示前 2000 行；输入全文仍可逐个查看。</p>}
 <pre data-testid="input-diff">{diff.lines.map((line,i)=><span className={line.startsWith('+')?'diff-added':line.startsWith('-')?'diff-removed':'diff-context'} key={i}>{line}{'\n'}</span>)}</pre></>:compare&&!parentData?<p>读取父 Attempt…</p>:null}</div>}
 </>:<p>暂无 inputs 文件。</p>}</section>{manifest.template==='crest'&&<CrestOutputs study={study} attempt={attempt}/>}</>;
}

type Frame={frame:number;frame_count:number;comment:string;geometry:unknown};
export function StructureFiles({study,files,selected,onSelect,revision}:{study:string;files:StructureFile[];selected:string[]|null;onSelect:(parts:string[])=>void;revision:number}){
 const location=selected?.join('/')??'';
 return <section aria-label="结构文件"><h2>结构与构象文件</h2><ul className="structure-list">{files.map(f=><li key={f.parts.join('/')}><a href={'#/'+[study,...f.parts].map(encodeURIComponent).join('/')} onClick={e=>{e.preventDefault();onSelect(f.parts);}}>{f.parts.join('/')}</a>{f.error&&<span className="notice">{f.error}</span>}</li>)}</ul>{files.length===0&&<p>structures 与 analyses 中暂无 XYZ 文件。</p>}
 {selected&&<><h3>{location}</h3><StructureFrames key={study+location+revision} study={study} parts={selected}/></>}
 </section>;
}
function StructureFrames({study,parts}:{study:string;parts:string[]}){
 const [frame,setFrame]=useState(0),[reference,setReference]=useState(0),[data,setData]=useState<Frame|null>(null),[ref,setRef]=useState<Frame|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const location=parts.join('/');
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');
  const read=(index:number)=>get<Frame>(endpoint(study,...parts)+`?frame=${index}`,c.signal);
  Promise.all([read(frame),reference===frame?Promise.resolve(null):read(reference)]).then(([value,target])=>{if(!c.signal.aborted){setData(value);setRef(target??value);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
 },[study,location,frame,reference]);
 return <div aria-busy={loading} className="structure-frames">
 <p role={error?'alert':'status'} className="frame-status">{error|| (loading?'读取 XYZ 帧…':'帧已读取')}</p>
 {data&&<><div className="frame-controls"><button disabled={frame===0||loading} onClick={()=>setFrame(f=>f-1)}>上一帧</button><label>帧号 <input aria-label="帧号" type="number" min={1} max={data.frame_count} value={frame+1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=data.frame_count)setFrame(n-1);}}/> / {data.frame_count}</label><button disabled={frame+1>=data.frame_count||loading} onClick={()=>setFrame(f=>f+1)}>下一帧</button></div>
 <p data-testid="frame-comment" className="frame-comment">{data.comment||'此帧无注释。'}</p>
 <FrameViewer geometry={error?null:data.geometry} reference={ref&&isGeometry(ref.geometry)?ref.geometry:null} onReference={setReference} frameCount={data.frame_count} frameLabel={`第 ${data.frame+1} 帧`}/></>}
 </div>;
}

// Reuse StructureFiles unchanged; this entry is rendered only for CREST Attempts.
function CrestOutputs({study,attempt}:{study:string;attempt:string}){
 const files=['crest_conformers.xyz','crest_best.xyz','crest_ensemble.xyz'].map(name=>({parts:['attempts',attempt,'crest-frames',name],error:null}));
 const [selected,setSelected]=useState<string[]|null>(null);
 return <section aria-label="CREST 输出"><h3>CREST 输出逐帧查看</h3><p className="muted">仅供显示，以 facts 和后端分析为准。缺失输出显示读取错误。</p><StructureFiles study={study} files={files} selected={selected} onSelect={setSelected} revision={0}/></section>;
}
