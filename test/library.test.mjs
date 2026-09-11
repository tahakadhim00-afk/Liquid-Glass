/**
 * The library's contract.
 *
 * These are the guarantees a real website depends on. They are deliberately
 * about *integration*, not optics - the shader's physics is covered by
 * lens/light/frost, and duplicating it here would only couple the suites.
 *
 * What matters for reuse:
 *   1. attaching does not disturb the host's content, layout or a11y
 *   2. profiles resolve, inherit, and can be overridden per instance
 *   3. the material adopts the host's real geometry
 *   4. destroy() leaves no trace
 *   5. several instances coexist
 *   6. the effect actually changes pixels (it is wired up, not inert)
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${name}: ${ok ? 'PASS' : `FAIL (${detail})`}`);
  if (!ok) failures++;
};

/* --- 1. non-intrusive attachment ------------------------------------ */
const attach = await page.evaluate(() => {
  const card = document.querySelector('[data-glass="apple"]');
  const layer = card.querySelector('.lg-layer');
  return {
    contentIntact: ['tagline', 'H2', 'P'].every((n) =>
      [...card.children].some((c) => c.className === n || c.tagName === n)),
    layerIsFirst: card.firstElementChild === layer,
    ariaHidden: layer?.getAttribute('aria-hidden'),
    pointerEvents: getComputedStyle(layer).pointerEvents,
    // The host must remain focusable/interactive exactly as before.
    hostTabIndex: card.getAttribute('tabindex'),
    hostRole: card.getAttribute('role'),
  };
});
check('content is preserved', attach.contentIntact, JSON.stringify(attach));
check('effect layer is inert', attach.ariaHidden === 'true' && attach.pointerEvents === 'none',
  `aria-hidden=${attach.ariaHidden} pointer-events=${attach.pointerEvents}`);
check('no a11y attributes imposed', attach.hostTabIndex === null && attach.hostRole === null,
  `tabindex=${attach.hostTabIndex} role=${attach.hostRole}`);

/* --- 2. profiles ----------------------------------------------------- */
const profiles = await page.evaluate(() => {
  const { LiquidGlass, resolveProfile, registerProfile } = window.__lg;
  const host = document.createElement('div');
  host.style.cssText = 'width:200px;height:120px;border-radius:18px';
  document.body.appendChild(host);

  const g = new LiquidGlass(host, { profile: 'crystal', ior: 2.05 });
  const overridden = g.getParams().ior;
  const inherited = g.getParams().dispersion;      // from crystal, untouched
  g.setProfile('subtle');
  const afterSwitch = g.getParams().ior;

  registerProfile('t-brand', { extends: 'apple', ior: 1.61 });
  const brand = resolveProfile('t-brand');

  g.destroy();
  host.remove();
  return {
    overridden, inherited, afterSwitch,
    brandIor: brand.ior, brandFrost: brand.frost,
    baseFrost: resolveProfile('apple').frost,
  };
});
check('per-instance override beats profile', profiles.overridden === 2.05,
  `ior=${profiles.overridden}`);
check('unoverridden values come from the profile', profiles.inherited === 0.075,
  `dispersion=${profiles.inherited}`);
check('setProfile switches the material', profiles.afterSwitch === 1.18,
  `ior=${profiles.afterSwitch}`);
check('registerProfile inherits its parent',
  profiles.brandIor === 1.61 && profiles.brandFrost === profiles.baseFrost,
  `ior=${profiles.brandIor} frost=${profiles.brandFrost}`);

/* --- 2b. intensity ---------------------------------------------------
   The master gain must scale the strength terms as a group while leaving
   the profile's identity - its shape - alone, or it would be switching
   materials rather than turning one up. */
const intensity = await page.evaluate(() => {
  const { applyIntensity, resolveProfile } = window.__lg;
  const base = resolveProfile('apple');
  const up = applyIntensity({ ...base, intensity: 2 });
  const down = applyIntensity({ ...base, intensity: 0 });
  return {
    // IOR scales about air (1.0), not about zero.
    iorUp: up.ior, baseIor: base.ior,
    thicknessUp: up.thickness, baseThickness: base.thickness,
    // Shape must be untouched.
    radiusUp: up.radius, baseRadius: base.radius,
    bevelUp: up.bevel, baseBevel: base.bevel,
    // 0 means "no glass": IOR back to air, no displacement.
    iorZero: down.ior, thicknessZero: down.thickness,
    // Frost is a 0..1 ratio and must not overflow it.
    frostClamped: applyIntensity({ ...base, intensity: 99 }).frost,
    // Identity at 1.
    identity: applyIntensity({ ...base, intensity: 1 }).ior === base.ior,
  };
});
check('intensity scales IOR about air',
  Math.abs(intensity.iorUp - (1 + (intensity.baseIor - 1) * 2)) < 1e-9,
  `ior=${intensity.iorUp}`);
