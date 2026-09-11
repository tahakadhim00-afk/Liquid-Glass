/**
 * Frost must behave like a rough glass SURFACE, not like frosted plastic.
 *
 *   1. it blurs, and more frost means strictly less surviving detail
 *   2. it does NOT lift brightness (no milky haze)
 *   3. it does NOT desaturate
 *   4. the blur stays smooth - no sampling grain at wide radii
 *
 * (2) and (3) are the regression this file exists for: modelling a thin
 * etched surface as if it were a scattering volume washed the backdrop
 * toward white and drained its colour, so any strong frost turned the
 * scene into flat grey fog. See RESEARCH.md section 16.
 *
 * Lighting is switched off for the measurements. The rim, Fresnel and
 * specular terms lay a smooth brightness ramp across the panel, and as
 * blur flattens the backdrop that ramp becomes most of the remaining
 * signal - which reads as rising "detail" even when the blur is perfectly
 * clean. Isolating the backdrop is what makes the numbers mean something.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const rect = await page.evaluate(() => {
  document.getElementById('panel-controls').style.display = 'none';
  const p = window.__panel;
  p.setOption('motion', 0);
  p.setOption('followPointer', false);
  // A wide, shallow panel over the busiest part of the scene.
  p.rect.x = 120; p.rect.y = 300; p.rect.width = 640; p.rect.height = 190;
  p.setOption('radius', 95);
  p.setOption('splay', 0);
  // Isolate the backdrop: no lighting, no tint, no dispersion.
  p.setOption('specular', 0);
  p.setOption('lightIntensity', 0);
  p.setOption('tint', 0);
  p.setOption('dispersion', 0);
  p.setOption('saturation', 1.0);
  p.hit.querySelector('.lg-content').style.visibility = 'hidden';
  return p.rect;
});

async function measure() {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ b64, rect }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const at = (x, y) => { const i = (c.width * y + x) << 2; return [d[i], d[i + 1], d[i + 2]]; };
    const lum = (x, y) => { const p3 = at(x, y); return (p3[0] + p3[1] + p3[2]) / 3; };

    const x0 = Math.round(rect.x + 90), x1 = Math.round(rect.x + rect.width - 90);
    const y0 = Math.round(rect.y + 55), y1 = Math.round(rect.y + rect.height - 55);

    let edge = 0, n = 0, mean = 0, sat = 0;
    // Grain: absolute second difference along a row. A smooth blur gives
    // a near-zero value; sparse tap sampling spikes it.
    let grain = 0, gn = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const v = lum(x, y);
        edge += Math.abs(4 * v - lum(x - 2, y) - lum(x + 2, y) - lum(x, y - 2) - lum(x, y + 2));
        n++; mean += v;
        const [r, g, b] = at(x, y);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        sat += mx === 0 ? 0 : (mx - mn) / mx;
      }
      for (let x = x0 + 2; x < x1 - 2; x += 2) {
        grain += Math.abs(2 * lum(x, y) - lum(x - 2, y) - lum(x + 2, y));
        gn++;
      }
    }
    return {
      detail: +(edge / n).toFixed(2),
      meanLum: +(mean / n).toFixed(1),
      saturation: +(sat / n).toFixed(3),
      grain: +(grain / gn).toFixed(3),
    };
  }, { b64, rect });
}

const levels = [0, 0.1, 0.21, 0.35, 0.5, 0.75, 1.0];
const rows = [];
console.log('frost   detail   meanLum   satur.   grain');
for (const f of levels) {
  await page.evaluate((v) => window.__panel.setOption('frost', v), f);
  await page.waitForTimeout(600);
  const m = await measure();
  rows.push([f, m]);
  console.log(
    String(f).padEnd(7),
    String(m.detail).padStart(6),
    String(m.meanLum).padStart(9),
    String(m.saturation).padStart(8),
    String(m.grain).padStart(7),
  );
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${name}: ${ok ? 'PASS' : `FAIL (${detail})`}`);
  if (!ok) failures++;
};

const base = rows[0][1];
const full = rows[rows.length - 1][1];

// 1. frost blurs: strong frost must destroy most fine detail.
check('frost blurs the backdrop', full.detail < base.detail * 0.5,
  `detail ${base.detail} -> ${full.detail}`);

// 2. no milky haze: brightness must stay put. This is the core fix - the
//    old milky term lifted mean luminance by tens of levels.
const lift = Math.abs(full.meanLum - base.meanLum);
check('frost does not lift brightness', lift < 4,
  `meanLum ${base.meanLum} -> ${full.meanLum}`);

// 3. no saturation FILTER. Averaging a multicoloured scene moves colours
//    toward the local mean, so some loss is inherent to any blur - a plain
//    canvas blur(120px) of this same backdrop loses ~17%. The regression
//    guarded here is the explicit mix(1.0, 0.82, frost) that used to stack
//    on top of that, so the budget is set just above the inherent loss.
check('frost applies no extra desaturation', full.saturation > base.saturation * 0.78,
  `sat ${base.saturation} -> ${full.saturation}, budget ${(base.saturation * 0.78).toFixed(3)}`);

// 4. the blur stays smooth. Compared across the BLURRED levels only:
//    frost 0 is unblurred, so it holds the scene's own detail and would
//    trivially be the maximum. Grain must not climb back toward that as
//    the radius widens - which is exactly what a too-sparse tap pattern
//    does, and what the mip-LOD choice exists to prevent.
//    A converged gaussian keeps flattening as the radius grows, so grain
//    must never climb back up once blurring has started. The sparse-disc
//    version failed exactly here: it bottomed out around 0.43 and then
//    rose to 1.10 at full frost as the taps spread apart.
const blurred = rows.filter(([f]) => f > 0).map(([, m]) => m.grain);
const worstGrain = Math.max(...blurred);
const bestGrain = Math.min(...blurred);
check('blur is free of sampling grain', worstGrain < base.grain * 0.3,
  `worst blurred grain ${worstGrain} vs unblurred ${base.grain}`);
// The real tell: heavy frost must not be grainier than light frost.
check('grain does not grow with radius', full.grain <= bestGrain * 1.15,
  `grain at full frost ${full.grain} vs best ${bestGrain}`);

await browser.close();
process.exit(failures ? 1 : 0);
