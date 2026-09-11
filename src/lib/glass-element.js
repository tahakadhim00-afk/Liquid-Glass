/**
 * LiquidGlass - the reusable component.
 *
 * Attaches the glass material to an element you already have, and leaves
 * everything else alone. The element keeps its own children, its own
 * layout and its own event handlers; this adds a material to it, it does
 * not take it over.
 *
 *   const glass = new LiquidGlass(document.querySelector('.card'), {
 *     profile: 'apple',
 *   });
 *
 * Design rules that fall out of "must work on a real site":
 *
 *   NO LAYOUT OWNERSHIP. The host element is positioned by the page's own
 *   CSS. The component reads its box with getBoundingClientRect and never
 *   writes width/height/transform, so it composes with flexbox, grid,
 *   sticky headers and anything else.
 *
 *   NO MARKUP INJECTION. Content is the caller's. The only nodes added are
 *   effect layers, marked aria-hidden and pointer-events:none, so
 *   accessibility and hit-testing are untouched.
 *
 *   NO PAGE-WIDE SIDE EFFECTS. Listeners are scoped and every one is
 *   removed by destroy(). Several instances coexist without fighting.
 *
 *   IDLE WHEN OFFSCREEN. An IntersectionObserver parks the render loop for
 *   panels that are not visible, so a page with many of them does not burn
 *   frames on glass nobody is looking at.
 */

import { resolveProfile } from './profiles.js';
import { pickTier, detectCapabilities } from './capabilities.js';
import { createRenderTarget } from './render-target.js';

let instanceSeq = 0;

/** Parameters that only the WebGL tier can honour. */
const WEBGL_ONLY = new Set([
  'lightMode', 'lightPos', 'lightHeight', 'lightColor', 'lightIntensity',
  'lightRange', 'lightRadius', 'lightWrap', 'lightAmbient',
  'specular', 'motion', 'splay', 'tint', 'tintColor', 'cornerLight',
  'rimWidth', 'edgeLine', 'edgeWidth',
]);

export class LiquidGlass {
  /**
   * @param {HTMLElement} host              element to apply the material to
   * @param {object}      [options]
   * @param {string|object} [options.profile='apple']  optical profile
   * @param {*}           [options.backdrop]  texture source; enables WebGL
   * @param {string}      [options.tier]      force a tier, for testing
   * @param {boolean}     [options.interactive=true]  light follows pointer
   * @param {boolean}     [options.observeResize=true]
   */
  constructor(host, options = {}) {
    if (!host || host.nodeType !== 1) {
      throw new TypeError('LiquidGlass: first argument must be an element');
    }

    this.host = host;
    this.id = `lg${++instanceSeq}`;
    this._destroyed = false;

    const { profile = 'apple', backdrop = null, tier, interactive = true,
            observeResize = true, ...overrides } = options;

    // A profile name/object resolves to a full parameter set, then any
    // loose options override it. That is what makes
    // `{ profile: 'crystal', ior: 2.0 }` work as one would expect.
    this.params = { ...resolveProfile(profile), ...overrides };
    this.profileName = typeof profile === 'string' ? profile : 'custom';

    this.backdropSource = backdrop;
    this.interactive = interactive;

    const caps = detectCapabilities();
    this.tier = pickTier({ hasBackdropSource: backdrop != null, prefer: tier });
    // Honour the user's motion preference rather than overriding it.
    if (caps.reducedMotion) this.params.motion = 0;

    this._buildLayers();

    this.target = createRenderTarget(this.tier, {
      host: this.host,
      layer: this.layer,
      id: this.id,
      params: this.params,
      backdrop: this.backdropSource,
    });

    this._bindEvents({ observeResize });
    this.measure();

    // A static tier paints once; only WebGL needs a continuous loop, and
    // only while the panel is actually on screen.
    if (this.target.animated) this._startLoop();
    else this.target.draw?.(this._geometry(), 0);
  }

  /* ---- DOM ----------------------------------------------------------- */

  _buildLayers() {
    // One positioned wrapper holds every effect layer. It is inert: it
    // never receives pointer events and is hidden from assistive tech, so
    // the host element behaves exactly as it did before.
    const layer = document.createElement('div');
    layer.className = 'lg-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;border-radius:inherit;overflow:hidden;';
    this.layer = layer;

    // The host must establish a containing block for the absolutely
    // positioned layer. Only set it if the page has not already - a host
    // that is relative/absolute/fixed/sticky is left untouched.
    const position = getComputedStyle(this.host).position;
    if (position === 'static') {
      this._restorePosition = this.host.style.position;
      this.host.style.position = 'relative';
    }

    // Inserting first keeps the layer behind the host's own content
    // without needing a z-index that could escape into the page.
    this.host.insertBefore(layer, this.host.firstChild);
    this.host.classList.add('lg-host');
  }

  /* ---- geometry ------------------------------------------------------ */

