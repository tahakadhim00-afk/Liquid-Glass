/**
 * Render targets - one adapter per tier.
 *
 * `LiquidGlass` knows nothing about WebGL, SVG filters or backdrop-filter.
 * It measures a box, tracks a pointer, and calls a small interface:
 *
 *   { animated, draw(geom, t), resize(geom), update(params),
 *     setPointer(pt, geom), setBackdrop(src), destroy() }
 *
 * Every method is optional, so a tier implements only what it can honour.
 * That is what keeps the component free of `if (tier === ...)` branches
 * and what makes a new tier (WebGPU, say) a single added file rather than
 * a rewrite.
 *
 * The tiers differ in one fundamental way, which drives everything else:
 * WebGL needs the backdrop as a *texture it can sample*, while the two CSS
 * tiers are handed the real composited backdrop by the browser. So the
 * WebGL target owns a canvas and a render loop, and the others are static
 * style writers that only touch the DOM when a parameter changes.
 */

import { LiquidGlassRenderer } from '../core/renderer.js';
import { buildDisplacementMap } from '../core/fallback.js';
import { applyIntensity } from './profiles.js';

/**
 * Map library parameters onto the shader's uniform names.
 *
 * The library calls the height-profile blend `surface`, because `profile`
 * at the API level means the whole material preset ("apple", "crystal").
 * The shader predates that distinction and still calls it `profile`, so
 * the rename is absorbed here rather than churning the shader.
 */
function toRendererOptions(params) {
  const { surface, ...rest } = applyIntensity(params);
  return { ...rest, profile: surface };
}

/**
 * @param {'webgl'|'svg'|'blur'|'none'} tier
 * @param {object} ctx  { host, layer, id, params, backdrop }
 */
export function createRenderTarget(tier, ctx) {
  switch (tier) {
    case 'webgl': return new WebGLTarget(ctx);
    case 'svg':   return new SVGTarget(ctx);
    case 'blur':  return new BlurTarget(ctx);
    default:      return new NullTarget(ctx);
  }
}

/* --------------------------------------------------------------------
   WebGL - the full optical pipeline.

   Draws into a canvas sized to the host element and sampled from the
   caller-supplied backdrop. This is the only tier that can do per-pixel
   lighting, so it is the only one where the configurable light source is
   fully meaningful.
   -------------------------------------------------------------------- */
class WebGLTarget {
  animated = true;

  constructor({ layer, params, backdrop }) {
    this.params = params;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    layer.appendChild(this.canvas);

    this.renderer = new LiquidGlassRenderer(this.canvas, toRendererOptions(params));
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    if (backdrop) this.setBackdrop(backdrop);

    // Springs, so a moved light glides instead of snapping.
    this.light = [...params.light];
    this.lightTarget = [...params.light];
  }

  setBackdrop(source) {
    this.source = source;
    this._needsUpload = true;
  }

  update(params) {
    this.params = params;
    Object.assign(this.renderer.options, toRendererOptions(params));
    this.lightTarget = [...params.light];
  }

  setPointer(pt, geom) {
    if (!geom) return;
    // Direction from the panel's centre toward the pointer, normalised to
    // the viewport so the highlight tracks the cursor at any panel size.
    const cx = geom.x + geom.width / 2;
    const cy = geom.y + geom.height / 2;
    const dx = (pt.x - cx) / Math.max(innerWidth, 1) * 2;
    const dy = (pt.y - cy) / Math.max(innerHeight, 1) * 2;
    this.lightTarget = [
      Math.max(-1, Math.min(1, dx * 1.6)),
      Math.max(-1, Math.min(1, dy * 1.6)),
    ];
    // A positional lamp needs a point, in the canvas's own space.
    this.renderer.options.lightPos = [pt.x - geom.x, pt.y - geom.y];
  }

  resize(geom) {
    this.renderer.resize(geom.width, geom.height, this.dpr);
    this._geom = geom;
  }

  draw(geom, t) {
    if (!this.source) return;   // nothing to refract yet

    if (this._needsUpload || this._isLive()) {
      this.renderer.setBackdrop(this._frame());
      this._needsUpload = false;
    }

    // Ease the light toward its target.
    this.light[0] += (this.lightTarget[0] - this.light[0]) * 0.09;
    this.light[1] += (this.lightTarget[1] - this.light[1]) * 0.09;
    this.renderer.options.light = this.light;

    // The canvas covers the host exactly, so the panel is drawn at the
    // canvas origin rather than at its page coordinates.
    this.renderer.render({ x: 0, y: 0, width: geom.width, height: geom.height }, t);
  }

  /** A video keeps changing, so it must be re-uploaded every frame. */
  _isLive() {
    const s = this.source;
    return s instanceof HTMLVideoElement && !s.paused && !s.ended;
  }

  _frame() {
    const s = this.source;
    // A video element is a valid TexImageSource once it has data; before
    // that, uploading throws, so hold the previous frame instead.
    if (s instanceof HTMLVideoElement && s.readyState < 2) return this._last ?? s;
    this._last = s;
    return s;
  }

  destroy() {
    this.renderer.destroy();
    this.canvas.remove();
  }
}

