// 在无头 Chromium 里用 OfflineAudioContext 渲染配乐，输出 WAV。
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'output', 'music.wav');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e));
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ path: path.join(root, 'src/timeline.js') });
await page.addScriptTag({ path: path.join(root, 'src/music.js') });
const t0 = Date.now();
const size = await page.evaluate(async () => {
  const buf = await MVMusic.renderMusic(48000);
  window.__wav = new Uint8Array(MVMusic.toWav(buf));
  return window.__wav.length;
});
console.log('rendered in', ((Date.now() - t0) / 1000).toFixed(1), 's, bytes', size);
const fd = fs.openSync(out, 'w');
const CH = 4 * 1024 * 1024;
for (let off = 0; off < size; off += CH) {
  const b64 = await page.evaluate(([o, n]) => {
    const s = window.__wav.subarray(o, o + n);
    let bin = '';
    for (let i = 0; i < s.length; i += 0x8000) bin += String.fromCharCode.apply(null, s.subarray(i, i + 0x8000));
    return btoa(bin);
  }, [off, CH]);
  fs.writeSync(fd, Buffer.from(b64, 'base64'));
}
fs.closeSync(fd);
await browser.close();
console.log('wrote', out);
