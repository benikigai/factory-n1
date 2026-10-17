import { exportV2Replays } from '../optimizer-v2-viewer/replay.ts';

const args = process.argv.slice(2), supported = new Set(['--evaluation', '--data', '--out']);
if (args.includes('--help')) console.log('Usage: npx tsx scripts/build-optimizer-v2-replay.ts --evaluation runs/optimizer-eval/<completed-v2-run> [--data runs/optimizer-data/v2] [--out runs/optimizer-v2-viewer/data]\nRequires a completed all-20-factory report. Re-scores all arms before exporting matched model traces.');
else {
  if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !supported.has(arg))) throw new Error('Unknown or incomplete argument');
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { if (values.has(args[i])) throw new Error('Repeated option'); values.set(args[i], args[i + 1]); }
  if (!values.get('--evaluation')) throw new Error('--evaluation is required');
  console.log(JSON.stringify(exportV2Replays({ evaluationDirectory: values.get('--evaluation')!, dataDirectory: values.get('--data'), outputDirectory: values.get('--out') }), null, 2));
}
