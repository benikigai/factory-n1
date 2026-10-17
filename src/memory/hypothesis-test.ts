/**
 * Isolated test of one external hypothesis. Lightning translates the hypothesis into the
 * smallest change to the current champion (code enforces 1-3 atomic edits); the frozen
 * simulator scores champion vs champion+change on the validation days. Only this result
 * can promote a hypothesis. Web text never touches the grader.
 */
import { retryOn429 } from "../agents/retry.ts";
import { chat, MODELS, parseJson } from "../llm/crusoe.ts";
import { DEFAULT_DOD } from "../sim/dod.ts";
import { evaluate, type Evaluation } from "../sim/evaluate.ts";
import type { Layout } from "../sim/types.ts";
import { validateForTask, type Task } from "../tasks/task.ts";
import { attribute } from "./attribution.ts";
import type { Lesson, MemoryOp } from "./store.ts";

export const MAX_TEST_EDITS = 3;

export interface HypothesisTest {
  op: MemoryOp | null;
  layout: Layout | null;
  train: Evaluation | null;
  select: Evaluation | null;
  improved: boolean;
  /** Why the hypothesis could not be tested, if it couldn't. */
  untestable?: string;
  simEvals: number;
}

export async function testHypothesis(opts: {
  task: Task;
  lesson: Lesson;
  champion: Layout;
  championSelect: Evaluation;
  gen: number;
  margin: number;
}): Promise<HypothesisTest> {
  const none = (untestable: string): HypothesisTest => ({ op: null, layout: null, train: null, select: null, improved: false, untestable, simEvals: 0 });
  const messages = [
    {
      role: "system" as const,
      content: `You implement ONE hypothesis as the smallest possible change (1 to ${MAX_TEST_EDITS} edits) to a factory layout, so it can be tested in isolation. Only sorter positions, pack station positions, adding/removing a pack station, and pack-station zones/sizes may change. Docks and grid are fixed. The change must differ from the current layout. Reply with strict JSON only (no comments, no trailing text): {"layout": <the complete modified layout>}`,
    },
    {
      role: "user" as const,
      content: `Hypothesis: ${opts.lesson.text}\nHow to test: ${opts.lesson.testableAs ?? "n/a"}\n\nCurrent layout:\n${JSON.stringify(opts.champion)}`,
    },
  ];
  const ask = (msgs: typeof messages | { role: "user" | "system" | "assistant"; content: string }[]) =>
    retryOn429(() => chat("hypothesis-test", { model: MODELS.lightning, max_tokens: 2500, temperature: 0, chat_template_kwargs: { enable_thinking: false }, messages: msgs }));
  let layout: Layout;
  try {
    const first = await ask(messages);
    const text = first.choices[0]?.message.content ?? "";
    try {
      layout = parseJson<{ layout: Layout }>(text).layout;
    } catch (parseError) {
      // One repair: malformed JSON is a formatting failure, not a test result.
      const second = await ask([...messages, { role: "assistant", content: text }, { role: "user", content: `That was not valid JSON (${String((parseError as Error).message).slice(0, 80)}). Reply again with strict JSON only: {"layout": ...}` }]);
      layout = parseJson<{ layout: Layout }>(second.choices[0]?.message.content).layout;
    }
  } catch (e) {
    return none(`no usable intervention: ${String((e as Error).message).slice(0, 100)}`);
  }
  const errors = validateForTask(layout, opts.task);
  if (errors.length) return none(`intervention invalid: ${errors.slice(0, 2).join("; ")}`);
  const edits = attribute(opts.champion, layout);
  if (edits.length === 0) return none("intervention made no change");
  if (edits.length > MAX_TEST_EDITS) return none(`intervention not isolated (${edits.length} edits > ${MAX_TEST_EDITS})`);

  const train = evaluate(layout, "train", DEFAULT_DOD);
  const select = evaluate(layout, "select", DEFAULT_DOD);
  const deltaSelect = Math.round((select.objective - opts.championSelect.objective) * 100) / 100;
  const improved = select.objective <= opts.championSelect.objective * (1 - opts.margin);
  return {
    op: {
      op: "tested",
      id: opts.lesson.id,
      improved,
      evidence: {
        gen: opts.gen,
        candidateId: `test-${opts.lesson.id}`,
        accepted: false,
        deltaSelect,
        isolated: true,
        edits: edits.map((e) => ({ edit: e.deltaAlone === null ? `${e.edit} (not valid on its own)` : e.edit, deltaAlone: e.deltaAlone ?? 0 })),
      },
    },
    layout,
    train,
    select,
    improved,
    simEvals: 2 + edits.length,
  };
}
