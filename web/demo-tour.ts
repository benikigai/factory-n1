import type { DemandProfile } from './factory-guide';
import type { AgentNode } from './runtime';

export const DEMO_RUN = 'live-a-11';
export interface DemoStep {
  title: string;
  caption: string;
  seconds: number;
  content: string[];
  time?: 'play' | 'end';
  profile?: DemandProfile;
  station?: { side: 'baseline' | 'improved'; id: string; detail: 'operation' | 'failures' };
  agentPath?: string[];
  panel?: 'rules' | 'demand' | 'results' | 'work' | 'critic' | 'critic-details' | 'optimizer' | 'optimizer-details';
}
export interface DemoTour {
  id: 'quick' | 'detailed';
  label: string;
  seconds: number;
  steps: DemoStep[];
}

export const DEMO_TOURS: DemoTour[] = [
  { id: 'quick', label: '1-minute walkthrough', seconds: 60, steps: [
    { title: 'The factory', seconds: 15, time: 'play', caption: 'The same packages, two factory layouts.', content: [
      'Factory N+1 simulates receiving, sorting, packing and shipping. The baseline is on the left; the agents’ improved design is on the right. Both replay the same packages.',
    ] },
    { title: 'Agents improve the design', seconds: 15, agentPath: ['Designers'], caption: 'Specialist agents propose and test layout changes.', content: [
      'Specialist agents propose changes. The simulator scores them, and code accepts improvements. Results feed the next round. Each child factory contains recorded proposals and tool receipts.',
    ] },
    { title: 'One measurable fix', seconds: 15, time: 'end', station: {side:'improved',id:'pack-B',detail:'failures'}, caption: 'A shorter route keeps fragile packages below the damage threshold.', content: [
      'Run 11 continued earlier work. Moving pack-B shortened its inbound trip from 15 cells to 11, below the damage threshold. Code verified the change.',
    ] },
    { title: 'The result', seconds: 15, time: 'end', panel:'results', caption: 'Run 11 meets all four goals on the displayed peak day.', content: [
      'All 100 packages shipped in 19:44, with zero mis-sorts or damage. Simulator penalty fell 82% across nine feedback validation days. These are validation results, not an untouched final test.',
    ] },
  ] },
  { id: 'detailed', label: '4-minute detailed walkthrough', seconds: 240, steps: [
    { title: 'The factory', seconds: 30, time:'play', caption:'Baseline and improved layouts replay the same package flow.', content:[
      'Factory N+1 is a simulated fulfillment center that agents can redesign. Packages enter receiving, pass through sorting and packing, then leave through the correct shipping dock. Each station processes one package at a time. Layout, capacity and queues affect performance.',
      'Both factories replay the same packages on the same clock.',
    ] },
    { title: 'How failures happen', seconds:30, panel:'rules', caption:'Eligibility and travel distance determine failures.', content:[
      'The baseline packing stations accept small and medium boxes, leaving large boxes without an eligible station. The sorter uses a fallback and records a mis-sort.',
      'Damage follows a separate rule: a fragile package is damaged if any trip exceeds 12 grid cells. Exactly 12 is safe. These are reproducible simulator rules, not physical damage predictions.',
    ] },
    { title: 'Stress the same layout', seconds:30, panel:'demand', profile:'peak', time:'play', caption:'Normal, peak and fragile demand stress different parts of the factory.', content:[
      'Normal demand spreads 100 arrivals across 20 minutes. Peak compresses them into five minutes, stressing queues. Fragile demand raises the fragile probability from 10% to 35%, exposing long routes.',
      'Each scenario tests the saved layouts with the simulator and fixed seeds. Scenario previews make no new model calls.',
    ] },
    { title: 'Inside the agent factory', seconds:30, agentPath:['Designers','Route designer','Generation 1'], caption:'Recorded proposals and tool receipts explain each decision.', content:[
      'Researchers suggest ideas, designers propose layouts, and the simulator scores them. Code accepts at most one improvement per generation and passes results into the next round.',
      'The recorded route proposal includes child tool receipts. The current system uses fixed roles; it does not create arbitrary new agents.',
    ] },
    { title: 'Trace the accepted fix', seconds:30, station:{side:'improved',id:'pack-B',detail:'failures'}, time:'end', caption:'The accepted pack-B move reduces its inbound trip to 11 cells.', content:[
      'Run 11 continued from run 7. Its accepted edit moved pack-B from (0,4) to (3,5), shortening the sorter trip from 15 cells to 11. The next trip to the shipping dock is eight cells.',
      'Both trips are below the damage threshold. The simulator receipt connects the layout change to its measured effect.',
    ] },
    { title: 'Measured results', seconds:30, panel:'results', time:'end', caption:'Measured outcomes for the displayed peak day and validation set.', content:[
      'The baseline ships all 100 packages in 26:21, with 16 mis-sorts and 14 damaged packages. Run 11 finishes in 19:44, with neither error.',
      'Simulator penalty fell 82% across nine feedback validation days. That includes earlier work. This is not an equal-budget comparison or an untouched final test.',
    ] },
    { title: 'Fine-tune one: the critic', seconds:30, panel:'critic-details', caption:'The critic learned the response format, not reliable outcome prediction.', content:[
      'Two separate adapters were trained on the same Nemotron Nano 8B model. The critic learned the required response format: valid responses increased from 0/100 to 100/100.',
      'Reliable outcome prediction was not demonstrated. The critic recognized none of 17 goal-passing layouts. The measured gain was format learning; the simulator still determines outcomes.',
    ] },
    { title: 'Fine-tune two: the optimizer', seconds:30, panel:'optimizer', caption:'A separate controlled test compares tuned, base and random proposals.', content:[
      'The optimizer learned from 1,200 simulator examples. On 20 unseen factories, penalty fell 12.64% with the adapter, versus 0.14% for the base model and 4.27% for random legal moves.',
      'This separate pilot still had 21 invalid moves out of 60, and no full-goal successes. Neither adapter powers this replay.',
    ] },
  ] },
];

/** Time offsets also define what Next and Back mean during timed playback. */
export function demoPosition(tour: DemoTour, elapsed: number) {
  const clamped = Math.max(0, Math.min(tour.seconds, elapsed));
  let start = 0;
  for (let index = 0; index < tour.steps.length; index++) {
    const end = start + tour.steps[index].seconds;
    if (clamped < end || index === tour.steps.length - 1) {
      return { index, start, remaining: Math.max(0, end - clamped), complete: clamped >= tour.seconds };
    }
    start = end;
  }
  throw new Error('The demo has no steps.');
}

export function demoAgent(root: AgentNode, path: string[]) {
  let node = root;
  for (const name of path) {
    const child = node.children.find(candidate => candidate.name === name);
    if (!child) throw new Error(`The recorded demo is missing ${name}.`);
    node = child;
  }
  return node;
}
