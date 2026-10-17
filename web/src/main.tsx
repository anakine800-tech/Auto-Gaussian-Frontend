import {useCallback,useEffect,useState} from 'react';
import {ActionOutput,AttemptActions,actionToken} from './actions';
import type {ActionResult} from './actions';
import {createRoot} from 'react-dom/client';
import {display,endpoint,get,object} from './api';
import {InputFiles,InputSummary,StructureFiles} from './preview-panels';
import {IRCPage,IRCReports} from './irc-panels';
import {EnsembleList,EnsemblePage} from './ensemble-panels';
import {routeHash,studyHash} from './routing';
import type {Attempt,Study} from './api';
import {ServerMonitor} from './server-monitor';
import {Results,StudyMarkdown,Optimization} from './results-panels';
import {Analyses,FileView,PagedLog,RelationshipGraph} from './study-panels';
import {ModeReviewViewer} from './mode-panels';
import type {ReviewModes} from './mode-panels';
import {Collapsible,EmptyState,ErrorNotice,StatusBadge,readPreference,savePreference,statusTone} from './ui';
import {GlobalSearch,indexAttempt} from './ui/search';
import type {AttemptIndex} from './ui/search';
import type {AttemptFile} from './routing';
import {goBackToList,locationChanged,returnLocation,useHistoryRoute,useScrollRestore} from './navigation';
import './ui/tokens.css';
import './style.css';
import './molecule-layout.css';
import './ui/shell.css';

