import sharp from 'sharp';

// Screen artwork, composed from the existing unmodified white Pepe illustration.
// Kept separate from the monitor geometry so the broadcast can be replaced.
const mascot = await sharp('public/assets/pepe-mascot-white.png')
  .resize(905, 905, { fit: 'contain' }).png().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1152" viewBox="0 0 1536 1152">
  <defs>
    <radialGradient id="paper"><stop stop-color="#fff9ee"/><stop offset="1" stop-color="#f1dfd5"/></radialGradient>
  </defs>
  <rect width="1536" height="1152" fill="url(#paper)"/>
  <path d="M0 0h1536v146Q760 187 0 146Z" fill="#d5a2f1"/>
  <g fill="#26062e" font-family="Georgia" font-weight="bold">
    <text x="70" y="104" font-size="76" letter-spacing="-6">1%</text>
    <text x="1460" y="100" font-size="48" text-anchor="end" letter-spacing="-1.5">Onepercent.</text>
  </g>
  <ellipse cx="802" cy="966" rx="325" ry="32" fill="#603167" opacity=".1"/>
  <image href="data:image/png;base64,${mascot.toString('base64')}" x="331" y="152" width="905" height="905"/>
  <path d="M0 1043Q750 1090 1536 1024V1152H0Z" fill="#d5a2f1"/>
  <text x="768" y="1120" text-anchor="middle" font-family="Georgia" font-weight="bold" font-size="55" letter-spacing="-1.5" fill="#26062e">Find your 1%.</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile('public/assets/crt-screen.png');
console.log('CRT artwork: public/assets/crt-screen.png (1536 × 1152)');
