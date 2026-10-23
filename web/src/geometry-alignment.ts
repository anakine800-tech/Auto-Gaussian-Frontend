import type {Geometry} from './molecule-viewer';

export function alignmentReason(geometries:(Geometry|null)[]):string|null {
 const first=geometries[0];
 if(!first||geometries.some(g=>!g))return '缺少完整几何，无法对齐。';
 if(geometries.some(g=>g!.atoms.length!==first.atoms.length))return '原子数不一致，无法对齐。';
 if(geometries.some(g=>g!.atoms.some((a,i)=>a.atomic_number!==first.atoms[i].atomic_number)))return '元素顺序不一致，无法对齐。';
 return null;
}
export const centroid=(g:Geometry)=>g.atoms.reduce((c,a)=>c.map((v,i)=>v+[a.x,a.y,a.z][i]/g.atoms.length),[0,0,0]);

// Kabsch's all-atom least-squares rigid fit, solved through the equivalent
// symmetric quaternion eigenproblem. The unit quaternion permits rotations
// only (never reflections); no atom permutation or stored coordinate mutation.
export function alignGeometry(moving:Geometry,reference:Geometry):Geometry {
 const reason=alignmentReason([reference,moving]);if(reason)throw Error(reason);
 const a=centroid(moving),b=centroid(reference),s=Array.from({length:3},()=>[0,0,0]);
 moving.atoms.forEach((atom,i)=>{
  const other=reference.atoms[i],p=[atom.x-a[0],atom.y-a[1],atom.z-a[2]],q=[other.x-b[0],other.y-b[1],other.z-b[2]];
  for(let j=0;j<3;j++)for(let k=0;k<3;k++)s[j][k]+=p[j]*q[k];
 });
 const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]]=s;
 const n=[[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],[zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]];
 const v:number[][]=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>i===j?1:0));
 // Jacobi diagonalization handles degenerate, collinear and planar structures
 // without a power iteration's ambiguous +/- eigenvalues.
 const magnitude=Math.max(...n.flat().map(Math.abs),1);
 for(let iteration=0;iteration<80;iteration++){
  let p=0,q=1;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(Math.abs(n[i][j])>Math.abs(n[p][q])){p=i;q=j;}
  if(Math.abs(n[p][q])<1e-14*magnitude)break;
  const angle=.5*Math.atan2(2*n[p][q],n[q][q]-n[p][p]),c=Math.cos(angle),t=Math.sin(angle);
  const pp=n[p][p],qq=n[q][q],pq=n[p][q];
  for(let k=0;k<4;k++)if(k!==p&&k!==q){const kp=n[k][p],kq=n[k][q];n[k][p]=n[p][k]=c*kp-t*kq;n[k][q]=n[q][k]=t*kp+c*kq;}
  n[p][p]=c*c*pp-2*c*t*pq+t*t*qq;n[q][q]=t*t*pp+2*c*t*pq+c*c*qq;n[p][q]=n[q][p]=0;
  for(let k=0;k<4;k++){const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-t*kq;v[k][q]=t*kp+c*kq;}
 }
 let largest=0;for(let i=1;i<4;i++)if(n[i][i]>n[largest][largest])largest=i;
 const [w,x,y,z]=v.map(row=>row[largest]);
 const rotation=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
 return {...moving,atoms:moving.atoms.map(atom=>{const p=[atom.x-a[0],atom.y-a[1],atom.z-a[2]],q=rotation.map((row,i)=>row.reduce((sum,value,j)=>sum+value*p[j],b[i]));return {...atom,x:q[0],y:q[1],z:q[2]};})};
}
