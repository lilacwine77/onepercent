/* eslint-disable */
// Synced from experience/lab/src/rip/shaders.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** GLSL for card faces, the foil pack, the stage haze and the CRT pass. */

/** Brand iridescence palette (#a8e7ff #e4c3ff #ffbfd9 #ffe5a4 #c7ffe9), linearised. */
const PALETTE = /* glsl */ `
vec3 iridescence(float t) {
  t = fract(t) * 5.0;
  vec3 c0 = vec3(0.392, 0.799, 1.000);
  vec3 c1 = vec3(0.775, 0.552, 1.000);
  vec3 c2 = vec3(1.000, 0.521, 0.693);
  vec3 c3 = vec3(1.000, 0.783, 0.371);
  vec3 c4 = vec3(0.565, 1.000, 0.815);
  float f = fract(t);
  f = f * f * (3.0 - 2.0 * f);
  if (t < 1.0) return mix(c0, c1, f);
  if (t < 2.0) return mix(c1, c2, f);
  if (t < 3.0) return mix(c2, c3, f);
  if (t < 4.0) return mix(c3, c4, f);
  return mix(c4, c0, f);
}
// Printed artwork is display-referred: it bypasses the scene's AgX tone mapping, and only
// highlights above 0.82 roll off softly (so foil glints never clip hard).
vec3 softClip(vec3 c) {
  vec3 k = max(c - 0.82, 0.0);
  return min(c, vec3(0.82)) + 0.18 * (1.0 - exp(-k / 0.18));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const cardVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const cardFragment = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uMask;
uniform float uHolo;
uniform float uFoil;
uniform float uShine;
uniform float uShineAmt;
uniform vec2 uPointer;
uniform float uGlare;
uniform vec3 uGlintColor;
uniform float uGlint;
uniform float uTime;
uniform float uDim;
uniform float uOpacity;
uniform float uGoldGlow;
uniform float uBloom;
uniform float uSharpen;
uniform vec3 uKeyDir;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${PALETTE}
void main() {
  // Crisp print: a slightly sharper mip choice plus an unsharp mask against a coarser mip, so
  // small type stays razor sharp when the face is minified (2-4x on the reveal row).
  vec4 tex = texture2D(uMap, vUv, -0.5);
  vec3 coarse = texture2D(uMap, vUv, 1.0).rgb;
  tex.rgb = clamp(tex.rgb + (tex.rgb - coarse) * uSharpen, 0.0, 1.0);
  vec3 base = tex.rgb;
  vec3 m = texture2D(uMask, vUv).rgb;
  float foil = m.r * uFoil;
  float holo = m.g * uHolo;
  float gloss = m.b;
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uKeyDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndh = max(dot(N, H), 0.0);
  vec3 R = reflect(-V, N);
  // Printed colours stay true; the key light adds gentle modelling as the card turns.
  vec3 col = base * (0.93 + 0.11 * ndl);
  // Foil: the photographed crinkles flash with a two-softbox studio reflection.
  vec2 r2 = R.xy + uPointer * 0.18;
  float softbox = exp(-pow(length(r2 - vec2(-0.32, 0.42)) / 0.34, 2.0))
                + 0.7 * exp(-pow(length(r2 - vec2(0.48, 0.12)) / 0.26, 2.0));
  float env = 0.62 + 0.5 * smoothstep(-0.5, 0.9, r2.y);
  vec3 foilCol = base * env + base * softbox * 0.85 + softbox * 0.06;
  col = mix(col, foilCol, foil);
  // Holo (pack-foil.css .orbit-iridescence, colour-dodge).
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  float phase = dot(vUv, vec2(0.47, 0.88)) * 1.35 + R.x * 0.85 + R.y * 0.55
              + uPointer.x * 0.32 + uPointer.y * 0.18 + lum * 0.8 + uTime * 0.015;
  vec3 ir = iridescence(phase);
  vec3 dodge = col / max(vec3(1.0) - ir * 0.62, vec3(0.1));
  float holoMix = holo * (0.3 + 0.7 * smoothstep(0.02, 0.5, lum));
  col = mix(col, dodge, holoMix * 0.8);
  col += ir * holo * 0.1 * (1.0 - lum);
  // Micro glitter that moves with the view.
  vec2 cell = floor(vUv * vec2(230.0, 322.0));
  float h = hash12(cell);
  float glit = step(0.986, h) * pow(max(0.0, sin(h * 71.0 + R.x * 16.0 + R.y * 12.0 + uPointer.x * 5.0)), 16.0);
  col += glit * (foil * 0.35 + holo * 0.5) * mix(vec3(1.0), ir, holo) * 0.9;
  // Gold emboss and spot gloss.
  float spec = pow(ndh, 70.0);
  col += gloss * (spec * 0.8 + softbox * 0.3) * vec3(1.0, 0.9, 0.7);
  col += foil * spec * 0.3;
  col += (1.0 - foil) * pow(ndh, 10.0) * 0.045;
  // Specular shine (pack-foil.css .orbit-light, 112°).
  float d = dot(vUv - 0.5, vec2(0.927, 0.375));
  float band = exp(-pow((d - uShine) / 0.075, 2.0));
  col += band * uShineAmt * (0.3 + 0.7 * max(max(foil, gloss), holo)) * vec3(1.0, 0.97, 0.9);
  // Pointer glare (pack-foil.css .orbit-glare).
  vec2 pUv = uPointer * 0.5 + 0.5;
  vec2 dp = (vUv - pUv) * vec2(1.0, 1.4);
  col += exp(-dot(dp, dp) / 0.07) * uGlare * 0.28 * vec3(1.0, 0.976, 0.925) * (0.35 + 0.65 * max(foil, holo));
  // Rim glint (Blue Foil) and gold glow (Black Foil, Jackpot).
  vec2 e2 = min(vUv, 1.0 - vUv) * vec2(1.0, 1.4);
  float edge = min(e2.x, e2.y);
  col += uGlintColor * uGlint * smoothstep(0.045, 0.0, edge);
  col += vec3(1.0, 0.72, 0.28) * uGoldGlow * smoothstep(0.08, 0.0, edge) * 0.8;
  col *= uDim;
  if (uBloom > 0.5) {
    // Bloom source: only what rises above print white on foil, holo or gloss (never paper).
    // Only the light added on top of the print (glints, softboxes, holo), never the print itself:
    // pearl and paper stay calm, foil glints bloom.
    float shiny = max(max(foil, holo), gloss);
    vec3 above = max(col - max(base * 1.08, vec3(0.78)), 0.0);
    gl_FragColor = vec4(above * 1.8 * shiny * uOpacity, 1.0);
    return;
  }
  gl_FragColor = vec4(softClip(col), uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const packVertex = /* glsl */ `
