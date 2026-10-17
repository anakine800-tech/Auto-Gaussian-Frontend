import {useCallback,useEffect,useState} from 'react';
import {ActionOutput,actionToken} from './actions';
import type {ActionResult} from './actions';
import {createRoot} from 'react-dom/client';
import {endpoint,get} from './api';
import {StructureFiles} from './preview-panels';
import {IRCPage,IRCReports} from './irc-panels';
import {EnsembleList,EnsemblePage} from './ensemble-panels';
import {routeHash,studyHash} from './routing';
import type {Attempt,Study} from './api';
import {ServerMonitor} from './server-monitor';
import {StudyMarkdown} from './results-panels';
import {Analyses,RelationshipGraph} from './study-panels';
import {AttemptView} from './attempt-view';
import {Collapsible,EmptyState,ErrorNotice,StatusBadge,readPreference,savePreference} from './ui';
import {GlobalSearch,indexAttempt} from './ui/search';
import type {AttemptIndex} from './ui/search';
import {goBackToList,locationChanged,returnLocation,useHistoryRoute,useScrollRestore} from './navigation';
import './ui/tokens.css';
import './style.css';
import './molecule-layout.css';
import './ui/shell.css';
import './ui/overview.css';
import './ui/attempt.css';
import {StudyOverview} from './overview';
import {AttemptTable} from './attempt-table';

function App(){
 useEffect(()=>{const bars=['.app-header','.context-bar'].map(s=>document.querySelector<HTMLElement>(s));const observer=new ResizeObserver(()=>bars.forEach((bar,i)=>{if(bar)document.documentElement.style.setProperty(i?'--context-height':'--header-height',`${bar.getBoundingClientRect().height}px`);}));bars.forEach(bar=>bar&&observer.observe(bar));return()=>observer.disconnect();},[]);
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
 const attempt=route.attempt;
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
 {data&&!route.error&&<>{!attempt&&<div className="study-heading"><div><span className="eyebrow">{top==='study'?'STUDY WORKSPACE':top==='analysis'?'ANALYSIS LIBRARY':'STUDY FILES'}</span><h2>{top==='study'?data.id:top==='analysis'?'分析报告':'研究文件'}</h2></div><StatusBadge>{data.attempts.length} Attempts</StatusBadge></div>}
 {top==='study'&&<nav className="section-nav" aria-label="Study 内容"><button aria-current={view==='overview'?'page':undefined} onClick={()=>navigate(studyHash(study))}>概览</button><button aria-current={view==='attempts'?'page':undefined} onClick={()=>navigate(studyHash(study,'attempts'))}>Attempts</button></nav>}
 {top==='files'&&<nav className="section-nav" aria-label="文件内容">{[['document','研究说明'],['structures','结构文件'],['graph','关系图'],['analyses','其他分析文件']].map(([id,label])=><button key={id} aria-current={fileTab===id?'page':undefined} onClick={()=>navigate(studyHash(study,'files',id))}>{label}</button>)}</nav>}
 {data.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}
 {view==='overview'&&<StudyOverview key={study} data={data}/>}
 {view==='analysis'&&(route.irc?<IRCPage key={study+route.irc.join('/')} study={study} parts={route.irc} direction={route.direction??'forward'} point={route.point??0} revision={revision}/>:route.ensemble?<EnsemblePage study={study} parts={route.ensemble} candidate={route.candidate} revision={revision}/>:route.report?data.analyses.some(a=>a.name===route.report)?<Analyses study={study} analyses={data.analyses.filter(a=>a.name===route.report)} selected/>:<ErrorNotice>报告文件不存在：{route.report}</ErrorNotice>:<><EnsembleList study={study} revision={revision}/><IRCReports study={study} revision={revision}/><Analyses study={study} analyses={data.analyses}/></>)}
 {view==='attempts'&&(attempt?<AttemptView key={study+attempt} study={study} id={attempt} revision={revision} busy={busy} onBusy={setBusy} onResult={completed} autoCompare={actionResult?.new_attempt===attempt} selectedFile={route.attemptFile} onLoaded={onLoaded}/>:<AttemptTable key={study} data={data}/>)}
 {view==='files'&&(route.report?(data.analyses.some(a=>a.name===route.report)?<Analyses study={study} analyses={data.analyses.filter(a=>a.name===route.report)} selected/>:<ErrorNotice>找不到分析文件：{route.report}</ErrorNotice>):fileTab==='document'?<StudyMarkdown doc={data.study}/>:fileTab==='graph'?<RelationshipGraph graph={data.graph} onSelect={choose}/>:fileTab==='structures'||route.structure?<StructureFiles study={study} files={data.structure_files} selected={route.structure??null} onSelect={parts=>navigate(routeHash([study,...parts]))} revision={revision}/>:<Analyses study={study} analyses={data.analyses}/>)}
 </>}
 </main></div>}
 <ActionOutput result={actionResult}/><footer>{actionToken?'study.md 中的计划和结论仍由 Codex 更新。':'Study 文件保持原样。'}状态与解析数字不自动构成科学结论。</footer></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
