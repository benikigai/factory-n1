import { h } from './dom';
import { DEMO_STEPS, type DemoStep } from '../demo-tour';

interface DemoHooks {
  ready(): boolean;
  load(): Promise<void>;
  lock(active: boolean): void;
  show(step: DemoStep): void;
  reset(): void;
  error(message: string): void;
}

/** The tour only selects recorded evidence and runs local simulator previews. */
export function mountGuidedDemo(before: HTMLElement, hooks: DemoHooks) {
  let index: number | null = null;
  let busy = false;
  const start = h('button', {class:'btn primary', id:'start-demo'}, 'Guided demo · Run 11');
  const back = h('button', {class:'btn', id:'demo-back'}, 'Back');
  const next = h('button', {class:'btn primary', id:'demo-next'}, 'Next');
  const exit = h('button', {class:'btn', id:'demo-exit'}, 'Exit demo');
  const progress = h('span', {id:'demo-progress'});
  const title = h('h2', {id:'demo-title'});
  const cue = h('p', {id:'demo-cue'});
  const speech = h('div', {id:'demo-speech', tabindex:'0', 'aria-label':'What to say', 'aria-live':'polite'});
  const coach = h('section', {id:'guided-demo', hidden:true, 'aria-label':'Guided demo'},
    h('div', {class:'demo-heading'}, progress, exit), title, cue, speech,
    h('div', {class:'demo-navigation'}, h('span',null,'What to say · about 6 minutes'), back, next));
  before.before(start);
  document.body.append(coach);

  function refresh() {
    start.disabled = busy || index !== null || !hooks.ready();
    coach.hidden = index === null;
    document.body.classList.toggle('guided-mode', index !== null);
    hooks.lock(index !== null);
  }
  function stop() {
    index = null;
    document.querySelectorAll('.demo-focus').forEach(el=>el.classList.remove('demo-focus'));
    refresh();hooks.reset();start.focus({preventScroll:true});
  }
  function show() {
    if(index === null)return;
    try {
      const step=DEMO_STEPS[index];
      progress.textContent=`GUIDED DEMO · ${index+1} / ${DEMO_STEPS.length}`;
      title.textContent=step.title;cue.textContent=step.cue;
      speech.replaceChildren(...step.say.map(text=>h('p',null,text)));speech.scrollTop=0;
      back.disabled=index===0;next.textContent=index===DEMO_STEPS.length-1?'Finish':'Next';
      refresh();hooks.show(step);
    } catch(error) {stop();hooks.error((error as Error).message);}
  }
  start.onclick=async()=>{
    if(busy)return;
    busy=true;refresh();
    try{await hooks.load();index=0;show();}
    catch(error){hooks.error((error as Error).message);}
    finally{busy=false;refresh();}
  };
  back.onclick=()=>{if(index!==null){index=Math.max(0,index-1);show();}};
  next.onclick=()=>{if(index===null)return;if(index===DEMO_STEPS.length-1)stop();else{index++;show();}};
  exit.onclick=stop;
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&index!==null){event.stopImmediatePropagation();stop();}
  },true);
  refresh();
  return {refresh};
}
