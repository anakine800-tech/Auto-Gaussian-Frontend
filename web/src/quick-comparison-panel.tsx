export const comparisonTitle='比较（前端现场计算，非正式结果）';
export type ComparisonDisplayRow={name:string;values:string[]};
// Presentational only: all compatibility checks and energy arithmetic remain
// in quick-comparison.ts, independently testable from the page and basket.
export function ComparisonTable({label,columns,rows,onlyDifferences}:{label:string;columns:{id:string;label:string}[];rows:ComparisonDisplayRow[];onlyDifferences:boolean}){
 const displayed=rows.filter(row=>!onlyDifferences||new Set(row.values).size>1);
 return <div className="table-scroll"><table aria-label={label}><thead><tr><th>项目</th>{columns.map(column=><th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{displayed.map(row=><tr key={row.name}><th>{row.name}</th>{row.values.map((value,i)=><td key={columns[i].id}>{value}</td>)}</tr>)}</tbody></table>{!displayed.length&&<p className="muted">{onlyDifferences?'此部分没有差异行。':'尚无条目。'}</p>}</div>;
}
