export type Document<T=unknown>={data:T|null;error:string|null};
export type AttemptSummary={id:string;label:string|null;template:string|null;state:string;manifest:Document;status:Document};
export type Graph={nodes:{id:string;state:string;missing:boolean}[];edges:{parent:string;child:string;relation:string}[]};
export type StructureFile={parts:string[];error:string|null};
export type Study={id:string;study:Document<string>;attempts:AttemptSummary[];graph:Graph;structure_files:StructureFile[];analyses:(Document&{name:string})[];issues:{path:string;error:string}[]};
export type Attempt={id:string;manifest:Document;status:Document;facts:Document;review:Document<string>;geometry:Document;input_geometry:Document;input_files:{name:string;error:string|null}[];logs:string[];issues:{path:string;error:string}[]};
export function endpoint(...parts:string[]){return '/api/studies/'+parts.map(encodeURIComponent).join('/');}
export async function get<T>(url:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(url,{signal,cache:'no-store'});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.detail??`读取失败 (${response.status})`);}
 return response.json();
}
export const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const display=(value:unknown)=>typeof value==='number'||typeof value==='string'?String(value):'—';
