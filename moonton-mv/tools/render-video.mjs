// 多进程逐帧导出：node tools/render-video.mjs [workers] [fps] [from] [to]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = execFileSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();
const WORKERS = parseInt(process.argv[2] || '3', 10);
const FPS = parseInt(process.argv[3] || '30', 10);
const DUR = 68 * (240 / 72) + 4.0;
const T0 = parseFloat(process.argv[4] || '0');
const T1 = Math.min(DUR, parseFloat(process.argv[5] || String(DUR)));
const outDir = path.join(root, 'output');
const segDir = path.join(outDir, 'segments');
fs.mkdirSync(segDir, { recursive: true });

const first = Math.round(T0 * FPS), last = Math.round(T1 * FPS); // [first, last)
const total = last - first;
const per = Math.ceil(total / WORKERS);
const { srv, url } = await serve(root);
const started = Date.now();

async function worker(w) {
  const a = first + w * per, b = Math.min(last, a + per);
  if (a >= b) return null;
  const seg = path.join(segDir, `seg_${String(w).padStart(2, '0')}.mp4`);
  const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'film', '-pix_fmt', 'yuv420p', '-r', String(FPS), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error(`[w${w}]`, e.message));
  await page.goto(url + '/index.html?render');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  for (let f = a; f < b; f++) {
    const b64 = await page.evaluate((t) => { MV.render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.95).split(',')[1]; }, f / FPS);
    const buf = Buffer.from(b64, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (w === 0 && (f - a) % 60 === 0) {
      const done = f - a + 1, el = (Date.now() - started) / 1000;
      console.log(`w0 ${done}/${b - a} frames, ${(el / done).toFixed(2)} s/frame, eta ${((b - a - done) * el / done / 60).toFixed(1)} min`);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  return seg;
}

const segs = (await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)))).filter(Boolean);
srv.close();
const list = path.join(segDir, 'list.txt');
fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join('\n'));
const silent = path.join(outDir, 'video_silent.mp4');
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
const wav = path.join(outDir, 'music.wav');
const final = path.join(outDir, T0 === 0 && T1 >= DUR ? 'moonton_12_years.mp4' : `preview_${T0}-${T1}.mp4`);
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', silent, '-ss', String(T0), '-t', String(T1 - T0), '-i', wav,
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', final]);
console.log('done in', ((Date.now() - started) / 60000).toFixed(1), 'min ->', final);
