/**
 * LiquidGlassPanel - the interactive element.
 *
 * Owns the panel rectangle, the drag/press interaction, the light
 * direction, and the render loop. Renders through the WebGL renderer when
 * available and degrades to a CSS/SVG tier otherwise.
 */

import { LiquidGlassRenderer, DEFAULTS } from './renderer.js';
import { PaintedBackdrop } from './backdrop.js';
import { detectTier, buildDisplacementMap } from './fallback.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class LiquidGlassPanel {
  constructor(root, options = {}) {
    this.root = root;
    this.options = { ...DEFAULTS, ...options };

    this.tier = options.forceTier || detectTier();

    this.rect = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 380,
      height: options.height ?? 200,
    };

    // Spring state for press/release scaling.
    this.press = 0;
    this.pressTarget = 0;
    this.lightTarget = [...this.options.light];
    this.light = [...this.options.light];

    // The lamp's position gets its own spring, so a moved light glides to
    // its new place instead of snapping - the border gradient then sweeps
    // round the shape, which is what reads as a real source moving.
    const start = this.options.lightPos ?? [
      this.rect.x + this.rect.width / 2,
      this.rect.y + this.rect.height / 2,
    ];
    this.lightPos = [...start];
    this.lightPosTarget = [...start];

    this._buildDOM();
    this._initRenderer();
    this._bindEvents();

    this.frames = 0;
    this.fps = 0;
    this._fpsMark = performance.now();

    this.start();
  }

  _buildDOM() {
    this.layer = document.createElement('div');
    this.layer.className = 'lg-layer';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lg-canvas';
    this.layer.appendChild(this.canvas);

    // The backdrop canvas is the visible page content in this demo.
    this.backdropEl = document.createElement('canvas');
    this.backdropEl.className = 'lg-backdrop';

    // Hit target + content layer, positioned over the glass.
    this.hit = document.createElement('div');
    this.hit.className = 'lg-hit';
    this.hit.setAttribute('tabindex', '0');
    this.hit.setAttribute('role', 'group');
    this.hit.setAttribute('aria-label', 'Liquid glass panel, draggable');
    this.hit.innerHTML = `
      <div class="lg-content">
        <div class="lg-eyebrow">Liquid Glass</div>
        <div class="lg-title">Refraction, not blur</div>
        <div class="lg-sub">Drag me across the background</div>
      </div>`;

    this.root.appendChild(this.backdropEl);
    this.root.appendChild(this.layer);
    this.root.appendChild(this.hit);
  }

  _initRenderer() {
    this.backdrop = new PaintedBackdrop();

    if (this.tier === 'webgl' || this.tier === 'webgl-static') {
      try {
        this.renderer = new LiquidGlassRenderer(this.canvas, this.options);
        if (this.tier === 'webgl-static') this.options.motion = 0;
        return;
      } catch (err) {
        console.warn('[liquid-glass] WebGL init failed, falling back:', err.message);
        this.tier = CSS.supports('backdrop-filter', 'url(#x)') ? 'svg' : 'blur';
      }
    }

    this._initCSSFallback();
  }

  _initCSSFallback() {
    this.canvas.style.display = 'none';
    this.hit.classList.add('lg-fallback');
    this.hit.classList.add(this.tier === 'svg' ? 'lg-fallback-svg' : 'lg-fallback-blur');

    if (this.tier === 'svg') {
      const dpr = window.devicePixelRatio || 1;
      const { url: map, scale } = buildDisplacementMap(
        this.rect.width * dpr, this.rect.height * dpr,
        this.options.radius * dpr, this.options.bevel * dpr,
        this.options.bevelPower, this.options.profile,
        this.options.ior, this.options.thickness * dpr,
      );
      // The map is normalised to +/-1, so the simulated maximum IS the
      // filter's scale: it converts the map back to pixel displacement.
      // Dividing out dpr keeps it in the CSS px that the filter works in.
      const s = scale / dpr;

      // Chromatic dispersion, from the same physics as the WebGL tier:
      // each channel gets its own IOR (blue bends most, as in a prism),
      // and displacement scales roughly with (n - 1), so the per-channel
      // scales follow that ratio instead of arbitrary fixed percentages.
      const disp = this.options.dispersion;
      const chan = (n) => s * ((n - 1) / (this.options.ior - 1));
      const sR = chan(this.options.ior - disp);
      const sG = s;
      const sB = chan(this.options.ior + disp);
      const id = `lg-disp-${Math.random().toString(36).slice(2, 8)}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'lg-filter-defs');
      svg.setAttribute('aria-hidden', 'true');
      // Three displacement passes at different scales = chromatic fringing.
      svg.innerHTML = `
        <defs>
          <filter id="${id}" x="-25%" y="-25%" width="150%" height="150%"
                  color-interpolation-filters="sRGB">
            <feImage href="${map}" result="map" preserveAspectRatio="none"/>
            <feDisplacementMap in="SourceGraphic" in2="map" scale="${sR.toFixed(2)}"
                               xChannelSelector="R" yChannelSelector="G" result="red"/>
            <feColorMatrix in="red" type="matrix" result="redC"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
            <feDisplacementMap in="SourceGraphic" in2="map" scale="${sG.toFixed(2)}"
                               xChannelSelector="R" yChannelSelector="G" result="green"/>
            <feColorMatrix in="green" type="matrix" result="greenC"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
            <feDisplacementMap in="SourceGraphic" in2="map" scale="${sB.toFixed(2)}"
                               xChannelSelector="R" yChannelSelector="G" result="blue"/>
            <feColorMatrix in="blue" type="matrix" result="blueC"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
            <feBlend in="redC" in2="greenC" mode="screen" result="rg"/>
            <feBlend in="rg" in2="blueC" mode="screen" result="rgb"/>
            <feGaussianBlur in="rgb" stdDeviation="${(Math.pow(this.options.frost, 1.35) * 130 * 0.35).toFixed(2)}"/>
          </filter>
        </defs>`;
      document.body.appendChild(svg);
      // Frost is scatter only, matching the WebGL tier: the blur above is
      // the whole effect. No milky overlay and no frost-driven
      // desaturation - a rough surface redistributes light, it does not
      // add white haze or drain colour (see RESEARCH.md 16).
      const fx = `url(#${id}) saturate(${this.options.saturation.toFixed(2)})`;
      this.hit.style.backdropFilter = fx;
      this.hit.style.webkitBackdropFilter = fx;
      this.hit.style.setProperty('--lg-frost', '0');
    }
  }

  _bindEvents() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    // --- drag ---------------------------------------------------------
    let dragging = false;
    let grab = { x: 0, y: 0 };

    const down = (e) => {
      dragging = true;
      this.pressTarget = 1;
      this.hit.setPointerCapture?.(e.pointerId);
      grab.x = e.clientX - this.rect.x;
      grab.y = e.clientY - this.rect.y;
      e.preventDefault();
    };

    const move = (e) => {
      // The light tracks the pointer even when not dragging: highlights
      // that respond to where you are looking sell the material.
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      // uLight points toward the light, in the same y-down space as the
      // pointer, so the highlight follows the cursor rather than fleeing it.
      this.lightTarget = [nx * 0.9, ny * 0.9];
      // A positional lamp needs a point, not a direction: put it under the
      // cursor so dragging the mouse physically moves the source and the
      // border gradient sweeps round the shape in response.
      if (this.options.followPointer !== false) {
        this.lightPosTarget = [e.clientX, e.clientY];
      }

      if (!dragging) return;
      this.rect.x = e.clientX - grab.x;
      this.rect.y = e.clientY - grab.y;
      this._clampRect();
    };

    const up = () => { dragging = false; this.pressTarget = 0; };

    this.hit.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    // --- keyboard -----------------------------------------------------
    this.hit.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 12;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = map[e.key];
      if (!delta) return;
      this.rect.x += delta[0];
      this.rect.y += delta[1];
      this._clampRect();
      e.preventDefault();
    });

    // --- device tilt (mobile) ----------------------------------------
    // Apple drives highlights from the gyroscope; this is the web analogue.
    this._onOrient = (e) => {
      if (e.gamma == null || e.beta == null) return;
      const gx = Math.max(-1, Math.min(1, e.gamma / 45));
      const gy = Math.max(-1, Math.min(1, (e.beta - 45) / 45));
      // Tilting the device right moves the light right, as with a real
      // object held under a fixed overhead light.
      this.lightTarget = [gx * 0.9, gy * 0.9];
    };
    window.addEventListener('deviceorientation', this._onOrient);

    this._onScroll = () => this.backdrop.setScroll(window.scrollY);
    window.addEventListener('scroll', this._onScroll, { passive: true });
  }

  _clampRect() {
    const m = 8;
    this.rect.x = Math.max(m, Math.min(window.innerWidth - this.rect.width - m, this.rect.x));
    this.rect.y = Math.max(m, Math.min(window.innerHeight - this.rect.height - m, this.rect.y));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap: 3x costs a lot for no visible gain

    this.layer.style.width = `${w}px`;
    this.layer.style.height = `${h}px`;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.backdropEl.style.width = `${w}px`;
    this.backdropEl.style.height = `${h}px`;

    this.backdrop.resize(w, h, dpr);
    this.backdrop.invalidate();
    this.renderer?.resize(w, h, dpr);
    this._clampRect();
  }

  setOption(key, value) {
    this.options[key] = value;
    if (this.renderer) this.renderer.options[key] = value;
  }

  start() {
    this.resize();
    this._running = true;
    this._t0 = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      this._frame((now - this._t0) / 1000);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame(t) {
    // Springs: press scale and light direction ease toward their targets.
    this.press = lerp(this.press, this.pressTarget, 0.18);
    this.light[0] = lerp(this.light[0], this.lightTarget[0], 0.09);
    this.light[1] = lerp(this.light[1], this.lightTarget[1], 0.09);
    this.lightPos[0] = lerp(this.lightPos[0], this.lightPosTarget[0], 0.12);
    this.lightPos[1] = lerp(this.lightPos[1], this.lightPosTarget[1], 0.12);

    // Pressing squashes the panel slightly and thins the glass, the way a
    // physical control gives under a finger.
    const scale = 1 - this.press * 0.02;
    const drawRect = {
      x: this.rect.x + (this.rect.width * (1 - scale)) / 2,
      y: this.rect.y + (this.rect.height * (1 - scale)) / 2,
      width: this.rect.width * scale,
      height: this.rect.height * scale,
    };

    // Keep the DOM content layer glued to the panel.
    this.hit.style.transform =
      `translate3d(${drawRect.x}px, ${drawRect.y}px, 0) scale(${scale})`;
    this.hit.style.width = `${this.rect.width}px`;
    this.hit.style.height = `${this.rect.height}px`;
    this.hit.style.borderRadius = `${this.options.radius}px`;

    // Repaint the backdrop only when it actually changed.
    if (this.backdrop.update(t)) {
      const bctx = this.backdropEl.getContext('2d');
      if (this.backdropEl.width !== this.backdrop.canvas.width ||
          this.backdropEl.height !== this.backdrop.canvas.height) {
        this.backdropEl.width = this.backdrop.canvas.width;
        this.backdropEl.height = this.backdrop.canvas.height;
      }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.drawImage(this.backdrop.canvas, 0, 0);
      this._backdropDirty = true;
    }

    if (this.renderer) {
      if (this._backdropDirty !== false) {
        this.renderer.setBackdrop(this.backdrop.canvas);
        this._backdropDirty = false;
      }
      this.renderer.options.light = this.light;
      this.renderer.options.lightPos = this.lightPos;
      // Squash the panel a touch thinner while pressed.
      this.renderer.options.thickness = this.options.thickness * (1 - this.press * 0.12);
      this.renderer.render(drawRect, t);
    }

    // FPS counter.
    this.frames++;
    const now = performance.now();
    if (now - this._fpsMark >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this._fpsMark));
      this.frames = 0;
      this._fpsMark = now;
      this.onStats?.({ fps: this.fps, tier: this.tier });
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('deviceorientation', this._onOrient);
    this.renderer?.destroy();
    this.layer.remove();
    this.hit.remove();
    this.backdropEl.remove();
  }
}
