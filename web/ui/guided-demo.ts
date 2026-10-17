import { h } from './dom';
import { DEMO_TOURS, demoPosition, type DemoStep, type DemoTour } from '../demo-tour';

interface DemoHooks {
  ready(): boolean;
  load(): Promise<void>;
  lock(active: boolean): void;
  show(step: DemoStep): void;
  reset(): void;
  error(message: string): void;
}

/** Walkthrough timers only navigate recorded evidence and local simulator previews. */
export function mountGuidedDemo(before: HTMLElement, hooks: DemoHooks) {
  let tour: DemoTour | null = null;
  let index = -1;
  let busy = false;
  let elapsed = 0;
  let startedAt = 0;
  let paused = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const starts = DEMO_TOURS.map(definition => {
    const button = h('button', {class:'btn primary', id:`start-demo-${definition.id}`}, definition.label);
    button.onclick = () => void start(definition);
    return button;
  });
  const back = h('button', {class:'btn', id:'demo-back'}, 'Back');
  const next = h('button', {class:'btn primary', id:'demo-next'}, 'Next');
  const exit = h('button', {class:'btn', id:'demo-exit'}, 'Exit walkthrough');
  const pause = h('button', {class:'btn', id:'demo-pause'}, 'Pause timer');
  const progress = h('span', {id:'demo-progress'});
  const clock = h('span', {id:'demo-clock',role:'timer','aria-label':'Walkthrough elapsed time'});
  const title = h('h2', {id:'demo-title'});
  const cue = h('p', {id:'demo-cue'});
  const speech = h('div', {id:'demo-speech', tabindex:'0', 'aria-label':'Walkthrough explanation', 'aria-live':'polite'});
  const coach = h('section', {id:'guided-demo', hidden:true, 'aria-label':'Guided walkthrough'},
    h('div', {class:'demo-heading'}, progress, clock, exit), title, cue, speech,
    h('div', {class:'demo-navigation'}, pause, back, next));
  before.before(h('div',{class:'demo-options','aria-label':'Choose walkthrough length'},...starts));
  document.body.append(coach);
  const fmt = (seconds:number) => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  function time() { return tour ? Math.min(tour.seconds, elapsed + (paused ? 0 : (performance.now()-startedAt)/1000)) : 0; }
  function refresh() {
    for (const button of starts) button.disabled = busy || tour !== null || !hooks.ready();
    coach.hidden = tour === null;
    document.body.classList.toggle('guided-mode', tour !== null);
    hooks.lock(tour !== null);
  }
  function stop() {
    clearInterval(ticker);tour = null;index = -1;
    document.querySelectorAll('.demo-focus').forEach(el=>el.classList.remove('demo-focus'));
    refresh();hooks.reset();starts[0].focus({preventScroll:true});
  }
  function update() {
    if(!tour)return;
    try {
      const now = time();
      const position = demoPosition(tour, now);
      if(position.index !== index){
        index=position.index;
        const step=tour.steps[index];
        title.textContent=step.title;
        cue.textContent=`${step.seconds}s · ${step.caption}`;
        speech.replaceChildren(...step.content.map(text=>h('p',null,text)));speech.scrollTop=0;
        hooks.show(step);
      }
      progress.textContent=`${tour.label.toUpperCase()} · ${index+1} / ${tour.steps.length}`;
      clock.textContent=`${fmt(now)} / ${fmt(tour.seconds)}${position.complete?' · Complete':paused?' · Paused':` · ${Math.ceil(position.remaining)}s left`}`;
      pause.textContent=paused?'Resume timer':'Pause timer';pause.disabled=position.complete;
      back.disabled=index===0;next.textContent=index===tour.steps.length-1?'Finish':'Next';
      if(position.complete)clearInterval(ticker);
    } catch(error) {stop();hooks.error((error as Error).message);}
  }
  async function start(definition:DemoTour) {
    if(busy)return;
    busy=true;refresh();
    try{
      await hooks.load();tour=definition;index=-1;elapsed=0;paused=false;startedAt=performance.now();
      refresh();update();ticker=setInterval(update,100);
    } catch(error){hooks.error((error as Error).message);}
    finally{busy=false;refresh();}
  }
  function jump(target:number){
    if(!tour)return;
    elapsed=tour.steps.slice(0,target).reduce((sum,step)=>sum+step.seconds,0);startedAt=performance.now();
    clearInterval(ticker);update();ticker=setInterval(update,100);
  }
  back.onclick=()=>{if(index>0)jump(index-1);};
  next.onclick=()=>{if(!tour)return;if(index===tour.steps.length-1)stop();else jump(index+1);};
  pause.onclick=()=>{elapsed=time();paused=!paused;startedAt=performance.now();update();};
  exit.onclick=stop;
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&tour){event.stopImmediatePropagation();stop();}
  },true);
  refresh();
  return {refresh};
}
