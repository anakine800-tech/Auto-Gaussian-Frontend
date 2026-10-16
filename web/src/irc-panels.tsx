import {useEffect,useState} from 'react';
import {endpoint,get} from './api';
import {routeHash} from './routing';
import {MoleculeViewer} from './molecule-viewer';
import type {Geometry} from './molecule-viewer';

type Direction='forward'|'reverse';
type Status='tool_checks_passed'|'met'|'met_by_endpoint_optimization'|'not_met'|'unknown';
type Ref={path:string;sha256:string};
type Point={point:number;geometry_frame:number|null;relative_energy_kcal_mol:number|null;distances_angstrom:Record<string,number|null>|null;energy_hartree:number|null;energy_line:number|null;geometry_line:number|null;energy_kind:string|null;geometry_kind:string|null};
type Midpoint={pair:string;ts_angstrom:number|null;last_angstrom:number|null;reference_angstrom:number|null;midpoint_angstrom:number|null;change:string;status:Status;reason:string};
type Criterion={status:Status;reasons?:string[];reason?:string;[key:string]:unknown};
type Side={attempt:string;summary:string;unresolved:string[];warnings:string[];stop_reason:string;last_accepted_point:number|null;points:Point[];path_geometry:{path:string;frame_count:number};ts_reference:Record<string,unknown>;log:Ref;criteria:{continuity:Criterion;energy_drop:Criterion&{drop_kcal_mol:number|null;threshold_kcal_mol:number|null};midpoint:Criterion&{pairs:Midpoint[]};endpoint:Criterion}};
type Packet={report:{notice:string;ts:string;protocol:Record<string,string|null>;pairs:number[][];thresholds:Record<string,number>;directions:Record<Direction,Side>;inputs:Ref[]};trajectories:Record<Direction,{frames:{geometry:Geometry}[];hash_status:string}>};
const directions:Direction[]=['reverse','forward'];
const labels:Record<Status,string>={tool_checks_passed:'工具核对完成，待人工审阅',met:'满足报告所列条件，待人工审阅',met_by_endpoint_optimization:'由端点优化补证，待人工审阅',not_met:'未满足报告所列条件',unknown:'报告依据不足或未知'};
const stops:Record<string,string>={completed:'报告路径完成',max_points:'达到最大点数',corrector_failed:'校正失败',truncated:'截断或异常终止'};
const value=(v:unknown):string=>v===null||v===undefined?'未提供':typeof v==='object'?JSON.stringify(v):String(v);
const url=(study:string,parts:string[],direction:Direction,point:number)=>routeHash([study,'irc-reviews',...parts])+`?direction=${direction}&point=${point}`;
function Saved({data}:{data:unknown}){return <details><summary>原始依据、文件与行号</summary><pre>{JSON.stringify(data,null,2)}</pre></details>;}
function StatusValue({status}:{status:Status}){return <span className="irc-status"><code>{status}</code><br/>{labels[status]}</span>;}

export function IRCReports({study,revision}:{study:string;revision:number}){
 const [data,setData]=useState<{reports:{name:string;group:string|null}[];issues:{name:string;error:string}[]}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<NonNullable<typeof data>>(endpoint(study,'irc-reviews'),c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,revision]);
 return <section aria-label="IRC 报告列表"><h3>IRC 报告</h3>{error?<p role="alert">{error}</p>:!data?<p>读取 IRC 报告…</p>:<>{data.reports.length?<ul>{data.reports.map(r=><li key={(r.group??'')+r.name}><a href={url(study,[...(r.group?[r.group]:[]),r.name],'forward',0)}>{[r.group,r.name].filter(Boolean).join('/')}</a></li>)}</ul>:<p>暂无可读 IRC 报告。</p>}{data.issues.map((r,i)=><p key={i} className="notice">{r.name}：{r.error}</p>)}</>}</section>;
}

