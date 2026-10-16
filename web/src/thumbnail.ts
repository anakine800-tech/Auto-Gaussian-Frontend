import {cameraBasis,inferDisplayBonds} from './molecule-math';
import type {Atom} from './molecule-math';

// Static principal-axis projection; no geometry or bond order is changed.
export function drawThumbnail(canvas:HTMLCanvasElement,atoms:Atom[]){
 const ctx=canvas.getContext('2d');if(!ctx||!atoms.length)return;
 const width=canvas.width,height=canvas.height;
 ctx.clearRect(0,0,width,height);ctx.fillStyle='#f3f7f6';ctx.fillRect(0,0,width,height);
 const axes=cameraBasis(atoms),center=[0,1,2].map(i=>atoms.reduce((sum,a)=>sum+[a.x,a.y,a.z][i]/atoms.length,0));
 const points=atoms.map(a=>{const d=[a.x-center[0],a.y-center[1],a.z-center[2]];return axes.map(axis=>axis.reduce((sum,v,i)=>sum+v*d[i],0));});
 const span=Math.max(...points.map(p=>Math.abs(p[0])*2),...points.map(p=>Math.abs(p[1])*2),1),scale=(Math.min(width,height)-28)/span;
 const project=(i:number)=>[width/2+points[i][0]*scale,height/2-points[i][1]*scale];
 const byCenter=new Map(atoms.map((a,i)=>[a.center,i]));
 ctx.strokeStyle='#708384';ctx.lineWidth=3;
 for(const bond of inferDisplayBonds(atoms).bonds){const a=project(byCenter.get(bond.a)!),b=project(byCenter.get(bond.b)!);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}
 const colors:Record<number,string>={1:'#fff',6:'#52656b',7:'#4268cf',8:'#cc4545',9:'#68ac7c',16:'#d2ae25',5:'#d89e83',14:'#c3b99b',15:'#dc9440',17:'#389b68',35:'#a35439',53:'#8553ac'};
 atoms.map((a,i)=>({a,i})).sort((a,b)=>points[a.i][2]-points[b.i][2]).forEach(({a,i})=>{const [x,y]=project(i);ctx.beginPath();ctx.arc(x,y,a.atomic_number===1?3.5:6,0,Math.PI*2);ctx.fillStyle=colors[a.atomic_number]??'#9b73b2';ctx.fill();ctx.strokeStyle='#6c8283';ctx.lineWidth=1;ctx.stroke();});
 canvas.dataset.drawn='true';
}
