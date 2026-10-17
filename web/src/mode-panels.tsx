import {createPortal} from 'react-dom';
import {locationChanged} from './navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {ComponentProps} from 'react';
import {endpoint,get} from './api';
import {isGeometry,MoleculeViewer} from './molecule-viewer';
import type {Atom,VibrationFrame} from './molecule-viewer';
import type {ModeProvenance,VibrationMode} from './vibration-contract';

type Pair=[number,number];
type PairReport={atoms:Pair;elements:string[];distance:number;plus_distance:number;minus_distance:number;plus_change:number;minus_change:number;distance_change_rate:number;absolute_rate_rank:number};
type Report={attempt:string;mode:number;source_mode_index:number;frequency:number;amplitude:number;orientation:string;source:{log:string;log_sha256:string;section_sha256:string};pairs:PairReport[];note:string;rate_definition:string};
type Entry={name:string;report:Report;log_matches:boolean};
type Reports={log_sha256:string;reports:Entry[];issues:{name:string;error:string}[]};
export type ReviewModes=ModeProvenance&{reference_geometry:unknown;modes:VibrationMode[]};
const notice='模式整体正负号任意；有限振幅距离变化可能不同于线性导数。';

function distance(atoms:Atom[],mode:VibrationMode,pair:Pair,scale:number){
 const points=pair.map(center=>{const a=atoms.find(v=>v.center===center),d=mode.displacements.find(v=>v.center===center);return a&&d?[a.x+d.dx*scale,a.y+d.dy*scale,a.z+d.dz*scale]:null;});
 return points[0]&&points[1]?Math.hypot(...points[0].map((x,i)=>x-points[1]![i])):NaN;
}
function readPairs(scope:string,atoms:Atom[]):Pair[]{
 const params=new URLSearchParams(window.location.search);
 if(params.get('modeScope')!==scope)return [];
 const values=(params.get('modePairs')??'').split(',');
 const pairs:Pair[]=[];
 for(const value of values){
  if(!/^[1-9][0-9]*-[1-9][0-9]*$/.test(value))continue;
  const [a,b]=value.split('-').map(Number);
  if(a!==b&&atoms.some(v=>v.center===a)&&atoms.some(v=>v.center===b)&&!pairs.some(p=>p.includes(a)&&p.includes(b)))pairs.push([a,b]);
 }
 return pairs;
}
function savePairs(scope:string,pairs:Pair[]){
 // Keep the existing hash router unchanged; query parameters precede the hash.
 const url=new URL(window.location.href);url.searchParams.set('modeScope',scope);url.searchParams.set('modePairs',pairs.map(p=>p.join('-')).join(','));
 window.history.replaceState({...window.history.state,agScroll:window.scrollY},'',url);locationChanged();
}
const formatted=(value:number)=>Number.isFinite(value)?value.toFixed(3):'无法计算';