type Modes=ReviewModes;
function AttemptView({study,id,revision,busy,onBusy,onResult,autoCompare,selectedFile,onLoaded}:{selectedFile?:AttemptFile;onLoaded:(study:string,data:Attempt)=>void;study:string;id:string;revision:number;busy:boolean;onBusy:(v:boolean)=>void;onResult:(r:ActionResult)=>void;autoCompare:boolean}){
 const [data,setData]=useState<Attempt|null>(null),[error,setError]=useState(''),[log,setLog]=useState(''),[modes,setModes]=useState<Modes|null>(null),[modeError,setModeError]=useState(''),[selected,setSelected]=useState<number|null>(null),[decode,setDecode]=useState(false),[geometrySource,setGeometrySource]=useState('input'),[attemptTab,setAttemptTab]=useState('details');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');setLog('');setModes(null);setSelected(null);setDecode(false);get<Attempt>(endpoint(study,'attempts',id),c.signal).then(v=>{if(!c.signal.aborted){setData(v);onLoaded(study,v);setLog(v.logs[0]??'');const state=object(v.status.data)?v.status.data.state:'';setGeometrySource(['prepared','submitting'].includes(String(state))||!v.geometry.data?'input':'final');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,id,revision]);
 useEffect(()=>{const c=new AbortController();setModes(null);setModeError('');setSelected(null);if(decode&&log)get<Modes>(endpoint(study,'attempts',id,'vibrations',log),c.signal).then(v=>{if(!c.signal.aborted)setModes(v);}).catch(e=>{if(!c.signal.aborted)setModeError(e.message);});return()=>c.abort();},[decode,log,study,id,revision]);
 useEffect(()=>{
  if(!data||!selectedFile)return;
  setAttemptTab('details');
  if(selectedFile.kind==='logs'){setLog(data.logs.includes(selectedFile.name)?selectedFile.name:'');setDecode(false);setSelected(null);}
  if(selectedFile.name==='final.xyz')setGeometrySource('final');
  const frame=requestAnimationFrame(()=>document.getElementById(selectedFile.kind==='inputs'?'attempt-inputs':selectedFile.kind==='logs'?'attempt-logs':selectedFile.name==='final.xyz'?'attempt-structure':`record-${selectedFile.name}`)?.scrollIntoView({block:'start'}));
  return()=>cancelAnimationFrame(frame);
 },[data,selectedFile?.kind,selectedFile?.name]);
 if(error)return <p role="alert">{error}</p>;if(!data)return <p role="status">读取 Attempt…</p>;
 const vibration=selected!==null?modes?.modes[selected]:undefined;
 return <section className="attempt-detail"><h2>{id}</h2><p>所属集群：{display(object(data.manifest.data)?data.manifest.data.cluster??'default':null)}</p><nav aria-label="Attempt 内容"><button aria-current={attemptTab==='details'?'page':undefined} onClick={()=>setAttemptTab('details')}>Attempt 详情</button><button aria-current={attemptTab==='optimization'?'page':undefined} onClick={()=>setAttemptTab('optimization')}>优化过程</button></nav>{attemptTab==='optimization'?<>{data.logs.length?<><label>优化日志 <select aria-label="优化日志" value={log} onChange={e=>setLog(e.target.value)}>{data.logs.map(l=><option key={l}>{l}</option>)}</select></label>{log&&<Optimization key={log+revision} study={study} attempt={id} log={log} revision={revision}/>}</>:<p>尚无 outputs 日志。</p>}</>:<><div id="attempt-structure" className="structure-preview">
 <div><label>预览结构 <select aria-label="预览结构" value={geometrySource} onChange={e=>{setGeometrySource(e.target.value);setSelected(null);}}><option value="input">输入结构</option><option value="final" disabled={!data.geometry.data}>最终结构 · final.xyz</option></select></label>
 <ModeReviewViewer study={study} attempt={id} log={log} packet={modes} revision={revision} key={vibration?'vibration':geometrySource} last={vibration?modes?.reference_geometry:geometrySource==='input'?data.input_geometry.data:data.geometry.data} frameLabel={vibration?'Gaussian 振动参考坐标':geometrySource==='input'?'输入结构':'最终结构 · final.xyz'} vibration={vibration} onClearVibration={()=>setSelected(null)}/>
 {geometrySource==='input'&&data.input_geometry.error&&<p className="notice">{data.input_geometry.error}</p>}
 {geometrySource==='final'&&data.geometry.error&&<p className="notice">final.xyz：{data.geometry.error}</p>}</div>
 <InputSummary input={data.input_geometry} manifest={data.manifest}/></div>
 {actionToken&&<AttemptActions study={study} data={data} revision={revision} busy={busy} onBusy={onBusy} onResult={onResult}/>}
 <div id="attempt-inputs"><InputFiles requestedName={selectedFile?.kind==='inputs'?selectedFile.name:undefined} study={study} attempt={id} data={data} autoCompare={autoCompare}/></div>
 <details open={selectedFile?.kind==='record'&&['manifest.json','status.json'].includes(selectedFile.name)?true:undefined}><summary>manifest.json 与 status.json</summary><div className="columns"><FileView title="status.json" doc={data.status}/><FileView title="manifest.json" doc={data.manifest}/></div></details>
 <section id="attempt-logs"><h3>Gaussian 振动与日志</h3><p className="muted">振动使用所选日志中的 Standard orientation 与原始打印位移。显示动画不代表过渡态验收。</p>{data.logs.length?<>
 <label>输出日志 <select aria-label="输出日志" value={log} onChange={e=>{setLog(e.target.value);setDecode(false);setSelected(null);}}>{data.logs.map(l=><option key={l}>{l}</option>)}</select></label>
 <button onClick={()=>setDecode(true)} disabled={decode}>解析振动位移</button>
 {modeError&&<p role="status" className="notice">{modeError}</p>}{decode&&!modes&&!modeError&&<p role="status">解析振动…</p>}
 {modes&&<label>振动模式 <select aria-label="振动模式" value={selected??''} onChange={e=>setSelected(e.target.value===''?null:Number(e.target.value))}><option value="">返回所选结构</option>{modes.modes.map((m,i)=><option key={i} value={i}>模式 {m.mode_number} · {m.frequency_cm1} cm⁻¹</option>)}</select></label>}
 {selectedFile?.kind==='logs'&&!data.logs.includes(selectedFile.name)&&<ErrorNotice>指定日志不存在：{selectedFile.name}</ErrorNotice>}{log&&<PagedLog key={log+revision} study={study} attempt={id} log={log}/>}</>:<p>尚无 outputs 日志。</p>}</section>
 <FileView title="facts.json" doc={data.facts}/><FileView title="review.md" doc={data.review}/>{data.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}</>}</section>;
}
function App(){
 const [busy,setBusy]=useState(false),[actionResult,setActionResult]=useState<ActionResult|null>(null);
 const route=useHistoryRoute();
 const [revision,setRevision]=useState(0),[attemptIndex,setAttemptIndex]=useState<Record<string,AttemptIndex>>({});
 const onLoaded=useCallback((study:string,data:Attempt)=>setAttemptIndex(old=>({...old,[JSON.stringify([study,data.id])]:indexAttempt(study,data)})),[]);
 const [list,setList]=useState<{studies:{id:string;title:string}[];issues:{path:string;error:string}[]}|null>(null);
 const [data,setData]=useState<Study|null>(null),[cache,setCache]=useState<Record<string,Study>>({}),[error,setError]=useState('');
 const recent=readPreference('last-study','');
 const study=route.study||list?.studies.find(s=>s.id===recent)?.id||list?.studies[0]?.id||'',view=route.view??'overview';

 useEffect(()=>{
  if(route.error)return;
  const c=new AbortController();setError('');
  get<NonNullable<typeof list>>('/api/studies',c.signal).then(v=>{if(c.signal.aborted)return;setList(v);
   if(!route.study&&!route.server){const recent=readPreference('last-study','');const id=v.studies.find(s=>s.id===recent)?.id??v.studies[0]?.id;
    if(id){window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+studyHash(id));locationChanged();}}
  }).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 },[revision,route.server,route.study,route.error]);
 useEffect(()=>{
  if(route.server||route.error||!route.study)return;
  const c=new AbortController();setData(null);setError('');
  get<Study>(endpoint(route.study),c.signal).then(v=>{if(!c.signal.aborted){setData(v);setCache(old=>({...old,[v.id]:v}));savePreference('last-study',v.id);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 },[route.study,revision,route.server,route.error]);
 useScrollRestore(route,Boolean(route.server||route.error||error||data?.id===route.study));
 const navigate=(hash:string)=>{window.location.hash=hash;};
 const choose=(id:string)=>navigate(routeHash([study,id]));
 const completed=(result:ActionResult)=>{setActionResult(result);setRevision(r=>r+1);if(result.new_attempt)choose(result.new_attempt);};
 const top=route.server?'jobs':view==='analysis'?'analysis':view==='files'?'files':'study';
 const title=list?.studies.find(s=>s.id===study)?.title??study;
 const attempt=route.attempt??(view==='attempts'?data?.attempts[0]?.id:undefined);
 const fileTab=route.fileTab??'document';
 const detail=route.attempt??route.ensemble?.join('/')??route.irc?.join('/')??route.structure?.join('/')??route.report;
 const back=route.attempt?studyHash(study,'attempts'):view==='analysis'?studyHash(study,'analysis'):studyHash(study,'files',fileTab);
 return <><header className="app-header">
 <a className="brand" href={study?studyHash(study):'#/'}><span className="brand-mark" aria-hidden="true">Ag</span><h1>Auto-Gaussian</h1></a>
 <nav aria-label="顶部导航">{[['jobs','作业'],['study','Study'],['analysis','分析'],['files','文件']].map(([id,label])=><button key={id} aria-current={top===id?'page':undefined} disabled={id!=='jobs'&&!study} onClick={()=>navigate(id==='jobs'?'#/jobs':studyHash(study,...(id==='analysis'?['analysis']:id==='files'?['files']:[])))}>{label}</button>)}</nav>
 <GlobalSearch studies={Object.values(cache)} attempts={Object.values(attemptIndex)}/><StatusBadge>{actionToken?'可操作（经 ag）':'只读'}</StatusBadge><button className="refresh" onClick={()=>setRevision(r=>r+1)}>刷新</button>
 </header>
 <div className="context-bar"><div><span className="context-label">{route.server?'WORKSPACE':'STUDY'}</span>{route.server?<strong>作业 / 本地监控快照</strong>:<><a href={study?studyHash(study):'#/'}>{title||'选择 Study'}</a>{detail&&<><span className="context-divider">/</span><strong>{detail}</strong></>}</>}</div>{detail&&<a className="back-link" href={returnLocation(back).href} onClick={e=>{e.preventDefault();goBackToList(back);}}>← 返回列表</a>}</div>
 {route.server?<main className="server-page"><ServerMonitor revision={revision}/></main>:<div className="workspace"><aside className="study-sidebar"><Collapsible page="shell" block="studies" title="Study 列表" defaultOpen>
 {list?.studies.map(s=><button className={study===s.id?'active':''} key={s.id} onClick={()=>navigate(studyHash(s.id))}><strong>{s.title}</strong><small>{s.id}</small></button>)}
 {list?.studies.length===0&&<EmptyState>目录中没有可读的 study.md。</EmptyState>}{list?.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}
 </Collapsible><p className="sidebar-note">本机研究目录<br/>状态与数值需结合证据审阅</p></aside><main>
 {route.error&&<ErrorNotice>{route.error}</ErrorNotice>}{error&&<ErrorNotice>{error}</ErrorNotice>}{study&&!data&&!error&&!route.error&&<p role="status">读取 Study…</p>}
 {data&&!route.error&&<><div className="study-heading"><div><span className="eyebrow">{top==='study'?'STUDY WORKSPACE':top==='analysis'?'ANALYSIS LIBRARY':'STUDY FILES'}</span><h2>{top==='study'?data.id:top==='analysis'?'分析报告':'研究文件'}</h2></div><StatusBadge>{data.attempts.length} Attempts</StatusBadge></div>
 {top==='study'&&<nav className="section-nav" aria-label="Study 内容"><button aria-current={view==='overview'?'page':undefined} onClick={()=>navigate(studyHash(study))}>概览</button><button aria-current={view==='attempts'?'page':undefined} onClick={()=>navigate(studyHash(study,'attempts'))}>Attempts</button></nav>}
 {top==='files'&&<nav className="section-nav" aria-label="文件内容">{[['document','研究说明'],['structures','结构文件'],['graph','关系图'],['analyses','其他分析文件']].map(([id,label])=><button key={id} aria-current={fileTab===id?'page':undefined} onClick={()=>navigate(studyHash(study,'files',id))}>{label}</button>)}</nav>}
 {data.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}
 {view==='overview'&&<><Results key={study} data={data} onSelect={choose} revision={revision}/><IRCReports study={study} revision={revision}/></>}
 {view==='analysis'&&(route.irc?<IRCPage key={study+route.irc.join('/')} study={study} parts={route.irc} direction={route.direction??'forward'} point={route.point??0} revision={revision}/>:route.ensemble?<EnsemblePage study={study} parts={route.ensemble} candidate={route.candidate} revision={revision}/>:route.report?data.analyses.some(a=>a.name===route.report)?<Analyses analyses={data.analyses.filter(a=>a.name===route.report)}/>:<ErrorNotice>报告文件不存在：{route.report}</ErrorNotice>:<><EnsembleList study={study} revision={revision}/><IRCReports study={study} revision={revision}/><Analyses analyses={data.analyses}/></>)}
 {view==='attempts'&&<><div className="table-scroll"><table aria-label="Attempt 状态列表"><thead><tr><th>Attempt</th><th>标签</th><th>程序</th><th>状态</th><th>读取问题</th></tr></thead><tbody>{data.attempts.map(a=><tr key={a.id} className={attempt===a.id?'selected':''}><td><button onClick={()=>choose(a.id)}>{a.id}</button></td><td>{a.label??'—'}</td><td>{a.template??'—'}</td><td><StatusBadge tone={statusTone(a.state)}>{a.state}</StatusBadge></td><td>{[a.manifest.error,a.status.error].filter(Boolean).join(' · ')||'—'}</td></tr>)}</tbody></table></div>{attempt?<AttemptView key={study+attempt} study={study} id={attempt} revision={revision} busy={busy} onBusy={setBusy} onResult={completed} autoCompare={actionResult?.new_attempt===attempt} selectedFile={route.attemptFile} onLoaded={onLoaded}/>:<EmptyState>尚无 Attempt。</EmptyState>}</>}
 {view==='files'&&(route.report?(data.analyses.some(a=>a.name===route.report)?<Analyses analyses={data.analyses.filter(a=>a.name===route.report)}/>:<ErrorNotice>找不到分析文件：{route.report}</ErrorNotice>):fileTab==='document'?<StudyMarkdown doc={data.study}/>:fileTab==='graph'?<RelationshipGraph graph={data.graph} onSelect={choose}/>:fileTab==='structures'||route.structure?<StructureFiles study={study} files={data.structure_files} selected={route.structure??null} onSelect={parts=>navigate(routeHash([study,...parts]))} revision={revision}/>:<Analyses analyses={data.analyses}/>)}
 </>}
 </main></div>}
 <ActionOutput result={actionResult}/><footer>{actionToken?'study.md 中的计划和结论仍由 Codex 更新。':'Study 文件保持原样。'}状态与解析数字不自动构成科学结论。</footer></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
