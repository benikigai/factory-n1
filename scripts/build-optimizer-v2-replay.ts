import { exportV2Replays } from '../optimizer-v2-viewer/replay.ts';

const args = process.argv.slice(2), supported = new Set(['--evaluation', '--data', '--out', '--mode']);
if (args.includes('--help')) console.log('Usage: npx tsx scripts/build-optimizer-v2-replay.ts --evaluation runs/optimizer-eval/<completed-v2-run> [--mode completed|continuation] [--data runs/optimizer-data/v2] [--out runs/optimizer-v2-viewer/data]\nDefault mode requires a completed all-20 report. Explicit continuation mode requires a completed 19-of-20 continuation-results.json with disclosure. Re-scores all included arms before exporting matched traces. Run only after independent audit passes.');
else {
  if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !supported.has(arg))) throw new Error('Unknown or incomplete argument');
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { if (values.has(args[i])) throw new Error('Repeated option'); values.set(args[i], args[i + 1]); }
  if (!values.get('--evaluation')) throw new Error('--evaluation is required');
  const mode = values.get('--mode') ?? 'completed';
  if (mode !== 'completed' && mode !== 'continuation') throw new Error('--mode must be completed or continuation');
  console.log(JSON.stringify(exportV2Replays({ evaluationDirectory: values.get('--evaluation')!, dataDirectory: values.get('--data'), outputDirectory: values.get('--out'), mode }), null, 2));
}
