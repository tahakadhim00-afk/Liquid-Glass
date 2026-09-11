/**
 * The border gradient must be driven by the light SOURCE, not baked in.
 *
 * Asserts three things a static CSS gradient could not do:
 *   1. moving a positional lamp sweeps the bright band round the border
 *   2. distance falloff dims the border as the lamp retreats
 *   3. the light's colour tints the lit edge
 *
 * Brightness is read from a page screenshot rather than the WebGL canvas:
 * reading back the drawing buffer after the frame has been presented
 * returns an empty buffer, so it would report zero regardless.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173/playground.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const rect = await page.evaluate(() => {
  document.getElementById('panel-controls').style.display = 'none';
  const p = window.__panel;
  // Freeze everything that would otherwise perturb a brightness probe.
  p.setOption('followPointer', false);
  p.setOption('motion', 0);
  p.setOption('lightMode', 1);       // positional lamp
  p.setOption('lightRange', 0);      // no falloff yet: isolate direction
  p.setOption('lightAmbient', 0);
  p.setOption('lightIntensity', 2.2);
  p.setOption('lightRadius', 0.2);
  p.setOption('lightColor', [1, 1, 1]);
  return p.rect;
});

const cx = rect.x + rect.width / 2;
const cy = rect.y + rect.height / 2;

async function apply(options, pos) {
  await page.evaluate(({ options, pos }) => {
    const p = window.__panel;
    for (const [k, v] of Object.entries(options)) p.setOption(k, v);
    if (pos) { p.lightPosTarget = pos; p.lightPos = [...pos]; }
  }, { options, pos });
  await page.waitForTimeout(520);   // let the light spring settle
}

/** Mean RGB of the four border edges, from a composited screenshot. */
async function readEdges() {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ b64, rect, cx, cy }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const px = (x, y) => {
      const i = (c.width * Math.round(y) + Math.round(x)) << 2;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const avg = (pts) => {
      const s = pts.reduce((a, [x, y]) => {
        const [r, g, b] = px(x, y);
        return [a[0] + r, a[1] + g, a[2] + b];
      }, [0, 0, 0]);
      return s.map((v) => v / pts.length);
    };
    const lum = (c3) => (c3[0] + c3[1] + c3[2]) / 3;
    const L = avg([[rect.x + 4, cy - 40], [rect.x + 4, cy], [rect.x + 4, cy + 40]]);
    const R = avg([[rect.x + rect.width - 4, cy - 40], [rect.x + rect.width - 4, cy], [rect.x + rect.width - 4, cy + 40]]);
    const T = avg([[cx - 60, rect.y + 4], [cx, rect.y + 4], [cx + 60, rect.y + 4]]);
    const B = avg([[cx - 60, rect.y + rect.height - 4], [cx, rect.y + rect.height - 4], [cx + 60, rect.y + rect.height - 4]]);
    return { L: lum(L), R: lum(R), T: lum(T), B: lum(B), Trgb: T };
  }, { b64, rect, cx, cy });
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${name}: ${ok ? 'PASS' : `FAIL (${detail})`}`);
  if (!ok) failures++;
};

// --- 1. the bright band follows the lamp ------------------------------
console.log('border brightness per lamp position (L/R/T/B):');
const places = {
  L: [rect.x - 400, cy],
  R: [rect.x + rect.width + 400, cy],
  T: [cx, rect.y - 400],
  B: [cx, rect.y + rect.height + 400],
};
for (const [expect, pos] of Object.entries(places)) {
  await apply({}, pos);
  const e = await readEdges();
  const brightest = ['L', 'R', 'T', 'B'].sort((a, b) => e[b] - e[a])[0];
  console.log(`  lamp@${expect}  L=${e.L.toFixed(0)} R=${e.R.toFixed(0)} T=${e.T.toFixed(0)} B=${e.B.toFixed(0)}`);
  check(`  brightest edge is ${expect}`, brightest === expect, `was ${brightest}`);
}

// --- 2. distance falloff ----------------------------------------------
await apply({ lightRange: 400 }, [cx, rect.y - 150]);
const near = (await readEdges()).T;
await apply({ lightRange: 400 }, [cx, rect.y - 1400]);
const far = (await readEdges()).T;
console.log(`falloff: near=${near.toFixed(1)} far=${far.toFixed(1)}`);
check('distant lamp dims the border', far < near - 3, `near ${near.toFixed(1)} vs far ${far.toFixed(1)}`);

// --- 3. light colour tints the lit edge -------------------------------
await apply({ lightRange: 0, lightIntensity: 2.4, lightColor: [1.0, 0.4, 0.1] }, [cx, rect.y - 300]);
const warm = (await readEdges()).Trgb;
await apply({ lightColor: [0.1, 0.4, 1.0] }, [cx, rect.y - 300]);
const cool = (await readEdges()).Trgb;
console.log(`warm edge rgb=[${warm.map((v) => v.toFixed(0))}]  cool edge rgb=[${cool.map((v) => v.toFixed(0))}]`);
// Warm light must push red above blue relative to a cool light.
const warmBias = warm[0] - warm[2];
const coolBias = cool[0] - cool[2];
check('light colour tints the border', warmBias > coolBias + 5,
  `warm r-b ${warmBias.toFixed(1)} vs cool r-b ${coolBias.toFixed(1)}`);

/* --- 4. corner light --------------------------------------------------
   `cornerLight` must brighten the rounded corners and ONLY those. The
   straight edges are the control: if they move too, the term is leaking
   down the sides and the panel would read as uniformly hot rather than
   catching light where the bevel actually turns. */
const R = 60;
await page.evaluate((R) => {
  const p = window.__panel;
  p.setOption('lightMode', 0);        // directional: no positional falloff
  p.setOption('lightAmbient', 0.5);   // lift the whole rim so both probes read
  p.setOption('lightIntensity', 2.0);
  p.setOption('lightColor', [1, 1, 1]);
  p.setOption('radius', R);
}, R);
await page.waitForTimeout(500);

/** Mean luminance of a small box in a composited screenshot. */
async function probe(boxes) {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ b64, boxes }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    return boxes.map(({ x, y, r }) => {
      let sum = 0, n = 0;
      for (let j = y - r; j <= y + r; j++) {
        for (let i = x - r; i <= x + r; i++) {
          const o = (j * c.width + i) * 4;
          sum += 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
          n++;
        }
      }
      return sum / n;
    });
  }, { b64, boxes });
}

// A point on the corner arc at 45 degrees, and the middle of the top edge,
// both the same few px inside the contour so only the corner term differs.
const k = R - R / Math.SQRT2;
const cornerBox = { x: Math.round(rect.x + k + 4), y: Math.round(rect.y + k + 4), r: 3 };
const edgeBox = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + 5), r: 3 };

await apply({ cornerLight: 1 });
const [corner1, edge1] = await probe([cornerBox, edgeBox]);
await apply({ cornerLight: 3 });
const [corner3, edge3] = await probe([cornerBox, edgeBox]);

console.log(`corner ${corner1.toFixed(1)} -> ${corner3.toFixed(1)}   `
          + `edge ${edge1.toFixed(1)} -> ${edge3.toFixed(1)}`);
check('cornerLight brightens the corners', corner3 > corner1 + 2,
  `${corner1.toFixed(1)} -> ${corner3.toFixed(1)}`);
check('cornerLight spares the straight edges', Math.abs(edge3 - edge1) < 2,
  `${edge1.toFixed(1)} -> ${edge3.toFixed(1)}`);

await browser.close();
process.exit(failures ? 1 : 0);