  /** Current box in CSS pixels, viewport-relative. */
  _geometry() {
    const r = this.host.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  /**
   * Re-read the host's box and resize the render target.
   * Called on resize/scroll; also safe to call manually after a layout
   * change the component could not observe.
   */
  measure() {
    if (this._destroyed) return;
    const geom = this._geometry();
    if (geom.width < 1 || geom.height < 1) return;   // display:none, etc.

    // The corner radius should track the host's real CSS, so the material
    // matches the element's shape instead of imposing its own.
    const cssRadius = parseFloat(getComputedStyle(this.host).borderTopLeftRadius);
    if (Number.isFinite(cssRadius) && cssRadius > 0) this.params.radius = cssRadius;

    this.target.resize?.(geom);
    this._geom = geom;
    if (!this.target.animated) this.target.draw?.(geom, 0);
  }

  /* ---- events -------------------------------------------------------- */

  _bindEvents({ observeResize }) {
    // Scroll and resize move the panel relative to the viewport, which
    // changes where the light falls. Passive listeners keep scrolling
    // smooth; the work itself is just a rect read.
    this._onViewport = () => this.measure();
    addEventListener('resize', this._onViewport, { passive: true });
    addEventListener('scroll', this._onViewport, { passive: true, capture: true });

    if (observeResize && typeof ResizeObserver === 'function') {
      // Catches layout changes the window events miss: a flex sibling
      // growing, content reflowing, a container query firing.
      this._ro = new ResizeObserver(() => this.measure());
      this._ro.observe(this.host);
    }

    if (typeof IntersectionObserver === 'function') {
      this._io = new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        this._visible = visible;
        if (!this.target.animated) return;
        if (visible) this._startLoop();
        else this._stopLoop();
      }, { rootMargin: '64px' });
      this._io.observe(this.host);
    }

    if (this.interactive) {
      // Pointer-driven light. Bound on the window rather than the host so
      // the highlight responds as the cursor approaches, the way a real
      // panel catches a light before you touch it.
      this._onPointer = (e) => {
        this._pointer = { x: e.clientX, y: e.clientY };
        this.target.setPointer?.(this._pointer, this._geom);
      };
      addEventListener('pointermove', this._onPointer, { passive: true });
    }
  }

  /* ---- loop ---------------------------------------------------------- */

  _startLoop() {
    if (this._raf || this._destroyed) return;
    this._t0 ??= performance.now();
    const tick = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(tick);
      this.target.draw?.(this._geom ?? this._geometry(), (now - this._t0) / 1000);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (!this._raf) return;
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /* ---- public API ---------------------------------------------------- */

  /**
   * Update parameters at runtime.
   *
   * Accepts either a single key/value or an object of them, so both
   * `set('ior', 1.6)` and `set({ ior: 1.6, frost: 0.3 })` work.
   *
   * @returns {this} for chaining
   */
  set(keyOrValues, maybeValue) {
    const patch = typeof keyOrValues === 'string'
      ? { [keyOrValues]: maybeValue }
      : keyOrValues;

    let ignored = null;
    for (const [k, v] of Object.entries(patch)) {
      this.params[k] = v;
      if (this.tier !== 'webgl' && WEBGL_ONLY.has(k)) (ignored ??= []).push(k);
    }

    // Silence here would look like a bug on Safari, where these tiers are
    // the norm. Say it once, plainly, rather than failing quietly.
    if (ignored && !this._warnedIgnored) {
      this._warnedIgnored = true;
      console.info(
        `[liquid-glass] ${ignored.join(', ')} need the WebGL tier; ` +
        `this instance is on "${this.tier}". Pass a \`backdrop\` source to enable it.`,
      );
    }

    this.target.update?.(this.params);
    if (!this.target.animated) this.target.draw?.(this._geom ?? this._geometry(), 0);
    return this;
  }

  /**
   * Switch to another optical profile, keeping any explicit overrides the
   * caller has applied since construction.
   * @returns {this}
   */
  setProfile(profile) {
    const resolved = resolveProfile(profile);
    this.profileName = typeof profile === 'string' ? profile : 'custom';
    return this.set(resolved);
  }

  /** Supply or replace the backdrop texture source (WebGL tier). */
  setBackdrop(source) {
    this.backdropSource = source;
    this.target.setBackdrop?.(source);
    return this;
  }

  /** Current resolved parameters, as a copy. */
  getParams() { return { ...this.params }; }

  /** Remove every layer, listener and GPU resource this instance created. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._stopLoop();

    removeEventListener('resize', this._onViewport);
    removeEventListener('scroll', this._onViewport, { capture: true });
    if (this._onPointer) removeEventListener('pointermove', this._onPointer);
    this._ro?.disconnect();
    this._io?.disconnect();

    this.target.destroy?.();
    this.layer.remove();
    this.host.classList.remove('lg-host');
    if (this._restorePosition !== undefined) {
      this.host.style.position = this._restorePosition;
    }
  }
}

/**
 * Apply the material to every element matching a selector.
 * @returns {LiquidGlass[]}
 */
export function applyLiquidGlass(target, options = {}) {
  const nodes = typeof target === 'string'
    ? document.querySelectorAll(target)
    : target instanceof Element ? [target] : target;
  return Array.from(nodes, (el) => new LiquidGlass(el, options));
}
