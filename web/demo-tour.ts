import type { DemandProfile } from './factory-guide';
import type { AgentNode } from './runtime';

export const DEMO_RUN = 'live-a-11';
export interface DemoStep {
  title: string;
  cue: string;
  seconds: number;
  say: string[];
  time?: 'play' | 'end';
  profile?: DemandProfile;
  station?: { side: 'baseline' | 'improved'; id: string; detail: 'operation' | 'failures' };
  agentPath?: string[];
  panel?: 'rules' | 'demand' | 'results' | 'work' | 'critic' | 'critic-details' | 'optimizer' | 'optimizer-details';
}
export interface DemoTour {
  id: 'quick' | 'judges';
  label: string;
  seconds: number;
  steps: DemoStep[];
}

export const DEMO_TOURS: DemoTour[] = [
  { id: 'quick', label: '1-minute demo', seconds: 60, steps: [
    { title: 'The factory', seconds: 15, time: 'play', cue: 'Show the two factories. Packages are moving through the recorded run.', say: [
      'Factory N+1 simulates receiving, sorting, packing and shipping. The left floor is the baseline; the right is the agents’ improved design. Both replay the same packages.',
    ] },
    { title: 'Agents improve the design', seconds: 15, agentPath: ['Designers'], cue: 'The child-agent factory opens. Point to the three designers.', say: [
      'Specialist agents propose changes. The simulator scores them, and code accepts improvements. Results feed the next round. Click these child factories to inspect the recorded work.',
    ] },
    { title: 'One measurable fix', seconds: 15, time: 'end', station: {side:'improved',id:'pack-B',detail:'failures'}, cue: 'Point to the 11-cell inbound route at pack-B.', say: [
      'Run eleven continued earlier work. Moving pack-B shortened its inbound trip from fifteen cells to eleven, below the damage threshold. Code verified the change.',
    ] },
    { title: 'The result', seconds: 15, time: 'end', panel:'results', cue: 'Show the final checks. Leave this result on screen at the end.', say: [
      'One hundred packages shipped in nineteen minutes, forty-four seconds, with zero mis-sorts or damage. Penalty fell eighty-two percent across nine feedback validation days, not an untouched final test.',
    ] },
  ] },
  { id: 'judges', label: '4-minute judges demo', seconds: 240, steps: [
    { title: 'Meet the factory', seconds: 30, time:'play', cue:'Introduce the baseline on the left and run 11 on the right.', say:[
      'Factory N+1 is a simulated fulfillment center that agents can redesign. Packages arrive at receiving, pass through sorting and packing, then leave through the correct shipping dock. Each station processes one package at a time, so layout, capacity and queues affect performance.',
      'Both factories replay the same packages on the same clock.',
    ] },
    { title: 'Explain the failures', seconds:30, panel:'rules', cue:'The sorting and damage rules are open.', say:[
      'Our baseline packing stations accept small and medium boxes, leaving large boxes without an eligible station. The sorter uses a fallback and records a mis-sort.',
      'Damage is separate: a fragile package gets damaged if any one trip exceeds twelve grid cells. Exactly twelve is safe. These are reproducible simulator rules, not physical damage predictions.',
    ] },
    { title: 'Stress the same layout', seconds:30, panel:'demand', profile:'peak', time:'play', cue:'Peak demand is selected. Point to the Normal, Peak and Fragile options.', say:[
      'Normal demand spreads one hundred arrivals across twenty minutes. Peak compresses them into five minutes, stressing queues. Fragile demand raises the fragile probability from ten to thirty-five percent, exposing long routes.',
      'These controls test the saved layouts with the real simulator and fixed seeds. They make no new model calls.',
    ] },
    { title: 'Open the agent factory', seconds:30, agentPath:['Designers','Route designer','Generation 1'], cue:'Designers → Route designer → Generation 1. The recorded proposal and child tools are visible.', say:[
      'Researchers suggest ideas, designers propose layouts, and the simulator scores them. Code accepts at most one improvement per generation and passes results into the next round.',
      'Here is the recorded route proposal, with child tool receipts you can inspect. The current system uses fixed roles; it does not invent arbitrary new agents.',
    ] },
    { title: 'Trace the accepted fix', seconds:30, station:{side:'improved',id:'pack-B',detail:'failures'}, time:'end', cue:'Champion pack-B is selected. Its inbound route is 11 cells.', say:[
      'Run 11 continued from run 7. Its accepted edit moved pack-B from zero, four to three, five. That shortened the sorter trip from fifteen cells to eleven. The next trip to the shipping dock is eight cells.',
      'Both are below the damage threshold. This receipt explains a specific improvement instead of asking you to trust the model.',
    ] },
    { title: 'Read the measured result', seconds:30, panel:'results', time:'end', cue:'Compare the final goal checks, then the validation score.', say:[
      'The baseline ships all one hundred packages in twenty-six minutes, twenty-one seconds, with sixteen mis-sorts and fourteen damaged packages. Run 11 finishes in nineteen minutes, forty-four seconds, with neither error.',
      'Simulator penalty fell eighty-two percent across nine feedback validation days. That includes earlier work. This is not an equal-budget comparison or an untouched final test.',
    ] },
    { title: 'Fine-tune one: the critic', seconds:30, panel:'critic-details', cue:'The separate critic experiment and its limitations are open.', say:[
      'Separately, we trained two small adapters on the same Nemotron Nano eight-billion-parameter model. The critic learned the required response format: zero out of one hundred valid responses became one hundred.',
      'It did not become a reliable judge. It recognized none of seventeen goal-passing layouts. We proved format learning, so the simulator still decides.',
    ] },
    { title: 'Fine-tune two: the optimizer', seconds:30, panel:'optimizer', cue:'Compare all three methods. Finish leaves the factory clean and paused.', say:[
      'The optimizer learned from twelve hundred simulator examples. On twenty unseen factories, penalty fell twelve-point-six-four percent with the adapter, versus zero-point-one-four for the base model and four-point-two-seven for random legal moves.',
      'This separate pilot still had twenty-one invalid moves out of sixty, and no full-goal successes. Neither adapter powers this replay yet.',
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
