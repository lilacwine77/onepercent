import * as THREE from 'three';

// The query refreshes cached copies whenever the coins change.
export const PACK_XRAY_COINS_URL = '/assets/pack-xray-coins.webp?v=2';

// Three coin slots, top to bottom: x, y, radius, rotation. Square logos cover the face.
const XRAY_COIN_SLOTS = [[440, 358, 146, -14], [635, 533, 143, 12], [440, 717, 141, -11]];
const XRAY_LOGO_SIZE = 208;

/** Reproducible, code-drawn relief coins. Logos are the supplied, unredrawn assets.
 * `coins` lists three `{ id, image }` entries, top to bottom; images are data URLs,
 * so the resulting SVG is self-contained offline. */
export function createPackXraySVG(coins) {
  if (coins.length !== XRAY_COIN_SLOTS.length) throw new Error(`The pack X-ray draws ${XRAY_COIN_SLOTS.length} coins.`);
  const coin = (id, x, y, radius, rotation, image, logoScale) => `
    <g transform="translate(${x} ${y}) rotate(${rotation}) scale(${radius / 140})">
      <ellipse cx="8" cy="21" rx="148" ry="133" fill="#070825" opacity=".72"/>
      <ellipse cy="14" rx="140" ry="127" fill="url(#edge)" stroke="#659bbb" stroke-width="3"/>
      ${Array.from({ length: 29 }, (_, i) => {
        const a = Math.PI * (.04 + i / 30 * .92);
        const px = Math.cos(a) * 137, py = Math.sin(a) * 119;
        return `<path d="M${px.toFixed(2)},${py.toFixed(2)}v14" stroke="#74d6e0" stroke-width="2" opacity=".5"/>`;
      }).join('')}
      <ellipse rx="140" ry="124" fill="url(#rim)" stroke="#d0ffff" stroke-width="3"/>
      <ellipse rx="128" ry="112" fill="none" stroke="#132344" stroke-width="7"/>
      <ellipse rx="121" ry="105" fill="url(#face)" stroke="#94f5ed" stroke-width="2"/>
      <ellipse rx="113" ry="97" fill="none" stroke="#62b7d0" stroke-width="1" opacity=".6"/>
      <g clip-path="url(#clip-${id})" filter="url(#xray-logo)">
        <image href="${image}" x="${-logoScale / 2}" y="${-logoScale / 2}" width="${logoScale}" height="${logoScale}" preserveAspectRatio="xMidYMid meet"/>
      </g>
      <path d="M-122,-30 A125,110 0 0 1 75,-90" fill="none" stroke="#efffff" stroke-width="5" stroke-linecap="round" opacity=".82"/>
      <path d="M-78,89 A128,112 0 0 0 120,28" fill="none" stroke="#55b6d0" stroke-width="3" opacity=".6"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#455a8a"/><stop offset=".44" stop-color="#142747"/><stop offset=".73" stop-color="#91e9e7"/><stop offset="1" stop-color="#273457"/></linearGradient>
      <linearGradient id="rim" x1=".08" y1="0" x2=".86" y2="1"><stop stop-color="#f1ffff"/><stop offset=".27" stop-color="#92ebf0"/><stop offset=".47" stop-color="#476582"/><stop offset=".69" stop-color="#caf8ed"/><stop offset="1" stop-color="#5eafc8"/></linearGradient>
      <radialGradient id="face" cx=".28" cy=".2" r=".94"><stop stop-color="#577793"/><stop offset=".45" stop-color="#193153"/><stop offset="1" stop-color="#0e1434"/></radialGradient>
      <filter id="xray-logo" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".18 .60 .06 0 .01  .25 .80 .10 0 .04  .25 .83 .12 0 .09  0 0 0 1 0"/></filter>
      ${coins.map(({ id }) => `<clipPath id="clip-${id}"><ellipse rx="100" ry="92"/></clipPath>`).join('\n      ')}
    </defs>
    ${coins.map(({ id, image }, i) => coin(id, ...XRAY_COIN_SLOTS[i], image, XRAY_LOGO_SIZE)).join('\n    ')}
  </svg>`;
}

export async function loadPackXrayTexture(renderer) {
  const texture = await new THREE.TextureLoader().loadAsync(PACK_XRAY_COINS_URL);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

export function createPackXrayState() {
  return { progress: { value: 0 }, cursor: { value: new THREE.Vector2() } };
}

/** Added after physical lighting, before output conversion. Zero progress takes
 * the exact existing native-print path, including its restrained reflection. */
export function patchPackXray(shader, state, texture) {
  shader.uniforms.uPackXray = state.progress;
  shader.uniforms.uPackXrayCursor = state.cursor;
  shader.uniforms.uPackXrayCoins = { value: texture };
  shader.fragmentShader = `uniform float uPackXray;
uniform vec2 uPackXrayCursor;
uniform sampler2D uPackXrayCoins;
${shader.fragmentShader}`;
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
    outgoingLight = diffuseColor.rgb + min(totalSpecular, vec3(0.4)) * 0.07;
    if (uPackXray > 0.0001) {
      float xrHeight = 1.0 - vMapUv.y;
      float xrScan = uPackXray * 1.44 - 0.22;
      float xrReveal = smoothstep(xrHeight - 0.20, xrHeight + 0.20, xrScan);
      vec2 xrCoinUV = vMapUv + uPackXrayCursor * vec2(0.009, -0.009);
      vec4 xrCoins = texture2D(uPackXrayCoins, xrCoinUV);
      float xrFoil = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float xrRim = pow(1.0 - abs(dot(normal, geometryViewDir)), 2.0);
      vec3 xrBody = vec3(0.026, 0.009, 0.069) + vec3(0.028, 0.087, 0.11) * xrFoil;
      vec3 xrInside = mix(xrBody, xrCoins.rgb, xrCoins.a * 0.96);
      // Foil creases, seal geometry and studio reflections remain in front of
      // the contents. A tiny opposite parallax gives depth inside the pouch.
      xrInside += vec3(0.13, 0.43, 0.48) * xrRim * 0.36;
      xrInside += min(totalSpecular, vec3(0.7)) * 0.09;
      xrInside += vec3(0.035, 0.083, 0.088) * xrFoil * xrCoins.a;
      float xrBeam = exp(-pow((xrHeight - xrScan) / 0.048, 2.0));
      xrInside += vec3(0.10, 0.35, 0.39) * xrBeam * sin(uPackXray * 3.14159265);
      outgoingLight = mix(outgoingLight, xrInside, xrReveal);
    }
    #include <opaque_fragment>`);
}
