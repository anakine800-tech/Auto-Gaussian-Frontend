import {object} from './api';
import type {Attempt} from './api';
import {isGeometry} from './molecule-viewer';

// T82: ag/_profile_sources.py protocol(), SCF_ENERGY_METHODS and
// NON_SCF_METHOD_PREFIXES. Job keywords do not change an electronic protocol.
const scfMethods=new Set(`hf lsda svwn svwn5 slyp blyp bp86 bpw91 bpe bpbe g96lyp g96p86 g96pw91 pw91lyp pw91p86 pw91pw91 mpwlyp mpwpw91 mpwpbe pbe pbe0 pbepbe pbe1pbe b3lyp b3lyp5 b3p86 b3pw91 b1b95 b1lyp b1pw91 b98 b971 b972 b97d b97d3 mpw1pw91 mpw1lyp mpw1pbe mpw3pbe mpw3lyp mpw1b95 mpwlyp1m o3lyp olyp opbe x3lyp cam-b3lyp lc-wpbe wb97 wb97x wb97xd m05 m052x m06 m06l m062x m06hf m08hx m08so m11 m11l mn12l mn12sx mn15 mn15l tpsstpss tpssh revtpss revtpssh vsxc hcth93 hcth147 hcth407 thcth thcthhyb sogga11 sogga11x n12 n12sx hseh1pbe hse1pbe hse2pbe ohse1pbe ohse2pbe`.split(' ').map(s=>s.replaceAll('-','')));
const nonScf='mp2 mp3 mp4 mp5 cc qcisd cbs g1 g2 g3 g4 b2 mpw2 dsd dod revdsd revdod pbe0dh pbeqidh pwpb95 xyg wb97x2 oniom am1 pm3 pm6 pm7 pddg mndo cndo indo zindo dftb uff dreiding amber cis eom bd cas sac td'.split(' ');
const variants=(method:string)=>{const s=method.replaceAll('-','');return [s,...['ro','r','u'].filter(p=>s.startsWith(p)).map(p=>s.slice(p.length))];};
const requireValue=(condition:boolean,message:string)=>{if(!condition)throw Error(message);};
function protocol(value:unknown,multiplicity:number):{spec:Record<string,string>;methodLabel:string}{
 requireValue(typeof value==='string'&&Boolean(value.trim()),'缺少 facts.route');
 const originalRoute=(value as string).replace(/\s*([=,/])\s*/g,'$1').replace(/\(\s*/g,'(').replace(/\s*\)/g,')'),route=originalRoute.toLowerCase();
 const tokens=[...route.matchAll(/(?<!\S)([a-z][a-z0-9-]*)(?=[\s/(=]|$)/g)].map(m=>m[1]);
 requireValue(!tokens.some(t=>variants(t).some(v=>nonScf.some(p=>v.startsWith(p)))),'T82 不支持的非 SCF 方法');
 const pairs=[...route.matchAll(/(?<!\S)([a-z0-9+_()\-]+)\/([^\s]+)/g)];
 requireValue(pairs.length===1,'需要唯一、明确的方法 / 基组');
 const [,method,basis]=pairs[0];
 requireValue(!variants(method).some(v=>nonScf.some(p=>v.startsWith(p)))&&variants(method).some(v=>scfMethods.has(v)),'T82 不支持或不认识的 SCF 方法');
 // T99 normalized_method(): match the complete base before adding R/U, so
 // revTPSS is not split. Hyphens are ignored only for supported-set lookup.
 const normalized=scfMethods.has(method.replaceAll('-',''))?(multiplicity===1?'r':'u')+method:method;
 const rawMethod=originalRoute.slice(pairs[0].index,pairs[0].index!+method.length);
 const methodLabel=rawMethod+(normalized!==method?`（按${multiplicity===1?'单重态':`多重度 ${multiplicity}`}视为 ${normalized.toUpperCase()}）`:'');
 requireValue(!['gen','genecp','chkbasis'].includes(basis)&&!['extrabasis','pseudo','iop'].some(s=>route.includes(s)),'不支持自定义基组 / ECP / IOp');
 const dispersion=[...route.matchAll(/\b(?:empiricaldispersion|em)=(\([^)]*\)|[^\s]+)/g)];
 requireValue(dispersion.length<=1,'色散设置有歧义');
 let model='none',solvent='none';const scrf=[...route.matchAll(/\bscrf(?:=)?(\([^)]*\)|[^\s]*)/g)];
 requireValue(scrf.length<=1,'溶剂设置有歧义');
 if(scrf.length){const options=scrf[0][1].replace(/^\(+|\)+$/g,'').split(','),models=options.filter(x=>['smd','pcm','iefpcm','cpcm','dipole','ipcm','scipcm'].includes(x)),solvents=options.filter(x=>x.startsWith('solvent=')).map(x=>x.split('=')[1]);requireValue(models.length===1&&solvents.length===1&&options.length===2,'溶剂需要明确模型和溶剂名称，不支持自定义 / Read');model=models[0];solvent=solvents[0];}
 const types=[...route.matchAll(/(?<!\S)(5d|6d|7f|10f)(?!\S)/g)].map(m=>m[1]);
 requireValue(!(types.includes('5d')&&types.includes('6d')||types.includes('7f')&&types.includes('10f')),'基函数形式冲突');
 return {spec:{方法:normalized,基组:basis,色散:dispersion[0]?.[1]??'method_default',溶剂模型:model,溶剂:solvent,基函数形式:['5d','6d','7f','10f'].filter(x=>types.includes(x)).map(x=>x.toUpperCase()).join(' ')||'basis_default'},methodLabel};
}
const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const record=(v:unknown)=>object(v)?v:{};
export type ComparisonRow={id:string;termination:string|null;nImag:number|null;electronic:number|null;free:number|null;relativeElectronic:number|null;relativeFree:number|null};
export type Comparison={differences:string[];rows:ComparisonRow[];protocol:Record<string,string>;methodLabel:string};
export function compareAttempts(attempts:Attempt[]):Comparison{
 const differences:string[]=[],specifications:Record<string,string>[]=[],methodLabels:string[]=[];
 const rows:ComparisonRow[]=attempts.map(a=>{
  const f=record(a.facts.data),e=record(f.energies);
  try{
   requireValue(f.program==='gaussian','需要明确的 Gaussian 程序记录');
   requireValue(Number.isInteger(f.multiplicity)&&Number(f.multiplicity)>0,'缺少正整数多重度');
   const {spec,methodLabel}=protocol(f.route,Number(f.multiplicity));
   requireValue(typeof f.program_version==='string'&&Boolean(f.program_version.trim()),'缺少程序版本');spec.程序版本=String(f.program_version);
   requireValue(Number.isInteger(f.charge),'缺少整数电荷');spec.电荷=String(f.charge);
   spec.多重度=String(f.multiplicity);
   const geometry=a.geometry.data;requireValue(isGeometry(geometry),'缺少有效最终几何，无法核对元素组成');
   if(isGeometry(geometry)){
    requireValue(geometry.atoms.length===f.n_atoms,'最终几何原子数与 facts 不符');
    const counts:Record<number,number>={};for(const atom of geometry.atoms)counts[atom.atomic_number]=(counts[atom.atomic_number]??0)+1;
    spec.元素组成=Object.entries(counts).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,count])=>`Z${n}×${count}`).join(' ');
   }
   requireValue(record(f.units).energy==='Hartree','能量单位必须明确为 Hartree');
   specifications.push(spec);
   methodLabels.push(methodLabel);
  }catch(error){differences.push(`${a.id}：${(error as Error).message}`);specifications.push({});}
  return {id:a.id,termination:typeof f.termination==='string'&&f.termination.trim()?f.termination:null,nImag:typeof f.n_imag==='number'&&Number.isSafeInteger(f.n_imag)&&f.n_imag>=0?f.n_imag:null,electronic:finite(e.scf),free:finite(e.g),relativeElectronic:null,relativeFree:null};
 });
 if(attempts.length<2)differences.push('至少选择两个 Attempt');
 if(!differences.length){for(const key of Object.keys(specifications[0]))if(new Set(specifications.map(s=>s[key])).size>1)differences.push(`${key}不同：${attempts.map((a,i)=>`${a.id} = ${key==='方法'?methodLabels[i]:specifications[i][key]}`).join('；')}`);}
 if(!differences.length)for(const [source,target] of [['electronic','relativeElectronic'],['free','relativeFree']] as const){const values=rows.map(r=>r[source]).filter((v):v is number=>v!==null),minimum=values.length?Math.min(...values):null;for(const row of rows)row[target]=row[source]===null||minimum===null?null:(row[source]-minimum)*627.5094740631;}
 if(rows.some(r=>[r.relativeElectronic,r.relativeFree].some(v=>v!==null&&!Number.isFinite(v)))){differences.push('能量差超出有限数值范围');for(const row of rows){row.relativeElectronic=null;row.relativeFree=null;}}
 return {differences,rows,protocol:specifications[0]??{},methodLabel:methodLabels[0]??'—'};
}
