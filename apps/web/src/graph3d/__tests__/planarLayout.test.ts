import {describe,expect,it} from "vitest";
import {GraphPhysics} from "../physics";
import {LabelOccupancy,placeGraphLabel} from "../labelPlacement";
import type {GraphTopology} from "../topology";
function dense(count=36):GraphTopology {
 const nodes=Array.from({length:count},(_,i)=>({id:String(i),title:'程序知识点 '+i,ghost:false,degree:0,accent:'blue' as const}));
 const edges:GraphTopology['edges']=[];for(let i=1;i<count;i++){edges.push({a:0,b:i,source:'wikilink'});if(i>1)edges.push({a:i-1,b:i,source:'wikilink'});}
 const neighbors:number[][]=nodes.map(()=>[]);for(const e of edges){nodes[e.a].degree++;nodes[e.b].degree++;neighbors[e.a].push(e.b);neighbors[e.b].push(e.a);}return {nodes,edges,neighbors};
}
function minimum(positions:Float32Array){let min=Infinity;for(let i=0;i<positions.length/3;i++)for(let j=i+1;j<positions.length/3;j++)min=Math.min(min,Math.hypot(positions[i*3]-positions[j*3],positions[i*3+1]-positions[j*3+1]));return min;}
describe('平面自动整理',()=>{
 it('大量重叠节点自动分散且保持严格平面',()=>{
  const graph=dense();const out=new Float32Array(graph.nodes.length*3);const p=new GraphPhysics(graph,out);p.setFlatten(true);for(let i=0;i<400;i++)p.tick();p.copyPositionsTo(out);
  expect(minimum(out)).toBeGreaterThan(65);expect([...out].every(Number.isFinite)).toBe(true);expect([...out].filter((_,i)=>i%3===2).every(z=>z===0)).toBe(true);expect(p.isSettled).toBe(true);p.dispose();
 });
 it('更新用户力度设置后仍维持平面间距',()=>{
  const graph=dense(20),out=new Float32Array(60);const p=new GraphPhysics(graph,out);p.setFlatten(true);p.setForces({center:1,repel:-150,linkForce:.5,linkDistance:70});for(let i=0;i<350;i++)p.tick();p.copyPositionsTo(out);expect(minimum(out)).toBeGreaterThan(65);p.dispose();
 });
 it('从有深度的位置切到2D后不会再通过深度避碰',()=>{const graph=dense(10),out=new Float32Array(30).map((_,i)=>i%3===2?i*3:0);const p=new GraphPhysics(graph,out);p.setFlatten(true);for(let i=0;i<300;i++)p.tick();p.copyPositionsTo(out);expect(minimum(out)).toBeGreaterThan(65);expect(out[2]).toBe(0);p.dispose();});
 it('手动整理只重新计算布局，不重置现有位置',()=>{const out=new Float32Array([0,0,0,120,20,0]);const p=new GraphPhysics(dense(2),out);p.setFlatten(true);for(let i=0;i<350;i++)p.tick();p.copyPositionsTo(out);const before=[...out];p.arrange();p.copyPositionsTo(out);expect([...out]).toEqual(before);expect(p.isSettled).toBe(false);p.dispose();});
});
describe('文字避让',()=>{
 it('多个文字框不相互覆盖，且避开星星',()=>{const occupancy=new LabelOccupancy();occupancy.add({left:195,right:205,top:195,bottom:205});const a=placeGraphLabel(occupancy,200,200,8,100,500,500);const b=placeGraphLabel(occupancy,205,200,8,100,500,500);expect(a).not.toBeNull();expect(b).not.toBeNull();expect(a!.bottom<=b!.top||b!.bottom<=a!.top||a!.right<=b!.left||b!.right<=a!.left).toBe(true);});
 it('没有空间时省略次要标签，不将它叠到已有标签上',()=>{const occupancy=new LabelOccupancy();occupancy.add({left:0,right:400,top:0,bottom:400});expect(placeGraphLabel(occupancy,200,200,10,100,400,400)).toBeNull();});
});