check('intensity scales displacement',
  intensity.thicknessUp === intensity.baseThickness * 2,
  `thickness=${intensity.thicknessUp}`);
check('intensity leaves shape alone',
  intensity.radiusUp === intensity.baseRadius && intensity.bevelUp === intensity.baseBevel,
  `radius=${intensity.radiusUp} bevel=${intensity.bevelUp}`);
check('intensity 0 is plain air',
  intensity.iorZero === 1 && intensity.thicknessZero === 0,
  `ior=${intensity.iorZero} thickness=${intensity.thicknessZero}`);
check('frost stays within 0..1', intensity.frostClamped <= 1,
  `frost=${intensity.frostClamped}`);
check('intensity 1 is the identity', intensity.identity);

/* --- 3. geometry adoption ------------------------------------------- */
const geom = await page.evaluate(async () => {
  const { LiquidGlass } = window.__lg;
  const host = document.createElement('div');
  // A radius the profile does not specify, to prove the host wins.
  host.style.cssText = 'width:240px;height:140px;border-radius:31px';
  document.body.appendChild(host);
  const g = new LiquidGlass(host, { profile: 'apple' });
  const adopted = g.getParams().radius;
  // Resizing must be picked up without the caller doing anything.
  host.style.width = '400px';
  await new Promise((r) => setTimeout(r, 250));
  const after = g._geom?.width;
  g.destroy();
  host.remove();
  return { adopted, after };
});
check('adopts the host CSS radius', geom.adopted === 31, `radius=${geom.adopted}`);
check('tracks host resize', Math.round(geom.after) === 400, `width=${geom.after}`);

/* --- 4. clean teardown ----------------------------------------------- */
const teardown = await page.evaluate(() => {
  const { LiquidGlass } = window.__lg;
  const host = document.createElement('div');
  host.style.cssText = 'width:200px;height:120px';
  host.innerHTML = '<p id="keepme">content</p>';
  document.body.appendChild(host);

  const svgBefore = document.querySelectorAll('svg[aria-hidden]').length;
  const g = new LiquidGlass(host, { profile: 'apple' });
  const during = {
    layers: host.querySelectorAll('.lg-layer').length,
    position: host.style.position,
  };
  g.destroy();
  const after = {
    layers: host.querySelectorAll('.lg-layer').length,
    hasClass: host.classList.contains('lg-host'),
    backdropFilter: host.style.backdropFilter,
    position: host.style.position,
    contentKept: !!host.querySelector('#keepme'),
    svgLeaked: document.querySelectorAll('svg[aria-hidden]').length - svgBefore,
  };
  host.remove();
  return { during, after };
});
check('destroy removes every layer', teardown.after.layers === 0,
  `layers=${teardown.after.layers}`);
check('destroy restores the host', !teardown.after.hasClass &&
  !teardown.after.backdropFilter && teardown.after.position === '',
  JSON.stringify(teardown.after));
check('destroy keeps host content', teardown.after.contentKept);
check('destroy leaks no filter defs', teardown.after.svgLeaked === 0,
  `leaked=${teardown.after.svgLeaked}`);

/* --- 5. coexistence --------------------------------------------------- */
const many = await page.evaluate(() => {
  const hosts = document.querySelectorAll('.lg-host');
  const filters = [...document.querySelectorAll('filter')].map((f) => f.id);
  return {
    count: hosts.length,
    uniqueFilters: new Set(filters).size === filters.length,
    filterCount: filters.length,
  };
});
check('many instances coexist', many.count >= 6, `count=${many.count}`);
check('filter ids do not collide', many.uniqueFilters, `n=${many.filterCount}`);

/* --- 6. the effect is actually applied -------------------------------- */
// The strongest available check without asserting exact optics: turning the
// material off must change the pixels under a panel. If the library were
// inert this is the test that would catch it.
const box = await page.evaluate(() => {
  const c = document.querySelector('[data-glass="crystal"]').getBoundingClientRect();
  return { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) };
});
const shotOn = await page.screenshot({ clip: box });
await page.evaluate(() => {
  for (const el of document.querySelectorAll('.lg-host')) {
    el.style.backdropFilter = 'none';
    el.style.webkitBackdropFilter = 'none';
  }
});
await page.waitForTimeout(350);
const shotOff = await page.screenshot({ clip: box });
const differs = !shotOn.equals(shotOff);
check('material visibly changes the backdrop', differs,
  'identical pixels with the effect on and off');

console.log('page errors:', errors.length ? errors : 'none');
check('no runtime errors', errors.length === 0, errors.join('; '));

await browser.close();
process.exit(failures ? 1 : 0);