type Curve={direction:Direction;points:Point[];color:string};
function PathChart({sides,pair,choose,selected}:{sides:Record<Direction,Side>;pair?:string;choose:(direction:Direction,point:number)=>void;selected:{direction:Direction;point:number}}){
 const series:Curve[]=directions.map(direction=>({direction,points:sides[direction].points,color:direction==='reverse'?'#8656a5':'#245d91'}));
 const saved=(p:Point)=>pair?p.distances_angstrom?.[pair]??null:p.relative_energy_kcal_mol;
 const refs=pair?series.flatMap(s=>sides[s.direction].criteria.midpoint.pairs.filter(p=>p.pair===pair).flatMap(p=>[{direction:s.direction,label:'预期端点',value:p.reference_angstrom},{direction:s.direction,label:'中点',value:p.midpoint_angstrom}])):[];
 const values=[...series.flatMap(s=>s.points.map(saved)),...refs.map(r=>r.value)].filter((v):v is number=>v!==null);
 const lo=Math.min(0,...values),hi=Math.max(0,...values),scale=Math.max(1,Math.abs(lo),Math.abs(hi)),span=hi/scale-lo/scale||1;
 const maxPoint=Math.max(1,...series.flatMap(s=>s.points.map(p=>p.point)));
 const x=(d:Direction,p:number)=>450+(d==='reverse'?-1:1)*p/maxPoint*370;
 const y=(v:number)=>225-(v/scale-lo/scale)/span*185;
 const title=pair?`键长曲线 ${pair}`:'能量曲线';
 return <section aria-label={title} className="irc-chart"><h3>{title}</h3><p>{pair?'保存距离 / Å':'保存相对能量 / kcal/mol'} · reverse ← TS 0 → forward</p>
 <svg viewBox="0 0 900 290" role="group" aria-label={title+'图'}>
 <line x1="65" y1="225" x2="845" y2="225" stroke="#9ba6b2"/><line x1="450" y1="30" x2="450" y2="240" stroke="#b3bcc5" strokeDasharray="4 4"/>
 {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="65" x2="845" y1={40+t*185} y2={40+t*185} stroke="#e0e5ea"/><text x="60" y={44+t*185} textAnchor="end" fontSize="12">{(hi*(1-t)+lo*t).toFixed(2)}</text></g>)}
 {[-1,-.5,0,.5,1].map(t=><text key={t} x={450+t*370} y="249" textAnchor="middle" fontSize="12">{Math.round(t*maxPoint)}</text>)}
 <text x="450" y="278" textAnchor="middle" fontSize="13">路径点（TS = 0）</text>
 {refs.filter(r=>r.value!==null).map((r,i)=><g key={i} data-testid="irc-reference" aria-label={`${r.direction} ${pair} ${r.label} ${r.value} Å`}><line x1={r.direction==='reverse'?80:450} x2={r.direction==='reverse'?450:820} y1={y(r.value!)} y2={y(r.value!)} stroke={r.direction==='reverse'?'#8656a5':'#245d91'} strokeDasharray={r.label==='中点'?'6 4':'2 4'}/><title>{r.direction} {r.label}：{r.value} Å</title></g>)}
 {series.map(s=>{
  let pen=false;const segments:string[]=[];
  for(const p of s.points){const v=saved(p);if(v===null){pen=false;continue;}segments.push(`${pen?'L':'M'}${x(s.direction,p.point)},${y(v)}`);pen=true;}
  return <g key={s.direction} data-direction={s.direction}>
   <path data-testid="irc-curve" data-direction={s.direction} d={segments.join(' ')} fill="none" stroke={s.color} strokeWidth="2"/>
   {s.points.map(p=>{const v=saved(p);if(v===null)return null;const active=selected.direction===s.direction&&selected.point===p.point;
    return <circle key={p.point} data-testid="irc-point" data-point={p.point} data-direction={s.direction} cx={x(s.direction,p.point)} cy={y(v)} r={active?6:4} fill={s.color} stroke={active?'#182d44':'white'} strokeWidth={active?2:1} role="button" tabIndex={0} aria-label={`${s.direction} 点 ${p.point} · ${pair??'能量'} ${v}`} onClick={()=>choose(s.direction,p.point)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(s.direction,p.point);}}}><title>{s.direction} 点 {p.point}：{v}{pair?' Å':' kcal/mol'}</title></circle>;
   })}
   {sides[s.direction].last_accepted_point!==null&&<line pointerEvents="none" data-testid="irc-stop-marker" x1={x(s.direction,sides[s.direction].last_accepted_point!)} x2={x(s.direction,sides[s.direction].last_accepted_point!)} y1="25" y2="230" stroke={s.color} strokeDasharray="3 4"/>}
  </g>;
 })}
 </svg>
 <div className="irc-stop-notes">{directions.map(d=><p key={d}><strong>{d}</strong> · <code>{sides[d].stop_reason}</code>（{stops[sides[d].stop_reason]}） · 最后已接受点 {value(sides[d].last_accepted_point)}</p>)}</div>
 {refs.length>0&&<ul>{refs.map((r,i)=><li key={i}>{r.direction} {r.label}：{value(r.value)} Å（{r.label==='中点'?'长虚线':'点虚线'}）</li>)}</ul>}
 </section>;
}

