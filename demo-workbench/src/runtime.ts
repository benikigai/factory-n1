export type Status = 'idle' | 'queued' | 'running' | 'done' | 'failed';
export interface AgentNode {
  id: string; name: string; role: string; color: string; model: string;
  children: AgentNode[]; depends: string[]; parent?: AgentNode;
  status: Status; progress: number; elapsed: number; duration: number;
  output: string; task: string;
}
export interface FactoryEvent { time: number; agent: string; nodeId: string; message: string; kind: 'start' | 'done' | 'error' | 'info' }
export function flatten(node: AgentNode): AgentNode[] { return [node, ...node.children.flatMap(flatten)]; }
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
