/**
 * The parameter contract.
 *
 * Every parameter the README documents as overridable must actually be
 * overridable, by all three routes a caller has: at construction, at
 * runtime via set(), and through a registered profile. "Wired up" is not
 * enough - a typo'd uniform name or a missing branch in a tier adapter
 * leaves the call silently inert, which is the failure this catches.
 *
 * The assertion is rendered pixels, not internal state: reading back
 * getParams() would pass even if the value never reached the shader.
 *
 * Runs on the WebGL tier, because four of the parameters (splay, specular,
 * tint, motion) need per-pixel lighting and are deliberately inert on the
 * CSS tiers - that split is part of the documented contract, so asserting
 * them on whichever tier the test machine happens to pick would fail for
 * a reason that is not a defect. A backdrop source is what opts in.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5173/harness.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Each documented parameter, with a value far enough from the default to
// move pixels. Shape params move geometry; optical ones move colour.
const CASES = [
  ['ior',        2.2],
  ['thickness',  10],
  ['bevel',      12],
  ['bevelPower', 8.0],
  ['surface',    1.0],
  ['splay',      1.0],
  ['dispersion', 0.35],
  ['frost',      0.9],
  ['specular',   0.0],
  ['saturation', 0.0],
  ['tint',       1.0],
  ['radius',     4],
  // Every other case is measured against a motion:0 baseline so the wobble
  // cannot make an unrelated case pass by moving pixels on its own. That
  // makes 0 the wrong probe for motion itself - it would be a no-op - so
  // this one drives the wobble hard instead.
  ['motion',     4.0],
];

// A stage with hard-edged detail behind the panel: refraction is only
// visible over texture, so a flat ground would make every case look
// identical and the whole suite would pass vacuously.
const BOX = { x: 150, y: 120, width: 600, height: 360 };

await page.evaluate((box) => {
  document.body.style.margin = '0';
  const stage = document.createElement('div');
  stage.id = 'pstage';
  stage.style.cssText =
    'position:fixed;left:0;top:0;width:900px;height:600px;overflow:hidden;z-index:99999;' +
    'background:repeating-linear-gradient(45deg,#fff 0 14px,#0a2540 14px 28px);';
  document.body.appendChild(stage);

  const host = document.createElement('div');
  host.id = 'phost';
  host.style.cssText =
    `position:absolute;left:${box.x}px;top:${box.y}px;` +
    `width:${box.width}px;height:${box.height}px;border-radius:0;`;
  stage.appendChild(host);

  // The backdrop the WebGL tier samples. Same hard-edged pattern as the
  // stage, drawn into a canvas the library can read as a texture - a
  // browser will not hand anyone the composited page, so the full shader
  // pipeline is opt-in by supplying the source.
  const bd = document.createElement('canvas');
  bd.width = 900;
  bd.height = 600;
  const ctx = bd.getContext('2d');
  ctx.fillStyle = '#0a2540';
  ctx.fillRect(0, 0, 900, 600);
  ctx.fillStyle = '#ffffff';
  for (let i = -600; i < 900; i += 28) {
    ctx.save();
    ctx.translate(i, 0);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(0, -400, 14, 1600);
    ctx.restore();
  }
  window.__backdrop = bd;
}, BOX);

// Long enough for a parameter change to reach the next drawn frame. The
// wobble is a travelling wave, so `motion` needs a longer wait than a
// static parameter before its effect is on screen.
const settle = (key) => page.waitForTimeout(key === 'motion' ? 700 : 260);

const differs = (a, b) => {
  if (a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n / a.length;
};

const tier = await page.evaluate(() => {
  const { LiquidGlass } = window.__lg;
  const g = new LiquidGlass(document.getElementById('phost'),
    { motion: 0, backdrop: window.__backdrop });
  window.__t = g;
  return g.tier;
});
await settle();

/* --- 1. runtime: set() on a live instance ---------------------------- */
const runtime = [];
for (const [key, value] of CASES) {
  const before = await page.screenshot({ clip: BOX });
  await page.evaluate(([k, v]) => window.__t.set(k, v), [key, value]);
  await settle(key);
  const after = await page.screenshot({ clip: BOX });
  runtime.push({ key, changed: differs(before, after) });

  // Reset from the profile so each case starts from the same state.
  await page.evaluate(() => { window.__t.setProfile('water'); window.__t.set('motion', 0); });
  await settle();
}
await page.evaluate(() => { window.__t.destroy(); delete window.__t; });
await settle();

/* --- 2. construction: new LiquidGlass(el, { key: value }) ------------- */
const mount = (opts) => page.evaluate((o) => {
  const { LiquidGlass } = window.__lg;
  window.__t = new LiquidGlass(document.getElementById('phost'),
    { motion: 0, backdrop: window.__backdrop, ...o });
}, opts);
const unmount = () => page.evaluate(() => { window.__t.destroy(); delete window.__t; });

await mount({});
await settle();
const baseShot = await page.screenshot({ clip: BOX });
await unmount();
await settle();

const construct = [];
for (const [key, value] of CASES) {
  await mount({ [key]: value });
  await settle(key);
  construct.push({ key, changed: differs(baseShot, await page.screenshot({ clip: BOX })) });
  await unmount();
  await settle();
}

/* --- 3. profile: registerProfile then use it by name ------------------ */
const profile = [];
for (const [key, value] of CASES) {
  await page.evaluate(([k, v]) => {
    const { LiquidGlass, registerProfile } = window.__lg;
    registerProfile(`t_${k}`, { extends: 'water', motion: 0, [k]: v });
    window.__t = new LiquidGlass(document.getElementById('phost'),
      { profile: `t_${k}`, backdrop: window.__backdrop });
  }, [key, value]);
  await settle(key);
  profile.push({ key, changed: differs(baseShot, await page.screenshot({ clip: BOX })) });
  await unmount();
  await settle();
}

/* --- report ----------------------------------------------------------- */
console.log(`tier: ${tier}`);

let failed = 0;
const THRESHOLD = 0.002;   // 0.2% of bytes must differ

const report = (label, rows) => {
  console.log(`\n--- ${label} ---`);
  for (const { key, changed } of rows) {
    const ok = changed > THRESHOLD;
    if (!ok) failed++;
    console.log(`${key.padEnd(12)} ${(changed * 100).toFixed(2).padStart(7)}%  ${ok ? 'PASS' : 'FAIL'}`);
  }
};

report('runtime set()', runtime);
report('construction', construct);
report('registerProfile', profile);

if (errors.length) {
  console.log('\npage errors:');
  for (const e of errors) console.log('  ' + e);
  failed++;
}

console.log(`\n${failed === 0
  ? 'every documented parameter is live: PASS'
  : `${failed} parameter check(s) FAILED`}`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
