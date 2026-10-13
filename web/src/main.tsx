import {useEffect,useState} from 'react';
import {ActionOutput,AttemptActions,actionToken} from './actions';
import type {ActionResult} from './actions';
import {createRoot} from 'react-dom/client';
import {endpoint,get,object} from './api';
import {InputFiles,InputSummary,StructureFiles} from './preview-panels';
import {readRoute,routeHash} from './routing';
import type {Attempt,Study} from './api';
import {ServerMonitor} from './server-monitor';
import {Results,StudyMarkdown,Optimization} from './results-panels';
import {Analyses,FileView,PagedLog,RelationshipGraph} from './study-panels';
import {MoleculeViewer} from './molecule-viewer';
import type {VibrationMode} from './vibration-contract';
import './style.css';
import './molecule-layout.css';

type Modes={reference_geometry:unknown;modes:VibrationMode[]};
function AttemptView({study,id,revision,busy,onBusy,onResult,autoCompare}:{study:string;id:string;revision:number;busy:boolean;onBusy:(v:boolean)=>void;onResult:(r:ActionResult)=>void;autoCompare:boolean}){
 const [data,setData]=useState<Attempt|null>(null),[error,setError]=useState(''),[log,setLog]=useState(''),[modes,setModes]=useState<Modes|null>(null),[modeError,setModeError]=useState(''),[selected,setSelected]=useState<number|null>(null),[decode,setDecode]=useState(false),[geometrySource,setGeometrySource]=useState('input'),[attemptTab,setAttemptTab]=useState('details');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');setLog('');setModes(null);setSelected(null);setDecode(false);get<Attempt>(endpoint(study,'attempts',id),c.signal).then(v=>{if(!c.signal.aborted){setData(v);setLog(v.logs[0]??'');const state=object(v.status.data)?v.status.data.state:'';setGeometrySource(['prepared','submitting'].includes(String(state))||!v.geometry.data?'input':'final');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,id,revision]);
 useEffect(()=>{const c=new AbortController();setModes(null);setModeError('');setSelected(null);if(decode&&log)get<Modes>(endpoint(study,'attempts',id,'vibrations',log),c.signal).then(v=>{if(!c.signal.aborted)setModes(v);}).catch(e=>{if(!c.signal.aborted)setModeError(e.message);});return()=>c.abort();},[decode,log,study,id,revision]);
 useEffect(()=>{if(data)document.getElementById('attempt-structure')?.scrollIntoView({block:'start'});},[data]);
 if(error)return <p role="alert">{error}</p>;if(!data)return <p role="status">读取 Attempt…</p>;
 const vibration=selected!==null?modes?.modes[selected]:undefined;
 return <section className="attempt-detail"><h2>{id}</h2><nav aria-label="Attempt 内容"><button aria-current={attemptTab==='details'?'page':undefined} onClick={()=>setAttemptTab('details')}>Attempt 详情</button><button aria-current={attemptTab==='optimization'?'page':undefined} onClick={()=>setAttemptTab('optimization')}>优化过程</button></nav>{attemptTab==='optimization'?<>{data.logs.length?<><label>优化日志 <select aria-label="优化日志" value={log} onChange={e=>setLog(e.target.value)}>{data.logs.map(l=><option key={l}>{l}</option>)}</select></label>{log&&<Optimization key={log+revision} study={study} attempt={id} log={log} revision={revision}/>}</>:<p>尚无 outputs 日志。</p>}</>:<><div id="attempt-structure" className="structure-preview">
 <div><label>预览结构 <select aria-label="预览结构" value={geometrySource} onChange={e=>{setGeometrySource(e.target.value);setSelected(null);}}><option value="input">输入结构</option><option value="final" disabled={!data.geometry.data}>最终结构 · final.xyz</option></select></label>
 <MoleculeViewer key={vibration?'vibration':geometrySource} last={vibration?modes?.reference_geometry:geometrySource==='input'?data.input_geometry.data:data.geometry.data} frameLabel={vibration?'Gaussian 振动参考坐标':geometrySource==='input'?'输入结构':'最终结构 · final.xyz'} vibration={vibration} onClearVibration={()=>setSelected(null)}/>
 {geometrySource==='input'&&data.input_geometry.error&&<p className="notice">{data.input_geometry.error}</p>}
 {geometrySource==='final'&&data.geometry.error&&<p className="notice">final.xyz：{data.geometry.error}</p>}</div>
 <InputSummary input={data.input_geometry} manifest={data.manifest}/></div>
 {actionToken&&<AttemptActions study={study} data={data} revision={revision} busy={busy} onBusy={onBusy} onResult={onResult}/>}
 <InputFiles study={study} attempt={id} data={data} autoCompare={autoCompare}/>
 <details><summary>manifest.json 与 status.json</summary><div className="columns"><FileView title="status.json" doc={data.status}/><FileView title="manifest.json" doc={data.manifest}/></div></details>
 <section><h3>Gaussian 振动与日志</h3><p className="muted">振动使用所选日志中的 Standard orientation 与原始打印位移。显示动画不代表过渡态验收。</p>{data.logs.length?<>
 <label>输出日志 <select aria-label="输出日志" value={log} onChange={e=>{setLog(e.target.value);setDecode(false);setSelected(null);}}>{data.logs.map(l=><option key={l}>{l}</option>)}</select></label>
 <button onClick={()=>setDecode(true)} disabled={decode}>解析振动位移</button>
 {modeError&&<p role="status" className="notice">{modeError}</p>}{decode&&!modes&&!modeError&&<p role="status">解析振动…</p>}
 {modes&&<label>振动模式 <select aria-label="振动模式" value={selected??''} onChange={e=>setSelected(e.target.value===''?null:Number(e.target.value))}><option value="">返回所选结构</option>{modes.modes.map((m,i)=><option key={i} value={i}>模式 {m.mode_number} · {m.frequency_cm1} cm⁻¹</option>)}</select></label>}
 {log&&<PagedLog key={log+revision} study={study} attempt={id} log={log}/>}</>:<p>尚无 outputs 日志。</p>}</section>
 <FileView title="facts.json" doc={data.facts}/><FileView title="review.md" doc={data.review}/>{data.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}</>}</section>;
}
function App(){
 const [busy,setBusy]=useState(false),[actionResult,setActionResult]=useState<ActionResult|null>(null);
 const [route,setRoute]=useState(readRoute);
 useEffect(()=>{const update=()=>setRoute(readRoute());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 const [list,setList]=useState<{studies:{id:string;title:string}[];issues:{path:string;error:string}[]}|null>(null),[study,setStudy]=useState(route.study),[data,setData]=useState<Study|null>(null),[attempt,setAttempt]=useState(route.attempt??''),[tab,setTab]=useState(route.attempt?'attempts':route.structure?'structures':'results'),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{if(route.server)return;const c=new AbortController();setError('');get<NonNullable<typeof list>>('/api/studies',c.signal).then(v=>{if(!c.signal.aborted){setList(v);setStudy(s=>s||v.studies[0]?.id||'');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[revision,route.server]);
 useEffect(()=>{if(route.server)return;const c=new AbortController();setData(null);setError('');if(study)get<Study>(endpoint(study),c.signal).then(v=>{if(!c.signal.aborted){setData(v);setAttempt(a=>a||v.attempts[0]?.id||'');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,revision,route.server]);
 useEffect(()=>{if(route.study){setStudy(route.study);setAttempt(route.attempt??'');setTab(route.attempt?'attempts':route.structure?'structures':'results');}},[route]);
 const navigate=(parts:string[])=>{window.location.hash=routeHash(parts);};
 const choose=(id:string)=>{setAttempt(id);setTab('attempts');navigate([study,id]);};
 const selectStructure=(parts:string[])=>navigate([study,...parts]);
 const completed=(result:ActionResult)=>{setActionResult(result);setRevision(r=>r+1);if(result.new_attempt)navigate([study,result.new_attempt]);};
 return <><header><div><span className="eyebrow">AUTO-GAUSSIAN</span><h1>Study 查看器</h1><p>{actionToken?'读取本机研究目录 · 操作通过本机 ag':'读取本机研究目录 · 计算提交请使用 ag'}</p></div><nav aria-label="顶部导航"><button aria-current={!route.server?'page':undefined} onClick={()=>navigate(study?[study]:[])}>Studies</button><button aria-current={route.server?'page':undefined} onClick={()=>{window.location.hash='#server';}}>服务器</button></nav><span className="readonly">{actionToken?'可操作（经 ag）':'只读'}</span><button onClick={()=>setRevision(r=>r+1)}>刷新</button></header>{route.server?<main className="server-page"><ServerMonitor revision={revision}/></main>:<div className="workspace"><aside><h2>Studies</h2>{!list&&!error&&<p>读取目录…</p>}{list?.studies.map(s=><button className={study===s.id?'active':''} key={s.id} onClick={()=>{setStudy(s.id);setTab('results');setAttempt('');navigate([s.id]);}}><strong>{s.title}</strong><small>{s.id}</small></button>)}{list?.studies.length===0&&<p>目录中没有可读的 study.md。</p>}{list?.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}</aside><main>{route.error&&<p role="alert">{route.error}</p>}{error&&<p role="alert">{error}</p>}{study&&!data&&!error&&<p role="status">读取 Study…</p>}{data&&<><div className="study-heading"><h2>{data.id}</h2><span>{data.attempts.length} Attempts</span></div><nav aria-label="Study 内容">{[['results','结果'],['overview','研究说明'],['attempts','Attempts'],['graph','关系图'],['structures','结构文件'],['analyses','分析结果']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
 {data.issues.map((x,i)=><p className="notice" key={i}>{x.path}：{x.error}</p>)}
 {tab==='results'&&<Results key={study} data={data} onSelect={choose} revision={revision}/>}
 {tab==='overview'&&<StudyMarkdown doc={data.study}/>}
 {tab==='attempts'&&<><div className="table-scroll"><table aria-label="Attempt 状态列表"><thead><tr><th>Attempt</th><th>标签</th><th>程序</th><th>状态</th><th>读取问题</th></tr></thead><tbody>{data.attempts.map(a=><tr key={a.id} className={attempt===a.id?'selected':''}><td><button onClick={()=>choose(a.id)}>{a.id}</button></td><td>{a.label??'—'}</td><td>{a.template??'—'}</td><td><span className="state">{a.state}</span></td><td>{[a.manifest.error,a.status.error].filter(Boolean).join(' · ')||'—'}</td></tr>)}</tbody></table></div>{attempt?<AttemptView key={study+attempt} study={study} id={attempt} revision={revision} busy={busy} onBusy={setBusy} onResult={completed} autoCompare={actionResult?.new_attempt===attempt}/>:<p>尚无 Attempt。</p>}</>}
 {tab==='graph'&&<RelationshipGraph graph={data.graph} onSelect={choose}/>}
 {tab==='structures'&&<StructureFiles study={study} files={data.structure_files} selected={route.structure??null} onSelect={selectStructure} revision={revision}/>}
 {tab==='analyses'&&<Analyses analyses={data.analyses}/>}</>}</main></div>}<ActionOutput result={actionResult}/><footer>{actionToken?'study.md 中的计划和结论仍由 Codex 更新。':'Study 文件保持原样。'}状态与解析数字不自动构成科学结论。</footer></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