function Criteria({side,direction}:{side:Side;direction:Direction}){
 const c=side.criteria;
 return <section aria-label={`${direction} 判据`}><h3>{direction} · {side.attempt}</h3><p className="irc-summary">{side.summary}</p><p>unresolved：{side.unresolved.length?side.unresolved.join('、'):'[]'}</p>
 {side.warnings.map((w,i)=><p role="note" key={i}>{w}</p>)}
 <table aria-label={`${direction} 判据表`}><thead><tr><th>判据</th><th>报告原始状态</th><th>报告数值与依据</th></tr></thead><tbody>
 <tr><th>① 路径连续性</th><td><StatusValue status={c.continuity.status}/></td><td><p>{value(c.continuity.manual_review)}</p><p>{c.continuity.reasons?.join('；')}</p><p>日志：{side.log.path}</p><Saved data={c.continuity}/></td></tr>
 <tr data-testid={`${direction}-energy-drop`}><th>② 降能</th><td><StatusValue status={c.energy_drop.status}/></td><td><p>实际降能：<strong>{value(c.energy_drop.drop_kcal_mol)}</strong> kcal/mol</p><p>阈值：<strong>{value(c.energy_drop.threshold_kcal_mol)}</strong> kcal/mol</p><p>{c.energy_drop.reason}</p><Saved data={c.energy_drop}/></td></tr>
 <tr><th>③ 越过中点</th><td><StatusValue status={c.midpoint.status}/></td><td>{c.midpoint.pairs.length?c.midpoint.pairs.map(p=><div key={p.pair}><p>原子对 {p.pair} · <code>{p.status}</code> · {p.change}</p><p>TS {value(p.ts_angstrom)} · 末点 {value(p.last_angstrom)} · 预期端点 {value(p.reference_angstrom)} · 中点 {value(p.midpoint_angstrom)} Å</p><p>报告比较方向：末点 {p.change==='forming'?'＜':'＞'} 中点；{p.reason}</p></div>):<p>{c.midpoint.reasons?.join('；')??'未提供原子对比较'}</p>}<Saved data={c.midpoint}/></td></tr>
 <tr><th>④ 端点</th><td><StatusValue status={c.endpoint.status}/></td><td><p>{c.endpoint.reasons?.join('；')}</p>{Array.isArray(c.endpoint.facts)&&<ul>{(c.endpoint.facts as {field:string;value:unknown;source:Ref;line:number|null}[]).map(f=><li key={f.field}>{f.field}：{value(f.value)}（{f.source.path}，行 {value(f.line)}）</li>)}</ul>}
 {'identity' in c.endpoint&&<p>身份比较：{value(c.endpoint.identity)}</p>}{'provenance_note' in c.endpoint&&<p>末点来源：{value(c.endpoint.provenance_note)}</p>}<Saved data={c.endpoint}/></td></tr>
 </tbody></table><details><summary>TS 起点与 facts 原值</summary><pre>{JSON.stringify(side.ts_reference,null,2)}</pre></details></section>;
}

