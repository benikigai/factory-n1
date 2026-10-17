import type { Layout } from '../../src/sim/types';
import type { AgentNode } from '../runtime';

/** Presentation coordinates only. These layouts are never submitted to the simulator. */
export function teamLayout(scope:AgentNode):Layout {
  const children=scope.children;
  const cols=Math.min(5,Math.max(2,Math.ceil(Math.sqrt(children.length))));
  const rows=Math.ceil(children.length/cols);
  const w=Math.max(24,cols*6+4),height=Math.max(14,rows*5+4);
  return {name:scope.name,grid:{w,h:height},stations:children.map((n,i)=>({
    id:n.id,kind:n.role.includes('tool')||n.role.includes('Tool')?'sorter':'pack',
    x:(w-1-(cols-1)*6)/2+(i%cols)*6,y:(height-1-(rows-1)*5)/2+Math.floor(i/cols)*5,
    sizes:['S','M','L'],zones:['A','B','C'],
  }))};
}
