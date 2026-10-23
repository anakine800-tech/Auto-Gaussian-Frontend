import {useEffect,useState} from 'react';
import {display,endpoint,get,object} from './api';
import {duration,latestSnapshot,safeIdentity} from './jobs-data';
import type {Snapshot} from './jobs-data';
import {ErrorNotice} from './ui';
export function WalltimeProgress({used,limit}:{used:unknown;limit:unknown}){
 const seconds=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:duration(v);
 const format=(v:unknown)=>typeof v==='number'&&seconds(v)!==null?`${Math.floor(v/3600).toString().padStart(2,'0')}:${Math.floor(v%3600/60).toString().padStart(2,'0')}:${(v%60).toString().padStart(2,'0')}`:v==null?'未知':display(v);
 const elapsed=seconds(used),maximum=seconds(limit),ratio=elapsed!==null&&maximum!==null&&maximum>0?elapsed/maximum:null;
 return <div className={'job-walltime'+(ratio!==null&&ratio>=.9?' walltime-warning':'')}><span>{format(used)} / {format(limit)}</span>{ratio!==null?<><progress aria-label="已用时长占 walltime" value={Math.min(elapsed!,maximum!)} max={maximum!}/><small>{(ratio*100).toFixed(1)}%{ratio>1?' · 已超 walltime':''}</small></>:<small className="muted">进度未知</small>}</div>;
}
export function SnapshotProgress({study,attempt,revision}:{study:string|null;attempt:string|null;revision:number}){
 const [data,setData]=useState<Snapshot[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  setData(null);setError('');if(!safeIdentity(study)||!safeIdentity(attempt))return;
  const c=new AbortController();get<{snapshots:Snapshot[]}>(endpoint(study,'attempts',attempt,'snapshots'),c.signal).then(v=>{if(!c.signal.aborted)setData(v.snapshots);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();
 },[study,attempt,revision]);
 if(!safeIdentity(study)||!safeIdentity(attempt))return <span className="muted">未关联本地 Attempt</span>;
 if(error)return <ErrorNotice>快照不可读：{error}</ErrorNotice>;
 if(data===null)return <span className="muted">读取快照…</span>;
 const {latest,unreadable}=latestSnapshot(data);
 const record=latest&&object(latest.data)?latest.data:null,p=record&&object(record.progress)?record.progress:{};
 const step=typeof p.last_step_number==='number'&&Number.isSafeInteger(p.last_step_number)&&p.last_step_number>=0?p.last_step_number:null;
 const energy=typeof p.last_scf_energy_hartree==='string'&&/^[-+]?\d+(?:\.\d+)?(?:[DEde][-+]?\d+)?$/.test(p.last_scf_energy_hartree)?Number(p.last_scf_energy_hartree.replace(/[Dd]/,'E')):p.last_scf_energy_hartree;
 return <div className="job-snapshot">{record?<><span>片段末次优化步：{display(step)}</span><span title={display(p.last_scf_energy_hartree)}>末次 SCF：{typeof energy==='number'&&Number.isFinite(energy)?energy.toFixed(6):'—'} Eh</span><small>{display(record.created_at)}</small><small className="snapshot-notice">运行中快照，不是结果</small></>:<span className="muted">{data.length?'无可用的带时间快照':'尚无本地快照'}</span>}{unreadable>0&&<span className="snapshot-notice">{unreadable} 份记录不可读或时间缺失，无法确认是否更新</span>}</div>;
}
