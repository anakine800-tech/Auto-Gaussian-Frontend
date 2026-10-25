import {object} from './api';
import type {AttemptSummary,Study} from './api';
import {reportCategory} from './analysis-summary';
import {comparisonEntries,comparisonEnergy,comparisonValue,spinTreatmentOf} from './quick-comparison';
import type {CompareEntry,CompareSource,ComparedObject,EnergyMetric} from './quick-comparison';

export type EnergyBasis='E'|'E+ZPE'|'G';
export type Adoption={attempt:string;report:string|null};
export type Expectation<T>={state:'unset'|'unknown';value:null}|{state:'set';value:T};
export type Assignment={status:'none'|'tentative'|'verified'|'undetermined';channels:string[]};
export type Outcome='diagnosed'|'accepted'|'other_channel'|'minimum'|'opt_failed'|'multiple_imag'|'other';
export type ChannelStatus='untried'|'attempted_not_found'|'tentative_found'|'verified'|'pending_confirmation'|'excluded_low_confidence';
export type CatalogChannel={id:string;name:string;definition:string;product_branch:string|null;discovered:boolean;confirmed:boolean;status:ChannelStatus;declaration:null|{status:'verified'|'excluded-low-confidence';at:string;quote:string;reason:string|null};candidate_ids:string[];outcome_counts:Partial<Record<Outcome,number>>};
export type CandidateResult={schema:'ag-catalog/2';seq:number;at:string;op:'candidate-result';prev_sha256:string|null;object:string;candidate:string;outcome:Outcome;attempt:string|null;diagnosis:Record<string,unknown>|null;assignment:Assignment;quote:string|null;note:string|null;checks:Record<string,unknown>};
export type CatalogCandidate={id:string;file:string;sha256:string;n_atoms:number;formula:string;origin:'scan'|'qst'|'template-transform'|'path-search'|'manual'|'literature';parent:{attempt:string|null;file:{source:string;sha256:string}|null};transform:Record<string,unknown>|null;target_channel:string|null;literature:{doi:string;si_location:string|null}|null;note:string|null;registered_at:string;results:CandidateResult[];latest_assignment:Assignment|null};
export type CatalogLedger={expected:{formula:Expectation<string>;charge:Expectation<number>};channels:CatalogChannel[];candidates:CatalogCandidate[];coverage:null|{statement:'stable'|'withdrawn';scope:string;budget:string;at:string;quote:string};member_mismatches:{attempt:string;field:'formula'|'charge'|'multiplicity';expected:string|number;actual:string|number}[]};
export type ChainObject={id:string;name:string;state_label:string|null;multiplicity:number|null;registered:boolean;status:'adopted'|'candidate'|'retired';members:{attempt:string;role:string}[];adopted:Partial<Record<'opt'|'freq'|'sp',Adoption>>;values:Record<string,unknown>;ledger?:CatalogLedger};
export type CatalogStudy=Study&{energy_basis?:EnergyBasis;catalog?:{state:unknown;journal_ok:boolean;warning:string|null}};
export const record=(v:unknown):Record<string,unknown>=>object(v)?v:{};
const string=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v:null;
const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
export const roles=['crest','scan','ts','opt','freq','stable','irc','sp','other'] as const;
export const roleLabels:Record<string,string>={crest:'CREST',scan:'Scan',ts:'TS',opt:'Opt',freq:'Freq',stable:'Stable',irc:'IRC',sp:'SP',other:'其他'};
export const routeOf=(a:AttemptSummary)=>string(record(a.facts.data).route)??string(record(record(a.manifest.data).science).route)??'';

