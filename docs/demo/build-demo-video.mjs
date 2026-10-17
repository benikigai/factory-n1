#!/usr/bin/env node
/**
 * Reproducible 60-second Factory N+1 demo video builder.
 *
 * - Key safety: loads ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID from process.env
 *   (or an external env file passed via ELEVENLABS_ENV_FILE). Never logs or writes keys.
 * - Picture: captures 1440x900 shots with Playwright from https://factory-n1.vercel.app
 *   and the rehearsed live laptop run at http://localhost:5173/replay.html?run=live-demo-2,
 *   burns in the exact lower-third captions, and stitches to 60.0s with ffmpeg.
 * - Output: ~/Desktop/factory-n1-demo.mp4 (outside the repository).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PLAYWRIGHT_PATH =
  process.env.PLAYWRIGHT_MODULE_PATH ||
  '/Users/bshyong/.npm/_npx/e41f203b7505f1fb/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT_PATH);

const VERCEL_BASE = process.env.DEMO_VERCEL_URL || 'https://factory-n1.vercel.app';
const LOCAL_BASE = process.env.DEMO_LOCAL_URL || 'http://localhost:5173';
const OUT_MP4 = process.env.DEMO_OUT_MP4 || path.join(os.homedir(), 'Desktop', 'factory-n1-demo.mp4');
const WORK_DIR = process.env.DEMO_WORK_DIR || '/tmp/factory-n1-demo-build';
const AUDIO_DIR = process.env.DEMO_AUDIO_DIR || '/tmp/factory-n1-demo-audio';

fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function loadEnvFile(filePath) {
  const out = {};
  if (!filePath || !fs.existsSync(filePath)) return out;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    out[k] = v;
  }
  return out;
}

const SEGMENTS = [
  {
    id: '01_hook_00-06',
    start: 0,
    end: 6,
    text: 'Left floor is jammed. Right floor clears every box. Four cents of Nemotron.',
  },
  {
    id: '02_floor_06-15',
    start: 6,
    end: 15,
    text: 'We call it Factory N plus one. A new layout only ships if it beats the old one. Simple rule.',
  },
  {
    id: '03a_agents_15-25',
    start: 15,
    end: 25,
    text: 'Lightning looks up warehouse rules on You dot com. Super V L sketches layouts on Crusoe. A locked simulator grades every day.',
  },
  {
    id: '03b_live_25-30',
    start: 25,
    end: 30,
    text: 'Here is a live run from my laptop today. Sixty six seconds.',
  },
  {
    id: '04_lineage_30-48',
    start: 30,
    end: 48,
    text: 'Run seven beat a code fix and random search on the same budget. Still broke four fragile boxes, and three runs stalled counting steps wrong. We gave it a ruler. Run eleven moved one pack table in, zero broken.',
  },
  {
    id: '05_trust_48-55',
    start: 48,
    end: 55,
    text: 'One model even faked a simulator score. The grader caught it cold.',
  },
  {
    id: '06_close_55-60',
    start: 55,
    end: 60,
    text: 'Factory N plus one. The next version earns it.',
  },
];

async function ensureMasterAudio() {
  const masterMp3 = path.join(AUDIO_DIR, 'factory-n1-ben-voiceover-60s.mp3');
  if (fs.existsSync(masterMp3)) {
    return masterMp3;
  }
  const envFromFile = loadEnvFile(process.env.ELEVENLABS_ENV_FILE);
  const apiKey = process.env.ELEVENLABS_API_KEY || envFromFile.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || envFromFile.ELEVENLABS_VOICE_ID || 'ykEL2qy430IhnwQ830iE';
  if (!apiKey) {
    throw new Error('Missing ELEVENLABS_API_KEY in environment or ELEVENLABS_ENV_FILE.');
  }

  for (const seg of SEGMENTS) {
    const segPath = path.join(AUDIO_DIR, `${seg.id}.mp3`);
    if (!fs.existsSync(segPath)) {
      const payload = JSON.stringify({
        text: seg.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      });
      execFileSync('curl', [
        '-4', '-sS', '-X', 'POST',
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        '-H', `xi-api-key: ${apiKey}`,
        '-H', 'Content-Type: application/json',
        '-d', payload,
        '-o', segPath,
      ]);
    }
  }

  const inputs = [];
  const filterParts = ['aevalsrc=0:d=60:s=44100:c=stereo[base]'];
  const mixLabels = ['[base]'];
  SEGMENTS.forEach((seg, idx) => {
    const p = path.join(AUDIO_DIR, `${seg.id}.mp3`);
    inputs.push('-i', p);
    const delayMs = Math.round(seg.start * 1000);
    const lbl = `[s${idx}]`;
    filterParts.push(`[${idx}:a]adelay=${delayMs}|${delayMs},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo${lbl}`);
    mixLabels.push(lbl);
  });
  filterParts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0,alimiter=limit=0.95[outa]`);
  execFileSync('ffmpeg', [
    '-y', ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outa]', '-t', '60', '-b:a', '192k', masterMp3,
  ], { stdio: 'ignore' });
  return masterMp3;
}

async function styleSceneWithCaption(page, { badge, caption, zoom = 1.0, origin = '50% 50%' }) {
  await page.evaluate(({ badge, caption, zoom, origin }) => {
    const target = document.getElementById('app') || document.querySelector('main') || document.body;
    target.style.transformOrigin = origin;
    target.style.transform = zoom === 1 ? 'none' : `scale(${zoom})`;

    let bar = document.getElementById('demo-burned-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-burned-caption';
      bar.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:22px',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'display:flex',
        'align-items:center',
        'gap:12px',
        'background:rgba(14, 19, 16, 0.92)',
        'color:#f6f3ea',
        'font-family:"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        'font-size:14px',
        'font-weight:600',
        'letter-spacing:0.015em',
        'padding:10px 18px',
        'border-radius:6px',
        'border:1px solid rgba(246, 243, 234, 0.28)',
        'box-shadow:0 10px 28px rgba(0, 0, 0, 0.42)',
        'white-space:nowrap',
      ].join(';');
      document.body.appendChild(bar);
    }
    bar.innerHTML = `<span style="background:#1f5c3a;color:#f6f3ea;padding:3px 8px;border-radius:4px;font-size:12px;letter-spacing:0.05em;">${badge}</span><span>${caption}</span>`;
  }, { badge, caption, zoom, origin });
}

const SHOTS = [
  {
    id: '01_hook',
    durationSec: 6,
    animated: true,
    url: `${VERCEL_BASE}/?speed=60`,
    badge: '0:00 · HOOK',
    caption: '18,061 → 3,283 (−82%) · goal met on all 15 development days (final split locked) · ~4¢/run',
    zoom: 1.0,
    origin: '50% 42%',
  },
  {
    id: '02_floor',
    durationSec: 9,
    animated: true,
    url: `${VERCEL_BASE}/replay.html?run=live-a-11`,
    badge: '0:06 · FACTORY N+1',
    caption: 'VERSION N+1 SHIPS ONLY IF IT BEATS VERSION N · 24×14 floor · 100 packages · 4 executable checks',
    zoom: 1.18,
    origin: '56% 48%',
    click60x: true,
  },
  {
    id: '03a_agents',
    durationSec: 6,
    animated: true,
    url: `${VERCEL_BASE}/replay.html?run=live-a-7&view=agents`,
    badge: '0:15 · AGENT LOOP',
    caption: 'YOU.COM → NEMOTRON 3.5 ON CRUSOE → FROZEN GRADER 493a1b03',
    zoom: 1.12,
    origin: '46% 48%',
    click60x: true,
  },
  {
    id: '03b_visual',
    durationSec: 4,
    animated: false,
    url: `${VERCEL_BASE}/replay.html?run=live-a-11&view=visual`,
    badge: '0:21 · VISUAL INSPECTOR',
    caption: 'Nemotron-3.5-Super-VL visual check · canary 678D59 verified · 3 calls ($0.00166)',
    zoom: 1.0,
    origin: '50% 50%',
  },
  {
    id: '03c_live_demo_2',
    durationSec: 5,
    animated: true,
    url: `${LOCAL_BASE}/replay.html?run=live-demo-2`,
    fallbackUrl: `${VERCEL_BASE}/replay.html?run=live-a-11`,
    badge: '0:25 · REHEARSAL RUN',
    caption: 'recorded from a live laptop run today · live-demo-2 · 66 s to goal · $0.042',
    zoom: 1.1,
    origin: '45% 45%',
    click60x: true,
  },
  {
    id: '04a_equal_budget',
    durationSec: 9,
    animated: false,
    url: `${VERCEL_BASE}/?speed=60#inspection`,
    scrollId: 'inspection',
    badge: '0:30 · EQUAL BUDGET (RUN 7)',
    caption: '41 sim runs: run 7 6,083 vs code heuristic 13,194 (both fix mis-sorts; shorter routes win) & random 13,099',
    zoom: 1.0,
    origin: '32% 52%',
  },
  {
    id: '04b_revisions',
    durationSec: 9,
    animated: false,
    url: `${VERCEL_BASE}/?speed=60#revisions`,
    scrollId: 'revisions',
    badge: '0:39 · RUN 7 → RUN 11',
    caption: '18,061 → 6,083 (run 7 FAIL, 4 damaged) → 3,283 (run 11 PASS, 0 damaged with measure_legs ruler)',
    zoom: 1.0,
    origin: '50% 50%',
  },
  {
    id: '05_trust',
    durationSec: 7,
    animated: false,
    url: `${VERCEL_BASE}/?speed=60#inspection`,
    scrollId: 'inspection',
    badge: '0:48 · CLAIM AUDIT',
    caption: 'Model claimed a re-run: ≈4 mis-sorts, passing · no re-run happened · grader 493a1b03 measured 18',
    zoom: 1.15,
    origin: '50% 54%',
  },
  {
    id: '06_close',
    durationSec: 5,
    animated: true,
    url: `${VERCEL_BASE}/?speed=60#top`,
    scrollTop: true,
    badge: '0:55 · FACTORY N+1',
    caption: 'FACTORY N+1 · THE NEXT VERSION EARNS IT · https://factory-n1.vercel.app',
    zoom: 1.0,
    origin: '50% 50%',
  },
];

async function captureClip(browser, shot) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch {
    if (shot.fallbackUrl) {
      await page.goto(shot.fallbackUrl, { waitUntil: 'networkidle', timeout: 15000 });
    }
  }
  await page.waitForTimeout(1000);

  if (shot.click60x) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '60×');
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
  }
  if (shot.scrollId) {
    await page.evaluate((id) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'center' });
    }, shot.scrollId);
    await page.waitForTimeout(400);
  }
  if (shot.scrollTop) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(300);
  }

  await styleSceneWithCaption(page, shot);
  const clipMp4 = path.join(WORK_DIR, `${shot.id}.mp4`);

  if (shot.animated) {
    const fps = 10;
    const totalFrames = shot.durationSec * fps;
    const frameDir = path.join(WORK_DIR, `frames_${shot.id}`);
    fs.mkdirSync(frameDir, { recursive: true });
    for (let i = 0; i < totalFrames; i++) {
      const framePath = path.join(frameDir, `f_${String(i).padStart(4, '0')}.jpg`);
      await page.screenshot({ path: framePath, type: 'jpeg', quality: 90 });
      await page.waitForTimeout(85);
    }
    execFileSync('ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(frameDir, 'f_%04d.jpg'),
      '-vf', 'fps=30,scale=1440:900:flags=lanczos,format=yuv420p',
      '-t', String(shot.durationSec),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      clipMp4,
    ], { stdio: 'ignore' });
  } else {
    const stillPath = path.join(WORK_DIR, `${shot.id}.jpg`);
    await page.screenshot({ path: stillPath, type: 'jpeg', quality: 95 });
    const frames = shot.durationSec * 30;
    execFileSync('ffmpeg', [
      '-y',
      '-loop', '1',
      '-i', stillPath,
      '-vf', `zoompan=z='min(1.0+0.0004*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1440x900:fps=30,format=yuv420p`,
      '-t', String(shot.durationSec),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      clipMp4,
    ], { stdio: 'ignore' });
  }

  await ctx.close();
  console.log(`Captured ${shot.id} (${shot.durationSec}s) -> ${clipMp4}`);
  return clipMp4;
}

const masterAudio = await ensureMasterAudio();
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

const clipPaths = new Array(SHOTS.length);
for (let i = 0; i < SHOTS.length; i += 3) {
  const batch = SHOTS.slice(i, i + 3);
  const res = await Promise.all(batch.map((shot) => captureClip(browser, shot)));
  res.forEach((p, idx) => { clipPaths[i + idx] = p; });
}
await browser.close();

const concatList = path.join(WORK_DIR, 'concat.txt');
fs.writeFileSync(concatList, clipPaths.map((p) => `file '${p}'`).join('\n') + '\n');

execFileSync('ffmpeg', [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', concatList,
  '-i', masterAudio,
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-t', '60',
  '-movflags', '+faststart',
  OUT_MP4,
], { stdio: 'ignore' });

console.log(`DEMO_MP4_READY: ${OUT_MP4}`);
