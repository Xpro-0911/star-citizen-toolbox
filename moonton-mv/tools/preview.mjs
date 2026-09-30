// 渲染若干时间点的静帧：node tools/preview.mjs outDir t1 t2 ...
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [outDir, ...times] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { srv, url } = await serve(root);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(url + '/index.html?render');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
for (const ts of times) {
  const t = parseFloat(ts);
  const t0 = Date.now();
  const b64 = await page.evaluate((t) => { MV.render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.9).split(',')[1]; }, t);
  const file = path.join(outDir, `f_${t.toFixed(2).padStart(7, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(file, Date.now() - t0, 'ms');
}
await browser.close(); srv.close();
