/**
 * Fallback tiers for when WebGL2 is unavailable or refused.
 *
 * Tier 2 - SVG displacement: build a displacement map on a 2D canvas
 *   (R = x offset, G = y offset, 128 = neutral) and run it through
 *   feDisplacementMap inside a backdrop-filter. Real refraction, but
 *   `backdrop-filter: url(#id)` is Chromium-only.
 *
 * Tier 3 - plain blur + gradients: works everywhere, no refraction.
 */

export function detectTier() {
  if (typeof document === 'undefined') return 'blur';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tier 1: WebGL2.
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (gl) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return reduced ? 'webgl-static' : 'webgl';
    }
  } catch { /* fall through */ }

  // Tier 2: SVG filter inside backdrop-filter.
  if (CSS.supports('backdrop-filter', 'url(#x)') ||
      CSS.supports('-webkit-backdrop-filter', 'url(#x)')) {
    return 'svg';
  }

  // Tier 3.
  return 'blur';
}

/**
 * Generate a displacement map for a rounded rect.
 *
 * Follows the kube.io method: simulate the refracted ray per pixel, record
 * the displacement VECTORS, then normalise the whole field by its maximum
 * so the map only carries the profile's *shape*. The magnitude is then
 * re-applied once, as feDisplacementMap's `scale`.
 *
 * That split is the point: an 8-bit channel has 127 usable steps either
 * side of neutral, so encoding raw pixel offsets wastes most of the range
 * whenever the real displacement is small, and clips whenever it is large.
 * Normalising always uses the full range, and `scale` restores the units.
 *
 * @returns {{ url: string, scale: number }} data URL and the pixel scale
 *          that converts the normalised map back to real displacement.
 */
export function buildDisplacementMap(width, height, radius, bevel, power = 4,
                                     profile = 0.5, ior = 1.48, thickness = 46) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const data = img.data;

  const hw = canvas.width / 2;
  const hh = canvas.height / 2;
  const r = Math.min(radius, hw, hh);

  const sdf = (px, py) => {
    const qx = Math.abs(px) - hw + r;
    const qy = Math.abs(py) - hh + r;
    return Math.min(Math.max(qx, qy), 0) +
           Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  };

  const smootherstep = (t) => {
    t = Math.min(1, Math.max(0, t));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  // Same profile family as the shader: convex superellipse, its concave
  // mirror, and the lip that blends the two through smootherstep.
  const heightAt = (t) => {
    t = Math.min(1, Math.max(0, t));
    const u = 1 - t;
    const convex = Math.pow(Math.max(1 - Math.pow(u, power), 0), 1 / power);
    const concave = 1 - convex;
    const lip = convex + (concave - convex) * smootherstep(t);
    return profile < 0.5
      ? convex + (lip - convex) * (profile * 2)
      : lip + (concave - lip) * ((profile - 0.5) * 2);
  };

  // --- pass 1: simulate the refracted ray, collect raw pixel offsets ---
  const offsets = new Float32Array(canvas.width * canvas.height * 2);
  const eta = 1 / Math.max(ior, 1.0001);
  let maxMagnitude = 0;

  const DELTA = 0.002;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x - hw;
      const py = y - hh;
      const d = sdf(px, py);
      const o = (y * canvas.width + x) * 2;

      if (d >= 0) continue;               // outside: stays zero

      const t = Math.min(1, -d / bevel);
      const h = heightAt(t);

      // Outward gradient of the SDF.
      const gx = (sdf(px + 1, py) - sdf(px - 1, py)) / 2;
      const gy = (sdf(px, py + 1) - sdf(px, py - 1)) / 2;
      const glen = Math.hypot(gx, gy) || 1;

      // Central-difference derivative of the profile, converted from
      // height-per-unit-t to a true rise/run gradient in pixels.
      const slope = (heightAt(t + DELTA) - heightAt(t - DELTA)) / (2 * DELTA)
                  * (thickness / bevel);

      // Normal = derivative rotated -90 degrees, normalised. In the 2D
      // cross-section this is (-slope, 1) along the outward direction.
      const nlen = Math.hypot(slope, 1);
      const nAxis = -slope / nlen;        // tangential component of N
      const nz = 1 / nlen;

      // Snell, solved exactly as the GLSL builtin refract() does:
      //   R = eta*I - (eta*cosI + sqrt(k)) * N,  k = 1 - eta^2*(1 - cosI^2)
      // With I = (0,0,-1) the incident tangential component is 0, so
      // cos(theta1) = dot(-I, N) = nz and the whole solve is scalar.
      const cosI = nz;
      const k = 1 - eta * eta * (1 - cosI * cosI);
      if (k < 0) continue;                // total internal reflection
      const f = eta * cosI + Math.sqrt(k);
      const rAxis = -f * nAxis;           // tangential part of R
      const rz = -eta - f * nz;           // z part of R (I.z = -1)

      // tan(theta2) = tangential / |z|, and the ray falls `thickness * h`
      // before reaching the backdrop plane, so:
      //   displacement = height * tan(theta2)
      const tan2 = rAxis / Math.max(Math.abs(rz), 0.25);
      const magnitude = tan2 * thickness * h;

      const ox = (gx / glen) * magnitude;
      const oy = (gy / glen) * magnitude;
      offsets[o] = ox;
      offsets[o + 1] = oy;

      const m = Math.hypot(ox, oy);
      if (m > maxMagnitude) maxMagnitude = m;
    }
  }

  // --- pass 2: normalise to [-1,1] and encode into R/G ----------------
  // "we can reuse that maximum directly as the filter's scale" - so the
  // map holds only the shape, and `scale` carries the pixel magnitude.
  const norm = maxMagnitude > 1e-6 ? 1 / maxMagnitude : 0;

  for (let i = 0, o = 0; i < data.length; i += 4, o += 2) {
    // 0 -> -1, 128 -> 0 (neutral, no displacement), 255 -> +1
    data[i]     = clamp8(128 + offsets[o] * norm * 127);
    data[i + 1] = clamp8(128 + offsets[o + 1] * norm * 127);
    data[i + 2] = 128;
    data[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), scale: maxMagnitude };
}

function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
