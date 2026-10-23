import {object} from './api';
import {studyHash} from './routing';

export const reportGroups=[['formal','正式结论'],['energy','能量与排序'],['state-check','电子态检查'],['ensemble','构象集合'],['irc','IRC'],['thermo','热化学 / 能量剖面'],['coverage','通道覆盖'],['ts','TS 标签'],['nci','NCI'],['stage-review','阶段审阅'],['figure','图与演示'],['other','其他']] as const;
export type ReportMetadata={catalog_kind?:string;kind?:string;category_basis?:string;schema?:string|null;name:string};
export function reportCategory(report:ReportMetadata):{kind:string;basis:string}{
 const schemaKinds:Record<string,string>={'ag-ensemble/1':'ensemble','ag-irc-review/1':'irc','ag-thermo/1':'thermo','ag-profile/1':'thermo','ag-channel-coverage/1':'coverage','ag-nci/1':'nci'};
 if(report.schema&&Object.hasOwn(schemaKinds,report.schema))return {kind:schemaKinds[report.schema],basis:'按 schema'};
 if(reportGroups.some(([kind])=>kind===report.catalog_kind))return {kind:report.catalog_kind!,basis:'按登记'};
 if(reportGroups.some(([kind])=>kind===report.kind))return {kind:report.kind!,basis:report.category_basis??'按报告声明'};
 if(tsLabelFile(report.name))return {kind:'ts',basis:'按 TS 标签目录'};
 return {kind:/\.(png|jpe?g|webp|svg|html)$/i.test(report.name)?'figure':'other',basis:'按文件类型'};
}
export const tsLabelFile=(name:string)=>/^ts-labels\/[^/]+\/(labels\.json|labels\.md|channel-suggestions\.csv)$/.test(name);
export function analysisType(schema:unknown,name=''):string{
 if(tsLabelFile(name))return 'ts';
 const types:Record<string,string>={'ag-ensemble/1':'ensemble','ag-irc-review/1':'irc','ag-thermo/1':'thermo','ag-profile/1':'thermo','ag-channel-coverage/1':'coverage','ag-nci/1':'nci'};
 return typeof schema==='string'&&Object.hasOwn(types,schema)?types[schema]:'file';
}
export const analysisLink=(study:string,name:string,schema:unknown)=>studyHash(study,'analysis',analysisType(schema,name),...name.split('/'));
const record=(v:unknown)=>object(v)?v:{};
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v:typeof v==='number'&&Number.isFinite(v)?String(v):'—';
const rows=(v:unknown)=>Array.isArray(v)?v.filter(object):[];
// Summaries copy saved fields, array counts and status only. No energy ranking,
// threshold evaluation or scientific acceptance is performed here.
export function analysisConclusion(value:unknown,name=''):string{
 if(!object(value))return '—';
 if(tsLabelFile(name)){
  const attempts=rows(value.attempts);
  return attempts.map(a=>{const centers=Array.isArray(a.product_centers)&&a.product_centers.every(c=>object(c)&&typeof c.label==='string')?rows(a.product_centers):null;return `${text(a.attempt)}：产物构型 ${text(a.product_configuration)} · unknown ${centers?centers.filter(c=>c.label==='unknown').length:'—'} / needs_review ${centers?centers.filter(c=>c.label==='needs_review').length:'—'} · 催化剂自检 ${text(record(a.catalyst_check).status)}`;}).join('；')||'—';
 }
 switch(value.schema){
 case 'ag-ensemble/1':return `候选 ${Array.isArray(value.candidates)?value.candidates.length:'—'} · 分组 ${Array.isArray(value.bin_summary)?value.bin_summary.length:'—'} · 最低者 ${Object.entries(record(value.references)).map(([layer,id])=>`${layer}: ${text(id)}`).join(' / ')||'—'}`;
 case 'ag-irc-review/1':{const d=record(value.directions);return `forward：${text(record(d.forward).summary)} · reverse：${text(record(d.reverse).summary)}`;}
 case 'ag-thermo/1':return `系综 G：${text(value.ensemble_G)} ${record(value.units).energy==='Hartree'?'Eh':'（单位 —）'}`;
 case 'ag-profile/1':return rows(value.selectivity).map(s=>`${text(s.id)} · ${rows(s.pairwise).map(p=>`${text(p.a)}/${text(p.b)} ΔΔG‡ ${text(p.ddG_barrier_kcal)} kcal/mol · 比 ${text(p.ratio_a_over_b)}`).join('；')||'ΔΔG‡ —'} · 选择性 ${Object.entries(record(s.products)).map(([name,p])=>`${name}: ${text(record(p).fraction)}`).join(' / ')||'—'}`).join('；')||'—';
 case 'ag-channel-coverage/1':{const entries=[...rows(value.channels),...rows(value.product_branches)];return !entries.length||entries.some(r=>!Array.isArray(r.imbalances))?'不均衡：—':entries.some(r=>(r.imbalances as unknown[]).length)?'报告记录：存在不均衡':'报告记录：未列出不均衡';}
 case 'ag-nci/1':return rows(value.frames).map(frame=>`帧 ${text(frame.frame)}：${rows(frame.fragment_pairs).map(pair=>`${Array.isArray(pair.fragments)?pair.fragments.map(text).join(' / ')+'：':''}${rows(pair.atom_pairs).filter(p=>Array.isArray(p.atoms)&&typeof p.percent==='number'&&Number.isFinite(p.percent)).sort((a,b)=>Number(b.percent)-Number(a.percent)).slice(0,3).map(p=>`原子 ${(p.atoms as unknown[]).map(text).join('–')} ${text(p.percent)}%`).join(' / ')||'—'}`).join('；')||'—'}`).join('；')||'—';
 default:return '—';
 }
}
