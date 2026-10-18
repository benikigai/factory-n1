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
    { title: 'A factory that redesigns itself', seconds: 15, time: 'play', caption: 'Same 100 packages. Same clock.', content: [
      'Left is the original floor. Right is what Nemotron agents built. Receive, sort, pack, ship. Same 100 packages, same clock.',
    ] },
    { title: 'The agents draw. Code decides.', seconds: 15, agentPath: ['Designers'], caption: 'Nemotron on Crusoe proposes. A frozen simulator decides.', content: [
      'Nemotron Super VL designers on Crusoe propose new floors. A frozen simulator scores them. A change ships only if it wins on days the designers never saw.',
    ] },
    { title: 'One move', seconds: 15, time: 'end', station: {side:'improved',id:'pack-B',detail:'failures'}, caption: '15 cells became 11. Under the limit.', content: [
      'Run 7 left one 15-cell conveyor that broke fragile packages. Run 11 moved pack-B 3 cells inland. 15 cells became 11. Under the limit.',
    ] },
    { title: 'Goal met', seconds: 15, time: 'end', panel:'results', caption: '100 of 100. 19:44. Zero mis-sorts. Zero damage.', content: [
      '100 of 100 shipped in 19:44. Zero mis-sorts. Zero damage. 82% better across 9 held-out days, for 4 cents. Version N+1 has to earn it.',
    ] },
  ] },
  { id: 'detailed', label: '4-minute detailed walkthrough', seconds: 240, steps: [
    { title: 'A factory that redesigns itself', seconds: 30, time:'play', caption:'Same 100 packages. Same clock.', content:[
      'A factory floor gets drawn once. Then demand shifts and the floor stays. Agents can propose the redesign, but agents grade their own homework. So here the agents draw and code decides.',
      'Left is the original floor. Right is the agents\' floor. Same 100 packages, same clock.',
    ] },
    { title: 'Why the old floor fails', seconds:30, panel:'rules', caption:'Two rules: box size and leg length.', content:[
      'Two rules. The old pack stations only take small and medium boxes, so large boxes get mis-sorted. Fragile packages break on any conveyor leg longer than 12 cells.',
      'On the peak day the old floor takes 26:21. 16 mis-sorts. 14 damaged.',
    ] },
    { title: 'Stress tests', seconds:30, panel:'demand', profile:'peak', time:'play', caption:'Normal, peak and fragile days.', content:[
      'Every layout runs on three kinds of day. Normal spreads 100 arrivals over 20 minutes. Peak crams them into 5. Fragile raises fragile packages from 10% to 35%.',
      'Fixed seeds. Same days for every design. No model calls.',
    ] },
    { title: 'The agent factory', seconds:30, agentPath:['Designers','Route designer','Generation 1'], caption:'Two models create. Three pieces of code keep them honest.', content:[
      'The team is a factory too. Nemotron Lightning researches on You.com. Nemotron Super VL designers propose layouts through typed tools and test drafts first.',
      'Code scores every proposal, keeps only measured lessons, and ships at most one change per generation. Every step leaves a receipt.',
    ] },
    { title: 'The fix', seconds:30, station:{side:'improved',id:'pack-B',detail:'failures'}, time:'end', caption:'pack-B moved from (0,4) to (3,5).', content:[
      'Run 7 gave each zone its own pack station. One leg, sorter to pack-B, was still 15 cells. Runs 8 to 10 stalled until the designers got a ruler tool.',
      'Run 11 moved pack-B from (0,4) to (3,5). 15 cells became 11. The next leg is 8. Both under the limit.',
    ] },
    { title: 'Result', seconds:30, panel:'results', time:'end', caption:'Goal met. 82% better. 4 cents.', content:[
      'Peak day: 19:44, zero mis-sorts, zero damage. 82% better across 9 held-out days. 54 model calls, 4 cents.',
      'Run 7 is the fair comparison. With the same 41 simulator runs it beat a one-line code fix and random search.',
    ] },
    { title: 'Fine-tune one: the critic', seconds:30, panel:'critic-details', caption:'It learned the format, not the outcome.', content:[
      'Nemotron Nano 8B, fine-tuned on a Crusoe GPU as a critic. Valid answers went from 0 to 100 out of 100.',
      'It could not predict which layouts pass. The simulator stays the judge.',
    ] },
    { title: 'Fine-tune two: the optimizer', seconds:30, panel:'optimizer', caption:'12.6% better on 20 factories it never saw.', content:[
      'A second adapter learned from 1,200 simulator examples. On 20 factories it never saw, it cut the score 12.6%. The base model managed 0.1%. Random moves, 4.3%.',
      'Still no full-goal wins, and 21 of 60 moves were invalid. That is the next version.',
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