function ReviewScene({study,attempt,log,packet,revision,reviewTarget,...viewer}:{study:string;attempt:string;log:string;packet:ReviewModes;revision:number;reviewTarget?:HTMLElement|null}&ComponentProps<typeof MoleculeViewer>){
 const mode=viewer.vibration!;
 const atoms=isGeometry(viewer.last)?viewer.last.atoms:[];
 const scope=JSON.stringify([study,attempt,log,packet.log_sha256,mode.source_mode_index??mode.mode_number]);
 const [pairs,setPairs]=useState<Pair[]>(()=>readPairs(scope,atoms));
 const [pending,setPending]=useState<number|null>(null),[review,setReview]=useState(false),[amplitude,setAmplitude]=useState(.3);
 const [frame,setFrame]=useState<VibrationFrame|null>(null),[response,setResponse]=useState<Reports|null>(null),[error,setError]=useState(''),[chosen,setChosen]=useState('');
 const applied=useRef('');
 const [previousScope,setPreviousScope]=useState(scope);
 // Reset only review state before rendering a different mode. Keep the viewer
 // mounted so its existing camera, raw amplitude and playback controls persist.
 if(previousScope!==scope){setPreviousScope(scope);setPairs(readPairs(scope,atoms));setPending(null);setReview(false);setAmplitude(.3);setFrame(null);applied.current='';}

 const maximum=Math.max(0,...mode.displacements.map(v=>Math.hypot(v.dx,v.dy,v.dz)));
 const scale=maximum>0?amplitude/maximum:NaN;
 const updatePairs=(next:Pair[])=>{setPairs(next);savePairs(scope,next);};
 useEffect(()=>{const c=new AbortController();get<Reports>(endpoint(study,'attempts',attempt,'mode-reports',log),c.signal).then(v=>{if(!c.signal.aborted)setResponse(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,log,revision]);
 const entries=response?.reports??[];
 const selected=entries.find(e=>e.name===chosen);
 const report=selected?.report;
 const sameLog=Boolean(selected?.log_matches&&response?.log_sha256===packet.log_sha256&&report?.source.log_sha256===packet.log_sha256);
 const sameMode=Boolean(report&&report.mode===mode.sorted_mode_index&&report.source_mode_index===mode.source_mode_index&&report.frequency===mode.frequency_cm1&&report.orientation===packet.orientation);
 useEffect(()=>{if(response?.reports.length===1)setChosen(response.reports[0].name);},[response]);
 useEffect(()=>{
  if(!selected||!report||!sameLog||!sameMode||applied.current===selected.name)return;
  applied.current=selected.name;setAmplitude(report.amplitude);
  // Explicit URL selection, including an empty list, wins over report defaults.
  if(new URLSearchParams(window.location.search).get('modeScope')!==scope){const next=report.pairs.map(p=>p.atoms);setPairs(next);savePairs(scope,next);}
 },[selected,report,sameLog,sameMode,scope]);
 const onFrame=useCallback((next:VibrationFrame)=>setFrame(next),[]);
 const pick=(center:number)=>{if(pending===null)setPending(center);else if(pending!==center){if(!pairs.some(p=>p.includes(center)&&p.includes(pending)))updatePairs([...pairs,[pending,center]]);setPending(null);}};
 const chooseReport=(name:string)=>{
  setChosen(name);applied.current='';
  const next=entries.find(e=>e.name===name);
  if(next?.log_matches&&next.report.source.log_sha256===packet.log_sha256&&next.report.source_mode_index===mode.source_mode_index&&next.report.mode===mode.sorted_mode_index&&next.report.frequency===mode.frequency_cm1&&next.report.orientation===packet.orientation){setAmplitude(next.report.amplitude);updatePairs(next.report.pairs.map(p=>p.atoms));}
 };
 const panel=<section aria-label="模式审阅面板">
  <h3>模式来源与原子对距离</h3>
  <dl><dt>log 文件</dt><dd>{packet.log_name??log}</dd><dt>log SHA-256</dt><dd><details><summary>{packet.log_sha256?.slice(0,12)??'未知'}（展开）</summary><code className="break-anywhere">{packet.log_sha256??'未知'}</code></details></dd>
   <dt>按频率排序的模式序号 / 原始频率序号</dt><dd>{mode.sorted_mode_index??'未知'} / {mode.source_mode_index??'未知'}</dd><dt>频率</dt><dd>{mode.frequency_cm1} cm⁻¹</dd><dt>坐标方向</dt><dd>{packet.orientation==='standard'?'Standard orientation':packet.orientation==='input'?'Input orientation':'未知'}</dd></dl>
  <label><input type="checkbox" aria-label="启用审阅模式" checked={review} onChange={e=>{setReview(e.target.checked);setFrame(null);}}/>启用审阅模式</label>
  <p>{review?'动画振幅定义：最大原子位移 = 归一化振幅。':'动画振幅定义：原始打印位移 × 显示幅度；实时距离仅在审阅模式显示。'}</p>
  <label>归一化振幅 / Å<input aria-label="归一化振幅" type="number" min="0.001" step="0.05" value={amplitude} onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v>0)setAmplitude(v);}}/></label>
  <p>下表始终按归一化振幅计算；原子编号从 1 开始，与 XYZ、mode-review、atoms.csv 对应。</p>
  <p>{pending===null?'依次点选两个原子添加一对。':`已选原子 ${pending}，请点选另一个原子。`}{pending!==null&&<button onClick={()=>setPending(null)}>取消待选原子</button>}</p>
  <div className="table-scroll"><table aria-label="原子对距离"><thead><tr><th>原子对</th><th>平衡 / Å</th><th>+ / Å</th><th>− / Å</th><th>Δ+ / Å</th><th>Δ− / Å</th>{review&&<th>当前帧 / Å</th>}<th>操作</th></tr></thead><tbody>{pairs.map(pair=>{
   const d=distance(atoms,mode,pair,0),plus=distance(atoms,mode,pair,scale),minus=distance(atoms,mode,pair,-scale);
   return <tr key={pair.join('-')} data-testid={`pair-${pair.join('-')}`}><th>{pair.join('–')}</th>{[d,plus,minus,plus-d,minus-d].map((v,i)=><td key={i}>{formatted(v)}</td>)}{review&&<td data-testid={`current-${pair.join('-')}`}>{frame?formatted(distance(atoms,mode,pair,frame.displacementScale)):'等待当前帧'}</td>}<td><button aria-label={`删除原子对 ${pair.join('-')}`} onClick={()=>updatePairs(pairs.filter(p=>p!==pair))}>删除</button></td></tr>;
  })}</tbody></table></div>
  {maximum===0&&<p role="status">模式没有非零位移，无法计算归一化距离。</p>}
  <p>{notice}</p>
  <h4>mode-review 报告对照</h4>
  {error&&<p role="status">{error}</p>}
  {!response&&!error&&<p>读取报告…</p>}
  {response&&entries.length===0&&<p>未找到当前 Attempt 的 mode-review 报告。</p>}
  {entries.length>0&&<label>报告<select aria-label="mode-review 报告" value={chosen} onChange={e=>chooseReport(e.target.value)}><option value="">选择报告</option>{entries.map(e=><option key={e.name} value={e.name}>{e.name} · 模式 {e.report.mode}</option>)}</select></label>}
  {selected&&!sameLog&&<p role="status">报告来自另一份 log，不自动带出</p>}
  {selected&&sameLog&&!sameMode&&<p role="status">报告对应另一模式或坐标方向；请选择原始频率序号 {report?.source_mode_index} 对应的模式，不自动带出。</p>}
  {report&&<p>报告振幅：{report.amplitude} Å · 模式 {report.mode} · {report.frequency} cm⁻¹</p>}
  {report&&sameLog&&sameMode&&<>
   {amplitude!==report.amplitude?<p>页面振幅与报告不同，<button onClick={()=>setAmplitude(report.amplitude)}>使用报告振幅进行对照</button></p>:<div className="table-scroll"><table aria-label="报告距离对照"><thead><tr><th>原子对</th><th>方向</th><th>页面 / Å</th><th>报告 / Å</th><th>差值 / Å</th><th>对照</th></tr></thead><tbody>{report.pairs.flatMap((p,i)=>(['plus','minus'] as const).map(side=>{
    const actual=distance(atoms,mode,p.atoms,side==='plus'?scale:-scale),saved=p[`${side}_distance`],delta=Math.abs(actual-saved),matches=Number.isFinite(delta)&&delta<=.001+4*Number.EPSILON*Math.max(1,Math.abs(actual),Math.abs(saved));
    return <tr key={`${i}-${side}`}><th>{p.atoms.join('–')}</th><td>{side==='plus'?'+':'−'}</td><td>{formatted(actual)}</td><td>{formatted(saved)}</td><td>{Number.isFinite(delta)?delta.toFixed(6):'无法计算'}</td><td>{matches?'一致':'不一致'}</td></tr>;
   }))}</tbody></table></div>}
  </>}
  {response?.issues.map((issue,i)=><p className="notice" key={i}>{issue.name}：{issue.error}</p>)}
 </section>;
 return <MoleculeViewer {...viewer} reviewMode={review} reviewAmplitude={amplitude} onAtomPick={pick} onFrame={onFrame} scientificPanel={reviewTarget?createPortal(panel,reviewTarget):panel}/>;
}

export function ModeReviewViewer({study,attempt,log,packet,revision,reviewTarget,...viewer}:{study:string;attempt:string;log:string;packet:ReviewModes|null;revision:number;reviewTarget?:HTMLElement|null}&ComponentProps<typeof MoleculeViewer>){
 if(!packet||!viewer.vibration||!isGeometry(viewer.last))return <MoleculeViewer {...viewer}/>;
 return <ReviewScene key={`${study}/${attempt}/${log}/${packet.log_sha256}`} study={study} attempt={attempt} log={log} packet={packet} revision={revision} reviewTarget={reviewTarget} {...viewer}/>;
}
