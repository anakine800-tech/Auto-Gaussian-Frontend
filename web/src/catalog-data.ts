import {object} from './api';
import type {AttemptSummary,Study} from './api';
import {reportCategory} from './analysis-summary';

export type EnergyBasis='E'|'E+ZPE'|'G';
export type Adoption={attempt:string;report:string|null};
export type ChainObject={id:string;name:string;state_label:string|null;multiplicity:number|null;registered:boolean;status:'adopted'|'candidate'|'retired';members:{attempt:string;role:string}[];adopted:Partial<Record<'opt'|'freq'|'sp',Adoption>>;values:Record<string,unknown>};
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
 if(data.catalog?.journal_ok!==true||state.schema!=='ag-catalog-state/1'||!Array.isArray(state.objects))return [];
 return state.objects.filter(object).flatMap(raw=>{
  if(!string(raw.id)||!string(raw.name)||!['adopted','candidate','retired'].includes(String(raw.status))||!Array.isArray(raw.members))return [];
  const adopted:ChainObject['adopted']={};
  for(const role of ['opt','freq','sp'] as const){const ref=record(record(raw.adopted)[role]);if(string(ref.attempt))adopted[role]={attempt:String(ref.attempt),report:string(ref.report)};}
  return [{id:String(raw.id),name:String(raw.name),state_label:string(raw.state_label),multiplicity:finite(raw.multiplicity),registered:true,status:raw.status as ChainObject['status'],members:raw.members.filter(object).filter(m=>string(m.attempt)).map(m=>({attempt:String(m.attempt),role:string(m.role)??'other'})),adopted,values:record(raw.values)}];
 });
}
export const hasCatalog=(data:CatalogStudy)=>data.catalog?.journal_ok===true&&record(data.catalog.state).schema==='ag-catalog-state/1';

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
export function energyValue(obj:ChainObject,basis:EnergyBasis):number|null{
 if(!obj.registered||obj.status!=='adopted')return null;
 const e=finite(obj.values.scf_h),zpe=finite(obj.values.zpe_h),g=finite(obj.values.g_h),freq=finite(obj.values.freq_scf_h);
 if(e===null||!obj.adopted.sp)return null;
 // All values are catalog Hartree snapshots. Never backfill a missing Freq
 // SCF with SP SCF, and never add the total Freq Gibbs energy directly to SP.
 const value=basis==='E'?e:!obj.adopted.freq?null:basis==='E+ZPE'?(zpe===null?null:e+zpe):(g===null||freq===null?null:e+(g-freq));
 return finite(value);
}
export const defaultBasis=(data:CatalogStudy):EnergyBasis=>['E','E+ZPE','G'].includes(data.energy_basis??'')?data.energy_basis!:'E+ZPE';
export type CompositionSource={geometry?:{data:unknown;error:string|null};error?:string};
export type EnergyRow={object:ChainObject;energy:number|null;relative:number|null;reason:string|null;stateGap:boolean};
export const HARTREE_TO_KCAL=627.5094740631;

