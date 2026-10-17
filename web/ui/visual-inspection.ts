import type { VisualInspection } from '../../src/inspection/types';
import { h, fmtTime } from './dom';

export type InspectionState =
  | { status: 'loading'; runId: string }
  | { status: 'missing'; runId: string }
  | { status: 'error'; runId: string; message: string }
  | { status: 'ready'; runId: string; data: VisualInspection };

export async function loadVisualInspection(runId: string): Promise<InspectionState> {
  try {
    const response = await fetch(`./runs/${encodeURIComponent(runId)}/inspection/inspection.json`);
    if (response.status === 404) return { status: 'missing', runId };
    if (!response.ok) throw new Error(`Inspection could not load (${response.status})`);
    const data = await response.json() as VisualInspection;
    if (data.runId !== runId || !Array.isArray(data.frames) || !Array.isArray(data.findings) || !Array.isArray(data.toolReceipts)) {
      throw new Error('Inspection artifact has an invalid recording identity or structure');
    }
    return { status: 'ready', runId, data };
  } catch (error) {
    return { status: 'error', runId, message: error instanceof Error ? error.message : String(error) };
  }
}

function artifactUrl(runId: string, path: string): string | null {
  try {
    const base = new URL(`./runs/${encodeURIComponent(runId)}/inspection/`, location.href);
    const url = new URL(path, base);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.search && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

function evidenceLink(runId: string, path: string, label: string): HTMLElement {
  const url = artifactUrl(runId, path);
  return url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, label) : h('span', { class: 'small' }, `${label}: unavailable path`);
}

function raw(value: unknown): HTMLElement {
  return h('pre', { class: 'inspection-json' }, JSON.stringify(value, null, 2) ?? 'No value recorded');
}

export function renderVisualInspection(container: HTMLElement, state: InspectionState, seek: (seconds: number) => void): void {
  container.replaceChildren(
    h('div', { class: 'inspection-heading' }, h('span', { class: 'inspection-kicker' }, 'Can the model see the floor?'), h('h2', null, 'Nemotron visual inspector')),
    h('ol', { class: 'inspection-explain' },
      h('li', null, h('b', null, 'What it looks at. '), 'One screenshot of this replay: the starting floor on the left, the agents\' floor on the right. The floor on screen is frozen on that exact frame.'),
      h('li', null, h('b', null, 'Proof it really saw it. '), 'A random six-character code is drawn into the pixels and appears nowhere in the text. Nemotron Super VL has to read it back.'),
      h('li', null, h('b', null, 'What it reports. '), 'Findings about the layout. Every number it states is checked by code (the receipts). Anything visual or causal stays marked "not tested".'),
    ),
    h('p', { class: 'small' }, `This runs after the run finishes. It does not change the layout or the grader${state.runId === 'live-a-11' ? ', and did not produce the run 11 improvement' : ''}. Today it inspects a simulated floor. Tomorrow, a camera on a real one.`),
  );
  if (state.status !== 'ready') {
    container.append(h('p', { class: state.status === 'error' ? 'fail' : 'small', role: 'status' },
      state.status === 'loading' ? 'Loading recorded inspection…' : state.status === 'missing' ? `No visual inspection has been recorded for ${state.runId}.` : state.message));
    return;
  }

  const data = state.data;
  const captured = new Date(data.recordedAt);
  container.append(
    h('div', { class: 'inspection-status' },
      h('span', { class: `state ${data.imageInput.verified ? 'state-done' : 'state-failed'}` }, data.imageInput.verified ? 'Image input verified' : 'Image input not verified'),
      h('span', { class: 'small' }, data.provider),
    ),
    h('p', { class: 'inspection-model' }, h('code', null, data.model)),
    h('p', { class: 'small' }, `Recorded ${Number.isNaN(captured.getTime()) ? data.recordedAt : captured.toLocaleString()} · ${data.runId}`),
    h('p', { class: 'small' }, `Frozen grader ${data.graderHash}`),
    h('p', { class: 'small' }, data.imageInput.details),
  );
  if (data.budget) container.append(h('p', { class: 'small' }, `${data.budget.calls} model calls · $${data.budget.usd.toFixed(5)} returned usage${data.budget.reservedUsd > 0 ? ` · $${data.budget.reservedUsd.toFixed(5)} reserved for uncertain charges` : ''}`));
  const verification = h('details', { class: 'inspection-verification' }, h('summary', null, 'Image-input verification receipt'),
    h('p', { class: 'small' }, data.imageInput.method), raw(data.imageInput));
  container.append(verification);

  if (data.frames.length) container.append(h('h3', null, 'Frames sent to the model'));
  for (const [index, frame] of data.frames.entries()) {
    const src = artifactUrl(state.runId, frame.path);
    if (!src) continue;
    const caption = h('figcaption', null, h('strong', null, frame.label));
    if (frame.simulationTime !== undefined) {
      const seconds = frame.simulationTime;
      const jump = h('button', { class: 'btn' }, `Replay at ${fmtTime(seconds)}`);
      jump.onclick = () => seek(seconds);
      caption.append(jump);
    }
    container.append(h('figure', { class: 'inspection-frame', id: `inspection-frame-${index}` },
      h('a', { href: src, target: '_blank', rel: 'noopener' }, h('img', { src, alt: frame.label, loading: 'lazy' })), caption));
  }

  container.append(h('h3', null, `Visual findings (${data.findings.length})`));
  for (const finding of data.findings) {
    const result = finding.verification;
    const status = result.status === 'supported' ? 'Supported by tool' : result.status === 'refuted' ? 'Refuted by tool' : 'Not tested';
    const card = h('article', { class: `inspection-finding inspection-${result.status}` },
      h('h4', null, finding.title), h('p', null, finding.observation),
      ...(finding.confidence ? [h('p', { class: 'small' }, `Model confidence: ${finding.confidence}`)] : []),
      h('div', { class: 'inspection-result' }, h('strong', null, status), h('p', null, result.summary)),
    );
    if (result.receiptIds?.length) {
      const links = result.receiptIds.map(id => {
        const index = data.toolReceipts.findIndex(receipt => receipt.id === id);
        if (index < 0) return h('span', { class: 'small' }, `${id} (receipt not present)`);
        const button = h('button', { class: 'btn' }, `Receipt ${id}`);
        button.onclick = () => {
          const receipt = container.querySelector<HTMLDetailsElement>(`#inspection-receipt-${index}`);
          if (receipt) { receipt.open = true; receipt.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        };
        return button;
      });
      card.append(h('div', { class: 'inspection-receipt-links' }, ...links));
    }
    container.append(card);
  }

  container.append(h('h3', null, `Deterministic tool receipts (${data.toolReceipts.length})`));
  for (const [index, receipt] of data.toolReceipts.entries()) {
    container.append(h('details', { class: 'inspection-tool', id: `inspection-receipt-${index}` },
      h('summary', null, `${receipt.name} · ${receipt.status}`),
      h('p', { class: 'small' }, `Receipt ${receipt.id}${receipt.durationMs !== undefined ? ` · ${receipt.durationMs} ms` : ''}`),
      h('h4', null, 'Input'), raw(receipt.input), h('h4', null, 'Output'), raw(receipt.output)));
  }
  if (data.notes?.length) container.append(h('ul', { class: 'inspection-notes small' }, ...data.notes.map(note => h('li', null, note))));
  container.append(h('div', { class: 'artifact-links' },
    evidenceLink(state.runId, 'inspection.json', 'Raw inspection'),
    ...(data.trainingDataPath ? [evidenceLink(state.runId, data.trainingDataPath, 'Saved training data')] : []),
  ));
}
