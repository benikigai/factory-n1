import { h } from './ui/dom';

export function renderNemotronGuide(root: HTMLElement) {
  root.replaceChildren(
    h('p', { class: 'tune-context' }, 'Tool use for experiments, different model sizes for different jobs, and downloadable weights for custom training.'),
    h('article', { class: 'tune-result' },
      h('h3', null, 'Lightning · research and testable ideas'),
      h('p', null, 'Nemotron 3.5 Lightning is the smaller text model. It searches warehouse practices through You.com and turns ideas into hypotheses to test.')),
    h('article', { class: 'tune-result' },
      h('h3', null, 'Super VL · design and reflection'),
      h('p', null, 'Nemotron 3.5 Super VL proposes layouts, calls tools to test drafts and measure routes, and writes lessons from the results.'),
      h('p', { class: 'small' }, 'VL means vision-language. It also supports the separate visual inspector. The main optimization loop uses structured layouts and simulator feedback; the 82% result does not establish a benefit from vision.')),
    h('article', { class: 'tune-result' },
      h('h3', null, 'Nano 8B · two separate fine-tunes'),
      h('p', null, 'Downloadable Llama-3.1-Nemotron-Nano-8B weights let us train two LoRA adapters on one GPU: a critic to predict outcomes and an optimizer to propose station moves.'),
      h('p', { class: 'small' }, 'Neither adapter produced the selected replay. Their measured results and limits are in the fine-tune panel below.')),
    h('p', { class: 'tune-limit' }, 'Nemotron proposes; the fixed simulator grades. We did not compare against Claude or GPT, so this does not prove Nemotron is the best model for the task.'),
    h('p', { class: 'small' },
      h('a', { href: 'https://research.nvidia.com/labs/nemotron/Nemotron-3.5-Super-and-Lightning/', target: '_blank', rel: 'noopener noreferrer' }, 'NVIDIA model overview'), ' · ',
      h('a', { href: 'https://huggingface.co/nvidia/Llama-3.1-Nemotron-Nano-8B-v1', target: '_blank', rel: 'noopener noreferrer' }, 'Nano 8B model card')),
  );
}

