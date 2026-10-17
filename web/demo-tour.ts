import type { DemandProfile } from './factory-guide';
import type { AgentNode } from './runtime';

export const DEMO_RUN = 'live-a-11';
export interface DemoStep {
  title: string;
  cue: string;
  say: string[];
  time?: 'play' | 'end';
  profile?: DemandProfile;
  station?: { side: 'baseline' | 'improved'; id: string; detail: 'operation' | 'failures' };
  agentPath?: string[];
  panel?: 'rules' | 'demand' | 'results' | 'work' | 'critic' | 'critic-details' | 'optimizer' | 'optimizer-details';
}

export const DEMO_STEPS: DemoStep[] = [
  { title: 'Meet the factory', cue: 'Point to receiving, sorting, packing and shipping. The recorded replay is playing.', time: 'play', say: [
    'This is Factory N+1. We built a simulated fulfillment center where agents redesign the operation and test their changes.',
    'Packages arrive at receiving, pass through sorting, get packed, and leave through the correct shipping dock. Each station handles one package at a time, so placement, capacity and queues affect the result.',
  ] },
  { title: 'Why the starting layout struggles', cue: 'The left baseline’s pack-1 is selected. Point to Sizes: S, M.', station: { side: 'baseline', id: 'pack-1', detail: 'operation' }, say: [
    'Our starting packing stations only support small and medium packages. Large packages have no eligible packing station.',
    'The sorter checks size and destination, then chooses the shortest queue. If no station qualifies, it uses a fallback and records a mis-sort.',
  ] },
  { title: 'How damage happens', cue: 'The simulation rules are open. Red means damaged; an amber flash means mis-sorted.', panel: 'rules', say: [
    'Damage follows a separate rule. A fragile package gets damaged when any single trip exceeds 12 grid cells. Exactly 12 is safe.',
    'These are explicit simulator rules we can reproduce. They are not physical collision or damage predictions.',
  ] },
  { title: 'Normal demand', cue: 'The same saved layouts are simulated under normal demand.', panel: 'demand', profile: 'normal', time: 'play', say: [
    'Normal demand spreads 100 arrivals across 20 minutes, with a 10 percent fragile probability.',
    'The actual package mix comes from a fixed random seed, so we can replay the same test.',
  ] },
  { title: 'Peak demand', cue: 'The peak preview is playing. Notice the receiving queues.', panel: 'demand', profile: 'peak', time: 'play', say: [
    'Peak compresses 100 arrivals into five minutes, which stresses the queues. The fragile probability stays at 10 percent.',
  ] },
  { title: 'Fragile demand', cue: 'This preview has a higher proportion of fragile packages.', panel: 'demand', profile: 'fragile', time: 'play', say: [
    'Fragile demand raises the fragile probability to 35 percent. This exposes long routes.',
    'These previews test the same saved layouts with different seeded demand samples. They require no new model calls.',
  ] },
  { title: 'What run 11 achieved', cue: 'The original recorded peak-202 day is back at the end. Compare the final measured results.', panel: 'results', time: 'end', say: [
    'The starting floor shipped all 100 packages, but took 26 minutes and 21 seconds, with 16 mis-sorts and 14 damaged packages.',
    'Run 11 ships all 100 in 19 minutes and 44 seconds, with zero mis-sorts and zero damage on this displayed peak day. It meets all four checks.',
    'The 82 percent reduction is in the combined simulator penalty across nine validation days. Those days guided acceptance; they are not an untouched final test.',
  ] },
  { title: 'Trace the fix to one station', cue: 'Champion pack-B is selected. Its inbound sorting route is now 11 cells.', time: 'end', station: { side: 'improved', id: 'pack-B', detail: 'failures' }, say: [
    'Run 11 continued from run 7. Its accepted edit moved pack-B from grid position zero, four to three, five.',
    'That shortened the sorter-to-pack-B trip from 15 cells to 11, below the damage threshold. The trip from pack-B to the B shipping dock is eight cells.',
    'The receipt isolates the change. The total 82 percent improvement includes the earlier work; it is not all caused by this one edit, and run 11 is not an equal-budget comparison.',
  ] },
  { title: 'Inside the agent factory', cue: 'The agent view shows the recorded roles. You can still click to explore.', agentPath: [], say: [
    'Researchers suggest ideas. Designers propose layouts. The simulator scores them.',
    'The controller accepts changes that pass its checks, then feeds results and saved lessons into the next round. That is the recursive loop in this prototype: propose, test, learn, repeat.',
  ] },
  { title: 'Inspect an actual tool call', cue: 'Opened Designers → Route designer → Generation 1 → simulate_layout.', agentPath: ['Designers', 'Route designer', 'Generation 1', 'simulate_layout'], say: [
    'This is the simulator receipt behind the accepted route proposal. These nested views expose real execution records.',
    'The current backend uses fixed roles. It does not create arbitrary new agents at runtime.',
  ] },
  { title: 'Why the loop keeps some changes', cue: 'The generation timeline shows the accepted route edit and rejected alternatives.', panel: 'work', time: 'end', say: [
    'Three designers propose different changes. Code scores them and keeps at most one per generation, only if validation improves enough and no goal check gets worse.',
    'The later rejected proposals remain visible. The agents cannot approve their own claims. No untouched final-split result is recorded for this run.',
  ] },
  { title: 'Critic: what the fine-tune proved', cue: 'The completed experiment results are open. Point to 0/100 → 100/100.', panel: 'critic', say: [
    'Separately, we trained two specialist adapters on the same Nemotron Nano 8B base model. An adapter changes a small fraction of the model’s parameters for a specific job.',
    'The critic was trained to predict factory outcomes. Its response format improved from zero out of 100 valid responses to 100 out of 100. We proved format learning.',
  ] },
  { title: 'Critic: what it did not prove', cue: 'The critic’s held-out test details are open.', panel: 'critic-details', say: [
    'Useful outcome prediction was not demonstrated. The critic recognized none of the 17 goal-passing layouts.',
    'Its zero-damage predictions were correct on 18 of 75 valid layouts. A simple majority prediction got 41 correct. So the simulator remains the judge.',
  ] },
  { title: 'Optimizer: the controlled comparison', cue: 'Compare the three methods on the same 20 unseen starting factories.', panel: 'optimizer', say: [
    'The optimizer learned from 1,200 examples of layouts, actions and simulator results. We tested it on 20 unseen factories, with three proposal opportunities per method per factory.',
    'The tuned model reduced the average penalty score by 12.64 percent from the starting layouts. The base model reduced it by 0.14 percent. Random legal moves reduced it by 4.27 percent.',
    'That score combines completion time, errors, damage and equipment cost. These percentages are reductions from the starting layouts, not improvements over the base model.',
  ] },
  { title: 'Optimizer: the evidence and limits', cue: 'The optimizer test details show fresh demand scoring and the win/loss count.', panel: 'optimizer-details', say: [
    'Final scoring used fresh demand days. Against the base model, the tuned optimizer won on 12 factories, lost on two and tied on six.',
    'It still proposed 21 invalid moves out of 60. None of the 20 factories achieved zero damage or the full goal.',
    'Training produced more useful station moves in this synthetic test. It did not solve the factory problem.',
  ] },
  { title: 'Close on the factory', cue: 'The original factory is back on screen. Finish leaves the demo clean and paused.', time: 'end', say: [
    'The training experiments are separate from this factory replay. The adapters are not connected to this UI yet.',
    'Run 11 demonstrates the agent improvement loop and a goal-passing simulated factory. The separate optimizer pilot shows a measured training gain. Every proposed improvement still has to survive the simulator.',
  ] },
];

export function demoAgent(root: AgentNode, path: string[]) {
  let node = root;
  for (const name of path) {
    const child = node.children.find(candidate => candidate.name === name);
    if (!child) throw new Error(`The recorded demo is missing ${name}.`);
    node = child;
  }
  return node;
}
