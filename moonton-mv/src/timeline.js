// 全片时间轴：音乐与画面共用同一套小节网格（72 BPM，4/4 拍）。
(function (root) {
  const BPM = 72;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;
  const END_BAR = 68;
  const TAIL = 4.0; // 最后一个和弦的混响尾音 + 黑场

  // 每一幕从第几小节开始
  const SCENES = [
    { id: 'title',     bar: 0 },  // 片名
    { id: 'shanghai',  bar: 6 },  // 2014 上海 · 起步
    { id: 'magicrush', bar: 12 }, // 2015 魔法英雄
    { id: 'mlbb',      bar: 17 }, // 2016 无尽对决
    { id: 'storm',     bar: 23 }, // 2017 强敌压境（低谷）
    { id: 'sea',       bar: 30 }, // 2017–2020 燎原
    { id: 'plateau',   bar: 38 }, // 2021–2023 平台期（低谷）
    { id: 'home',      bar: 44 }, // 2025 决胜巅峰 · 回家
    { id: 'stars',     bar: 49 }, // 2015–2025 产品星图
    { id: 'peak',      bar: 54 }, // 2026 巅峰
    { id: 'finale',    bar: 61 }, // 尾声
  ];
  SCENES.forEach((s, i) => {
    s.start = s.bar * BAR;
    s.end = (i + 1 < SCENES.length ? SCENES[i + 1].bar : END_BAR) * BAR;
  });

  const DURATION = END_BAR * BAR + TAIL;
  const XFADE = 1.6; // 相邻两幕交叉溶解的半宽（秒）

  root.TL = { BPM, BEAT, BAR, END_BAR, DURATION, SCENES, XFADE };
})(typeof window !== 'undefined' ? window : globalThis);