attribute float aSide;
attribute vec2 aImg;
attribute float aTear;
uniform float uOpen;
uniform float uPeel;
uniform float uIsStrip;
uniform vec2 uSpan;
uniform float uSize;
varying vec2 vImg;
varying float vSide;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vEdgeLight;
varying float vTear;
void main() {
  vImg = aImg;
  vTear = aTear;
  vSide = aSide;
  vec3 p = position;
  vec3 n = normal;
  float across = clamp((aImg.x - uSpan.x) / (uSpan.y - uSpan.x), 0.0, 1.0);
  vEdgeLight = 0.0;
  if (uIsStrip < 0.5) {
    // The mouth opens: the front sheet bows forward, the back sheet back.
    float dv = aImg.y - aTear;
    float k = clamp(1.0 - dv / 0.24, 0.0, 1.0);
    float taper = pow(sin(3.14159265 * across), 0.8);
    float bow = k * k * taper * uOpen;
    p.z += aSide * 0.34 * bow;
    p.y -= 0.05 * bow * (aSide > 0.0 ? 1.0 : 0.3);
    n = normalize(n + vec3(0.0, aSide * 0.9 * k * taper * uOpen, 0.0));
    vEdgeLight = bow;
  } else {
    // The strip peels from the left, hinged on the serrated tear line.
    // Torn from the left: each column lifts, curls back and opens a gap.
    float local = clamp(uPeel * 1.7 - across * 0.7, 0.0, 1.0);
    local = local * local * (3.0 - 2.0 * local);
    float ang = local * 1.25;
    float hingeY = (0.5 - aTear) * uSize;
    float dy = p.y - hingeY;
    float dz = p.z;
    float c = cos(ang), s = sin(ang);
    p.y = hingeY + dy * c - dz * s + local * (0.16 + 0.1 * (1.0 - across));
    p.z = dz * c + dy * s + local * 0.12;
    p.x += local * 0.05;
    n = normalize(vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c));
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const packFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uXray;
uniform float uXrayFade;
uniform float uScan;
uniform float uScanAmt;
uniform float uLock;
uniform float uTime;
uniform float uOpacity;
uniform vec2 uPointer;
uniform float uSheen;
uniform float uTearGlow;
uniform vec3 uTearColor;
uniform vec3 uAura;
uniform float uIsStrip;
uniform float uBloom;
uniform vec3 uKeyDir;
varying vec2 vImg;
varying float vSide;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vEdgeLight;
varying float vTear;
${PALETTE}
void main() {
  // Opaque foil: fades are a screen-door dissolve (no sorting, nothing shows through it).
  if (uOpacity < 0.999) {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (ign >= uOpacity) discard;
  }
  vec2 uv = vec2(vImg.x, 1.0 - vImg.y);
  vec4 tex = texture2D(uMap, uv);
  if (tex.a < 0.5) discard;
  vec3 base = tex.rgb;
  vec3 N = normalize(vWorldNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uKeyDir);
  float ndl = max(dot(N, L), 0.0);
  vec3 col = base * (0.82 + 0.26 * ndl);
  if (vSide < 0.0) col = base * 0.42 * (0.8 + 0.3 * ndl);
  // The torn strip's inner face is bare silver foil (bright), not the dark back of the print.
  if (uIsStrip > 0.5 && !gl_FrontFacing) col = vec3(0.8, 0.8, 0.84) * (0.72 + 0.4 * ndl) + vec3(0.12) * pow(max(dot(reflect(-normalize(cameraPosition - vWorldPos), N), L), 0.0), 8.0);
  // Inside of the opened mouth is shadowed…
  col *= 1.0 - 0.35 * vEdgeLight * step(vSide, 0.0);
  // Foil light layers (pack-foil.css): shine band, iridescence, glare.
  vec3 R = reflect(-V, N);
  float d = dot(vImg - 0.5, vec2(0.927, -0.375)) - (uPointer.x * 0.25 + R.x * 0.4);
  float band = exp(-pow(d / 0.09, 2.0));
  col += band * uSheen * 0.32 * vec3(1.0, 0.97, 0.9);
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  vec3 ir = iridescence(dot(vImg, vec2(0.47, 0.88)) * 1.2 + R.x * 0.7 + uPointer.x * 0.3 + lum * 0.6);
  col = mix(col, col / max(vec3(1.0) - ir * 0.5, vec3(0.1)), uSheen * 0.16);
  vec2 dp = vImg - (uPointer * vec2(0.5, -0.5) + 0.5);
  col += exp(-dot(dp, dp) / 0.05) * uSheen * 0.16 * vec3(1.0, 0.976, 0.925);
  // Cranking: the edition's foil stays; a light charges it. A soft aura along the silhouette and
  // a bright band that travels down the foil (128 BPM), in the stage colour (the tier's once locked).
  if (uXray > 0.001) {
    float a4 = texture2D(uMap, uv + vec2(0.014, 0.0)).a * texture2D(uMap, uv - vec2(0.014, 0.0)).a
             * texture2D(uMap, uv + vec2(0.0, 0.014)).a * texture2D(uMap, uv - vec2(0.0, 0.014)).a;
    float edge = 1.0 - smoothstep(0.55, 0.98, a4);
    float rim = pow(1.0 - abs(dot(N, V)), 2.5);
    float pulse = mix(0.75 + 0.25 * sin(uTime * 6.7), 1.0, uLock);
    float beam = exp(-pow((vImg.y - uScan) / 0.045, 2.0)) * uScanAmt;
    vec3 charge = uAura * (edge * 0.75 + rim * 0.45) * pulse + mix(vec3(1.0, 0.97, 0.92), uAura, 0.35) * beam * (0.28 + 0.3 * lum);
    col += charge * uXray * uXrayFade;
  }
  // The rip: a white-hot torn edge and light leaking out of the opening, in the tier colour.
  if (uTearGlow > 0.001) {
    float below = vImg.y - vTear;
    float core = exp(-pow(below / 0.005, 2.0));
    float leak = uIsStrip > 0.5 ? 0.0 : exp(-max(below, 0.0) / 0.05) * step(-0.004, below);
    float inside = vEdgeLight * step(vSide, 0.0) + vEdgeLight * 0.5;
    col += (vec3(1.0, 0.97, 0.92) * core * 1.4 + uTearColor * (leak * 0.85 + inside * 1.1)) * uTearGlow;
  }
  if (uBloom > 0.5) { gl_FragColor = vec4(max(col - 0.92, 0.0) * 1.2, 1.0); return; }
  gl_FragColor = vec4(softClip(col), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Stage haze between the machine and the cards: cream haze, mood tints, liquid waves. */
export const hazeFragment = /* glsl */ `
uniform vec2 uRes;
uniform float uHaze;
uniform vec3 uHazeColor;
uniform float uMood;
uniform vec3 uMoodColor;
uniform float uMoodAlpha;
uniform float uWave;
uniform float uWaveOut;
uniform vec3 uWaveLo;
uniform vec3 uWaveHi;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 s = gl_FragCoord.xy / uRes;
  // Haze is a touch stronger at the edges, like a lens vignette in a studio.
  float vig = smoothstep(0.25, 0.95, length((s - 0.5) * vec2(1.2, 1.0)));
  vec3 col = uHazeColor;
  float a = uHaze * (0.85 + 0.15 * vig);
  col = mix(col, uMoodColor, uMood);
  a = mix(a, uMoodAlpha, uMood);
  // Liquid wave (entrance.js waveTransition variant): rises from the bottom, leaves the same way.
  float surf = uWave * 1.35 - 0.18
    + 0.028 * sin(s.x * 8.5 + uTime * 2.6)
    + 0.016 * sin(s.x * 17.0 - uTime * 4.1);
  float top = uWaveOut * 1.35 - 0.18
    + 0.03 * sin(s.x * 7.0 - uTime * 2.2)
    + 0.014 * sin(s.x * 15.0 + uTime * 3.6);
  float inWave = smoothstep(surf + 0.006, surf - 0.006, s.y) * smoothstep(top - 0.006, top + 0.006, s.y);
  vec3 wcol = mix(uWaveLo, uWaveHi, smoothstep(0.0, 1.0, s.y));
  // Moving caustics: two scrolling bands of light inside the liquid.
  float c1 = sin(s.x * 13.0 + s.y * 7.0 + uTime * 1.7) * sin(s.x * 5.0 - s.y * 11.0 - uTime * 1.1);
  float c2 = sin(s.x * 21.0 - s.y * 5.0 - uTime * 2.3);
  wcol *= 1.0 + 0.12 * smoothstep(0.55, 1.0, c1) + 0.06 * smoothstep(0.7, 1.0, c2);
  // A bright 1.5 px crest and a slightly darker trough under it.
  float px = 1.0 / uRes.y;
  float crest = exp(-pow((s.y - surf + 2.0 * px) / (1.5 * px), 2.0));
  float trough = exp(-pow((s.y - surf + 0.03) / 0.02, 2.0));
  wcol = wcol * (1.0 - 0.1 * trough) + crest * 0.45;
  float exitCrest = exp(-pow((s.y - top - 2.0 * px) / (1.5 * px), 2.0)) * step(0.001, uWaveOut);
  wcol += exitCrest * 0.35;
  col = mix(col, wcol, inWave * 0.92);
  a = max(a, inWave * 0.92);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** CRT treatment (crt-tv.js crtBroadcast, as a screen pass) with lilac broadcast bands. */
export const crtFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBands;
uniform float uAmount;
uniform float uBands;
uniform float uTime;
uniform float uRows;
uniform vec2 uPx;
uniform float uMotion;
varying vec2 vUv;
float crtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec4 readScene(vec2 uv) {
  vec4 c = texture2D(tScene, uv);
  vec4 b = texture2D(tBands, uv);
  c.rgb = mix(c.rgb, b.rgb, b.a * uBands);
  c.a = max(c.a, b.a * uBands);
  return c;
}
void main() {
  vec2 p = vUv - 0.5;
  vec2 w = vUv + p * dot(p, p) * 0.05 * uAmount;
  float roll = fract(w.y - uTime * 0.21 * uMotion);
  float band = exp(-pow((roll - 0.5) * 18.0, 2.0));
  float shadowBand = exp(-pow((roll - 0.59) * 23.0, 2.0));
  w.x += sin(w.y * 37.0 + uTime * 3.0) * uPx.x * 2.2 * band * uAmount * uMotion;
  vec2 shift = vec2(uPx.x * 1.0 * uAmount * uMotion, 0.0);
  vec4 c = readScene(w);
  c.r = readScene(w + shift).r;
  c.b = readScene(w - shift).b;
  float scan = 0.5 + 0.5 * sin(w.y * uRows * 6.283185);
  float grain = crtHash(floor(w * vec2(620.0, 465.0)) + floor(uTime * 22.0 * uMotion)) - 0.5;
  c.rgb *= 1.0 - uAmount * (0.16 * scan + 0.08 * shadowBand);
  c.rgb += uAmount * (0.035 * grain + 0.06 * band) * c.a;
  float vig = smoothstep(0.85, 0.35, length(p * vec2(1.0, 1.15)));
  c.rgb *= mix(1.0, 0.82 + 0.18 * vig, uAmount);
  // Outside the warped screen, nothing.
  float inside = step(0.0, w.x) * step(w.x, 1.0) * step(0.0, w.y) * step(w.y, 1.0);
  gl_FragColor = vec4(c.rgb * inside, c.a * inside);
}
`;
