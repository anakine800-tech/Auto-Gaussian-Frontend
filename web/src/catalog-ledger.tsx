import type {Assignment,CatalogCandidate,CatalogChannel,ChainObject,Expectation,Outcome} from './catalog-data';
import {routeHash} from './routing';
import {StatusBadge} from './ui';
import './ui/catalog-ledger.css';

const statuses={untried:'未尝试',attempted_not_found:'已尝试未找到',tentative_found:'暂定找到',verified:'已验证',pending_confirmation:'待确认通道',excluded_low_confidence:'低置信度排除'};
const origins={scan:'扫描（scan）',qst:'QST（qst）','template-transform':'模板变换（template-transform）','path-search':'路径搜索（path-search）',manual:'手工（manual）',literature:'文献（literature）'};
const outcomes:Record<Outcome,string>={diagnosed:'已登记诊断',accepted:'通过验收（登记）',other_channel:'落入其他通道',minimum:'收敛到极小点',opt_failed:'优化失败',multiple_imag:'多个虚频',other:'其他'};
const fields={formula:'组成',charge:'电荷',multiplicity:'多重度'};
function AttemptLink({study,id}:{study:string;id:string|null}){return id?<a href={routeHash([study,id])}>{id}</a>:<>未关联</>;}
function JsonDetails({label,value}:{label:string;value:Record<string,unknown>|null}){return value===null?null:<details className="ledger-json"><summary>{label}（原始 JSON）</summary><pre>{JSON.stringify(value,null,2)}</pre></details>;}
function ExpectedValue({value}:{value:Expectation<string|number>}){return <>{value.state==='unset'?'未提供':value.state==='unknown'?'未知':`值：${value.value}`}</>;}
function AssignmentText({value,channels}:{value:Assignment|null;channels:CatalogChannel[]}){
 if(value===null)return <>暂无结果</>;
 const label={none:'未归属',tentative:'暂定归属',verified:'已验证归属（登记）',undetermined:'归属不能唯一确定'}[value.status];
 const names=value.channels.map(id=>`${channels.find(c=>c.id===id)?.name??id}（${id}）`);
 return <>{label}{names.length?` · ${value.status==='undetermined'?'候选通道：':''}${names.join('、')}`:value.status==='undetermined'?' · 未列出候选通道':''}</>;
}
function Candidate({study,candidate:c,channels}:{study:string;candidate:CatalogCandidate;channels:CatalogChannel[]}){
 return <article className="ledger-candidate" aria-label={`候选 ${c.id}`}>
  <h4>{c.id}</h4>
  <dl className="ledger-facts">
   <dt>来源</dt><dd>{origins[c.origin]}</dd>
   <dt>父结构</dt><dd>{c.parent.attempt&&<AttemptLink study={study} id={c.parent.attempt}/>} {c.parent.file&&<span>文件 SHA-256：<code title={c.parent.file.sha256}>{c.parent.file.sha256.slice(0,12)}</code></span>}{!c.parent.attempt&&!c.parent.file&&'未提供'}</dd>
   <dt>目标通道</dt><dd>{c.target_channel?`${channels.find(ch=>ch.id===c.target_channel)?.name??c.target_channel}（${c.target_channel}）`:'未指定'}</dd>
   <dt>登记时间</dt><dd><time>{c.registered_at}</time></dd>
   <dt>组成 / 原子数</dt><dd>{c.formula} / {c.n_atoms}</dd>
   <dt>最新归属</dt><dd className="ledger-latest"><AssignmentText value={c.latest_assignment} channels={channels}/></dd>
   {c.literature&&<><dt>文献</dt><dd>DOI：{c.literature.doi}{c.literature.si_location&&` · ${c.literature.si_location}`}</dd></>}
   {c.note&&<><dt>备注</dt><dd>{c.note}</dd></>}
  </dl>
  <JsonDetails label="transform" value={c.transform}/>
  {c.results.length?<div className="ledger-scroll" tabIndex={0} role="region" aria-label={`候选 ${c.id} 的全部结果，可横向滚动`}><table aria-label={`${c.id} 全部结果`}><thead><tr>{['时间 / 序号','Attempt','结果','归属','诊断 / 记录'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{c.results.map(r=><tr key={r.seq}>
   <td><time>{r.at}</time><small>事件 {r.seq}</small></td><td><AttemptLink study={study} id={r.attempt}/></td>
   <td>{outcomes[r.outcome]}<small>{r.outcome}</small></td><td><AssignmentText value={r.assignment} channels={channels}/></td>
   <td>{r.diagnosis===null?'无诊断':'有诊断'}<JsonDetails label="diagnosis" value={r.diagnosis}/>{r.quote&&<blockquote>{r.quote}</blockquote>}{r.note&&<p>{r.note}</p>}</td>
  </tr>)}</tbody></table></div>:<p className="muted">暂无结果记录。</p>}
 </article>;
}
export function CatalogLedgerPanel({study,object:o}:{study:string;object:ChainObject}){
 const ledger=o.ledger;
 if(!ledger)return null;
 const {expected,channels,candidates,coverage,member_mismatches:mismatches}=ledger;
 const byId=new Map(candidates.map(c=>[c.id,c]));
 const linked=new Set(channels.flatMap(c=>c.candidate_ids));
 const unassigned=candidates.filter(c=>!linked.has(c.id));
 return <details className="catalog-ledger" open aria-label={`${o.name} · 通道与候选`}>
  <summary>{o.name} · 通道与候选</summary>
  <p className="ledger-notice">catalog 是登记视图，不是科学验收；状态由登记事件派生。</p>
  <section aria-label="对象期望值"><h3>对象期望值</h3><dl className="ledger-expectations">
   <div><dt>期望组成</dt><dd><ExpectedValue value={expected.formula}/></dd></div>
   <div><dt>期望电荷</dt><dd><ExpectedValue value={expected.charge}/></dd></div>
   <div><dt>期望多重度</dt><dd>{o.multiplicity===null?'未提供 / 未知（原记录未区分）':`值：${o.multiplicity}`}</dd></div>
  </dl></section>
  {mismatches.length>0&&<section aria-label="成员不一致"><h3>成员不一致</h3><p>只报告，未改动任何文件。</p><ul>{mismatches.map((m,i)=><li key={i}><AttemptLink study={study} id={m.attempt}/> · {fields[m.field]} · 期望 {m.expected} · 实际 {m.actual}</li>)}</ul></section>}
  <section aria-label="通道表"><h3>通道</h3>
   {channels.length?<div className="ledger-scroll" tabIndex={0} role="region" aria-label="通道表，可横向滚动"><table aria-label="登记通道"><thead><tr>{['名称 / 定义','产物分支','状态 / 负责人声明','候选数','各类结果计数'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{channels.map(c=><tr key={c.id}>
    <th scope="row">{c.name}<small>{c.id}</small><p>{c.definition}</p>{c.discovered&&!c.confirmed&&<small>采样中新发现</small>}</th><td>{c.product_branch??'未提供'}</td>
    <td><StatusBadge tone={c.status==='verified'?'info':c.status==='tentative_found'?'warn':'neutral'}>{statuses[c.status]}{c.status==='tentative_found'?' · 待负责人确认':''}</StatusBadge>
     {c.declaration&&<div className="ledger-declaration"><blockquote>{c.declaration.quote}</blockquote><time>{c.declaration.at}</time>{c.declaration.reason&&<p>理由：{c.declaration.reason}</p>}</div>}
    </td><td>{c.candidate_ids.length}</td><td>{Object.entries(c.outcome_counts).map(([key,count])=><div key={key}>{outcomes[key as Outcome]}：{count}</div>)}{Object.keys(c.outcome_counts).length===0&&'无结果'}</td>
   </tr>)}</tbody></table></div>:<p className="muted">暂无登记通道。</p>}
   <p className="muted">同一候选可关联多个通道；各通道计数不能相加作为不重复尝试数。</p>
  </section>
  <section aria-label="候选台账"><h3>候选台账</h3>{channels.map(c=><details className="ledger-group" key={c.id}><summary>{c.name} · 候选 {c.candidate_ids.length}</summary>{c.candidate_ids.map(id=><Candidate key={id} study={study} candidate={byId.get(id)!} channels={channels}/>)}{c.candidate_ids.length===0&&<p className="muted">暂无关联候选。</p>}</details>)}
   <details className="ledger-group"><summary>未关联通道的候选 · {unassigned.length}</summary>{unassigned.map(c=><Candidate key={c.id} study={study} candidate={c} channels={channels}/>)}{unassigned.length===0&&<p className="muted">暂无未关联通道的候选。</p>}</details>
  </section>
  <section aria-label="整体覆盖结论"><h3>整体覆盖结论</h3>{coverage?<><p className="ledger-coverage">{coverage.statement==='stable'?'在声明的通道范围与采样预算内稳定':'已撤销'}</p><dl className="ledger-facts"><dt>通道范围</dt><dd>{coverage.scope}</dd><dt>采样预算</dt><dd>{coverage.budget}</dd></dl><blockquote>{coverage.quote}</blockquote><time>{coverage.at}</time></>:<p className="muted">尚无整体覆盖声明。</p>}</section>
 </details>;
}
