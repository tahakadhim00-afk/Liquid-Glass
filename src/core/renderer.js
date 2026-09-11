/**
 * LiquidGlassRenderer - WebGL2 renderer for a single liquid-glass panel.
 *
 * It owns one canvas that sits *above* the page content. Every frame it
 * uploads a "backdrop" image (whatever is behind the glass) as a texture
 * and runs the glass fragment shader over the panel's rectangle.
 *
 * The backdrop is supplied by a capture source (see capture.js) so the
 * renderer stays agnostic about where the pixels come from.
 */

import vertSrc from '../shaders/glass.vert.glsl?raw';
import fragSrc from '../shaders/glass.frag.glsl?raw';

const UNIFORMS = [
  'uBackdrop', 'uResolution', 'uCenter', 'uHalfSize', 'uRadius',
  'uBevel', 'uBevelPower', 'uProfile', 'uIOR', 'uDispersion', 'uThickness',
  'uSplay',
  'uFrost', 'uTint', 'uTintColor', 'uSaturation',
  'uLight', 'uLightMode', 'uLightPos', 'uLightHeight', 'uLightColor',
  'uLightIntensity', 'uLightRange', 'uLightRadius', 'uLightWrap',
  'uLightAmbient',
  'uSpecular', 'uCornerLight', 'uRimWidth', 'uEdgeLine', 'uEdgeWidth',
  'uTime', 'uMotion', 'uQuality',
];

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed:\n${log}`);
  }
  return sh;
}

function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link failed:\n${log}`);
  }
  return p;
}

export const DEFAULTS = {
  radius: 44,
  bevel: 34,
  bevelPower: 4.0,
  // 0 convex | 0.5 lip (raised rim, shallow dish) | 1 concave
  profile: 0.5,
  ior: 1.48,
  dispersion: 0.022,
  thickness: 46,
  splay: 0.0,
  frost: 0.22,
  tint: 0.06,
  tintColor: [1.0, 1.0, 1.0],
  saturation: 1.28,
  // --- light source -------------------------------------------------
  // Direction toward the light, for the directional (sun) mode.
  light: [-0.45, -0.85],
  // 0 = directional (parallel rays), 1 = positional (radiates from a point).
  lightMode: 0,
  // Position in CSS px, page space, y-down. null = track the panel centre,
  // so a fresh positional light starts somewhere sensible.
  lightPos: null,
  lightHeight: 180,      // px above the glass plane
  lightColor: [1.0, 1.0, 1.0],
  lightIntensity: 1.0,
  lightRange: 600,       // px to half brightness; 0 = no falloff
  lightRadius: 0.25,     // apparent source size, 0 = point, 1 = broad softbox
  lightWrap: 0.25,       // how far the lit band wraps past the terminator
  lightAmbient: 0.10,    // floor so the unlit border never goes black
  specular: 0.85,
  cornerLight: 1.0,      // extra gain on the rounded corners, 1 = physical
  rimWidth: 0.55,        // border-light band, fraction of the bevel
  edgeLine: 0.0,         // thin specular edge line strength, 0..1
  edgeWidth: 1.5,        // its width in CSS px
  motion: 0.5,
  quality: 1.0,
};