export function methodFromRoute(route:string){
 const pairs=[...route.replace(/\s*\/\s*/g,'/').matchAll(/(?:^|[\s#])([^\s/#]+)\/([^\s]+)/g)];
 return pairs.length===1?`${pairs[0][1]}/${pairs[0][2]}`:null;
}
function methodParts(method:string){
 const prefix=method.match(/^(ro|r|u)/i)?.[1];
 return prefix&&method.length>prefix.length?{method:method.slice(prefix.length),spin:prefix.toUpperCase()}:{method,spin:'未显式指定'};
}
export function spinTreatment(route:string){const pair=methodFromRoute(route);return pair?methodParts(pair.split('/')[0]).spin:'—';}
function routeProtocol(a:AttemptSummary|undefined,role:'SP'|'Freq'){
 if(!a)throw Error(`缺少已采用的 ${role} Attempt`);
 const route=routeOf(a).replace(/\s*([=,/])\s*/g,'$1').replace(/\(\s*/g,'(').replace(/\s*\)/g,')').toLowerCase();
 const pair=methodFromRoute(route);if(!pair)throw Error(`${role} 方法或基组缺失 / 无法识别`);
 const [rawMethod,basis]=pair.split('/'),{method}=methodParts(rawMethod);
 // R/U/RO describe spin treatment, not a different method for state gaps.
 // Matching the word "gen" cannot establish identical basis definitions.
 if(['gen','genecp','chkbasis'].includes(basis)||/\b(?:pseudo|extrabasis)\b/.test(route))throw Error(`${role} 自定义基组信息不足`);
 const scrfs=[...route.matchAll(/\bscrf\b\s*=?\s*(\([^)]*\)|[^\s]*)/g)];
 let solvent='gas';if(scrfs.length){
  if(scrfs.length!==1)throw Error(`${role} 溶剂设置有歧义`);
  const options=scrfs[0][1].replace(/^\(|\)$/g,'').split(',').sort();
  if(!options.some(s=>s.startsWith('solvent='))||options.some(s=>['read','external','generic','solvent=generic'].includes(s)))throw Error(`${role} 溶剂信息不足`);
  solvent=options.join(',');
 }
 // The adopted Freq supplies corrections, so its route must be checked too.
 const dispersion=route.match(/\b(?:empiricaldispersion|em)=(\([^)]*\)|[^\s]+)/)?.[1]??'default';
 const angular=[...route.matchAll(/\b(5d|6d|7f|10f)\b/g)].map(m=>m[1]).sort().join(',');
 return {route,spec:{方法:method,色散:dispersion,基组:basis,基函数形式:angular,溶剂:solvent}};
}
function thermodynamicSetting(route:string,key:'temperature'|'pressure'){
 const matches=[...route.matchAll(new RegExp(`\\b${key}\\b(?:=([^\\s]+))?`,'g'))];
 if(!matches.length)return key==='temperature'?'298.15':'1';
 const raw=matches[0][1]??'',value=Number(raw.replace(/d/i,'e'));
 // A present but unreadable setting must not silently become a default.
 if(matches.length!==1||!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[ed][+-]?\d+)?$/i.test(raw)||!Number.isFinite(value)||value<=0)throw Error(`Freq ${key==='temperature'?'温度':'压力'}无法识别`);
 return String(value);
}
function protocol(a:AttemptSummary|undefined,source:CompositionSource|undefined,freq:AttemptSummary|undefined,basis:EnergyBasis){
 const sp=routeProtocol(a,'SP');
 const spec:Record<string,string>={...sp.spec};
 if(basis!=='E'){
  const correction=routeProtocol(freq,'Freq');
  for(const [key,value] of Object.entries(correction.spec))spec[`Freq ${key}`]=value;
  if(basis==='G'){
   spec['Freq 温度']=thermodynamicSetting(correction.route,'temperature');
   spec['Freq 压力']=thermodynamicSetting(correction.route,'pressure');
  }
 }
 const f=record(a!.facts.data);if(!Number.isInteger(f.charge))throw Error('SP 电荷缺失');
 if(!Number.isInteger(f.multiplicity)||Number(f.multiplicity)<1)throw Error('SP 多重度缺失');
 if(source?.error||source?.geometry?.error)throw Error('SP 元素组成无法读取');
 const atoms=record(source?.geometry?.data).atoms;
 if(!Array.isArray(atoms)||!atoms.length||atoms.length!==f.n_atoms)throw Error('SP 元素组成缺失或原子数不符');
 const counts=new Map<number,number>();for(const atom of atoms){const z=record(atom).atomic_number;if(!Number.isInteger(z)||Number(z)<1||Number(z)>118)throw Error('SP 元素组成无法识别');counts.set(Number(z),(counts.get(Number(z))??0)+1);}
 const composition=[...counts].sort((a,b)=>a[0]-b[0]).map(([z,n])=>`${z}:${n}`).join(',');
 spec['元素组成']=composition;spec['电荷']=String(f.charge);
 return {spec,multiplicity:Number(f.multiplicity)};
}
export function relativeEnergies(objects:ChainObject[],attempts:AttemptSummary[],sources:Record<string,CompositionSource>,basis:EnergyBasis,referenceId=''){
 const rows:EnergyRow[]=objects.map(o=>({object:o,energy:energyValue(o,basis),relative:null,reason:!o.registered?'未登记':o.status!=='adopted'?'未采用':null,stateGap:false}));
 const ref=(referenceId?rows.find(r=>r.object.id===referenceId):rows.filter(r=>r.energy!==null).sort((a,b)=>a.energy!-b.energy!||a.object.id.localeCompare(b.object.id))[0]);
 const inspect=(o:ChainObject)=>protocol(attempts.find(a=>a.id===o.adopted.sp?.attempt),sources[o.adopted.sp?.attempt??''],attempts.find(a=>a.id===o.adopted.freq?.attempt),basis);
 let refSpec:ReturnType<typeof protocol>|null=null,refError='';
 if(ref)try{refSpec=inspect(ref.object);}catch(e){refError=(e as Error).message;}
 for(const row of rows){if(row.reason)continue;
  if(row.energy===null){row.reason=`${basis} 所需能量或采用来源缺失`;continue;}
  if(!ref||ref.energy===null){row.reason='参照对象能量缺失';continue;}
  if(!refSpec){row.reason=`参照对象：${refError}`;continue;}
  try{const spec=inspect(row.object),keys=Object.keys(spec.spec) as (keyof typeof spec.spec)[];
   const differences=keys.filter(k=>spec.spec[k]!==refSpec!.spec[k]);
   if(differences.length){row.reason=differences.map(k=>`${k}不同`).join('、');continue;}
   const delta=(row.energy-ref.energy)*HARTREE_TO_KCAL;
   if(!Number.isFinite(delta)){row.reason='能量差超出有限数值范围';continue;}
   row.relative=delta;row.stateGap=spec.multiplicity!==refSpec.multiplicity;
  }catch(e){row.reason=(e as Error).message;}
 }
 return {rows,referenceId:ref?.object.id??''};
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
