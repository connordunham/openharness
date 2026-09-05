/**
 * Regenerates the README screenshots in docs/images/.
 *
 *   cd packages/app && npx vite build
 *   (cd packages/app/dist && python3 -m http.server 8099 &)
 *   npm i -D playwright   # browsers come from PLAYWRIGHT_BROWSERS_PATH
 *   node scripts/screenshots.mjs
 *
 * Checked in so the images can be refreshed rather than re-derived by hand
 * every time the UI moves — a stale screenshot is worse than none, and the
 * only defence is making the regeneration a single command.
 *
 * The renderer is a plain web app — @openharness/core has no Node dependency
 * and is bundled straight in (see electron/main.ts's header) — so it can be
 * driven in Chromium directly. Only `window.openharness`, the preload bridge,
 * is Electron-specific, and it is stubbed below; the example document is
 * inlined at build time and needs none of it.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(root, 'docs', 'images');
const CHROME = process.env.OPENHARNESS_CHROME
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2, // retina-sharp on GitHub's 2x displays
});

// Stub the preload bridge so nothing throws if a handler is reached.
await page.addInitScript(() => {
  window.openharness = {
    pickFile: async () => null,
    saveFile: async () => null,
    platform: 'linux',
  };
});

await page.goto('http://localhost:8099/index.html', { waitUntil: 'networkidle' });

// Empty state → load the bundled example.
await page.getByRole('button', { name: 'Open example harness' }).click();
await page.waitForTimeout(600);

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`wrote ${OUT}/${name}.png`);
}

/** Single-pane mode exposes its view as tab buttons, and the split layouts as
 * a per-pane <select>. Screenshots use the tabs. */
async function setSinglePane(view) {
  await page.getByRole('button', { name: 'Single pane' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: view, exact: true }).click();
  await page.waitForTimeout(400);
  // Both canvases open at 1:1 on whatever the document's coordinates happen
  // to be, so without this the shot is a close-up of empty grid.
  // Click twice: the first fit can run against a container that has only
  // just been laid out, so the second one sees the real size.
  const fit = page.getByRole('button', { name: 'Fit view' });
  if (await fit.count()) {
    await fit.first().click();
    await page.waitForTimeout(400);
    await fit.first().click();
    await page.waitForTimeout(500);
  }
}

// 1. Schematic — the pane people picture when they hear "harness CAD".
await setSinglePane('Schematic');
await shot('schematic');

// 2. Layout — the redesigned pane: tool switcher, route health, bundles.
await setSinglePane('Layout');
await shot('layout');

// 3. The split view, which is the app's actual argument: edit one pane,
//    watch the other follow.
await page.getByRole('button', { name: 'Split into quarters' }).click();
await page.waitForTimeout(600);

// Each pane in quad mode carries its own <select>. Set them explicitly —
// otherwise they inherit whatever the single-pane shots left behind.
// Panes' own view selects are the only ones offering 'schematic' — BOM part
// assignment and Overview settings dropdowns also match a bare 'select'.
// Re-query each round: switching a pane re-renders it, invalidating handles.
const wanted = ['schematic', 'layout', 'table', 'bom'];
for (let i = 0; i < wanted.length; i++) {
  const paneSelects = [];
  for (const sel of await page.locator('select:visible').all()) {
    const values = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    if (values.includes('schematic') && values.includes('bom')) paneSelects.push(sel);
  }
  if (paneSelects[i]) {
    await paneSelects[i].selectOption(wanted[i]);
    await page.waitForTimeout(300);
  }
}
await page.waitForTimeout(400);
for (const b of await page.getByRole('button', { name: 'Fit view' }).all()) {
  await b.click();
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);
await shot('panes');

// 4. The routing gesture mid-drag: preview line following the cursor, valid
//    drop targets ringed, invalid ones dimmed. This is the feature, so it
//    gets its own shot rather than being left to the prose to describe.
await setSinglePane('Layout');
// The tool switcher is a radiogroup, so these are radios, not buttons.
await page.getByRole('radio', { name: 'Route', exact: true }).click();
await page.waitForTimeout(300);

// Find C1's on-screen centre from its own <title> rather than guessing at
// fractions of the viewport — the fitted scale depends on the window size.
const c1 = await page.evaluate(() => {
  const t = [...document.querySelectorAll('svg title')].find((n) => n.textContent.startsWith('C1 —'));
  const r = t?.parentElement?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (!c1) throw new Error('could not locate C1');

// Drag out toward C2. C1 is already bundled to BP1, so BP1 is not a legal
// second bundle and stays dim while C2 and C3 ring up — which is exactly the
// behaviour worth showing.
await page.mouse.move(c1.x, c1.y);
await page.mouse.down();
await page.mouse.move(c1.x + 420, c1.y - 220, { steps: 25 });
await page.waitForTimeout(400);
await shot('routing');
await page.mouse.up();

await browser.close();
