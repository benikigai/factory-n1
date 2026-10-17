import { exportV2Replays } from '../optimizer-v2-viewer/replay.ts';

const args = process.argv.slice(2), supported = new Set(['--evaluation', '--data', '--out', '--mode', '--audit', '--audit-sha256']);
if (args.includes('--help')) console.log('Usage: npx tsx scripts/build-optimizer-v2-replay.ts --evaluation runs/optimizer-eval/<run> [--mode completed|continuation|interrupted] [--data runs/optimizer-data/v2] [--out runs/optimizer-v2-viewer/data]\nDefault requires completed20; continuation requires completed19. Interrupted requires --audit <verified-partial-audit.json> --audit-sha256 <verified-file-hash>, and exports only audited factories1/10 with no aggregate comparison. Re-scores included arms before exporting traces.');
else {
  if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !supported.has(arg))) throw new Error('Unknown or incomplete argument');
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { if (values.has(args[i])) throw new Error('Repeated option'); values.set(args[i], args[i + 1]); }
  if (!values.get('--evaluation')) throw new Error('--evaluation is required');
  const mode = values.get('--mode') ?? 'completed';
  if (mode !== 'completed' && mode !== 'continuation' && mode !== 'interrupted') throw new Error('--mode must be completed, continuation or interrupted');
  console.log(JSON.stringify(exportV2Replays({ evaluationDirectory: values.get('--evaluation')!, dataDirectory: values.get('--data'), outputDirectory: values.get('--out'), mode, auditPath: values.get('--audit'), auditSha256: values.get('--audit-sha256') }), null, 2));
}