export class LiquidGlassRenderer {
  /**
   * @param {HTMLCanvasElement} canvas   overlay canvas, page-sized
   * @param {object} options             see DEFAULTS
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = { ...DEFAULTS, ...options };

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    this.program = link(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.loc = {};
    for (const name of UNIFORMS) {
      this.loc[name] = gl.getUniformLocation(this.program, name);
    }

    // Backdrop texture. CLAMP_TO_EDGE matters: refraction at the rim
    // samples slightly outside the panel, and wrapping would fold the
    // opposite side of the page into the edge.
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Trilinear: the frost blur samples a coarser mip as its radius grows.
    // A fixed tap count cannot cover a wide radius - the taps spread apart
    // and the blur degenerates into visible grain - so the taps ride on a
    // pre-filtered level instead, which is both smoother and cheaper.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.vao = gl.createVertexArray();   // empty, but core profile needs one

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Straight (non-premultiplied) alpha, matching the context option.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this._texSize = { w: 0, h: 0 };
  }

  /** Upload the backdrop. Accepts any TexImageSource (canvas, image, video). */
  setBackdrop(source) {
    const gl = this.gl;
    const w = source.width | 0;
    const h = source.height | 0;
    if (!w || !h) return;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (w !== this._texSize.w || h !== this._texSize.h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this._texSize = { w, h };
    } else {
      // Same dimensions: a sub-image update avoids reallocating storage.
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    // The mip chain must be rebuilt for the new pixels, or the frost blur
    // would keep sampling the previous frame at its coarser levels.
    // WebGL2 handles non-power-of-two textures here without extensions.
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** Resize the drawing buffer to CSS size * dpr. */
  resize(cssWidth, cssHeight, dpr = window.devicePixelRatio || 1) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  /**
   * Draw one frame.
   * @param {{x,y,width,height}} rect  panel box in CSS px, page-relative
   * @param {number} timeSeconds
   */
  render(rect, timeSeconds = 0) {
    const gl = this.gl;
    const o = this.options;
    const dpr = this.dpr || 1;
    const W = this.canvas.width;
    const H = this.canvas.height;

    gl.viewport(0, 0, W, H);

    // Confine rasterization to the panel's bounding box (plus margin for
    // the wobble and the soft edge). The fullscreen triangle still covers
    // the screen, but fragments outside the scissor are never generated -
    // roughly a 10x cut in fragment work for a typical panel.
    const pad = Math.ceil((o.bevel + Math.abs(o.thickness)) * dpr) + 8;
    const sx = Math.floor((rect.x * dpr) - pad);
    const sw = Math.ceil((rect.width * dpr) + pad * 2);
    // gl_FragCoord/scissor are bottom-up; rect is top-down.
    const sy = Math.floor(H - ((rect.y + rect.height) * dpr) - pad);
    const sh = Math.ceil((rect.height * dpr) + pad * 2);

    const box = { x: sx, y: sy, w: sw, h: sh };

    // Clear the union of this frame's box and the last one, so a panel
    // that moved does not leave the previous frame behind.
    const prev = this._lastBox || box;
    const ux = Math.min(box.x, prev.x);
    const uy = Math.min(box.y, prev.y);
    const uw = Math.max(box.x + box.w, prev.x + prev.w) - ux;
    const uh = Math.max(box.y + box.h, prev.y + prev.h) - uy;
    this._lastBox = box;

    const clip = (x, y, w, h) => {
      const cx = Math.max(0, x);
      const cy = Math.max(0, y);
      gl.scissor(cx, cy, Math.max(0, Math.min(w - (cx - x), W - cx)),
                         Math.max(0, Math.min(h - (cy - y), H - cy)));
    };

    gl.enable(gl.SCISSOR_TEST);
    clip(ux, uy, uw, uh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    clip(box.x, box.y, box.w, box.h);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.loc.uBackdrop, 0);

    const cx = (rect.x + rect.width / 2) * dpr;
    const cy = (rect.y + rect.height / 2) * dpr;

    gl.uniform2f(this.loc.uResolution, W, H);
    gl.uniform2f(this.loc.uCenter, cx, cy);
    gl.uniform2f(this.loc.uHalfSize, (rect.width / 2) * dpr, (rect.height / 2) * dpr);
    gl.uniform1f(this.loc.uRadius, o.radius * dpr);
    gl.uniform1f(this.loc.uBevel, o.bevel * dpr);
    gl.uniform1f(this.loc.uBevelPower, o.bevelPower);
    gl.uniform1f(this.loc.uProfile, o.profile);
    gl.uniform1f(this.loc.uIOR, o.ior);
    gl.uniform1f(this.loc.uDispersion, o.dispersion);
    gl.uniform1f(this.loc.uThickness, o.thickness * dpr);
    gl.uniform1f(this.loc.uSplay, o.splay);
    gl.uniform1f(this.loc.uFrost, o.frost);   // unitless 0..1, so no dpr scaling
    gl.uniform1f(this.loc.uTint, o.tint);
    gl.uniform3fv(this.loc.uTintColor, o.tintColor);
    gl.uniform1f(this.loc.uSaturation, o.saturation);
    gl.uniform2fv(this.loc.uLight, o.light);
    gl.uniform1f(this.loc.uLightMode, o.lightMode);
    // Default the lamp to the panel centre until one is set, then convert
    // CSS px to device px so it lands where the pointer actually is.
    const lp = o.lightPos ?? [rect.x + rect.width / 2, rect.y + rect.height / 2];
    gl.uniform2f(this.loc.uLightPos, lp[0] * dpr, lp[1] * dpr);
    gl.uniform1f(this.loc.uLightHeight, o.lightHeight * dpr);
    gl.uniform3fv(this.loc.uLightColor, o.lightColor);
    gl.uniform1f(this.loc.uLightIntensity, o.lightIntensity);
    gl.uniform1f(this.loc.uLightRange, o.lightRange * dpr);
    gl.uniform1f(this.loc.uLightRadius, o.lightRadius);
    gl.uniform1f(this.loc.uLightWrap, o.lightWrap);
    gl.uniform1f(this.loc.uLightAmbient, o.lightAmbient);
    gl.uniform1f(this.loc.uSpecular, o.specular);
    gl.uniform1f(this.loc.uCornerLight, o.cornerLight ?? 1.0);
    gl.uniform1f(this.loc.uRimWidth, o.rimWidth ?? 0.55);
    gl.uniform1f(this.loc.uEdgeLine, o.edgeLine ?? 0.0);
    gl.uniform1f(this.loc.uEdgeWidth, (o.edgeWidth ?? 1.5) * dpr);
    gl.uniform1f(this.loc.uTime, timeSeconds);
    gl.uniform1f(this.loc.uMotion, o.motion);
    gl.uniform1f(this.loc.uQuality, o.quality);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
