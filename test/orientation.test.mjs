import { chromium } from 'playwright';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:1280,height:800}, deviceScaleFactor:1 });
page.on('pageerror', e=>console.log('ERR',e.message));
await page.goto('http://localhost:5173/playground.html', {waitUntil:'networkidle'});
await page.waitForTimeout(1800);

const r = await page.evaluate(() => new Promise(res => {
  const p = window.__panel;
  // Neutralise everything except the geometry mapping.
  p.setOption('frost',0); p.setOption('dispersion',0); p.setOption('specular',0);
  p.setOption('tint',0); p.setOption('saturation',1); p.setOption('motion',0);
  // The playground opens on the water drop, whose whole face curves. The
  // probes below need a bevelled sheet with a flat top, so set one.
  p.setOption('splay',0); p.setOption('bevel',34); p.setOption('radius',44);
  p.setOption('thickness',46); p.setOption('bevelPower',4); p.setOption('profile',0.5);
  p.rect.x=440; p.rect.y=290;
  const gl=p.renderer.gl, c=p.canvas;
  const orig=p.renderer.render.bind(p.renderer);
  p.renderer.render=(rect,t)=>{
    orig(rect,t);
    const read=(x,yTop)=>{const px=new Uint8Array(4);
      gl.readPixels(Math.round(x), Math.round(c.height-yTop),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
      return [px[0],px[1],px[2]];};
    // Backdrop pixels (what SHOULD appear, roughly, at panel centre)
    const b=p.backdrop.canvas.getContext('2d');
    const bp=(x,y)=>{const d=b.getImageData(x,y,1,1).data;return [d[0],d[1],d[2]];};
    const cx=rect.x+rect.width/2, cy=rect.y+rect.height/2;
    p.renderer.render=orig;
    res({
      // At the exact centre the bevel is flat -> refraction ~0 -> glass
      // pixel should closely match the backdrop pixel underneath it.
      centre_glass: read(cx,cy), centre_backdrop: bp(Math.round(cx),Math.round(cy)),
      // 40px above centre, still on the flat top
      up_glass: read(cx,cy-40), up_backdrop: bp(Math.round(cx),Math.round(cy-40)),
      down_glass: read(cx,cy+40), down_backdrop: bp(Math.round(cx),Math.round(cy+40)),
      left_glass: read(cx-120,cy), left_backdrop: bp(Math.round(cx-120),Math.round(cy)),
    });
  };
}));
// On the flat top of the panel the bevel slope is ~0, so refraction is
// negligible and each glass pixel must match the backdrop directly BEHIND
// it. If the sampling axes are flipped, `up` matches `down` instead - the
// bug that rendered the backdrop text upside-down and mirrored.
const dist=(a,b)=>Math.round(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]));
let fail=0;
for (const k of ['centre','up','down','left']) {
  const d=dist(r[k+'_glass'], r[k+'_backdrop']);
  const ok = d <= 20;
  if (!ok) fail++;
  console.log(`${k.padEnd(7)} dist=${String(d).padStart(3)}  ${ok?'PASS':'FAIL'}`);
}
// Explicit mirror check: glass-above must not match backdrop-below.
const crossed = dist(r.up_glass, r.down_backdrop) < dist(r.up_glass, r.up_backdrop);
console.log(`vertical axis   ${crossed ? 'FAIL (mirrored)' : 'PASS (upright)'}`);
if (crossed) fail++;
await browser.close();
process.exit(fail ? 1 : 0);
