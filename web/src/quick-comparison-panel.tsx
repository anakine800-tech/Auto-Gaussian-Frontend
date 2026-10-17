import {useEffect,useState} from 'react';
import {endpoint,get} from './api';
import type {Attempt} from './api';
import {compareAttempts} from './quick-comparison';
import type {Comparison} from './quick-comparison';
import {Collapsible,DataTable,Drawer,ErrorNotice,StatusBadge} from './ui';
export const comparisonTitle='快速比较（前端计算，非正式结果）';
export function QuickComparison({study,ids,onClose}:{study:string;ids:string[];onClose:()=>void}){
 const [result,setResult]=useState<Comparison|null>(null),[error,setError]=useState(''),key=ids.join('/');
 useEffect(()=>{const c=new AbortController();setResult(null);setError('');Promise.all(ids.map(id=>get<Attempt>(endpoint(study,'attempts',id),c.signal))).then(data=>{if(!c.signal.aborted)setResult(compareAttempts(data));}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[study,key]);
 const number=(n:number|null,digits:number)=>n===null?'—':<span title={String(n)}>{n.toFixed(digits)}</span>;
 return <Drawer title={comparisonTitle} open onClose={onClose}><div className="quick-comparison"><p>比较所选 Attempt 的 facts.json 保存值。只计算相对电子能与自由能，最低者为 0；缺失能量为 —。termination 与 n_imag 仅显示保存记录，不代表结果已完成或通过科学审阅。不做 Boltzmann、不换温度、不写入 study。</p><StatusBadge tone="warn">工具记录，待人工审阅</StatusBadge>{error?<ErrorNotice>{error}</ErrorNotice>:!result?<p role="status">读取所选 Attempt，核对方法口径和元素组成…</p>:result.differences.length?<><ErrorNotice>拒绝快速比较：口径不同或证据不足。</ErrorNotice><ul className="comparison-differences">{result.differences.map((d,i)=><li key={i}>{d}</li>)}</ul></>:<><DataTable label="快速比较结果" rows={result.rows} rowKey={r=>r.id} columns={[{key:'id',label:'Attempt',render:r=>r.id},{key:'termination',label:'termination',render:r=>r.termination===null?'—':<StatusBadge tone={r.termination==='normal'?'neutral':r.termination==='error'?'bad':'warn'}>{r.termination}</StatusBadge>},{key:'n_imag',label:'n_imag',className:'numeric',render:r=>r.nImag??'—'},{key:'e',label:'E / Eh',className:'numeric',render:r=>number(r.electronic,6)},{key:'g',label:'G / Eh',className:'numeric',render:r=>number(r.free,6)},{key:'de',label:'ΔE / kcal/mol',className:'numeric',render:r=>number(r.relativeElectronic,3)},{key:'dg',label:'ΔG / kcal/mol',className:'numeric',render:r=>number(r.relativeFree,3)}]}/><Collapsible page="quick-comparison" block="protocol" title="比较口径">{Object.entries(result.protocol).map(([k,v])=><p key={k}>{k}：{v}</p>)}</Collapsible></>}</div></Drawer>;
}