function IRCContent({packet,study,parts,direction,point}:{packet:Packet;study:string;parts:string[];direction:Direction;point:number}){
 const r=packet.report,sides=r.directions,side=sides[direction];
 const selected=side.points.find(p=>p.point===point),index=side.points.findIndex(p=>p.point===point);
 const [highlight,setHighlight]=useState(r.pairs[0].join('-'));
 const pair=r.pairs.find(p=>p.join('-')===highlight)??r.pairs[0];
 const choose=(d:Direction,p:number)=>{window.location.hash=url(study,parts,d,p);};
 const geometry=selected?.geometry_frame===null||selected?.geometry_frame===undefined?null:packet.trajectories[direction].frames[selected.geometry_frame].geometry;
 return <section className="irc-page" aria-label="IRC 查看页">
 <style>{`.irc-page{min-width:0}.irc-page pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:480px;overflow:auto}.irc-page table{width:100%;table-layout:fixed}.irc-page td,.irc-page th{overflow-wrap:anywhere;vertical-align:top}.irc-page th:first-child{width:17%}.irc-page th:nth-child(2){width:27%}.irc-chart svg{width:100%;min-width:540px;display:block}.irc-chart{overflow:auto}.irc-chart circle[role=button]{cursor:pointer}.irc-chart circle:focus{stroke:#111;stroke-width:3}.irc-status{color:#384b60}.irc-summary{background:#edf1f5;padding:12px}.irc-structure .measurement{display:none}.irc-structure [data-testid=molecule-atom][data-center="${pair[0]}"] circle,.irc-structure [data-testid=molecule-atom][data-center="${pair[1]}"] circle{stroke:#bd5b11;stroke-width:4;stroke-opacity:1;filter:drop-shadow(0 0 3px #e3a236)}`}</style>
 <h2>IRC 查看 · {parts.join('/')}</h2><a href={routeHash([study])}>返回结果</a>
 <p className="notice" role="note">{r.notice}</p><p>TS：{r.ts} · forward：{sides.forward.attempt} · reverse：{sides.reverse.attempt}</p>
 <p>方法口径：{Object.entries(r.protocol).map(([k,v])=>`${k}: ${value(v)}`).join(' · ')}</p>
 <details open><summary>报告阈值</summary><dl>{Object.entries(r.thresholds).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details>
 {directions.map(d=><p key={d} data-testid={`${d}-count`}>{d}：非零路径点 {sides[d].points.filter(p=>p.point!==0).length} · 含 TS 点数 {sides[d].points.length} · XYZ 帧数 {sides[d].path_geometry.frame_count} · {packet.trajectories[d].hash_status}</p>)}
 <p className="muted">曲线使用报告保存值；能量基准为各方向第 0 点，TS facts 对照见判据下方。缺失能量留空断线；TS 位于横轴 0。</p>
 <PathChart sides={sides} selected={{direction,point}} choose={choose}/>
 {r.pairs.map(pair=><PathChart key={pair.join('-')} sides={sides} pair={pair.join('-')} selected={{direction,point}} choose={choose}/>)}
 <section aria-label="路径点结构" className="irc-structure"><h3>路径点结构</h3>
 <label>方向 <select aria-label="IRC 方向" value={direction} onChange={e=>choose(e.target.value as Direction,0)}><option value="forward">forward</option><option value="reverse">reverse</option></select></label>
 <label>路径点 <select aria-label="IRC 路径点" value={selected?point:''} onChange={e=>choose(direction,Number(e.target.value))}>{!selected&&<option value="">URL 点不存在</option>}{side.points.map(p=><option key={p.point} value={p.point}>{p.point===0?'TS · 点 0':`点 ${p.point}`}{p.geometry_frame===null?' · 缺少几何':` · 帧 ${p.geometry_frame}`}</option>)}</select></label>
 <button disabled={index<=0} onClick={()=>choose(direction,side.points[index-1].point)}>上一点</button><button disabled={index<0||index>=side.points.length-1} onClick={()=>choose(direction,side.points[index+1].point)}>下一点</button>
 <label>高亮报告原子对 <select aria-label="IRC 高亮原子对" value={highlight} onChange={e=>setHighlight(e.target.value)}>{r.pairs.map(p=><option key={p.join('-')}>{p.join('-')}</option>)}</select></label>
 <p data-testid="irc-pair-highlight">橙色描边：原子 {pair.join('、')} · 报告保存距离：{value(selected?.distances_angstrom?.[pair.join('-')])} Å</p>
 {!selected?<p role="alert">URL 中的路径点不存在。</p>:<><p data-testid="irc-selected">{direction} 点 {point} · XYZ 帧 {value(selected.geometry_frame)}（从 0 开始）</p><p>相对能量：{value(selected.relative_energy_kcal_mol)} kcal/mol · 日志：{side.log.path} · 能量行 {value(selected.energy_line)} · 几何行 {value(selected.geometry_line)} · {selected.geometry_kind}</p>{geometry?<MoleculeViewer last={geometry} frameLabel={`${direction} 点 ${point} · 帧 ${selected.geometry_frame}`}/>:<p role="status">此点缺少几何，未借用其他帧。</p>}</>}
 </section>
 {directions.map(d=><Criteria key={d} direction={d} side={sides[d]}/>)}
 <details><summary>报告输入哈希（只显示来源，不打开文件）</summary><pre>{JSON.stringify(r.inputs,null,2)}</pre></details>
 </section>;
}

export function IRCPage({study,parts,direction,point,revision}:{study:string;parts:string[];direction:Direction;point:number;revision:number}){
 const [packet,setPacket]=useState<Packet|null>(null),[error,setError]=useState('');const location=parts.join('/');
 useEffect(()=>{const c=new AbortController();setPacket(null);setError('');get<Packet>(endpoint(study,'irc-reviews',...parts),c.signal).then(v=>{if(!c.signal.aborted)setPacket(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,location,revision]);
 return error?<p role="alert">{error}</p>:packet?<IRCContent packet={packet} study={study} parts={parts} direction={direction} point={point}/>:<p role="status">读取 IRC 报告与路径 XYZ…</p>;
}
