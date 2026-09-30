// 各幕背景（WebGL2 片元着色器）：星云、夜空、极光、风暴云、海面、迷雾、晨曦、日出云海……
(function (root) {
  root.MV_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uT;
uniform int uA; uniform int uB; uniform float uMix;
uniform float uLA; uniform float uLB; uniform float uKA; uniform float uKB;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03; a *= .5; }
  return v;
}
float stars(vec2 q, float dens, float thr, float t){
  vec2 g = q * dens; vec2 id = floor(g); vec2 f = fract(g) - .5;
  float h = hash(id);
  if (h < thr) return 0.;
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - .5;
  float d = length(f - o * .6);
  float tw = .65 + .35 * sin(t * (1. + h * 3.) + h * 40.);
  return smoothstep(.16, 0., d) * tw * (h - thr) / (1. - thr);
}
vec2 P(vec2 uv){ return (uv - .5) * vec2(uRes.x / uRes.y, 1.); }
float eo(float x){ x = clamp(x, 0., 1.); return 1. - pow(1. - x, 3.); }

// 0 片名：暖色星尘
vec3 sTitle(vec2 uv, float t, float k){
  vec2 p = P(uv);
  vec3 c = vec3(.012, .009, .014);
  float n = fbm(p * 1.4 + vec2(t * .015, -t * .01));
  float n2 = fbm(p * 3. + n * 2. + vec2(-t * .02, 0.));
  c += vec3(.22, .12, .05) * pow(n2, 3.) * 1.3 * smoothstep(0., 7., t);
  c += vec3(.07, .045, .09) * pow(n, 2.) * .7;
  float line = exp(-abs(p.y + .035) * 110.) * exp(-p.x * p.x * 2.5);
  float on = smoothstep(6.5, 10.5, t) * (1. - smoothstep(15.5, 19.5, t));
  c += vec3(1., .74, .42) * line * .5 * on;
  c += vec3(.5, .3, .13) * exp(-length(p * vec2(.55, 2.)) * 3.) * .22 * on;
  return c;
}
// 1 上海 2014：雨夜
vec3 sShanghai(vec2 uv, float t, float k){
  vec2 p = P(uv);
  float h = uv.y;
  vec3 c = mix(vec3(.13, .085, .09), vec3(.035, .04, .075), smoothstep(.2, .45, h));
  c = mix(c, vec3(.006, .01, .03), smoothstep(.45, 1., h));
  c += vec3(.34, .16, .07) * exp(-max(h - .22, 0.) * 8.) * .5;
  float cl = fbm(vec2(p.x * 1.1 + t * .012, p.y * 3.2));
  c += vec3(.07, .06, .08) * smoothstep(.45, .85, cl) * smoothstep(.3, .8, h);
  c += vec3(.9, .9, 1.) * stars(uv * vec2(uRes.x / uRes.y, 1.), 110., .965, t) * smoothstep(.6, .9, h) * .6;
  return c;
}
// 2 魔法英雄 2015：金色极光
vec3 sMagic(vec2 uv, float t, float k){
  vec2 p = P(uv);
  vec3 c = mix(vec3(.035, .018, .012), vec3(.012, .008, .025), uv.y);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float yc = -.05 + .13 * fi + .12 * sin(p.x * 1.3 + t * .18 + fi * 2.1) + .1 * (fbm(vec2(p.x * .8 + t * .05, fi * 3.)) - .5);
    float w = .05 + .035 * fi;
    float band = exp(-pow((p.y - yc) / w, 2.));
    float streak = fbm(vec2(p.x * 4. + t * .25 + fi * 10., p.y * 1.5));
    vec3 col = mix(vec3(1., .55, .18), vec3(1., .82, .5), fi / 2.);
    if (i == 2) col = vec3(.95, .45, .38);
    c += col * band * pow(streak, 1.4) * .6 * smoothstep(0., 3., t);
  }
  c += vec3(1., .7, .35) * exp(-length(p * vec2(.8, 1.4)) * 2.2) * .2;
  return c;
}
// 3 无尽对决 2016：蓝紫夜空
vec3 sMlbb(vec2 uv, float t, float k){
  vec2 p = P(uv);
  vec3 c = mix(vec3(.01, .012, .035), vec3(.035, .02, .075), uv.y);
  float n = fbm(p * 2. + vec2(t * .02, 0.));
  c += vec3(.12, .08, .26) * pow(n, 2.5) * .9;
  c += vec3(.15, .25, .62) * exp(-length(p - vec2(.25, -.05)) * 1.6) * .28;
  c += vec3(.9, .9, 1.) * stars(uv * vec2(uRes.x / uRes.y, 1.), 90., .97, t) * .5;
  return c;
}
// 4 强敌压境 2017：风暴云
vec3 sStorm(vec2 uv, float t, float k){
  vec2 p = P(uv) * 1.2;
  vec2 q = vec2(fbm(p * 1.3 + vec2(t * .12, 0.)), fbm(p * 1.3 + vec2(5.2, 1.3) - vec2(t * .1, t * .03)));
  float r = fbm(p * 1.6 + 2.8 * q + vec2(t * .3, -t * .06));
  vec3 c = mix(vec3(.01, .012, .02), vec3(.14, .17, .23), clamp(r * r * 1.8, 0., 1.));
  c = mix(c, vec3(.2, .24, .32), clamp(q.y * q.y * .6, 0., 1.) * .5);
  float g = .35 + .9 * smoothstep(.55, 1., k);
  c += vec3(.25, .45, .95) * exp(-length((p - vec2(0., -.12)) * vec2(1., 1.3)) * 2.6) * .35 * g * (.6 + .4 * r);
  c *= .85 + .15 * sin(t * .35 + p.x);
  return c;
}
// 5 燎原：深海
vec3 sSea(vec2 uv, float t, float k){
  vec2 p = P(uv);
  vec3 c = mix(vec3(.004, .018, .036), vec3(.01, .045, .075), uv.y);
  float n = fbm(p * 3. + vec2(t * .03, t * .02));
  float n2 = fbm(p * 7. - vec2(t * .05, 0.) + n);
  c += vec3(.02, .08, .1) * pow(n2, 2.) * .8;
  c += vec3(.28, .13, .03) * exp(-length(p - vec2(.15, -.05)) * 2.) * .28 * smoothstep(0., .6, k);
  return c;
}
// 6 平台期：迷雾平原
vec3 sPlateau(vec2 uv, float t, float k){
  vec2 p = P(uv);
  float hy = .42;
  vec3 sky = mix(vec3(.16, .155, .19), vec3(.06, .06, .09), smoothstep(hy, 1., uv.y));
  vec3 gr = mix(vec3(.04, .04, .055), vec3(.12, .115, .14), smoothstep(0., hy, uv.y));
  vec3 c = uv.y > hy ? sky : gr;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float f = fbm(vec2(p.x * (1. + fi * .5) + t * (.02 + fi * .012), uv.y * 6. + fi * 4.));
    float band = exp(-pow((uv.y - (hy - .05 + fi * .06)) / (.08 + fi * .03), 2.));
    c = mix(c, vec3(.21, .2, .24), band * f * .6);
  }
  float warm = smoothstep(.62, 1., k);
  c += vec3(.62, .36, .18) * exp(-abs(uv.y - hy) * 22.) * exp(-p.x * p.x * 5.) * warm * .65;
  return c;
}
// 7 回家 2025：晨曦
vec3 sHome(vec2 uv, float t, float k){
  vec2 p = P(uv);
  float y = uv.y;
  vec3 c = mix(vec3(1., .62, .32), vec3(.72, .34, .36), smoothstep(.22, .45, y));
  c = mix(c, vec3(.2, .16, .3), smoothstep(.45, .75, y));
  c = mix(c, vec3(.04, .05, .13), smoothstep(.75, 1., y));
  float sun = exp(-length((p - vec2(.12, -.22)) * vec2(1., 1.6)) * 3.);
  c += vec3(1., .7, .4) * sun * .5;
  float cl = fbm(vec2(p.x * 1.5 + t * .02, y * 5.));
  c = mix(c, c * 1.15 + vec3(.08, .04, .03), smoothstep(.5, .8, cl) * smoothstep(.3, .7, y) * .6);
  c *= .4 + .6 * smoothstep(-1., 5., t);
  return c;
}
// 8 产品星图：星云
vec3 sStars(vec2 uv, float t, float k){
  vec2 p = P(uv) + vec2(t * .004, 0.);
  vec2 q = vec2(fbm(p * 1.2 + t * .01), fbm(p * 1.2 + vec2(3.1, 1.7)));
  float n = fbm(p * 1.6 + 2. * q);
  vec3 c = vec3(.008, .008, .02);
  c += mix(vec3(.25, .08, .35), vec3(.05, .3, .38), q.x) * pow(n, 2.2) * .95;
  c += vec3(.6, .4, .2) * pow(fbm(p * 3. + q * 3.), 4.) * .5;
  vec2 su = uv * vec2(uRes.x / uRes.y, 1.);
  c += vec3(1.) * stars(su + vec2(t * .003, 0.), 140., .94, t) * .8;
  c += vec3(.8, .85, 1.) * stars(su * 1.7, 160., .965, t * 1.3) * .5;
  return c;
}
// 9 巅峰 2026：云海日出
vec3 sPeak(vec2 uv, float t, float k){
  vec2 p = P(uv);
  float hy = .34;
  float y = uv.y;
  float sy = hy + .015 + .09 * eo(k * 1.1);
  vec2 sp = vec2(0., sy - .5);
  vec3 sky = mix(vec3(1., .64, .36), vec3(.6, .38, .46), smoothstep(hy, hy + .16, y));
  sky = mix(sky, vec3(.13, .14, .33), smoothstep(hy + .12, .68, y));
  sky = mix(sky, vec3(.025, .04, .12), smoothstep(.68, 1., y));
  vec2 d = p - sp; float L = length(d);
  vec3 c = sky;
  c += vec3(1., .7, .42) * exp(-L * 5.5) * .85;
  c += vec3(1., .96, .88) * smoothstep(.042, .035, L);
  float ang = atan(d.y, d.x);
  float rays = pow(fbm(vec2(ang * 5., t * .06)), 3.) * exp(-L * 2.4);
  c += vec3(1., .78, .5) * rays * .5 * smoothstep(-.05, .1, d.y + .05);
  vec2 su = uv * vec2(uRes.x / uRes.y, 1.);
  c += vec3(.9, .9, 1.) * stars(su, 120., .975, t) * smoothstep(.7, .95, y) * .6;
  if (y < hy) {
    float depth = hy - y;
    vec2 cp = vec2(p.x / (depth * 2.5 + .06), 1. / (depth * 2.5 + .06));
    float cn = fbm(cp * .5 + vec2(t * .03, t * .12));
    vec3 cc = mix(vec3(.3, .22, .3), vec3(1., .78, .58), cn);
    cc *= .45 + .6 * exp(-abs(p.x - sp.x) * 1.6);
    c = mix(c, cc, smoothstep(0., .025, depth));
  }
  return c;
}
// 10 尾声
vec3 sFinale(vec2 uv, float t, float k){
  vec2 p = P(uv);
  vec3 c = vec3(.012, .009, .012);
  float n = fbm(p * 1.5 + vec2(t * .01, t * .012));
  c += vec3(.2, .12, .05) * pow(n, 3.) * .9;
  c += vec3(.5, .32, .14) * exp(-length(p * vec2(.6, 1.8)) * 2.5) * .22;
  return c;
}
vec3 scene(int id, vec2 uv, float t, float k){
  if (id == 0) return sTitle(uv, t, k);
  if (id == 1) return sShanghai(uv, t, k);
  if (id == 2) return sMagic(uv, t, k);
  if (id == 3) return sMlbb(uv, t, k);
  if (id == 4) return sStorm(uv, t, k);
  if (id == 5) return sSea(uv, t, k);
  if (id == 6) return sPlateau(uv, t, k);
  if (id == 7) return sHome(uv, t, k);
  if (id == 8) return sStars(uv, t, k);
  if (id == 9) return sPeak(uv, t, k);
  return sFinale(uv, t, k);
}
void main(){
  vec3 c = scene(uA, vUv, uLA, uKA);
  if (uMix > .001) c = mix(c, scene(uB, vUv, uLB, uKB), uMix);
  c += (hash(vUv * uRes + fract(uT * 7.13) * 100.) - .5) / 255.;
  fragColor = vec4(c, 1.);
}`;
})(typeof window !== 'undefined' ? window : globalThis);