// Verified against factory-n1-final/docs/evidence/nemotron-{finetune,optimizer}-pilot.md,
// completed October 17, 2026. These fixed experiment results are independent of run selection.
export function renderNemotronResults(root: HTMLElement) {
  const critic = h('article', { class: 'tune-result', id: 'critic-result' },
    h('h3', null, '1. Critic · predict factory outcomes'),
    h('div', { class: 'tune-stat' }, h('strong', null, '0/100 → 100/100'), h('span', null, 'responses matching the required format · base → tuned')),
    h('p', null, h('b', null, 'What it proved: '), 'Training taught the model to return the required structured response.'),
    h('p', { class: 'tune-limit' }, h('b', null, 'What it did not prove: '), 'Reliable factory predictions. It recognized none of the 17 goal-passing layouts. Simulator results remain the source of truth.'),
    h('details', {id:'critic-test-details'}, h('summary', null, 'Critic test details'),
      h('p', null, '600 training examples from 30 synthetic buildings. Evaluation used 100 held-out examples from five other buildings, with 100 calls per model.'),
      h('dl', { class: 'station-stats' },
        h('dt', null, 'Layout validity correct'), h('dd', null, '76/100'),
        h('dt', null, 'Always-valid baseline'), h('dd', null, '75/100'),
        h('dt', null, 'Zero-damage prediction correct'), h('dd', null, '18/75 valid layouts'),
        h('dt', null, 'Majority-label baseline'), h('dd', null, '41/75')),
      h('p', { class: 'small' }, 'Better formatting does not establish better prediction.')),
  );
  const optimizer = h('article', { class: 'tune-result', id: 'optimizer-result' },
    h('h3', null, '2. Optimizer · propose station moves'),
    h('div', { class: 'tune-stat' }, h('strong', null, '12.64%'), h('span', null, 'reduction in mean simulator penalty from the starting layouts')),
    h('p', {class:'comparison-explainer'}, 'We gave each method the same 20 unseen starting factories and three chances per factory to propose a move. We then scored the resulting layouts on four fresh demand days per factory.'),
    h('table', { class: 'metrics tune-comparison', 'aria-label': 'Optimizer comparison' },
      h('caption', null, 'Reduction in average penalty from the starting layouts. Higher reduction is better.'),
      h('thead', null, h('tr', null, h('th', null, 'How moves were chosen'), h('th', { class: 'num' }, 'Penalty reduced'))),
      h('tbody', null,
        h('tr', null, h('th', { scope: 'row' }, 'Base Nemotron', h('small',null,'Original model, no adapter')), h('td', { class: 'num' }, '0.14%')),
        h('tr', null, h('th', { scope: 'row' }, 'Fine-tuned Nemotron', h('small',null,'Same model + our optimizer adapter')), h('td', { class: 'num tune-best' }, '12.64%')),
        h('tr', null, h('th', { scope: 'row' }, 'Random legal moves', h('small',null,'Random valid station relocations')), h('td', { class: 'num' }, '4.27%')))),
    h('p', {class:'comparison-explainer small'}, 'All three percentages use the same starting mean penalty: 10,767.46. The penalty combines time, mis-sorts, damage, unshipped packages and equipment cost. This is not a throughput percentage or a real-world savings estimate.'),
    h('p', null, h('b', null, 'What it proved: '), 'Training produced more useful station-move proposals on 20 unseen synthetic factories.'),
    h('p', { class: 'tune-limit' }, h('b', null, 'Still limited: '), '21 of 60 proposals were invalid. None of the 20 factories achieved zero damage or the full goal.'),
    h('details', {id:'optimizer-test-details'}, h('summary', null, 'Optimizer test details'),
      h('p', null, '1,200 training examples from 60 buildings, labeled by simulator search. Each method got the same 20 unseen starting factories and three proposal opportunities per factory.'),
      h('p', null, 'Both models used the same base checkpoint, output limit, parser and acceptance rules. Final scoring used four fresh demand days per building after proposal selection.'),
      h('p', null, 'Against the base model: 12 wins, two losses, six ties. Two tuned factories regressed on fresh demand despite passing the feedback-day gate.'),
      h('p', { class: 'small' }, '12.64% is the reduction in the aggregate mean objective from starting layouts. It is not a throughput gain or a percentage improvement over the base model. Lower scores combine faster completion, fewer errors, less damage and equipment cost.'),
      h('p', { class: 'small' }, 'An independent audit reproduced all 1,156 scenario simulations. Actual token use and simulation counts differed between methods, within equal limits.')),
  );
  root.replaceChildren(
    h('p', { class: 'tune-context' }, 'Completed experiments · October 17, 2026. These results are separate from the selected factory replay; neither adapter is connected to this UI.'),
    h('p', {class:'small'}, h('a',{href:'./evidence/nemotron-finetune-pilot.md',target:'_blank',rel:'noopener'},'Critic evidence'), ' · ', h('a',{href:'./evidence/nemotron-optimizer-pilot.md',target:'_blank',rel:'noopener'},'Optimizer evidence')),
    critic, optimizer,
    h('details', { class: 'tune-method' }, h('summary', null, 'Shared model and training setup'),
      h('p', null, 'Two independent LoRA adapters on the same Llama-3.1-Nemotron-Nano-8B-v1 base model. Each trained about 6.8 million parameters for one epoch on a Crusoe A100 80GB.'),
      h('p', null, 'The critic learned to predict outcomes. The optimizer learned to relocate an existing sorter or packing station, or stop. The optimizer was not trained on the critic.'),
      h('p', { class: 'small' }, 'These are synthetic experiments, not evidence of real warehouse savings.')),
  );
}