/* --------------------------------------------------------------------
   SVG displacement - real refraction over live DOM.

   `backdrop-filter: url(#id)` hands the filter the composited backdrop,
   so this needs no texture and no render loop: it is a static style whose
   displacement map is rebuilt only when the geometry or optics change.

   Chromium only.
   -------------------------------------------------------------------- */
class SVGTarget {
  animated = false;

  constructor({ host, id, params }) {
    this.host = host;
    this.id = `lg-filter-${id}`;
    this.params = params;

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    document.body.appendChild(this.svg);
  }

  update(params) {
    this.params = params;
    this._dirty = true;
  }

  resize(geom) {
    // Rebuilding a displacement map is expensive (a per-pixel ray
    // simulation), so skip it when the box has not actually changed -
    // scroll fires this constantly.
    const w = Math.round(geom.width), h = Math.round(geom.height);
    if (w === this._w && h === this._h && !this._dirty) return;
    this._w = w; this._h = h;
    this._dirty = true;
    this._geom = geom;
  }

  draw(geom) {
    if (!this._dirty || !geom || geom.width < 1) return;
    this._dirty = false;
    this._build(geom);
  }

  _build(geom) {
    const p = applyIntensity(this.params);
    const dpr = Math.min(devicePixelRatio || 1, 2);

    const { url, scale } = buildDisplacementMap(
      geom.width * dpr, geom.height * dpr,
      p.radius * dpr, p.bevel * dpr, p.bevelPower,
      p.surface, p.ior, p.thickness * dpr,
    );

    // The map is normalised to +/-1, so the simulated maximum IS the
    // filter's scale. Divide out dpr to land back in CSS pixels.
    const s = scale / dpr;
    // Per-channel scales from each channel's own IOR, so blue bends more
    // than red for the same physical reason it does in the shader.
    const chan = (n) => s * ((n - 1) / (p.ior - 1));
    const sR = chan(p.ior - p.dispersion);
    const sB = chan(p.ior + p.dispersion);
    const blur = (Math.pow(p.frost, 1.35) * 130 * 0.35).toFixed(2);

    this.svg.innerHTML = `
      <defs>
        <filter id="${this.id}" x="-25%" y="-25%" width="150%" height="150%"
                color-interpolation-filters="sRGB">
          <feImage href="${url}" result="map" preserveAspectRatio="none"/>
          <feDisplacementMap in="SourceGraphic" in2="map" scale="${sR.toFixed(2)}"
                             xChannelSelector="R" yChannelSelector="G" result="r"/>
          <feColorMatrix in="r" type="matrix" result="rc"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
          <feDisplacementMap in="SourceGraphic" in2="map" scale="${s.toFixed(2)}"
                             xChannelSelector="R" yChannelSelector="G" result="g"/>
          <feColorMatrix in="g" type="matrix" result="gc"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
          <feDisplacementMap in="SourceGraphic" in2="map" scale="${sB.toFixed(2)}"
                             xChannelSelector="R" yChannelSelector="G" result="b"/>
          <feColorMatrix in="b" type="matrix" result="bc"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
          <feBlend in="rc" in2="gc" mode="screen" result="rg"/>
          <feBlend in="rg" in2="bc" mode="screen" result="rgb"/>
          <feGaussianBlur in="rgb" stdDeviation="${blur}"/>
        </filter>
      </defs>`;

    const fx = `url(#${this.id}) saturate(${p.saturation.toFixed(2)})`;
    this.host.style.backdropFilter = fx;
    this.host.style.webkitBackdropFilter = fx;
  }

  destroy() {
    this.svg.remove();
    this.host.style.backdropFilter = '';
    this.host.style.webkitBackdropFilter = '';
  }
}

/* --------------------------------------------------------------------
   CSS blur - universal fallback.

   No refraction: `backdrop-filter: blur()` scatters light rather than
   bending it. The frost radius still maps through the same curve as the
   other tiers, so the material reads as consistently as it can without
   displacement.
   -------------------------------------------------------------------- */
class BlurTarget {
  animated = false;

  constructor({ host, params }) {
    this.host = host;
    this.params = params;
  }

  update(params) { this.params = params; this._apply(); }
  resize() { this._apply(); }
  draw() { this._apply(); }

  _apply() {
    const p = applyIntensity(this.params);
    // Same frost curve as the WebGL tier, halved: a pure blur with no
    // displacement reads as heavier at the same radius.
    const blur = (Math.pow(p.frost, 1.35) * 130 * 0.5).toFixed(1);
    const fx = `blur(${Math.max(blur, 2)}px) saturate(${p.saturation.toFixed(2)})`;
    if (fx === this._last) return;    // avoid pointless style writes on scroll
    this._last = fx;
    this.host.style.backdropFilter = fx;
    this.host.style.webkitBackdropFilter = fx;
  }

  destroy() {
    this.host.style.backdropFilter = '';
    this.host.style.webkitBackdropFilter = '';
  }
}

/* --------------------------------------------------------------------
   None - no backdrop-filter support at all.

   Leaves the host exactly as the page styled it. Returning a working
   no-op rather than throwing means a caller can construct the component
   unconditionally and let progressive enhancement do its job.
   -------------------------------------------------------------------- */
class NullTarget {
  animated = false;
}