// Port of ag/src/ag/catalog.py infer_roles (T119). Keep order and the combined
// task rule identical: an Opt+Freq job cannot masquerade as standalone SP.
export function inferRoles(manifest:unknown):string[]{
 const m=record(manifest),science=record(m.science);
 if(m.template==='crest')return ['crest'];
 const scan=science.scan;
 if(scan&&(Array.isArray(scan)?scan.length:object(scan)?Object.keys(scan).length:true))return ['scan'];
 if(m.template==='xtb')return [Object.hasOwn(record(m.template_params),'--opt')?'opt':'sp'];
 if(!['gaussian','gaussian-cp'].includes(String(m.template)))return [];
 const route=string(science.route)??'',found=new Set([...route.matchAll(/(?:^|[\s#])(opt|freq|stable|irc|scan|sp)\b/gi)].map(m=>m[1].toLowerCase()));
 const opt=route.match(/(?:^|[\s#])opt\b\s*(?:=\s*)?(\([^()]*\)|[\w]+)/i);
 if(found.has('opt')&&opt&&/\b(ts|qst2|qst3)\b/i.test(opt[1])){found.delete('opt');found.add('ts');}
 if(!found.size&&/\S+\/\S+/.test(route))found.add('sp');
 if([...found].some(r=>r!=='sp'))found.delete('sp');
 return roles.filter(r=>found.has(r));
}
export function calculationType(a:AttemptSummary,role?:string){
 const inferred=role?[role]:inferRoles(a.manifest.data);
 return (a.template==='xtb'?'xTB · ':'')+(inferred.map(r=>roleLabels[r]??r).join(' + ')||'未知');
}

export function catalogObjects(data:CatalogStudy):ChainObject[]{
 const state=record(data.catalog?.state);
 if(!hasCatalog(data)||!Array.isArray(state.objects))return [];
 return state.objects.filter(object).flatMap(raw=>{
  if(!string(raw.id)||!string(raw.name)||!['adopted','candidate','retired'].includes(String(raw.status))||!Array.isArray(raw.members))return [];
  const adopted:ChainObject['adopted']={};
  for(const role of ['opt','freq','sp'] as const){const ref=record(record(raw.adopted)[role]);if(string(ref.attempt))adopted[role]={attempt:String(ref.attempt),report:string(ref.report)};}
  // The existing read endpoint validates every v2 field; no status derivation
  // or additional request belongs in this model. V1 objects retain their shape.
  const ledger=state.schema==='ag-catalog-state/2'?{ledger:{expected:raw.expected,channels:raw.channels,candidates:raw.candidates,coverage:raw.coverage,member_mismatches:raw.member_mismatches} as CatalogLedger}:{};
  return [{id:String(raw.id),name:String(raw.name),state_label:string(raw.state_label),multiplicity:finite(raw.multiplicity),registered:true,status:raw.status as ChainObject['status'],members:raw.members.filter(object).filter(m=>string(m.attempt)).map(m=>({attempt:String(m.attempt),role:string(m.role)??'other'})),adopted,values:record(raw.values),...ledger}];
 });
}
export const hasCatalog=(data:CatalogStudy)=>data.catalog?.journal_ok===true&&['ag-catalog-state/1','ag-catalog-state/2'].includes(String(record(data.catalog.state).schema));

// suggest groups only the unassigned induced subgraph. A registered (including
// retired) parent never bridges two unregistered groups. No identity inference.
export function chainObjects(data:CatalogStudy):ChainObject[]{
 const registered=catalogObjects(data),assigned=new Set(registered.flatMap(o=>o.members.map(m=>m.attempt)));
 const remaining=new Set(data.attempts.map(a=>a.id).filter(id=>!assigned.has(id))),adjacency=new Map([...remaining].map(id=>[id,new Set<string>()]));
 for(const a of data.attempts){const parents=record(a.manifest.data).parents;if(!Array.isArray(parents))continue;
  for(const p of parents.filter(object))if(remaining.has(a.id)&&remaining.has(String(p.attempt_id))){adjacency.get(a.id)!.add(String(p.attempt_id));adjacency.get(String(p.attempt_id))!.add(a.id);}
 }
 const used=new Set(registered.map(o=>o.id)),groups:ChainObject[]=[];
 while(remaining.size){const todo=[[...remaining].sort()[0]],members=new Set<string>();
  while(todo.length){const id=todo.pop()!;if(members.has(id))continue;members.add(id);todo.push(...adjacency.get(id)!);}
  members.forEach(id=>remaining.delete(id));let n=groups.length+1;while(used.has(`object-${n}`))n++;const id=`object-${n}`;used.add(id);
  groups.push({id,name:`未登记 · ${id}`,state_label:null,multiplicity:null,registered:false,status:'candidate',adopted:{},values:{},members:[...members].sort().map(attempt=>({attempt,role:inferRoles(data.attempts.find(a=>a.id===attempt)!.manifest.data)[0]??'other'}))});
 }
 return [...registered,...groups];
}
export function orderedMembers(obj:ChainObject,attempts:AttemptSummary[]){
 const members=new Map(obj.members.map(m=>[m.attempt,m])),byId=new Map(attempts.map(a=>[a.id,a])),visited=new Set<string>(),result:ChainObject['members']=[];
 const visit=(id:string)=>{if(visited.has(id))return;visited.add(id);const parents=record(byId.get(id)?.manifest.data).parents;
  if(Array.isArray(parents))for(const p of parents.filter(object))if(members.has(String(p.attempt_id)))visit(String(p.attempt_id));result.push(members.get(id)!);};
 [...members.keys()].sort().forEach(visit);return result;
}
export function representativeAttempt(obj:ChainObject,attempts:AttemptSummary[]):string|null{
 if(obj.registered){if(obj.status!=='adopted')return null;for(const role of ['sp','freq','opt'] as const){const id=obj.adopted[role]?.attempt;if(id&&attempts.some(a=>a.id===id))return id;}return null;}
 return orderedMembers(obj,attempts).filter(m=>attempts.some(a=>a.id===m.attempt&&a.state==='fetched')).at(-1)?.attempt??null;
}
export function electronicState(obj:ChainObject){return obj.state_label??(obj.multiplicity===1?'S':obj.multiplicity===3?'T':obj.multiplicity?`多重度 ${obj.multiplicity}`:'电子态未登记');}
export function chainStatus(obj:ChainObject,attempts:AttemptSummary[]){
 if(obj.status==='retired')return '历史';if(obj.status==='adopted')return '已采用';
 return obj.members.some(m=>attempts.some(a=>a.id===m.attempt&&a.state==='finished'))?'待取回':'候选';
}
const metricFor=(basis:EnergyBasis):EnergyMetric=>basis==='E'?'sp':basis==='E+ZPE'?'zero':'g';
const comparedObject=(obj:ChainObject):ComparedObject=>({...obj,members:obj.members.map(m=>m.attempt),adopted:Object.fromEntries(Object.entries(obj.adopted).map(([role,ref])=>[role,ref.attempt]))});
export function energyValue(obj:ChainObject,basis:EnergyBasis):number|null{
 return comparisonValue({id:obj.id,label:obj.name,object:comparedObject(obj),layers:{},error:obj.registered?'':'未登记'},metricFor(basis));
}
export const defaultBasis=(data:CatalogStudy):EnergyBasis=>['E','E+ZPE','G'].includes(data.energy_basis??'')?data.energy_basis!:'E+ZPE';
export type CompositionSource=Partial<CompareSource>&{error?:string};
export type EnergyRow={object:ChainObject;energy:number|null;relative:number|null;reason:string|null;stateGap:boolean};
export {HARTREE_TO_KCAL} from './quick-comparison';

export function methodFromRoute(route:string){
 const pairs=[...route.replace(/\s*\/\s*/g,'/').matchAll(/(?:^|[\s#])([^\s/#]+)\/([^\s]+)/g)];
 return pairs.length===1?`${pairs[0][1]}/${pairs[0][2]}`:null;
}
export function spinTreatment(route:string){const pair=methodFromRoute(route);return pair?spinTreatmentOf(pair.split('/')[0]):'—';}
export function relativeEnergies(objects:ChainObject[],attempts:AttemptSummary[],sources:Record<string,CompositionSource>,basis:EnergyBasis,referenceId=''){
 const loaded:Record<string,CompareSource>=Object.fromEntries(attempts.map(a=>[a.id,{id:a.id,facts:sources[a.id]?.facts??a.facts,geometry:sources[a.id]?.geometry??{data:null,error:sources[a.id]?.error??'最终几何缺失'}}]));
 const registered=objects.filter(o=>o.registered).map(comparedObject);
 const entries:CompareEntry[]=objects.map(o=>{
  const id=o.adopted.sp?.attempt??o.members[0]?.attempt??o.id;
  const entry=comparisonEntries([id],registered,loaded)[0];
  return o.registered?entry:{...entry,error:'未登记'};
 });
 const refIndex=referenceId?objects.findIndex(o=>o.id===referenceId):objects.map((o,i)=>({i,value:energyValue(o,basis)})).filter(r=>r.value!==null).sort((a,b)=>a.value!-b.value!||objects[a.i].id.localeCompare(objects[b.i].id))[0]?.i??-1;
 const rows:EnergyRow[]=objects.map((object,i)=>{
  if(refIndex<0)return {object,energy:null,relative:null,reason:entries[i].error||'参照项所需能量缺失',stateGap:false};
  const cell=comparisonEnergy(entries[i],entries[refIndex],metricFor(basis));
  return {object,energy:cell.value,relative:cell.delta,reason:cell.reason||null,stateGap:cell.stateGap};
 });
 return {rows,referenceId:objects[refIndex]?.id??''};
}

// Only explicit report references support a signature label; an unrelated
// signed milestone or an adoption quote cannot sign an object's result.
export function reportReferences(text:string,names:string[]):string[]{
 const refs=new Set<string>();
 for(const match of text.matchAll(/\]\(<?([^\s)>]+)>?\)|`([^`]+)`|(?:^|[\s|])((?:analyses\/)[^\s|，；。]+)/g)){
  let path=match[1]??match[2]??match[3];try{path=decodeURIComponent(path.split('#')[0]);}catch{continue;}
  path=path.replace(/^\.\//,'').replace(/^analyses\//,'');if(names.includes(path))refs.add(path);
 }
 return [...refs];
}
export function adoptionState(obj:ChainObject,data:Study){
 const refs=Object.values(obj.adopted).flatMap(a=>a?.report?[a.report]:[]),entries=data.sections['里程碑签字']?.entries??[];
 if(entries.some(e=>e.state==='recorded'&&reportReferences(e.text,refs).length))return '已签';
 if(entries.some(e=>e.state==='pending'&&reportReferences(e.text,refs).length))return '待签';return '候选';
}
export function keyReports(data:CatalogStudy,objects=catalogObjects(data)){
 if(!hasCatalog(data))return [];
 const names=data.analyses.map(r=>r.name),selected=new Map<string,string>();
 const add=(name:string,reason:string)=>{if(names.includes(name)&&!selected.has(name))selected.set(name,reason);};
 // Key-report selection honors an explicit formal registration even when a
 // known schema places the report in another library category (H6 vs H9).
 const registeredKinds=record(record(data.catalog?.state).report_kinds);
 data.analyses.filter(r=>registeredKinds[r.name]==='formal'||reportCategory(r).kind==='formal').sort((a,b)=>a.name.localeCompare(b.name)).forEach(r=>add(r.name,'正式结论'));
 objects.filter(o=>o.status==='adopted').forEach(o=>Object.values(o.adopted).forEach(a=>{if(a?.report)add(a.report,'被采用结果引用');}));
 (data.sections['里程碑签字']?.entries??[]).filter(e=>e.state==='pending').forEach(e=>reportReferences(e.text,names).forEach(name=>add(name,'里程碑待签')));
 return [...selected].map(([name,reason])=>({report:data.analyses.find(r=>r.name===name)!,reason}));
}
