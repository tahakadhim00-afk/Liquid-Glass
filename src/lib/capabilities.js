/**
 * Renderer capability detection.
 *
 * The library has to answer one question before it can draw anything:
 * *where do the pixels behind the glass come from?* That is the real
 * constraint, and it splits the tiers in a way that is easy to get
 * backwards.
 *
 *   WebGL2 needs the backdrop as a TEXTURE. The browser will not let us
 *   read the composited page, so this tier only works when the caller
 *   supplies a source (an image, a video, a canvas, a WebGL scene) or
 *   accepts a rasterised approximation. Best optics, but it cannot see
 *   ordinary DOM.
 *
 *   SVG displacement runs inside `backdrop-filter`, so the browser hands
 *   it the real composited backdrop for free. Real refraction over live
 *   DOM with zero setup - but `backdrop-filter: url(#id)` is Chromium
 *   only.
 *
 *   CSS blur works everywhere and sees live DOM, but only scatters light
 *   rather than bending it.
 *
 * So for a panel over page content the order is SVG then CSS, and WebGL
 * is opted into by supplying a backdrop. For a panel over media the
 * caller supplies that media and WebGL leads. `pickTier` encodes exactly
 * that, instead of assuming the demo's situation.
 */

/** Results are stable for the page's lifetime, so probe once. */
let cache = null;

/**
 * Probe what this browser can actually do.
 * @returns {{webgl2: boolean, svgBackdrop: boolean, cssBackdrop: boolean, reducedMotion: boolean}}
 */
export function detectCapabilities() {
  if (cache) return cache;

  if (typeof document === 'undefined') {
    // SSR: report nothing and let the caller render a static fallback.
    return { webgl2: false, svgBackdrop: false, cssBackdrop: false, reducedMotion: false };
  }

  let webgl2 = false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (gl) {
      webgl2 = true;
      // Release the probe context immediately: browsers cap how many live
      // WebGL contexts a page may hold, and leaking one here would count
      // against a real panel later.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* treated as unsupported */ }

  const supports = (prop, value) =>
    typeof CSS !== 'undefined' && CSS.supports?.(prop, value);

  // Chromium alone accepts an SVG filter reference in backdrop-filter.
  const svgBackdrop =
    supports('backdrop-filter', 'url(#x)') ||
    supports('-webkit-backdrop-filter', 'url(#x)');

  const cssBackdrop =
    supports('backdrop-filter', 'blur(1px)') ||
    supports('-webkit-backdrop-filter', 'blur(1px)');

  const reducedMotion =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  cache = { webgl2, svgBackdrop, cssBackdrop, reducedMotion };
  return cache;
}

/**
 * Choose a tier.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.hasBackdropSource]  caller supplied a texture source
 * @param {string}  [opts.prefer]             force a tier, for testing
 * @returns {'webgl'|'svg'|'blur'|'none'}
 */
export function pickTier({ hasBackdropSource = false, prefer } = {}) {
  const caps = detectCapabilities();

  if (prefer) {
    // An explicit request is honoured when the browser can actually do it,
    // so tests and demos can exercise a lower tier on capable hardware.
    if (prefer === 'webgl' && caps.webgl2) return 'webgl';
    if (prefer === 'svg' && caps.svgBackdrop) return 'svg';
    if (prefer === 'blur' && caps.cssBackdrop) return 'blur';
    if (prefer === 'none') return 'none';
  }

  // With a texture to sample, the shader is unambiguously the best answer.
  if (hasBackdropSource && caps.webgl2) return 'webgl';

  // Over live DOM, refraction via backdrop-filter beats a blur...
  if (caps.svgBackdrop) return 'svg';
  if (caps.cssBackdrop) return 'blur';

  // ...and a browser with neither still gets a legible, opaque panel.
  return 'none';
}

/** Reset the probe cache. Test-only; capabilities do not change at runtime. */
export function resetCapabilityCache() {
  cache = null;
}
