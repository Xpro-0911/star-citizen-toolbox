// 画面引擎：render(t) 是时间的纯函数，任意一帧都能单独渲染（便于多进程导出）。
(function (root) {
  const { SCENES, DURATION, XFADE, BEAT, BAR } = root.TL;
  const W = 1920, H = 1080, GW = 960, GH = 540;
  const LB = 128; // 电影遮幅上下黑边
  const IDX = Object.fromEntries(SCENES.map((s, i) => [s.id, i]));

  // ---------- 工具 ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeIO = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = (x) => x - Math.floor(x);
  const mod = (x, m) => ((x % m) + m) % m;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  function glowSprite(r, g, b, size = 128, core = 0.12) {
    const c = mk(size, size), x = c.getContext('2d');
    const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(core, `rgba(${r},${g},${b},0.65)`);
    gr.addColorStop(0.38, `rgba(${r},${g},${b},0.16)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, size, size);
    return c;
  }
  function spr(g, s, x, y, size, a) {
    if (a <= 0.004 || size <= 0.2) return;
    g.globalAlpha = Math.min(1, a);
    g.drawImage(s, x - size / 2, y - size / 2, size, size);
  }

  // ---------- 字幕 ----------
  const COL = { text: '#f4ede2', gold: '#e9c57f', en: '#d4cabb', steel: '#b9c7da', dim: '#a79f95' };
  function cap(lt, t0, t1, fi = 1.5, fo = 1.3) {
    const ki = ease((lt - t0) / fi), ko = ease((t1 - lt) / fo);
    return { a: Math.min(ki, ko), blur: (1 - ki) * 7 + (1 - ko) * 5, dy: (1 - ki) * 18 - (1 - ko) * 8 };
  }
  // 文字先渲染成位图并缓存（含阴影与若干级模糊），逐帧只做贴图，比每帧用 filter 模糊快一个数量级
  const TXT_CACHE = new Map();
  const BLUR_LV = [0, 1, 2.2, 3.6, 5.2, 7.2];
  let scratch = null;
  function txtEntry(s, o) {
    const key = [o.f, o.w, o.size, o.italic ? 1 : 0, o.ls || 0, o.color, o.shadow ?? 22, s].join('|');
    let e = TXT_CACHE.get(key);
    if (e) return e;
    const fam = o.f === 'sc' ? '"Noto Serif SC"' : o.f === 'cz' ? '"Cinzel", "Noto Serif SC"' : '"Cormorant Garamond", "Noto Serif SC"';
    const font = `${o.italic ? 'italic ' : ''}${o.w || 400} ${o.size}px ${fam}, serif`;
    scratch = scratch || mk(8, 8).getContext('2d');
    scratch.font = font; scratch.letterSpacing = (o.ls || 0) + 'px';
    const width = scratch.measureText(s).width;
    const pad = 44;
    const c = mk(Math.ceil(width + pad * 2), Math.ceil(o.size * 1.7 + pad * 2));
    const x = c.getContext('2d');
    x.font = font; x.letterSpacing = (o.ls || 0) + 'px';
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = o.shadow ?? 22;
    x.fillStyle = o.color || COL.text;
    const base = pad + o.size * 1.2;
    x.fillText(s, pad, base);
    e = { lv: [c], width, pad, base };
    TXT_CACHE.set(key, e);
    return e;
  }
  function txtLevel(e, i) {
    if (!e.lv[i]) {
      const src = e.lv[0];
      const c = mk(src.width, src.height), x = c.getContext('2d');
      x.filter = `blur(${BLUR_LV[i]}px)`; x.drawImage(src, 0, 0);
      e.lv[i] = c;
    }
    return e.lv[i];
  }
  function txt(g, s, x, y, o, c) {
    const a = (o.a ?? 1) * (c ? c.a : 1);
    if (a <= 0.004) return;
    const e = txtEntry(s, o);
    const blur = c ? c.blur : 0;
    let li = 0;
    for (let i = 1; i < BLUR_LV.length; i++) if (Math.abs(BLUR_LV[i] - blur) < Math.abs(BLUR_LV[li] - blur)) li = i;
    const img = txtLevel(e, li);
    const ls = o.ls || 0;
    const left = o.align === 'center' ? x + ls / 2 - e.width / 2 : x;
    g.save();
    g.globalAlpha = Math.min(1, a);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(img, Math.round(left - e.pad), Math.round(y + (c ? c.dy : 0) - e.base));
    g.restore();
  }
  // 大号年份 + 标题 + 正文 + 英文的标准排版块
  function block(g, lt, t0, t1, x, y, lines, align = 'left') {
    let yy = y;
    lines.forEach((ln, i) => {
      if (ln.gap) { yy += ln.gap; return; }
      const c = cap(lt, t0 + (ln.delay ?? i * 0.35), t1 - (lines.length - i) * 0.05);
      txt(g, ln.s, x, yy, { align, ...ln }, c);
      yy += ln.lh ?? ln.size * 1.45;
    });
  }
  const numFmt = (n) => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // ---------- WebGL 背景 ----------
  let gl, glc, prog, U = {};
  function initGL() {
    glc = mk(GW, GH);
    gl = glc.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    const vs = `#version 300 es
in vec2 p; out vec2 vUv; void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, root.MV_SHADER));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uRes', 'uT', 'uA', 'uB', 'uMix', 'uLA', 'uLB', 'uKA', 'uKB'].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
    gl.viewport(0, 0, GW, GH);
    gl.uniform2f(U.uRes, GW, GH);
  }
  function drawGL(t, A, B, mix, la, lb, ka, kb) {
    gl.uniform1f(U.uT, t);
    gl.uniform1i(U.uA, A); gl.uniform1i(U.uB, B < 0 ? A : B);
    gl.uniform1f(U.uMix, mix);
    gl.uniform1f(U.uLA, la); gl.uniform1f(U.uLB, lb);
    gl.uniform1f(U.uKA, ka); gl.uniform1f(U.uKB, kb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------- 共享素材 ----------
  const S = {};
  function initAssets() {
    S.gold = glowSprite(255, 196, 120);
    S.warm = glowSprite(255, 170, 90);
    S.white = glowSprite(255, 248, 235, 128, 0.2);
    S.blue = glowSprite(110, 175, 255);
    S.red = glowSprite(255, 105, 88);
    S.cyan = glowSprite(120, 220, 255);
    S.ice = glowSprite(170, 205, 255);
    S.rose = glowSprite(255, 150, 140);

    // 暗角
    S.vig = mk(W, H);
    { const g = S.vig.getContext('2d');
      const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.62)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    // 胶片颗粒
    S.grain = mk(256, 256);
    { const g = S.grain.getContext('2d'); const id = g.createImageData(256, 256); const r = rng(3);
      for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0); }

    buildSkyline();
    buildMap();
    buildParticles();
  }

  // ---------- 上海天际线（两版：2014 暗夜 / 2025 万家灯火） ----------
  function buildSkyline() {
    const cw = 2600, ch = 760;
    const dark = mk(cw, ch), lit = mk(cw, ch);
    const gd = dark.getContext('2d'), gli = lit.getContext('2d');
    const R = rng(21);
    const both = (fn) => { fn(gd, false); fn(gli, true); };
    const windows = (x, y0, w, h, pDark, pLit, near) => {
      const cols = Math.floor((w - 8) / 13), rows = Math.floor((h - 14) / 17);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = R(), tone = R(), a = 0.35 + R() * 0.6;
        const wx = x + 6 + c * 13, wy = y0 + 10 + r * 17;
        const col = tone < 0.8 ? `rgba(255,${190 + Math.floor(tone * 40)},120,` : 'rgba(170,205,255,';
        if (v < pDark) { gd.fillStyle = col + a * 0.8 + ')'; gd.fillRect(wx, wy, 6, 9); }
        if (v < pLit) { gli.fillStyle = col + a + ')'; gli.fillRect(wx, wy, 6, 9); }
      }
    };
    // 远景层
    let x = -20;
    while (x < cw) {
      const w = 40 + R() * 70, h = 110 + R() * 220;
      both((g, L) => { g.fillStyle = L ? '#141526' : '#0a0e1a'; g.fillRect(x, ch - h, w, h); });
      windows(x, ch - h, w, h, 0.015, 0.25, false);
      x += w + R() * 6;
    }
    // 地标（陆家嘴剪影）
    both((g, L) => {
      g.fillStyle = L ? '#10111f' : '#070a14';
      const base = ch;
      // 东方明珠
      const px = 1500;
      g.fillRect(px - 5, base - 640, 10, 640);
      g.fillRect(px - 26, base - 250, 8, 250); g.fillRect(px + 18, base - 250, 8, 250);
      g.beginPath(); g.arc(px, base - 250, 44, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px, base - 470, 30, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px, base - 560, 11, 0, Math.PI * 2); g.fill();
      g.fillRect(px - 2, base - 720, 4, 90);
      if (L) {
        [[250, 44], [470, 30], [560, 11]].forEach(([hh, r]) => {
          const gr = g.createRadialGradient(px, base - hh, 0, px, base - hh, r * 1.1);
          gr.addColorStop(0, 'rgba(255,140,190,0.9)'); gr.addColorStop(1, 'rgba(160,60,140,0.25)');
          g.fillStyle = gr; g.beginPath(); g.arc(px, base - hh, r, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#10111f';
        });
      }
      // 金茂
      const jx = 1690;
      g.fillStyle = L ? '#10111f' : '#070a14';
      for (let i = 0; i < 9; i++) { const ww = 76 - i * 6; g.fillRect(jx - ww / 2, base - 430 - i * 16, ww, 430 + i * 16); }
      g.fillRect(jx - 2, base - 620, 4, 80);
      // 环球金融中心
      const sx = 1840;
      g.beginPath(); g.moveTo(sx - 50, base); g.lineTo(sx - 30, base - 560); g.lineTo(sx + 30, base - 560); g.lineTo(sx + 50, base); g.fill();
      g.clearRect(sx - 16, base - 540, 32, 26);
      // 上海中心
      const tx = 2010;
      g.beginPath(); g.moveTo(tx - 62, base);
      g.bezierCurveTo(tx - 58, base - 300, tx - 40, base - 560, tx - 20, base - 690);
      g.lineTo(tx + 8, base - 700);
      g.bezierCurveTo(tx + 34, base - 560, tx + 56, base - 300, tx + 64, base); g.fill();
    });
    // 中景层
    x = -10;
    S.hero = null;
    while (x < cw) {
      const w = 60 + R() * 110, h = 70 + R() * 250;
      both((g, L) => {
        const gr = g.createLinearGradient(0, ch - h, 0, ch);
        gr.addColorStop(0, L ? '#1a1728' : '#0b0f1b'); gr.addColorStop(1, L ? '#0b0a14' : '#04060c');
        g.fillStyle = gr; g.fillRect(x, ch - h, w, h);
      });
      windows(x, ch - h, w, h, 0.04, 0.55, true);
      if (!S.hero && x > 820 && h > 200) {
        // 那扇一直亮着的窗
        S.hero = { x: x + w * 0.5, y: ch - h + 60 };
        both((g) => { g.fillStyle = '#04060c'; g.fillRect(S.hero.x - 10, S.hero.y - 8, 20, 16); });
      }
      x += w + 4 + R() * 30;
    }
    S.sky = { dark, lit, cw, ch };
  }
  function drawSkyline(g, which, ox, oy, s, lt, ripple = 1, reflA = 0.3, waterTop = null) {
    const { cw, ch } = S.sky;
    const src = which === 'lit' ? S.sky.lit : S.sky.dark;
    const baseY = oy + ch * s;
    g.imageSmoothingQuality = 'low';
    // 水面
    const wt = waterTop ?? baseY;
    const wg = g.createLinearGradient(0, wt, 0, H);
    if (which === 'lit') { wg.addColorStop(0, 'rgba(60,30,40,0.95)'); wg.addColorStop(1, 'rgba(12,8,16,1)'); }
    else { wg.addColorStop(0, 'rgba(6,8,16,0.96)'); wg.addColorStop(1, 'rgba(1,2,5,1)'); }
    g.globalAlpha = 1; g.fillStyle = wg; g.fillRect(0, wt, W, H - wt);
    // 倒影（分片错位模拟水波）
    const sliceH = 4, rows = Math.ceil((H - LB - baseY) / sliceH);
    g.globalAlpha = reflA;
    for (let j = 0; j < rows; j++) {
      const yy = j * sliceH;
      const srcY = ch - (yy / (s * 0.75));
      if (srcY < 0) break;
      const wob = Math.sin(yy * 0.09 + lt * 1.7) * (1.5 + yy * 0.05) * ripple;
      g.drawImage(src, 0, srcY - sliceH / (s * 0.75), cw, sliceH / (s * 0.75), ox + wob, baseY + yy, cw * s, sliceH);
    }
    g.globalAlpha = 1;
    g.drawImage(src, ox, oy, cw * s, ch * s);
  }

  function beacons(g, ox, oy, s, lt, a = 1) {
    const ch = S.sky.ch;
    [[1500, 722], [1690, 622], [1840, 562], [2012, 702]].forEach(([x, h], i) => {
      const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(lt * 1.6 + i * 1.3));
      spr(g, S.red, ox + x * s, oy + (ch - h) * s, 26, 0.8 * pulse * a);
    });
  }

  // ---------- 东南亚点阵地图 ----------
  const LAND = [
    // 亚洲大陆（中国沿海 + 中南半岛 + 马来半岛）
    [[120.5, 33.0], [121.9, 31.8], [121.9, 30.9], [121.5, 30.3], [122.0, 29.9], [121.5, 28.5], [120.7, 27.9], [120.0, 26.6], [119.6, 25.5], [118.6, 24.6], [117.5, 23.7], [116.5, 23.0], [115.2, 22.7], [114.2, 22.3], [113.3, 22.1], [112.0, 21.7], [110.5, 21.3], [110.3, 20.4], [109.8, 21.4], [108.5, 21.6], [107.5, 21.3], [106.7, 20.5], [105.9, 19.4], [105.7, 18.6], [106.6, 17.5], [107.2, 16.5], [108.2, 16.0], [108.8, 15.2], [109.3, 13.5], [109.2, 12.0], [108.6, 11.1], [107.5, 10.4], [106.7, 10.0], [106.2, 9.3], [105.1, 8.6], [104.8, 9.6], [105.0, 10.4], [104.4, 10.4], [103.5, 10.6], [102.9, 11.7], [102.3, 12.2], [101.0, 12.7], [100.9, 13.5], [100.1, 13.4], [99.9, 12.2], [99.2, 10.4], [99.3, 9.2], [100.3, 8.4], [100.6, 7.0], [101.3, 6.9], [102.1, 6.2], [103.1, 5.4], [103.4, 4.3], [103.4, 3.0], [103.9, 1.6], [104.2, 1.4], [103.5, 1.3], [102.6, 1.9], [101.3, 2.8], [100.7, 3.8], [100.4, 5.0], [100.3, 6.3], [99.7, 6.9], [99.0, 7.9], [98.3, 8.2], [98.4, 9.6], [98.6, 10.8], [98.6, 12.5], [98.1, 13.9], [97.7, 15.5], [97.5, 16.5], [96.3, 16.6], [95.3, 15.8], [94.3, 16.1], [94.6, 17.8], [94.1, 18.9], [93.6, 19.7], [92.4, 20.7], [92.0, 21.8], [91.8, 22.6], [90.6, 22.5], [90.0, 22.0], [88.5, 22.0], [88.5, 34.5], [120.3, 34.5]],
    [[95.3, 5.6], [97.5, 5.2], [98.7, 3.8], [100.3, 2.3], [101.5, 1.6], [103.0, 1.0], [104.0, -0.5], [104.5, -1.9], [105.8, -3.0], [105.9, -4.6], [105.0, -5.8], [104.0, -5.0], [102.3, -4.0], [101.0, -2.3], [99.8, -0.8], [98.8, 0.5], [98.0, 2.0], [96.8, 3.5], [95.4, 4.8]],
    [[105.2, -6.8], [106.1, -6.0], [107.5, -6.2], [108.6, -6.7], [110.4, -6.9], [111.5, -6.6], [112.7, -6.9], [114.4, -7.8], [114.5, -8.7], [113.0, -8.3], [111.0, -8.2], [109.0, -7.8], [107.0, -7.5], [105.5, -7.0]],
    [[109.0, 1.5], [109.6, 2.0], [111.0, 2.0], [113.0, 3.2], [114.0, 4.5], [115.4, 5.3], [116.8, 6.9], [117.7, 6.4], [118.6, 5.4], [119.2, 5.0], [118.4, 4.4], [117.7, 3.3], [118.0, 2.2], [118.9, 1.0], [117.9, 0.8], [117.4, -0.8], [116.6, -1.6], [116.2, -3.5], [114.6, -4.0], [113.0, -3.1], [111.7, -3.4], [110.2, -2.9], [110.0, -1.4], [109.3, -0.2], [108.9, 0.5]],
    [[119.4, -5.5], [119.5, -3.5], [118.8, -2.5], [119.8, 0.0], [120.2, 0.9], [121.5, 1.1], [123.0, 1.0], [124.5, 1.4], [125.1, 1.6], [124.2, 0.5], [122.5, 0.5], [121.0, 0.5], [120.3, -0.8], [121.5, -1.3], [122.9, -0.8], [123.3, -1.0], [122.3, -1.8], [121.3, -2.0], [122.0, -3.0], [122.6, -4.6], [121.0, -4.0], [120.4, -3.0], [120.3, -5.6]],
    [[120.6, 18.5], [121.9, 18.3], [122.3, 17.2], [122.2, 16.0], [121.6, 15.4], [121.8, 14.1], [122.6, 14.0], [123.9, 13.8], [124.1, 12.6], [123.3, 13.0], [122.5, 13.5], [121.6, 13.7], [120.7, 13.8], [120.6, 14.8], [119.8, 15.8], [120.4, 16.5], [120.4, 17.6]],
    [[122.0, 7.0], [123.5, 7.8], [124.2, 8.2], [125.4, 9.2], [126.3, 9.0], [126.6, 7.3], [126.0, 6.3], [125.4, 5.6], [124.1, 6.4], [123.0, 7.4], [122.1, 6.9]],
    [[124.3, 12.5], [125.7, 12.2], [125.5, 11.0], [125.0, 10.0], [124.3, 10.3], [124.4, 11.5]],
    [[121.9, 11.9], [123.1, 11.3], [123.3, 10.0], [122.9, 9.1], [122.4, 9.9], [122.0, 10.7]],
    [[123.3, 11.2], [124.1, 10.9], [123.5, 9.7], [123.3, 10.4]],
    [[117.2, 8.4], [118.5, 9.6], [119.6, 11.3], [119.3, 11.6], [118.1, 10.2], [117.1, 8.8]],
    [[120.1, 23.1], [121.0, 25.2], [121.9, 25.0], [121.5, 23.5], [120.9, 22.0], [120.3, 22.6]],
    [[108.6, 19.2], [109.5, 20.0], [110.8, 20.0], [111.0, 19.6], [110.0, 18.4], [109.0, 18.4]],
    [[114.9, -8.1], [115.7, -8.4], [115.2, -8.9]],
    [[116.0, -8.3], [116.7, -8.4], [116.3, -8.9]],
    [[117.0, -8.4], [119.0, -8.3], [118.8, -8.8], [117.1, -9.0]],
    [[119.8, -8.5], [122.9, -8.2], [122.8, -8.8], [119.9, -8.8]],
    [[123.6, -10.3], [125.1, -9.0], [127.2, -8.4], [125.0, -9.6], [124.0, -10.2]],
    [[127.5, 1.9], [128.5, 2.3], [128.1, 0.2], [128.8, -0.6], [127.6, 0.3]],
    [[131.0, -0.8], [132.5, -0.4], [134.0, -1.0], [134.0, -4.0], [132.0, -3.2], [131.0, -1.8]],
    [[129.7, 33.2], [130.9, 34.0], [131.9, 33.2], [131.4, 31.4], [130.6, 31.0], [130.2, 31.5], [129.6, 32.7]],
  ];
  const CITY = {
    shanghai: [121.47, 31.23], manila: [120.98, 14.6], jakarta: [106.85, -6.21], kl: [101.69, 3.14],
    singapore: [103.82, 1.35], phnompenh: [104.92, 11.56], yangon: [96.16, 16.84], bangkok: [100.5, 13.75],
  };
  function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function buildMap() {
    const dots = [];
    const R = rng(77);
    const centers = [['manila', 2.7], ['jakarta', 3.1], ['kl', 3.5], ['singapore', 3.8], ['bangkok', 6.0], ['phnompenh', 5.6], ['yangon', 6.6]];
    for (let lat = -10.8; lat <= 34.2; lat += 0.4) {
      for (let lon = 88.6; lon <= 134; lon += 0.4) {
        const jl = lon + (R() - 0.5) * 0.06, jt = lat + (R() - 0.5) * 0.06;
        let pi = -1;
        for (let p = 0; p < LAND.length; p++) if (inPoly(jl, jt, LAND[p])) { pi = p; break; }
        if (pi < 0) continue;
        const china = (pi === 0 && jt > 21.6 && jl > 100.5) || pi === 11 || pi === 12;
        const west = pi === 0 && jl < 92.2 && jt > 20.5;
        const japan = pi === LAND.length - 1;
        let ign = Infinity;
        if (!china && !west && !japan) {
          for (const [c, t0] of centers) {
            const [cx, cy] = CITY[c];
            ign = Math.min(ign, t0 + Math.hypot(jl - cx, jt - cy) / 2.6);
          }
          ign += R() * 1.1;
        }
        dots.push({ lon: jl, lat: jt, ign, r: R(), glow: R() < 0.16 });
      }
    }
    S.map = { dots };
  }

  // ---------- 各幕粒子（预生成参数，位置按时间解析计算） ----------
  function buildParticles() {
    const R = rng(1001);
    const arr = (n, f) => Array.from({ length: n }, (_, i) => f(i));
    S.dust = arr(520, () => ({ x: R() * W, y: R() * H, z: 0.25 + R() * 0.75, ph: R() * 6.28, tw: 0.5 + R() * 2 }));
    S.rain = arr(260, () => ({ x: R() * (W + 400), y: R() * H, v: 900 + R() * 600, l: 18 + R() * 30, a: 0.07 + R() * 0.16 }));
    S.sparks = arr(300, () => ({ x: R() * W, v: 25 + R() * 70, ph: R(), s: 1.5 + R() * 4.5, sw: R() * 6.28, sa: 10 + R() * 40 }));
    S.storm = arr(760, () => ({ x: R() * (W + 900) - 300, y: R() * H, v: 1300 + R() * 900, l: 26 + R() * 44, a: 0.06 + R() * 0.16 }));
    S.flame = arr(260, () => ({ ph: R(), rate: 0.55 + R() * 0.7, x: (R() - 0.5) * 2, s: 0.5 + R(), sw: R() * 6.28 }));
    S.motes = arr(170, () => ({ x: R() * W, y: R() * H, z: 0.3 + R() * 0.7, ph: R() * 6.28 }));
    S.lanterns = arr(80, () => ({ x: 180 + R() * (W - 360), d: R() * 12, v: 16 + R() * 22, s: 0.6 + R() * 0.7, sw: R() * 6.28 }));
    S.bgstars = arr(220, () => ({ x: R() * W, y: R() * H, s: 0.5 + R() * 1.8, ph: R() * 6.28 }));
    S.rise = arr(220, () => ({ x: R() * W, v: 20 + R() * 55, ph: R(), s: 1 + R() * 3.5, sw: R() * 6.28 }));
    S.conv = arr(420, () => ({ x: R() * W, y: R() * H, tx: (R() - 0.5) * 1.0, ty: (R() - 0.5) * 0.04, z: 0.3 + R() * 0.7, ph: R() * 6.28 }));
  }

  // 雨丝按透明度分 4 组，一组一次 stroke
  function rainBatch(g, drops, lt, slant, padY, padX) {
    const groups = [[], [], [], []];
    for (const r of drops) groups[Math.min(3, Math.floor(r.a / 0.06))].push(r);
    groups.forEach((grp, gi) => {
      if (!grp.length) return;
      g.globalAlpha = 0.05 + gi * 0.06;
      g.beginPath();
      for (const r of grp) {
        const y = mod(r.y + lt * r.v, H + padY) - padY / 2;
        const x = mod(r.x - lt * r.v * slant, W + padX) - padX / 3;
        g.moveTo(x, y); g.lineTo(x - r.l * slant, y + r.l);
      }
      g.stroke();
    });
    g.globalAlpha = 1;
  }

  // ======================= 各幕 =======================
  const SC = {};

  // --- 0 片名 ---
  SC.title = (g, lt) => {
    g.globalCompositeOperation = 'lighter';
    const fin = sstep(0, 5, lt) * (1 - sstep(17, 20.5, lt));
    for (const p of S.dust) {
      const x = mod(p.x + lt * 7 * p.z + Math.sin(lt * 0.12 + p.ph) * 30 * p.z, W);
      const y = mod(p.y - lt * 5 * p.z, H);
      const tw = 0.55 + 0.45 * Math.sin(lt * p.tw + p.ph);
      spr(g, S.gold, x, y, 4 + 10 * p.z, 0.45 * tw * p.z * fin);
    }
    g.globalCompositeOperation = 'source-over';
    const cy = H / 2 - 10;
    const c1 = cap(lt, 8.6, 18.5, 2.6, 2);
    txt(g, '沐 瞳', W / 2, cy, { f: 'sc', w: 500, size: 150, ls: 36, align: 'center', color: '#f6ead6' }, c1);
    txt(g, '十二年', W / 2, cy + 110, { f: 'sc', w: 300, size: 40, ls: 26, align: 'center', color: COL.gold }, cap(lt, 10.4, 18.2, 2, 1.8));
    txt(g, 'MOONTON  ·  2014 — 2026', W / 2, cy + 160, { f: 'cz', w: 500, size: 24, ls: 10, align: 'center', color: COL.en }, cap(lt, 11.2, 18, 2, 1.8));
  };

  // --- 1 上海 2014 ---
  SC.shanghai = (g, lt, k) => {
    const s0 = 0.86, ch = S.sky.ch, cw = S.sky.cw;
    const baseY0 = 820;
    const ox0 = (W - cw * s0) / 2 - 180, oy0 = baseY0 - ch * s0;
    const hx0 = ox0 + S.hero.x * s0, hy0 = oy0 + S.hero.y * s0;
    const z = ease(clamp(lt / 21));
    const s = s0 * (1 + 0.2 * z);
    const ax = lerp(hx0, W * 0.47, 0.4 * z), ay = lerp(hy0, H * 0.52, 0.4 * z);
    const ox = ax - S.hero.x * s, oy = ay - S.hero.y * s;
    drawSkyline(g, 'dark', ox, oy, s, lt, 1, 0.28);
    g.globalCompositeOperation = 'lighter'; beacons(g, ox, oy, s, lt); g.globalCompositeOperation = 'source-over';
    // 那扇窗
    const on = sstep(0.5, 4, lt);
    const hx = ox + S.hero.x * s, hy = oy + S.hero.y * s;
    g.globalAlpha = on; g.fillStyle = '#ffd9a0';
    g.fillRect(hx - 8 * s, hy - 6 * s, 16 * s, 12 * s);
    g.globalCompositeOperation = 'lighter';
    const pulse = 0.85 + 0.15 * Math.sin(lt * 1.3);
    spr(g, S.warm, hx, hy, 90 + 60 * z, 0.75 * on * pulse);
    spr(g, S.warm, hx, hy, 300 + 200 * z, 0.18 * on);
    // 倒影里的光柱
    const baseY = oy + ch * s;
    for (let j = 0; j < 14; j++) spr(g, S.warm, hx + Math.sin(j * 1.7 + lt * 2) * 4, baseY + (baseY - hy) * 0.7 + j * 9, 26, 0.12 * on * (1 - j / 14));
    // 雨
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#c9d6ee'; g.lineWidth = 1.2;
    rainBatch(g, S.rain, lt, 0.12, 60, 400);
    block(g, lt, 1.8, 10.2, 150, 380, [
      { s: '2014', f: 'cz', w: 400, size: 150, color: '#efe6d8', lh: 104 },
      { s: '上海 · 起点', f: 'sc', w: 500, size: 50, lh: 72 },
      { s: '一支约二十人的团队，从零开始', f: 'sc', w: 300, size: 32, lh: 50 },
      { s: 'Shanghai. A team of about twenty, starting from zero.', f: 'en', italic: true, size: 27, color: COL.en },
    ]);
    const c2 = cap(lt, 11, 19.4, 1.8, 1.6);
    txt(g, '那时，没有人知道这条路会通向哪里', W / 2, 868, { f: 'sc', w: 300, size: 36, ls: 4, align: 'center' }, c2);
    txt(g, 'Back then, no one knew where the road would lead.', W / 2, 912, { f: 'en', italic: true, size: 26, align: 'center', color: COL.en }, cap(lt, 11.6, 19.4, 1.8, 1.6));
  };

  // --- 2 魔法英雄 2015 ---
  SC.magicrush = (g, lt, k) => {
    g.globalCompositeOperation = 'lighter';
    const bloom = ease(lt / 3.5);
    spr(g, S.warm, W / 2, H * 0.52, 700 * bloom + 50, 0.35 * bloom);
    for (const p of S.sparks) {
      const cyc = (H + 120) / p.v;
      const age = mod(lt + p.ph * cyc, cyc);
      const y = H + 60 - age * p.v;
      const x = p.x + Math.sin(lt * 0.8 + p.sw) * p.sa;
      const a = sstep(0, 2.5, lt) * (0.3 + 0.7 * Math.min(1, age / 2)) * sstep(40, 380, y);
      spr(g, S.gold, x, y, p.s * 5, a * 0.9);
    }
    g.globalCompositeOperation = 'source-over';
    block(g, lt, 1.2, 15.2, W / 2, 372, [
      { s: '2015', f: 'cz', w: 400, size: 120, color: '#f3e6cf', lh: 106 },
      { s: '《魔法英雄》', f: 'sc', w: 700, size: 70, lh: 64 },
      { s: 'Magic Rush: Heroes', f: 'en', italic: true, size: 34, color: COL.en, lh: 78 },
      { s: '第一款作品，全球发行', f: 'sc', w: 300, size: 32, lh: 54, delay: 2.4 },
      { s: '获 Google Play 2015 年度最佳游戏', f: 'sc', w: 500, size: 32, color: COL.gold, lh: 54, delay: 3.4 },
      { s: 'Our first title — Google Play Best Games of 2015.', f: 'en', italic: true, size: 26, color: COL.en, delay: 3.9 },
    ], 'center');
  };

  // --- 3 无尽对决 2016：抽象 5v5 地图 ---
  function proj(x, z, cam) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const X = x * cy - z * sy, Z = x * sy + z * cy;
    const L = Math.hypot(cam.h, cam.d);
    const vy = -cam.h, vz = Z + cam.d;
    const zc = (-vy * cam.h + vz * cam.d) / L;
    const yc = (vy * cam.d + vz * cam.h) / L;
    return [cam.cx + (cam.f * X) / zc, cam.cy - (cam.f * yc) / zc, zc];
  }
  function lanePts(which) {
    const a = -0.82, b = 0.82;
    if (which === 0) return [[a, a], [a, b], [b, b]];
    if (which === 1) return [[a, a], [b, b]];
    return [[a, a], [b, a], [b, b]];
  }
  function laneAt(pts, s) {
    const segs = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); tot += l; }
    let d = s * tot;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) {
        const u = clamp(d / segs[i]);
        return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)];
      }
      d -= segs[i];
    }
  }
  SC.mlbb = (g, lt, k) => {
    const intro = ease(lt / 4);
    const cam = { yaw: Math.PI / 4 - 0.14 + lt * 0.009, h: 2.05 - 0.2 * ease(lt / 20), d: 2.45 - 0.2 * ease(lt / 20), f: 860, cx: W * 0.67, cy: H * 0.5 };
    const P = (x, z) => proj(x, z, cam);
    // 地面
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => P(x, z));
    g.globalAlpha = 0.5 * intro;
    const cg = g.createLinearGradient(0, corners[2][1], 0, corners[0][1]);
    cg.addColorStop(0, 'rgba(40,50,110,0.25)'); cg.addColorStop(1, 'rgba(20,30,70,0.55)');
    g.fillStyle = cg;
    g.beginPath(); corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    // 网格
    g.strokeStyle = 'rgba(130,160,255,0.09)'; g.lineWidth = 1;
    for (let i = -1; i <= 1.001; i += 0.25) {
      let [x1, y1] = P(i, -1), [x2, y2] = P(i, 1); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      [x1, y1] = P(-1, i); [x2, y2] = P(1, i); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.globalAlpha = 1;
    // 河道
    g.globalCompositeOperation = 'lighter';
    const river = [];
    for (let i = 0; i <= 40; i++) { const u = -1 + i / 20; river.push(P(u, -u + Math.sin(u * 4 + 1) * 0.06)); }
    g.strokeStyle = 'rgba(90,200,255,0.18)'; g.lineWidth = 16 * intro;
    g.beginPath(); river.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.strokeStyle = 'rgba(150,230,255,0.35)'; g.lineWidth = 2;
    g.stroke();
    // 三路
    for (let L = 0; L < 3; L++) {
      const pts = lanePts(L);
      const reveal = ease((lt - 0.6 - L * 0.4) / 2.2);
      const path = [];
      for (let i = 0; i <= 60; i++) { const s = (i / 60) * reveal; path.push(P(...laneAt(pts, s))); }
      g.strokeStyle = 'rgba(255,220,160,0.12)'; g.lineWidth = 14;
      g.beginPath(); path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.strokeStyle = 'rgba(255,236,200,0.55)'; g.lineWidth = 1.8;
      g.stroke();
      // 防御塔
      [0.18, 0.32, 0.68, 0.82].forEach((s, j) => {
        if (s > reveal) return;
        const [x, y] = P(...laneAt(pts, s));
        spr(g, j < 2 ? S.blue : S.red, x, y, 22, 0.8 * intro);
      });
      // 兵线：蓝方从左下出发，红方从右上出发，在中点交汇
      for (let i = 0; i < 16; i++) {
        const u = fract(lt * 0.045 + i / 16) * 0.5;
        const vis = sstep(2.5, 4, lt);
        const [bx, by] = P(...laneAt(pts, u));
        const [rx, ry] = P(...laneAt(pts, 1 - u));
        spr(g, S.blue, bx, by, 14, 0.85 * vis);
        spr(g, S.red, rx, ry, 14, 0.85 * vis);
      }
      const [mx, my] = P(...laneAt(pts, 0.5));
      const flick = 0.55 + 0.45 * Math.sin(lt * 2.4 + L * 2.1);
      spr(g, S.white, mx, my, 40 + 24 * flick, 0.5 * flick * sstep(3, 5, lt));
    }
    // 基地
    const [bx, by] = P(-0.82, -0.82), [rx, ry] = P(0.82, 0.82);
    const pul = 0.8 + 0.2 * Math.sin(lt * 1.6);
    spr(g, S.blue, bx, by, 150 * pul, 0.9 * intro); spr(g, S.white, bx, by, 26, intro);
    spr(g, S.red, rx, ry, 110 * pul, 0.9 * intro); spr(g, S.white, rx, ry, 20, intro);
    g.globalCompositeOperation = 'source-over';
    block(g, lt, 1.4, 11.4, 150, 330, [
      { s: '2016', f: 'cz', w: 400, size: 130, color: '#e8ecf8', lh: 110 },
      { s: '《无尽对决》', f: 'sc', w: 700, size: 76, lh: 58 },
      { s: 'MOBILE LEGENDS: BANG BANG', f: 'cz', w: 500, size: 28, ls: 6, color: COL.en, lh: 82 },
      { s: '把 5v5 MOBA 装进每一部手机', f: 'sc', w: 300, size: 34, lh: 50, delay: 2.6 },
      { s: 'Bringing 5v5 MOBA to every phone.', f: 'en', italic: true, size: 27, color: COL.en, delay: 3 },
    ]);
    const c2 = cap(lt, 12.2, 19.6, 1.8, 1.4);
    txt(g, '从这一刻起，一切都不一样了', 150, 560, { f: 'sc', w: 300, size: 38, ls: 3 }, c2);
    txt(g, 'From here on, everything changed.', 150, 610, { f: 'en', italic: true, size: 27, color: COL.en }, cap(lt, 12.8, 19.6, 1.8, 1.4));
  };

  // --- 4 强敌压境 2017（低谷） ---
  SC.storm = (g, lt, k) => {
    const cx = W / 2, cy = H * 0.6;
    // 压迫的黑暗：从四周逼近，最后被火光推开
    const close = sstep(0, 14, lt) * (1 - sstep(16, 22, lt));
    const rIn = lerp(H * 0.9, H * 0.34, close);
    const vg = g.createRadialGradient(cx, cy, rIn * 0.4, cx, cy, rIn * 1.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,4,0.82)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    // 火焰
    const grow = 0.75 + 0.55 * sstep(15, 21, lt);
    const lean = 0.5 + 0.35 * Math.sin(lt * 0.7) + 0.25 * Math.sin(lt * 1.9 + 1) - 0.4 * sstep(15, 21, lt);
    g.globalCompositeOperation = 'lighter';
    spr(g, S.ice, cx, cy - 30, 520 * grow, 0.32);
    spr(g, S.ice, cx, cy - 40, 520 * grow, 0.16);
    // 火焰本体：三层泪滴形，外层最宽最淡、内核最白
    const layers = [
      [52, 300, 'rgba(70,130,255,0.38)', 'rgba(40,80,230,0)', 16, 0.0],
      [32, 215, 'rgba(120,180,255,0.42)', 'rgba(90,150,255,0)', 7, 1.7],
      [14, 105, 'rgba(235,245,255,0.6)', 'rgba(210,235,255,0)', 3, 3.1],
    ];
    for (const [r0, h0, c0, c1, bl, ph] of layers) {
      const r = r0 * grow, h = h0 * grow * (0.92 + 0.08 * Math.sin(lt * 9 + ph) + 0.05 * Math.sin(lt * 13.7 + ph * 2));
      const wob = Math.sin(lt * 5.3 + ph) + 0.5 * Math.sin(lt * 8.1 + ph);
      const tipX = cx + lean * h * 0.42 + wob * 7, tipY = cy - h;
      g.save();
      g.filter = `blur(${bl}px)`;
      g.beginPath();
      g.moveTo(cx - r, cy);
      g.bezierCurveTo(cx - r * 1.05, cy - h * 0.38, tipX - r * 0.35 + wob * 5, tipY + h * 0.38, tipX, tipY);
      g.bezierCurveTo(tipX + r * 0.35 + wob * 5, tipY + h * 0.38, cx + r * 1.05, cy - h * 0.38, cx + r, cy);
      g.arc(cx, cy, r, 0, Math.PI);
      g.closePath();
      const gr = g.createLinearGradient(0, cy + r, 0, tipY);
      gr.addColorStop(0, c0); gr.addColorStop(0.3, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr; g.globalAlpha = 1; g.fill();
      g.restore();
      g.globalCompositeOperation = 'lighter';
    }
    for (const p of S.flame) {
      const a = fract(lt * p.rate + p.ph);
      const hgt = 260 * grow * (0.7 + 0.5 * p.s);
      const x = cx + p.x * 30 * grow * Math.pow(1 - a, 1.5) + lean * a * a * 170 + Math.sin(lt * 6 + p.sw + a * 8) * 12 * a;
      const y = cy - 20 - Math.pow(a, 0.9) * hgt;
      spr(g, S.blue, x, y, Math.pow(1 - a, 0.8) * 40 * grow * p.s + 4, Math.pow(1 - a, 1.4) * 0.16);
    }
    for (let i = 0; i < 70; i++) {
      const a = fract(lt * (0.32 + (i % 7) * 0.05) + i * 0.137);
      const x = cx + (Math.sin(i * 12.9) * 30) + (0.6 + lean) * a * 380 + Math.sin(lt * 3 + i) * 14 * a;
      const y = cy - 40 - a * (220 + (i % 5) * 40) + a * a * 60;
      spr(g, S.ice, x, y, 7 + (i % 3) * 3, (1 - a) * 0.8 * grow);
    }
    spr(g, S.white, cx, cy - 8, 30 * grow, 0.25);
    g.globalCompositeOperation = 'source-over';
    // 暴雨
    g.strokeStyle = '#a9b8d0'; g.lineWidth = 1.3;
    rainBatch(g, S.storm, lt, 0.42, 80, 900);
    block(g, lt, 1.4, 11.6, 150, 330, [
      { s: '2017', f: 'cz', w: 400, size: 130, color: COL.steel, lh: 112 },
      { s: '强敌压境', f: 'sc', w: 700, size: 80, lh: 84 },
      { s: '国际大厂的 MOBA 手游相继进入东南亚', f: 'sc', w: 300, size: 34, lh: 50, delay: 2.2 },
      { s: 'Industry giants arrived in Southeast Asia.', f: 'en', italic: true, size: 27, color: COL.en, delay: 2.7 },
    ]);
    txt(g, '每一天，都是正面交锋', W / 2, 858, { f: 'sc', w: 300, size: 38, ls: 6, align: 'center' }, cap(lt, 12.2, 17.6, 1.6, 1.3));
    txt(g, 'Every day was a head-on battle.', W / 2, 905, { f: 'en', italic: true, size: 27, align: 'center', color: COL.en }, cap(lt, 12.7, 17.6, 1.6, 1.3));
    txt(g, '阵地，守住了。', W / 2, 858, { f: 'sc', w: 500, size: 46, ls: 10, align: 'center', color: '#eef3ff' }, cap(lt, 18.4, 24.2, 1.8, 1.4));
    txt(g, 'We held our ground.', W / 2, 905, { f: 'en', italic: true, size: 28, align: 'center', color: COL.en }, cap(lt, 18.9, 24.2, 1.8, 1.4));
  };

  // --- 5 燎原 2017–2020 ---
  SC.sea = (g, lt, k) => {
    const m1 = easeIO(lt / 9);
    const clon = lerp(117.5, 110.8, m1) + 0.6 * sstep(9, 27, lt);
    const clat = lerp(19.5, 6.8, m1) + 0.4 * sstep(9, 27, lt);
    const sc = lerp(19, 29, m1) + 1.2 * sstep(9, 27, lt);
    const cx = W * 0.64, cy = H * 0.5;
    const X = (lon) => cx + (lon - clon) * sc, Y = (lat) => cy - (lat - clat) * sc;
    // 点阵
    const ds = Math.max(2.2, sc * 0.13);
    g.fillStyle = 'rgba(120,150,195,0.26)';
    const lit = [];
    for (const d of S.map.dots) {
      const x = X(d.lon), y = Y(d.lat);
      if (x < -10 || x > W + 10 || y < LB - 10 || y > H - LB + 10) continue;
      if (lt >= d.ign) lit.push([x, y, d]);
      else g.fillRect(x - ds / 2, y - ds / 2, ds, ds);
    }
    g.fillStyle = 'rgba(255,196,120,0.9)';
    for (const [x, y] of lit) g.fillRect(x - ds / 2, y - ds / 2, ds, ds);
    g.globalCompositeOperation = 'lighter';
    for (const [x, y, d] of lit) {
      const since = lt - d.ign;
      const flare = Math.exp(-since * 1.6);
      if (d.glow || flare > 0.05) spr(g, S.warm, x, y, 16 + 30 * flare, 0.22 + 0.5 * flare);
    }
    // 上海
    const [sx, sy] = [X(CITY.shanghai[0]), Y(CITY.shanghai[1])];
    spr(g, S.gold, sx, sy, 60, 0.9); spr(g, S.white, sx, sy, 14, 1);
    // 火种航线
    [['manila', 0.9, 2.7], ['kl', 1.3, 3.5], ['jakarta', 1.1, 3.1]].forEach(([c, t0, t1]) => {
      const [tx, ty] = [X(CITY[c][0]), Y(CITY[c][1])];
      const qx = (sx + tx) / 2 + (c === 'manila' ? 160 : -120), qy = (sy + ty) / 2;
      const u = clamp((lt - t0) / (t1 - t0));
      const fade = 1 - sstep(t1 + 0.5, t1 + 3.5, lt);
      if (u <= 0 || fade <= 0) return;
      const pt = (v) => [(1 - v) * (1 - v) * sx + 2 * (1 - v) * v * qx + v * v * tx, (1 - v) * (1 - v) * sy + 2 * (1 - v) * v * qy + v * v * ty];
      g.strokeStyle = 'rgba(255,200,130,0.5)'; g.lineWidth = 1.6; g.globalAlpha = fade;
      g.beginPath();
      for (let i = 0; i <= 40; i++) { const [x, y] = pt((i / 40) * u); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.globalAlpha = 1;
      const [hx, hy] = pt(u);
      spr(g, S.white, hx, hy, 18, fade * (u < 1 ? 1 : 0.4));
      spr(g, S.gold, hx, hy, 70, fade * 0.6);
    });
    // 2019 东运会金牌：马尼拉
    const medal = sstep(9.4, 11.4, lt) * (1 - sstep(16.8, 18.2, lt));
    if (medal > 0) {
      const [mx, my] = [X(CITY.manila[0]), Y(CITY.manila[1])];
      spr(g, S.gold, mx, my, 200, 0.5 * medal);
      g.strokeStyle = `rgba(255,214,140,${0.8 * medal})`; g.lineWidth = 2.5;
      const rr = 46 + 6 * Math.sin(lt * 1.5);
      g.beginPath(); g.arc(mx, my, rr, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1; g.beginPath(); g.arc(mx, my, rr + 12, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 10; i++) {
        const a = lt * 0.5 + (i / 10) * Math.PI * 2;
        spr(g, S.white, mx + Math.cos(a) * (rr + 12), my + Math.sin(a) * (rr + 12), 10, 0.7 * medal);
      }
    }
    g.globalCompositeOperation = 'source-over';
    // 城市标签
    const lbl = (c, zh, en, t0) => {
      const cc = cap(lt, t0, 40, 1.2, 1);
      const x = X(CITY[c][0]), y = Y(CITY[c][1]);
      if (y < LB + 20 || y > H - LB - 10) return;
      txt(g, zh, x + 14, y - 8, { f: 'sc', w: 500, size: 20, color: '#fff3df', shadow: 10 }, cc);
      txt(g, en, x + 14, y + 14, { f: 'cz', w: 500, size: 16, ls: 2, color: COL.en, shadow: 10 }, cc);
    };
    lbl('shanghai', '上海', 'SHANGHAI', 0.3);
    lbl('manila', '马尼拉', 'MANILA', 2.9);
    lbl('jakarta', '雅加达', 'JAKARTA', 3.3);
    lbl('kl', '吉隆坡', 'KUALA LUMPUR', 3.7);
    // 字幕
    block(g, lt, 1.2, 8.8, 130, 330, [
      { s: '2017', f: 'cz', w: 400, size: 120, color: '#f3e6cf', lh: 104 },
      { s: '燎 原', f: 'sc', w: 700, size: 78, ls: 12, lh: 80 },
      { s: '在印尼、菲律宾、马来西亚', f: 'sc', w: 300, size: 32, lh: 46, delay: 2.2 },
      { s: '登顶 iPhone 免费游戏下载榜', f: 'sc', w: 300, size: 32, lh: 52, delay: 2.5 },
      { s: 'No.1 free iPhone game in Indonesia,', f: 'en', italic: true, size: 26, color: COL.en, lh: 34, delay: 2.9 },
      { s: 'the Philippines and Malaysia.', f: 'en', italic: true, size: 26, color: COL.en, delay: 3.1 },
    ]);
    block(g, lt, 9.4, 17.4, 130, 330, [
      { s: '2019', f: 'cz', w: 400, size: 120, color: '#f3e6cf', lh: 104 },
      { s: '第一枚电竞金牌', f: 'sc', w: 700, size: 64, lh: 78 },
      { s: '东南亚运动会首次设立电竞奖牌项目', f: 'sc', w: 300, size: 30, lh: 46, delay: 2.2 },
      { s: '历史上第一枚电竞金牌，在《无尽对决》中诞生', f: 'sc', w: 300, size: 30, lh: 52, delay: 2.5 },
      { s: "SEA Games 2019: the Games' first-ever", f: 'en', italic: true, size: 26, color: COL.en, lh: 34, delay: 2.9 },
      { s: 'esports gold medal was won in MLBB.', f: 'en', italic: true, size: 26, color: COL.en, delay: 3.1 },
    ]);
    const c3 = cap(lt, 18.2, 27.2, 1.5, 1.4);
    txt(g, '2020', 130, 430, { f: 'cz', w: 400, size: 120, color: '#f3e6cf' }, c3);
    const cnt = 1e9 * ease((lt - 18.8) / 3.8);
    txt(g, numFmt(cnt), 130, 540, { f: 'cz', w: 400, size: 92, ls: 2, color: COL.gold }, cap(lt, 18.6, 27.2, 1.2, 1.4));
    txt(g, '全球下载突破十亿', 130, 620, { f: 'sc', w: 500, size: 46, ls: 6 }, cap(lt, 20.2, 27.2, 1.5, 1.4));
    txt(g, 'One billion downloads worldwide.', 130, 670, { f: 'en', italic: true, size: 27, color: COL.en }, cap(lt, 20.8, 27.2, 1.5, 1.4));
  };

  // --- 6 平台期 2021–2023（低谷） ---
  SC.plateau = (g, lt, k) => {
    const hy = H * (1 - 0.42);
    const vx = W / 2;
    g.globalAlpha = 0.5 * sstep(0, 3, lt);
    g.strokeStyle = 'rgba(210,205,225,0.35)'; g.lineWidth = 1.2;
    [-1, 1].forEach((sd) => { g.beginPath(); g.moveTo(vx + sd * 30, hy + 4); g.lineTo(vx + sd * 620, H - LB); g.stroke(); });
    // 路中虚线，缓缓向远方流动
    for (let i = 0; i < 12; i++) {
      const u = fract(i / 12 + lt * 0.03);
      const d = Math.pow(u, 2.2);
      const y = lerp(H - LB, hy + 6, 1 - d);
      const w = lerp(1, 5, d), l = lerp(3, 36, d);
      g.fillStyle = 'rgba(230,225,240,0.5)'; g.fillRect(vx - w / 2, y - l / 2, w, l);
    }
    g.globalAlpha = 1;
    // 独行的光
    g.globalCompositeOperation = 'lighter';
    const tp = ease(lt / 22);
    const ty = lerp(H - LB - 40, hy + 40, tp), ts = lerp(1, 0.4, tp);
    spr(g, S.warm, vx, ty, 90 * ts, 0.55);
    spr(g, S.white, vx, ty, 16 * ts, 0.9);
    for (const p of S.motes) {
      const x = mod(p.x + lt * 10 * p.z + Math.sin(lt * 0.3 + p.ph) * 20, W);
      const y = mod(p.y + lt * 8 * p.z, H);
      spr(g, S.white, x, y, 3 + 6 * p.z, 0.16 * p.z);
    }
    g.globalCompositeOperation = 'source-over';
    const c1 = cap(lt, 1.6, 9.6, 1.8, 1.5);
    txt(g, '2021 — 2023', W / 2, 330, { f: 'cz', w: 400, size: 96, ls: 8, align: 'center', color: '#e4e0ea' }, c1);
    txt(g, '高速增长之后，是更难的一段路', W / 2, 425, { f: 'sc', w: 300, size: 42, ls: 4, align: 'center' }, cap(lt, 2.3, 9.6, 1.8, 1.5));
    txt(g, 'After the rapid rise came a harder road.', W / 2, 475, { f: 'en', italic: true, size: 28, align: 'center', color: COL.en }, cap(lt, 2.8, 9.6, 1.8, 1.5));
    txt(g, '放慢脚步，重新寻找方向', W / 2, 360, { f: 'sc', w: 300, size: 40, ls: 4, align: 'center' }, cap(lt, 10.4, 19, 1.8, 1.6));
    txt(g, '在迷雾中打磨，在沉默里积蓄', W / 2, 425, { f: 'sc', w: 300, size: 40, ls: 4, align: 'center' }, cap(lt, 11.1, 19, 1.8, 1.6));
    txt(g, 'Slowing down. Searching again. Building quietly through the fog.', W / 2, 478, { f: 'en', italic: true, size: 27, align: 'center', color: COL.en }, cap(lt, 11.7, 19, 1.8, 1.6));
  };

  // --- 7 回家 2025 ---
  SC.home = (g, lt, k) => {
    const s = 0.8 + 0.06 * ease(lt / 17);
    const { cw, ch } = S.sky;
    const ox = W / 2 - (cw * s) / 2 + 60, oy = 860 - ch * s;
    drawSkyline(g, 'lit', ox, oy, s, lt, 0.8, 0.35);
    g.globalCompositeOperation = 'lighter';
    beacons(g, ox, oy, s, lt, 0.8);
    // 远方归来的光
    const u = clamp((lt - 0.4) / 3.2);
    const land = [W * 0.5, oy + ch * s - 220 * s];
    if (u > 0 && u < 1) {
      const e = easeIO(u);
      const x = lerp(W + 80, land[0], e), y = lerp(170, land[1], e);
      for (let i = 0; i < 14; i++) {
        const b = Math.max(0, e - i * 0.018);
        spr(g, S.gold, lerp(W + 80, land[0], b), lerp(170, land[1], b), 40 - i * 2, 0.35 * (1 - i / 14));
      }
      spr(g, S.white, x, y, 22, 1);
    }
    const arr = Math.exp(-Math.max(0, lt - 3.6) * 0.5) * sstep(3.0, 3.8, lt);
    spr(g, S.warm, land[0], land[1], 700, 0.35 * arr);
    // 孔明灯
    for (const L of S.lanterns) {
      const age = lt - 2.5 - L.d;
      if (age < 0) continue;
      const y = H - LB - 20 - age * L.v;
      if (y < LB - 30) continue;
      const x = L.x + Math.sin(age * 0.6 + L.sw) * 18;
      const fl = 0.85 + 0.15 * Math.sin(lt * 7 + L.sw);
      spr(g, S.warm, x, y, 46 * L.s, 0.5 * fl);
      g.globalAlpha = 0.9 * fl; g.fillStyle = '#ffc070';
      g.fillRect(x - 5 * L.s, y - 7 * L.s, 10 * L.s, 13 * L.s);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    block(g, lt, 1.6, 15.4, 150, 272, [
      { s: '2025.01.23', f: 'cz', w: 400, size: 84, ls: 6, color: '#fff1dd', lh: 92 },
      { s: '《决胜巅峰》国服正式上线', f: 'sc', w: 700, size: 58, lh: 70 },
      { s: '海外最大的 MOBA，回家了', f: 'sc', w: 300, size: 40, ls: 4, lh: 54, delay: 2.4 },
      { s: 'The biggest MOBA abroad finally came home.', f: 'en', italic: true, size: 28, color: '#f0e3d0', delay: 3 },
    ]);
  };

  // --- 8 产品星图 ---
  const PRODUCTS = [
    { y: '2015', zh: '魔法英雄', en: 'Magic Rush: Heroes', p: [300, 760] },
    { y: '2016', zh: '无尽对决', en: 'Mobile Legends: Bang Bang', p: [540, 610] },
    { y: '2019', en: 'Mobile Legends: Adventure', p: [760, 735] },
    { y: '2023', en: 'Watcher of Realms', p: [965, 560] },
    { y: '2025', zh: '决胜巅峰', en: 'MLBB · China', p: [1165, 700] },
    { y: '2025', en: 'Magic Chess: Go Go', p: [1370, 520] },
    { y: '2025', en: 'Silver and Blood', p: [1560, 660] },
    { y: '2025', en: 'Acecraft', p: [1690, 450] },
  ];
  SC.stars = (g, lt, k) => {
    const drift = lt * 4;
    g.globalCompositeOperation = 'lighter';
    for (const s of S.bgstars) {
      const x = mod(s.x - drift * s.s * 0.5, W);
      spr(g, S.white, x, s.y, s.s * 5, 0.25 + 0.2 * Math.sin(lt * 1.5 + s.ph));
    }
    const at = (i) => i * (BEAT * 2) + 0.05;
    // 连线
    g.lineWidth = 1.4;
    for (let i = 1; i < PRODUCTS.length; i++) {
      const u = ease((lt - at(i)) / 1.1);
      if (u <= 0) continue;
      const [x1, y1] = PRODUCTS[i - 1].p, [x2, y2] = PRODUCTS[i].p;
      g.strokeStyle = 'rgba(200,215,255,0.34)';
      g.beginPath(); g.moveTo(x1 - drift, y1); g.lineTo(lerp(x1, x2, u) - drift, lerp(y1, y2, u)); g.stroke();
    }
    PRODUCTS.forEach((P, i) => {
      const u = ease((lt - at(i)) / 0.9);
      if (u <= 0) return;
      const [x0, y] = P.p; const x = x0 - drift;
      const tw = 0.85 + 0.15 * Math.sin(lt * 2 + i);
      const flare = Math.exp(-Math.max(0, lt - at(i)) * 1.4);
      spr(g, i === 1 ? S.gold : S.ice, x, y, (90 + 90 * flare) * u, 0.55 * tw);
      spr(g, S.white, x, y, 18 * u + 12 * flare, 1);
      const fl = (130 + 120 * flare) * u;
      const hg = g.createLinearGradient(x - fl, 0, x + fl, 0);
      hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, `rgba(255,250,240,${0.55 * tw})`); hg.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = u; g.fillStyle = hg; g.fillRect(x - fl, y - 1, fl * 2, 2);
      const vg = g.createLinearGradient(0, y - fl * 0.5, 0, y + fl * 0.5);
      vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(0.5, `rgba(255,250,240,${0.4 * tw})`); vg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = vg; g.fillRect(x - 1, y - fl * 0.5, 2, fl);
      g.globalAlpha = 1;
    });
    g.globalCompositeOperation = 'source-over';
    PRODUCTS.forEach((P, i) => {
      const c = cap(lt, at(i) + 0.2, 17.2, 1.1, 1.2);
      const [x0, y] = P.p; const x = x0 - drift;
      const below = i % 2 === 0;
      let yy = below ? y + 52 : y - 74;
      txt(g, P.y, x, yy, { f: 'cz', w: 500, size: 22, ls: 4, align: 'center', color: COL.gold, shadow: 14 }, c);
      yy += 32;
      if (P.zh) { txt(g, P.zh, x, yy, { f: 'sc', w: 500, size: 26, ls: 2, align: 'center', shadow: 14 }, c); yy += 28; }
      txt(g, P.en, x, yy, { f: 'en', italic: true, size: P.zh ? 19 : 24, align: 'center', color: COL.en, shadow: 14 }, c);
    });
    txt(g, '从一款作品，到一片星空', W / 2, 255, { f: 'sc', w: 500, size: 48, ls: 8, align: 'center' }, cap(lt, 11.8, 17.4, 1.8, 1.2));
    txt(g, 'From a single game to a sky full of stars.', W / 2, 305, { f: 'en', italic: true, size: 28, align: 'center', color: COL.en }, cap(lt, 12.4, 17.4, 1.8, 1.2));
  };

  // --- 9 巅峰 2026 ---
  SC.peak = (g, lt, k) => {
    g.globalCompositeOperation = 'lighter';
    const hy = H * (1 - 0.34);
    // 光柱
    for (let i = 0; i < 6; i++) {
      const x = W * (0.12 + i * 0.152) + Math.sin(lt * 0.2 + i) * 20;
      const a = (0.06 + 0.05 * Math.sin(lt * 0.6 + i * 1.3)) * sstep(1, 5, lt);
      const gr = g.createLinearGradient(0, hy, 0, LB);
      gr.addColorStop(0, `rgba(255,225,170,${a})`); gr.addColorStop(1, 'rgba(255,225,170,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - 24, hy); g.lineTo(x + 24, hy); g.lineTo(x + 70, LB); g.lineTo(x - 70, LB); g.fill();
    }
    for (const p of S.rise) {
      const cyc = (H) / p.v;
      const age = mod(lt + p.ph * cyc, cyc);
      const y = hy + 40 - age * p.v;
      if (y < LB) continue;
      const x = p.x + Math.sin(lt * 0.7 + p.sw) * 18;
      spr(g, S.gold, x, y, p.s * 5, 0.55 * sstep(0, 3, lt) * Math.min(1, age));
    }
    // 镜头光斑
    const sy = H * (1 - (0.34 + 0.015 + 0.09 * ease(k * 1.1)));
    const sx = W / 2;
    [[0.35, 80, 0.07], [0.6, 40, 0.1], [1.25, 120, 0.05], [1.6, 60, 0.07]].forEach(([f, s, a]) => {
      spr(g, S.rose, sx + (W / 2 - sx) * f, sy + (H / 2 - sy) * f * 2.2, s, a);
    });
    g.globalCompositeOperation = 'source-over';
    const TX = W / 2;
    const c1 = cap(lt, 1.2, 11.2, 1.6, 1.4);
    txt(g, '2026.01  ·  雅加达', TX, 232, { f: 'sc', w: 300, size: 34, ls: 6, align: 'center', color: COL.gold }, c1);
    txt(g, 'M7 世界锦标赛', TX, 306, { f: 'sc', w: 700, size: 62, ls: 4, align: 'center', color: '#fffaf0' }, cap(lt, 1.7, 11.2, 1.6, 1.4));
    txt(g, numFmt(5680000 * ease((lt - 3.2) / 3.4)), TX, 420, { f: 'cz', w: 400, size: 118, ls: 4, align: 'center', color: '#fff4de' }, cap(lt, 3.0, 11.2, 1.2, 1.4));
    txt(g, '总决赛峰值观看人数', TX, 472, { f: 'sc', w: 300, size: 30, ls: 6, align: 'center', color: '#fff6ea' }, cap(lt, 4.2, 11.2, 1.4, 1.4));
    txt(g, '移动电竞史上观看人数最多的赛事', TX, 526, { f: 'sc', w: 500, size: 36, ls: 4, align: 'center', color: '#fffaf0' }, cap(lt, 5.4, 11.2, 1.5, 1.4));
    txt(g, 'The most-watched mobile esports event in history.', TX, 570, { f: 'en', italic: true, size: 27, align: 'center', color: '#fbf1e2' }, cap(lt, 5.9, 11.2, 1.5, 1.4));
    const c2 = cap(lt, 12.2, 22.8, 1.8, 1.5);
    txt(g, '2026.09  ·  爱知 · 名古屋', TX, 300, { f: 'sc', w: 300, size: 34, ls: 6, align: 'center', color: COL.gold }, c2);
    txt(g, '登上亚运会', TX, 400, { f: 'sc', w: 700, size: 78, ls: 14, align: 'center', color: '#fffaf0' }, cap(lt, 12.8, 22.8, 1.8, 1.5));
    txt(g, '《无尽对决》首次成为亚运会正式奖牌项目', TX, 480, { f: 'sc', w: 300, size: 36, ls: 3, align: 'center', color: '#fffaf0' }, cap(lt, 14, 22.8, 1.8, 1.5));
    txt(g, 'MLBB debuts as an official medal event at the Asian Games.', TX, 528, { f: 'en', italic: true, size: 27, align: 'center', color: '#fbf1e2' }, cap(lt, 14.6, 22.8, 1.8, 1.5));
  };

  // --- 10 尾声 ---
  SC.finale = (g, lt, k) => {
    g.globalCompositeOperation = 'lighter';
    const conv = easeIO(lt / 7) * (1 - easeIO((lt - 18) / 7) * 0.8);
    const fin = sstep(0, 2, lt) * (1 - sstep(24, 27, lt));
    for (const p of S.conv) {
      const fx = mod(p.x + lt * 8 * p.z + Math.sin(lt * 0.2 + p.ph) * 30, W);
      const fy = mod(p.y - lt * 5 * p.z, H);
      const tx = W / 2 + p.tx * W * 0.7, ty = H * 0.72 + p.ty * H;
      const x = lerp(fx, tx, conv * 0.85), y = lerp(fy, ty, conv * 0.85);
      spr(g, S.gold, x, y, 4 + 9 * p.z, 0.5 * p.z * fin * (0.6 + 0.4 * Math.sin(lt * 2 + p.ph)));
    }
    const lineA = sstep(3, 7, lt) * (1 - sstep(23, 27, lt));
    const lw = W * (0.2 + 0.5 * ease((lt - 3) / 12));
    const lg = g.createLinearGradient(W / 2 - lw / 2, 0, W / 2 + lw / 2, 0);
    lg.addColorStop(0, 'rgba(255,200,130,0)'); lg.addColorStop(0.5, `rgba(255,220,170,${0.55 * lineA})`); lg.addColorStop(1, 'rgba(255,200,130,0)');
    g.globalAlpha = 1; g.fillStyle = lg; g.fillRect(W / 2 - lw / 2, H * 0.72 - 1, lw, 2);
    g.globalCompositeOperation = 'source-over';
    txt(g, '十二年', W / 2, 430, { f: 'sc', w: 500, size: 96, ls: 34, align: 'center', color: '#f6ead6' }, cap(lt, 1.4, 8.8, 2, 1.6));
    txt(g, '2014 — 2026', W / 2, 505, { f: 'cz', w: 400, size: 42, ls: 10, align: 'center', color: COL.gold }, cap(lt, 2.4, 8.8, 2, 1.6));
    txt(g, '献给每一位沐瞳人', W / 2, 420, { f: 'sc', w: 300, size: 46, ls: 8, align: 'center' }, cap(lt, 9.8, 17.2, 1.8, 1.6));
    txt(g, '和每一位玩家', W / 2, 490, { f: 'sc', w: 300, size: 46, ls: 8, align: 'center' }, cap(lt, 10.6, 17.2, 1.8, 1.6));
    txt(g, 'To everyone at MOONTON, and to every player.', W / 2, 555, { f: 'en', italic: true, size: 28, align: 'center', color: COL.en }, cap(lt, 11.3, 17.2, 1.8, 1.6));
    txt(g, '未完待续', W / 2, 455, { f: 'sc', w: 500, size: 56, ls: 24, align: 'center', color: '#f6ead6' }, cap(lt, 18.2, 25.2, 2.2, 2));
    txt(g, 'TO BE CONTINUED', W / 2, 510, { f: 'cz', w: 500, size: 22, ls: 12, align: 'center', color: COL.en }, cap(lt, 19, 25.2, 2.2, 2));
    txt(g, 'MOONTON', W / 2, 850, { f: 'cz', w: 500, size: 28, ls: 18, align: 'center', color: COL.gold }, cap(lt, 20, 25.4, 2.2, 2));
  };

  // ======================= 合成 =======================
  let main, g, layer, lg;
  let ready = false;
  async function init(canvas) {
    main = canvas; main.width = W; main.height = H;
    g = main.getContext('2d');
    layer = mk(W, H); lg = layer.getContext('2d');
    initGL();
    initAssets();
    const txtAll = '沐瞳十二年上海起点一支约二十人的团队从零开始那时没有知道这条路会通向哪里魔法英雄第款作品全球发行获年度最佳游戏无尽对决把装进每部手机刻切都不样了强敌压境国际大厂相继进入东南亚天是正面交锋阵地守住燎原印尼菲律宾马来西亚登顶免费下载榜枚电竞金牌运动首次设立奖项目历史上诞生突破亿高速增长之后更难段放慢脚步重新寻找方向在迷雾中打磨沉默里积蓄巅峰服正式线外最大回家星空从到世界锦标赛雅加达总决观看峰值移多爱知名古屋亚献给位和玩未完待续马尼拉吉隆坡《》，。·—成为';
    await Promise.all([
      ...[300, 500, 700].map((w) => document.fonts.load(`${w} 40px "Noto Serif SC"`, txtAll + '0123456789 abcABC')),
      document.fonts.load('300 40px "Cormorant Garamond"', '0123456789 ABC,'),
      document.fonts.load('400 40px "Cinzel"', '0123456789 ABC,.—'),
      document.fonts.load('500 40px "Cinzel"', 'MOONTON ABC'),
      document.fonts.load('italic 400 40px "Cormorant Garamond"', 'abc ABC'),
    ]);
    ready = true;
  }

  function sceneState(t) {
    let i = SCENES.findIndex((s) => t < s.end);
    if (i < 0) i = SCENES.length - 1;
    const s = SCENES[i];
    let A = i, B = -1, mix = 0;
    if (i + 1 < SCENES.length && t > s.end - XFADE) { B = i + 1; mix = sstep(s.end - XFADE, s.end + XFADE, t); }
    else if (i > 0 && t < s.start + XFADE) { A = i - 1; B = i; mix = sstep(s.start - XFADE, s.start + XFADE, t); }
    return { A, B, mix };
  }
  function local(i, t) {
    const s = SCENES[i];
    const end = i === SCENES.length - 1 ? DURATION : s.end;
    return [t - s.start, clamp((t - s.start) / (end - s.start))];
  }

  function render(t) {
    const { A, B, mix } = sceneState(t);
    const [la, ka] = local(A, t);
    const [lb, kb] = B >= 0 ? local(B, t) : [0, 0];
    drawGL(t, A, B, mix, la, lb, ka, kb);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1; g.filter = 'none';
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    g.drawImage(glc, 0, 0, W, H);
    const drawScene = (i, lt, k, alpha) => {
      if (alpha <= 0.002) return;
      const fn = SC[SCENES[i].id];
      if (alpha >= 0.998) { g.save(); fn(g, lt, k); g.restore(); return; }
      lg.clearRect(0, 0, W, H);
      lg.save(); fn(lg, lt, k); lg.restore();
      g.globalAlpha = alpha; g.drawImage(layer, 0, 0); g.globalAlpha = 1;
    };
    if (B < 0) drawScene(A, la, ka, 1);
    else { drawScene(A, la, ka, 1 - mix); drawScene(B, lb, kb, mix); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    // 暗角 + 颗粒
    g.drawImage(S.vig, 0, 0);
    g.save();
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.05;
    const R = rng(Math.floor(t * 30) + 11);
    g.translate(-Math.floor(R() * 256), -Math.floor(R() * 256));
    g.fillStyle = g.createPattern(S.grain, 'repeat');
    g.fillRect(0, 0, W + 256, H + 256);
    g.restore();
    // 遮幅
    g.fillStyle = '#000'; g.fillRect(0, 0, W, LB); g.fillRect(0, H - LB, W, LB);
    // 首尾黑场
    const fade = Math.min(sstep(0, 2.2, t), 1 - sstep(DURATION - 5.5, DURATION - 1.2, t));
    if (fade < 1) { g.globalAlpha = 1 - fade; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  }

  root.MV = { W, H, init, render, get ready() { return ready; }, DURATION };
})(typeof window !== 'undefined' ? window : globalThis);
