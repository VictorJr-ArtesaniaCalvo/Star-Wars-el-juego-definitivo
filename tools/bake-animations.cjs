// Traduce las animaciones de Mixamo (assets/animaciones/mixamo/*.fbx) al clon comando y las guarda en public/animations/<nombre>.json.
// Uso: con `npm run dev` en marcha (puerto 5173), `node tools/bake-animations.cjs`. La lista está en tools/anim-preview/preview.ts (CLIPS).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const out = path.join(__dirname, '..', 'public', 'animations');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('Error:', e.message));
  await p.goto(`http://localhost:${process.env.PORT || 5173}/tools/anim-preview/index.html`);
  await p.waitForFunction(() => window.api, null, { timeout: 120000 });
  const clips = await p.evaluate(() => window.api.bake());
  for (const [n, json] of Object.entries(clips)) {
    fs.writeFileSync(path.join(out, `${n}.json`), json);
    console.log(`${n}.json  ${(json.length / 1024).toFixed(0)} KB`);
  }
  await b.close();
})();
