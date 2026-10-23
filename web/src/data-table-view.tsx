import {Children,createContext,isValidElement,useContext,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {routeHash} from './routing';

export const TableAttempts=createContext<{study:string;ids:ReadonlySet<string>;select:(id:string)=>void}|null>(null);
export const cellText=(value:ReactNode):string=>Children.toArray(value).map(c=>isValidElement<{children?:ReactNode}>(c)?cellText(c.props.children):String(c)).join('');
export function AttemptCell({children}:{children:ReactNode}){
 const context=useContext(TableAttempts),text=cellText(children);
 return context?.ids.has(text)?<a href={routeHash([context.study,text])} onClick={e=>{e.preventDefault();context.select(text);}}>{text}</a>:<>{children}</>;
}
const numeric=(value:string)=>/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())&&Number.isFinite(Number(value));
export function DataTableView({headers,rows,label='报告表格'}:{headers:ReactNode[];rows:ReactNode[][];label?:string}){
 const [sort,setSort]=useState<{column:number;descending:boolean}|null>(null);
 const sorted=useMemo(()=>{
  const indexed=rows.map((cells,index)=>({cells,index}));
  if(!sort)return indexed;
  const numbers=rows.length>0&&rows.every(row=>numeric(cellText(row[sort.column])));
  return indexed.sort((a,b)=>{const left=cellText(a.cells[sort.column]),right=cellText(b.cells[sort.column]);
   const order=numbers?Number(left)-Number(right):left.localeCompare(right,'zh-CN');
   return (sort.descending?-order:order)||a.index-b.index;
  });
 },[rows,sort]);
 return <div className="report-table-scroll" tabIndex={0} role="region" aria-label={label+'（可横向滚动）'}><table aria-label={label}><thead><tr>{headers.map((header,column)=><th key={column} aria-sort={sort?.column===column?(sort.descending?'descending':'ascending'):'none'}><button onClick={()=>setSort(old=>({column,descending:old?.column===column?!old.descending:false}))}>{header}{sort?.column===column?(sort.descending?' ↓':' ↑'):''}</button></th>)}</tr></thead><tbody>{sorted.map(({cells,index})=><tr key={index}>{headers.map((_,column)=><td key={column}><AttemptCell>{cells[column]??''}</AttemptCell></td>)}</tr>)}</tbody></table>{!rows.length&&<p className="muted">没有数据行。</p>}</div>;
}
export function MarkdownTable({children}:{children:ReactNode}){
 const rows:ReactNode[][]=[];
 const visit=(nodes:ReactNode)=>Children.forEach(nodes,node=>{
  if(!isValidElement<{children?:ReactNode}>(node))return;
  if(node.type==='tr')rows.push(Children.toArray(node.props.children).filter(isValidElement).map(cell=>(cell.props as {children?:ReactNode}).children));
  else visit(node.props.children);
 });
 visit(children);
 return <DataTableView headers={rows[0]??[]} rows={rows.slice(1)}/>;
}

export function parseCSV(text:string):{headers:string[];rows:string[][];truncated:boolean;error?:number}{
 const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false,line=1,truncated=false;
 const finish=()=>{row.push(field);records.push(row);row=[];field='';closed=false;};
 const fail=()=>({headers:[],rows:[],truncated:false,error:line});
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else {quoted=false;closed=true;}}
   else {field+=c;if(c==='\n'||c==='\r'&&text[i+1]!=='\n')line++;}
  }else if(c===','){row.push(field);field='';closed=false;}
  else if(c==='\n'||c==='\r'){
   finish();if(c==='\r'&&text[i+1]==='\n')i++;line++;
   if(records.length===5001&&i<text.length-1){truncated=true;break;}
  }else if(c==='"'){if(field||closed)return fail();quoted=true;}
  else {if(closed)return fail();field+=c;}
 }
 if(quoted)return fail();
 if(field||closed||row.length)finish();
 const headers=records.shift()??[];
 // Ragged records have no unambiguous header mapping; show the original text.
 if(records.some(r=>r.length!==headers.length)){
  // Physical line numbers, including embedded quoted newlines.
  let physical=1;
  for(const record of [headers,...records]){if(record!==headers&&record.length!==headers.length)return {...fail(),error:physical};physical+=1+record.reduce((n,v)=>n+(v.match(/\r\n|\r|\n/g)?.length??0),0);}
 }
 return {headers,rows:records.slice(0,5000),truncated:truncated||records.length>5000};
}
export function CSVView({text}:{text:string}){
 const data=useMemo(()=>parseCSV(text),[text]);
 return data.error?<><p role="alert">CSV 解析失败：第 {data.error} 行</p><pre>{text}</pre></>:<>{data.truncated&&<p role="status">超过 5000 行，仅显示前 5000 行。</p>}<DataTableView headers={data.headers} rows={data.rows}/></>;
}
