import {useEffect,useState} from 'react';
import {display,endpoint,get,object} from './api';
import type {Document} from './api';
import {DataTable,EmptyState,ErrorNotice,StatusBadge} from './ui';
type Snapshot=Document&{name:string};
export function Snapshots({study,attempt,revision}:{study:string;attempt:string;revision:number}){
 const [data,setData]=useState<Snapshot[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();setData(null);setError('');get<{snapshots:Snapshot[]}>(endpoint(study,'attempts',attempt,'snapshots'),c.signal).then(v=>{if(!c.signal.aborted)setData(v.snapshots);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,attempt,revision]);
 const value=(r:Snapshot,key:string)=>object(r.data)?r.data[key]:null;
 return <><StatusBadge tone="warn">运行中快照，不是结果</StatusBadge><p className="muted">只读本地 snapshot.json；不能用于签字或分析。片段中的能量、步数和终止标记不替代 facts，也不刷新状态。</p>{error?<ErrorNotice>{error}</ErrorNotice>:!data?<p role="status">读取快照…</p>:!data.length?<EmptyState>尚无本地快照。</EmptyState>:<DataTable label="本地快照摘要" rows={data} rowKey={r=>r.name} columns={[
 {key:'name',label:'记录',render:r=><>{r.name}{r.error&&<ErrorNotice>{r.error}</ErrorNotice>}</>},
 {key:'time',label:'采集时间',render:r=>display(value(r,'created_at'))},
 {key:'file',label:'文件 / 已读字节',render:r=><>{display(value(r,'file'))} / {display(value(r,'read_bytes'))}</>},
 {key:'truncated',label:'截断',render:r=>typeof value(r,'truncated')==='boolean'?value(r,'truncated')?'是':'否':'—'},
 {key:'detail',label:'摘要与哈希',render:r=><details><summary>查看记录</summary><pre>{JSON.stringify(r.data,null,2)}</pre></details>},
 ]}/>}</>;
}
