#version 300 es
precision highp float;

/* ------------------------------------------------------------------
   Liquid Glass - fragment shader

   Pipeline (per pixel):
     1. SDF of a rounded rect  -> shape + edge distance
     2. Height field from SDF  -> convex / lip / concave surface profile
     3. Normal from height     -> central-difference derivative, rotated -90
     4. Snell refraction       -> ray marched to the backdrop plane:
                                  offset = height * tan(theta_refracted)
     5. Chromatic dispersion   -> per-channel IOR
     6. Backdrop blur          -> mip-based gaussian, radius grows w/ bend
     7. Fresnel + specular     -> Schlick + Blinn-Phong key light
     8. Tint / edge glow       -> adaptive, saturation-boosted
   ------------------------------------------------------------------ */

uniform sampler2D uBackdrop;   // captured page behind the glass
uniform vec2  uResolution;     // drawing buffer size (px)
uniform vec2  uCenter;         // glass centre, px, y-down
uniform vec2  uHalfSize;       // glass half extents, px
uniform float uRadius;         // corner radius, px
uniform float uBevel;          // width of the refracting rim, px
uniform float uBevelPower;     // superellipse exponent (2 = circle, 4 = squircle)
// Surface profile family (kube.io): 0 = convex, 0.5 = lip (raised rim with
// a shallow centre dip), 1 = concave. The lip is the Apple-like one.
uniform float uProfile;
uniform float uIOR;            // index of refraction (~1.5 = glass)
uniform float uDispersion;     // per-channel IOR spread
uniform float uThickness;      // virtual slab thickness (px) -> displacement
// How much of the surface curves. 0 = bevelled sheet (flat centre, all the
// bending at the rim). 1 = thick lens (the whole face curves and magnifies).
uniform float uSplay;
// Surface roughness, 0 = polished glass, 1 = heavily etched. Drives the
// scatter radius and nothing else: a rough SURFACE redistributes the light
// passing through it, it does not add haze or drain colour (RESEARCH.md 16).
uniform float uFrost;
uniform float uTint;           // tint strength
uniform vec3  uTintColor;
uniform float uSaturation;     // backdrop saturation boost
/* --- Light source -------------------------------------------------
   The border gradient is driven by a real light, not a fixed direction.

   uLightMode blends between the two classical source types:
     0 = directional (sun): parallel rays, uLight gives the direction,
         every point on the rim sees the same incoming angle.
     1 = positional (lamp): rays radiate from uLightPos, so the angle
         varies along the border and the gradient sweeps as it moves.

   Blending rather than branching keeps it animatable and avoids the
   two modes popping when a control crosses the midpoint. */
// Direction *toward* the light, in y-down screen space (matching CSS):
// (0,-1) = light above the panel, (-1,0) = light to its left.
uniform vec2  uLight;
uniform float uLightMode;      // 0 = directional, 1 = positional
uniform vec2  uLightPos;       // light position, px, y-down (page space)
uniform float uLightHeight;    // height above the glass plane, px
uniform vec3  uLightColor;     // light colour (tints the rim gradient)
uniform float uLightIntensity; // overall gain on the border lighting
// Distance at which a positional light falls to ~half brightness, px.
// 0 disables falloff, so a lamp reads as evenly bright at any distance.
uniform float uLightRange;
// Apparent size of the source. A point source gives a hard, narrow rim
// highlight; a broad source (softbox) wraps further round the border.
uniform float uLightRadius;
// How far the lit band wraps past the terminator, 0..1. Physically this
// is the source subtending a wider angle; visually it is the difference
// between a hard-edged glint and a gradient that eases around the corner.
uniform float uLightWrap;
// Ambient floor so the unlit side of the border never goes fully black.
uniform float uLightAmbient;
uniform float uSpecular;       // specular intensity
// Extra gain on the rounded corners specifically. A real bevel wraps in two
// directions at once where it turns a corner, so it gathers light from a
// wider arc than the straight edges do and reads brighter. 1 = physical,
// >1 exaggerates it the way product renders do.
uniform float uCornerLight;
// Width of the soft border-light band, as a fraction of the bevel. Apple's
// material keeps this narrow; a wide band reads as a thick acrylic block.
uniform float uRimWidth;
// The thin specular line at the very edge - the single feature that most
// makes a panel read as glass rather than tinted film. Strength 0..1 and
// width in device px; px rather than bevel-relative because on a real
// device the line is ~1.5pt no matter how large the control is.
uniform float uEdgeLine;
uniform float uEdgeWidth;
uniform float uTime;
uniform float uMotion;         // 0..1 idle liquid wobble
uniform float uQuality;        // <0.5 -> 5x5 blur kernel, else 7x7

out vec4 fragColor;

/* --- Signed distance to a rounded rectangle (Inigo Quilez) --------- */
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

/* --- Surface height profiles ---------------------------------------
   t = 0 at the outer edge, 1 once we are past the bezel (flat top).

   Following kube.io's "Liquid Glass in the Browser", the surface is one
   of a small family of profiles, all defined on the bezel's [0,1] span:

     convex circle   y = sqrt(1 - (1-t)^2)          p = 2
     convex squircle y = (1 - (1-t)^4)^(1/4)        p = 4
     concave         y = 1 - convex(t)
     lip             y = mix(convex, concave, smootherstep(t))

   The generalised superellipse h = (1 - (1-t)^p)^(1/p) covers both convex
   cases: p=2 IS the circle, p=4 the squircle. The circle's slope is
   infinite at t=0 - a hard optical edge - while the squircle keeps the
   gradient smooth even when the profile is stretched around a long
   rectangle, which is why Apple's shapes stay clean at the corners.
   ------------------------------------------------------------------ */
float convexHeight(float t, float p) {
  t = clamp(t, 0.0, 1.0);
  float u = 1.0 - t;
  return pow(max(1.0 - pow(u, p), 0.0), 1.0 / p);
}

/* Ken Perlin's smootherstep: 6t^5 - 15t^4 + 10t^3. Second derivative is
   zero at both ends, so the convex->concave blend below has no visible
   crease where it changes direction. */
float smootherstep(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/* Blend the family with one continuous control.
   uProfile: 0 = convex, 0.5 = lip (raised rim + shallow centre dip),
             1 = concave. The lip is the profile that reads as Apple's
   material: light is gathered hard at the rim, then released across a
   gently dished face, instead of a single dome. */
float surfaceHeight(float t, float p, float profile) {
  float convex = convexHeight(t, p);
  float concave = 1.0 - convex;
  float lip = mix(convex, concave, smootherstep(t));
  // Two-segment blend so 0.5 lands exactly on the lip profile.
  return profile < 0.5
    ? mix(convex, lip, profile * 2.0)
    : mix(lip, concave, (profile - 0.5) * 2.0);
}

/* --- Snell refraction -> lateral ray travel ------------------------
   n1*sin(theta1) = n2*sin(theta2), solved by the builtin refract() for
   eta = n1/n2. The builtin hands back a unit direction, so its .xy is
   sin(theta2); walking that ray down to a plane one unit below needs
   tan(theta2) = xy / |z|. Returns the per-unit-depth lateral travel.

   Total internal reflection makes refract() return exactly 0; that is
   also where |z| -> 0, so the clamp below keeps the rim finite instead
   of flinging samples off-screen. */
vec2 bendXY(vec3 I, vec3 N, float eta) {
  vec3 r = refract(I, N, eta);
  if (dot(r, r) < 1e-8) return vec2(0.0);        // total internal reflection
  return r.xy / max(abs(r.z), 0.25);
}

vec3 sampleBackdrop(vec2 uv) {
  return texture(uBackdrop, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

/* --- Backdrop blur -------------------------------------------------
   A true Gaussian, the same thing `backdrop-filter: blur()` and the
   frosted side panels of a real OS give you.

   The earlier version scattered a rotated Poisson disc over the radius.
   That cannot be made clean: a fixed tap budget spread over a growing
   radius leaves gaps between samples, and the gaps ARE the grain. Adding
   taps only postpones it, and per-pixel rotation converts the banding
   into noise rather than removing it.

   The standard fix is to stop asking the taps to span the radius. Pick a
   mip level where the blur is only a couple of texels wide, then a small
   fixed kernel covers it completely - every pixel under the footprint is
   accounted for by the hardware's own box filtering, so there is nothing
   left to alias. The kernel is separable (two 1D passes in a cross, not
   an NxN grid), which is what keeps it cheap.

   sigma is the gaussian's standard deviation in texels of the chosen
   level. The cap below limits how wide the blur may be there, and the mip
   is chosen to satisfy it - so cost is constant regardless of how large
   radiusPx gets. */
vec3 blurredBackdrop(vec2 uv, float radiusPx) {
  if (radiusPx < 0.5) return sampleBackdrop(uv);

  // Treat the requested radius as a gaussian's ~2-sigma extent, which is
  // the convention CSS blur() uses, so a given px value reads the same
  // here as it would in backdrop-filter.
  float sigmaPx = radiusPx * 0.5;

  // Choose the level where sigma shrinks to KERNEL_TEXELS texels. The cap
  // is tied to the kernel radius (sigma <= R/1.35) so the kernel always
  // reaches past 2 sigma: shrinking the kernel for quality must also pick
  // a coarser mip, or the gaussian would be truncated and the missing
  // tail would show as a hard-edged blur.
  float kernelTexels = (uQuality < 0.5 ? 2.0 : 3.0) / 1.35;
  float lod = max(log2(sigmaPx / kernelTexels), 0.0);
  float scale = exp2(lod);                 // texels of that level, in px
  float sigma = sigmaPx / scale;           // sigma measured in those texels

  // Step in UV for one texel of the chosen level.
  vec2 texel = scale / uResolution;

  // A full 2D kernel, not a cross: sampling only along the two axes
  // leaves the diagonals under-blurred, which shows up as a faint plus
  // shape around bright spots. 7x7 at one-texel spacing spans +/-3 texels,
  // past 2 sigma at the capped sigma above, so the tail that is dropped is
  // negligible. 49 taps is affordable precisely because the mip keeps the
  // kernel small no matter how large radiusPx is - a 500px blur costs
  // exactly the same as a 50px one, it just reads a coarser level.
  //
  // uQuality trades the outer ring away on slower hardware: radius 2
  // (25 taps) still reaches 2 sigma once the mip is chosen one level
  // coarser to compensate, which the sigma cap below handles.
  int R = uQuality < 0.5 ? 2 : 3;
  float inv2s2 = 1.0 / (2.0 * sigma * sigma);

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int j = -3; j <= 3; j++) {
    if (j < -R || j > R) continue;
    for (int i = -3; i <= 3; i++) {
      if (i < -R || i > R) continue;
      vec2 d = vec2(float(i), float(j));
      float w = exp(-dot(d, d) * inv2s2);
      acc += textureLod(uBackdrop, clamp(uv + d * texel, vec2(0.0), vec2(1.0)), lod).rgb * w;
      wsum += w;
    }
  }
  return acc / max(wsum, 1e-4);
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  // Work in a y-down pixel space so it matches DOM/CSS coordinates.
  vec2 p = vec2(fragPx.x, uResolution.y - fragPx.y);
  vec2 local = p - uCenter;

  /* ---- 1. shape ---------------------------------------------------- */
  vec2 half_ = uHalfSize;
  float radius = min(uRadius, min(half_.x, half_.y));

  // Idle breathing: the rim swells slightly, travelling round the shape.
  // Cosmetic, but it is what sells the *liquid* half of liquid glass.
  float ang = atan(local.y, local.x);
  float wobble = uMotion * 1.5 * sin(ang * 3.0 - uTime * 1.1)
               + uMotion * 1.0 * sin(ang * 5.0 + uTime * 0.7);

  float d = sdRoundRect(local, half_, radius) + wobble;

  float aa = fwidth(d) + 1e-4;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  if (inside <= 0.001) { fragColor = vec4(0.0); return; }

  /* ---- 2. height field (bevel + lens) ------------------------------ */
  float bevel = max(uBevel, 1.0);
  // 0 at rim, 1 past the bevel.
  //
  // The clamp is only C0: the profile still has real slope when it reaches
  // t = 1, and truncating it there snaps the surface flat in one pixel. On
  // a wide bevel the profile has room to flatten on its own before the cut,
  // so nothing shows - but a narrow one is compressed enough to still be
  // climbing when it hits the clamp, and the break draws a ring at exactly
  // `bevel` px in from the contour. Easing the last stretch of the ramp
  // lands on the flat top with matching slope instead of cutting to it.
  float tRaw = max(-d / bevel, 0.0);
  float t = tRaw < 1.0 ? smootherstep(tRaw) : 1.0;
  float h = surfaceHeight(t, uBevelPower, uProfile);

  // A pure bevel is flat on top, so its interior refracts nothing: the
  // panel reads as a sheet of glass with shaped edges. Real thick glass -
  // and the look Figma's Glass effect produces - behaves like a LENS: the
  // whole surface curves, so content is displaced and magnified right
  // across the face, not only pinched at the rim.
  //
  // uSplay blends between the two.
  //
  // Distance from the centre, normalised per-axis. Using the SDF depth
  // instead would clamp to the SHORT axis on a wide panel - `inner`
  // saturates once you are half the panel's height from any edge - which
  // leaves the whole middle of a wide panel perfectly flat and makes the
  // lens indistinguishable from a bevel there.
  vec2 q = local / max(half_, vec2(1.0));
  float rN = clamp(length(q), 0.0, 1.0);             // 0 centre -> 1 edge

  // Spherical cap: height falls off as sqrt(1 - r^2), giving the smooth
  // continuous curvature that makes a lens magnify instead of merely
  // pinching. Its slope is 0 at the centre and grows toward the edge.
  float lensH = sqrt(max(1.0 - rN * rN, 0.0));

  h = mix(h, lensH, uSplay);

  /* ---- 3. normal --------------------------------------------------- */
  // Outward direction of the shape, used as the bevel's fall line.
  //
  // Central-differencing the SDF looks like the obvious way to get this,
  // but the rounded-rect SDF is only C0 along the diagonals running in
  // from each corner: that is where the nearest feature switches from a
  // vertical edge to a horizontal one, and the gradient jumps from (1,0)
  // to (0,1) across it. The jump lands in the normal, and from there in
  // the refraction and the specular, so a hard diagonal seam is drawn
  // from every corner. A narrow bevel hides it - `t` saturates before the
  // diagonals are reached, so the surface is already flat there - but
  // widening the bevel pushes the sloped region inward over them and the
  // seams appear.
  //
  // So build the direction analytically instead, blending the two edge
  // candidates rather than switching between them. `w` is the per-axis
  // proximity to that axis' edge; normalising it gives x and y weights
  // that cross over smoothly on the diagonal instead of swapping.
  vec2 ax = abs(local);
  vec2 innerBox = max(half_ - radius, vec2(0.0));
  vec2 cornerV = max(ax - innerBox, 0.0);

  // Signed proximity to each axis' edge. Their difference is what the SDF
  // switches on, so blending against it removes exactly that switch.
  vec2 w = ax - innerBox;
  // Softness must span the whole region the surface is still sloped in,
  // since that is exactly where a direction discontinuity could show. The
  // bevel sets that width, but the corner radius also rounds the contour
  // over its own span, so take whichever reaches further in.
  float soft = max(max(bevel, radius) * 0.75, 1.0);
  // Weights that cross over smoothly on the diagonal instead of swapping.
  // Derived from one difference, so they sum to 1 and stay continuous.
  float sx = smoothstep(-soft, soft, w.x - w.y);
  vec2 edgeDir = normalize(vec2(sx, 1.0 - sx) * sign(local + vec2(1e-6)) + vec2(1e-6));

  // Inside a corner arc the true outward direction is radial from that
  // corner's centre. Hand over to it by how deep into the arc we are.
  //
  // The handover weight has to reach zero exactly where cornerV does, or
  // it introduces its own discontinuity in place of the one being removed:
  // cornerV is a max(...,0) clamp, so gating on `cornerV > 0` and then
  // ramping over an unrelated span makes the blend switch on abruptly at
  // the inner box - which is precisely the seam that survived at narrow
  // bevels. Ramping the clamped value itself is continuous by construction.
  vec2 arcRamp = clamp(cornerV / max(radius, 1.0), 0.0, 1.0);
  float inArc = min(arcRamp.x, arcRamp.y);
  inArc = smootherstep(inArc);

  vec2 arcDir = normalize(cornerV * sign(local + vec2(1e-6)) + vec2(1e-6));
  vec2 gradMix = mix(edgeDir, arcDir, inArc);
  vec2 grad = normalize(gradMix + vec2(1e-6));

  // Slope of the bezel along the outward direction. This is the article's
  // central-difference derivative, in the profile's own [0,1] parameter:
  //   y1 = f(x - delta); y2 = f(x + delta); slope = (y2 - y1) / (2*delta)
  // and the normal is that derivative rotated -90 degrees, i.e. (-m, 1).
  // Differencing in `t` (not pixels) keeps the slope a pure property of
  // the profile, so it stays correct as the bezel width changes.
  const float DELTA = 0.002;
  float bevelSlope = (surfaceHeight(t + DELTA, uBevelPower, uProfile)
                    - surfaceHeight(t - DELTA, uBevelPower, uProfile)) / (2.0 * DELTA);
  // Convert from height-per-unit-t to height-per-pixel: the profile spans
  // `bevel` pixels, and rises `uThickness` pixels over that span.
  bevelSlope *= uThickness / bevel;

  // Slope of the spherical cap. d/dr of sqrt(1-r^2) is -r/sqrt(1-r^2), in
  // the cap's own normalised units where the face spans r = 0..1 and the
  // sag is 1. Unlike the bezel - which rises uThickness over a `bevel`-wide
  // span, a genuine rise/run - the cap is a *shape*: converting it to
  // pixels over the panel's half-extent would divide the slope by ~100 and
  // flatten the lens to nothing, since a sphere that wide is almost planar.
  // Keeping it in normalised units preserves the optical power, and
  // uThickness then sets the magnitude through the ray length below.
  // Clamped because the true derivative diverges at the rim.
  float lensSlope = clamp(-rN / max(sqrt(max(1.0 - rN * rN, 0.0)), 0.35), -4.0, 4.0);

  // The two profiles curve about different origins: the bevel falls away
  // from the nearest EDGE (so it follows the SDF gradient), the lens falls
  // away from the CENTRE. Blending the directions as well as the slopes
  // keeps the normal consistent with the blended height field.
  // Gradient of rN = length(local/half_), so it matches the height field
  // above on non-square panels rather than pointing at the geometric centre.
  // q is ALREADY local/half_; dividing by half_ a second time squared the
  // aspect correction, which swung the direction hard toward the short axis
  // on a wide panel and made it disagree with `grad` - the disagreement then
  // drew its own crease once uSplay mixed the two.
  vec2 radial = normalize(q + vec2(1e-6));

  // Blend the DIRECTIONS by normalised interpolation, not by mixing raw
  // vectors: mix() of two unit vectors shortens as they diverge, and where
  // they point opposite ways it passes through ~zero, so normalize() of the
  // result flips sign across that point. Slerping via the mixed vector with
  // a magnitude floor keeps the turn monotonic instead.
  vec2 mixed = mix(grad, radial, uSplay);
  vec2 dir = length(mixed) > 1e-3
    ? normalize(mixed)
    : normalize(mix(grad, radial, uSplay < 0.5 ? 0.0 : 1.0) + vec2(1e-6));

  float slope = mix(bevelSlope, lensSlope, uSplay);

  // The article's construction exactly: normal = derivative rotated -90,
  // i.e. (-m, 1), normalised. `slope` is already a true rise/run gradient
  // (both branches above carry their own uThickness/span factor), so it
  // must NOT be scaled by thickness again here - doing so made the normal
  // and the ray length both grow with thickness, so displacement rose
  // quadratically and tipped into total internal reflection early.
  vec3 N = normalize(vec3(-dir * slope, 1.0));

  /* ---- 4. refraction (viewer looking straight down -Z) ------------- */
  vec3 I = vec3(0.0, 0.0, -1.0);
  float eta = 1.0 / max(uIOR, 1.0001);

  // Distance the refracted ray travels before hitting the backdrop.
  //
  // The article's model is a ray simulation: a ray enters the surface at
  // the point's own height, bends by Snell, then travels in a straight
  // line until it reaches the backdrop plane. So the travel distance is
  // simply that height - it is not a free parameter.
  //
  //   displacement = height * tan(theta_refracted)
  //
  // and refract() already returns a unit vector whose xy/z ratio IS that
  // tangent, so multiplying by the height gives the lateral offset.
  //
  // The height is measured from the FLAT BACK of the slab, so the ray's
  // total run to the backdrop is the slab it still has to cross plus the
  // relief of the surface above it. uSplay says how much of the body is
  // solid glass: a bevelled sheet is mostly air above a thin plate (the
  // ray only travels the local relief), a thick lens is solid throughout
  // (the ray crosses the whole body even where the face is flat).
  //
  // This matters because a spherical cap has h ~ 1 but slope ~ 0 at its
  // centre. Keying travel to `h` alone is right for a bevel - the flat
  // top then sits exactly still, instead of drifting as the old
  // mix(0.35, 1.0, h) floor made it - but it would flatten a lens, whose
  // whole face must magnify. Carrying the body term keeps both true.
  float depth = uThickness * (h + uSplay);

  // The backdrop canvas is uploaded with UNPACK_FLIP_Y_WEBGL = false, so
  // its top row lands at v = 0: the texture is y-down, the same space as
  // `p`. No flip belongs here - adding one mirrors the refracted image.
  vec2 uv = p / uResolution;

  /* ---- 5. chromatic dispersion ------------------------------------ */
  // Each channel gets its own IOR: blue bends most, as in a prism.
  // Weighted by how steeply the surface is tilted here, so the colour
  // fringing concentrates where rays cross the most glass - the rim and
  // the corners - instead of tinting the whole face uniformly. This is
  // what produces the rainbow edges in Figma's Glass effect.
  float tilt = clamp(length(N.xy) * 2.2, 0.0, 1.0);
  float disp = uDispersion * mix(0.15, 1.0, tilt);
  float etaR = 1.0 / max(uIOR - disp, 1.0001);
  float etaG = eta;
  float etaB = 1.0 / max(uIOR + disp, 1.0001);

  // N.xy lives in y-down pixel space, so refract().xy comes out y-down -
  // matching `uv` above. Everything stays in one space, no flips.
  //
  // refract() returns a UNIT vector, so its .xy is sin(theta). Walking a
  // ray down to a plane `depth` below needs the tangent, not the sine:
  //
  //   lateral = depth * tan(theta) = depth * (xy / |z|)
  //
  // Dividing by |z| is what makes the bend accelerate correctly as the
  // surface steepens near the rim - using .xy alone quietly understates
  // the displacement exactly where the glass bends hardest, which is the
  // difference between "blurred with a kink" and a real optical edge.
  // Guarded: z -> 0 at grazing incidence, and refract() returns the zero
  // vector on total internal reflection.
  vec2 offR = bendXY(I, N, etaR) * depth / uResolution;
  vec2 offG = bendXY(I, N, etaG) * depth / uResolution;
  vec2 offB = bendXY(I, N, etaB) * depth / uResolution;

  /* ---- 6. frost (surface scattering) ------------------------------- */
  // A frosted glass SURFACE is a thin roughened boundary: transmitted
  // rays leave in a cone instead of a single direction. That is a blur,
  // and essentially only a blur.
  //
  // It is NOT milky. Milkiness comes from subsurface scattering inside a
  // thick translucent SOLID - frosted plastic, wax, marble - where light
  // bounces through a volume and re-emerges diffusely. Modelling a thin
  // etched surface as if it were such a volume is what made this panel
  // read as grey fog: the backdrop was washed toward white and
  // desaturated, so heavy frost turned every scene into flat haze.
  // Reference implementations (Figma's Glass) keep the backdrop dark and
  // fully saturated no matter how strong the frost, because the surface
  // only ever redistributes the light passing through it.
  //
  // So frost now does one thing, physically: it widens the scatter cone.
  float frost = clamp(uFrost, 0.0, 1.0);

  // Scatter radius. The response is roughly linear in the slider rather
  // than squared: squaring made the useful range unreachable, since low
  // settings produced almost no blur (0.21 gave ~2px) and users had to
  // push the slider to the top - straight into the haze - just to get a
  // normal frosted look. A mild 1.35 exponent keeps fine control near
  // zero while still reaching a genuinely strong blur by mid-slider.
  // The rim bends light hardest, so it scatters most: radius follows bend.
  float bend = length(offG * uResolution);
  float scatter = pow(frost, 1.35) * 130.0
                * (0.55 + 0.45 * clamp(bend / max(uThickness, 1.0), 0.0, 1.0));

  // Three blurs would cost 3x49 taps for one channel each. The kernel is
  // identical in all three - only the sample CENTRE differs, by the few
  // pixels of chromatic offset - so blur once at the green centre and
  // take the red/blue channels from cheap unblurred reads displaced by
  // the same amount, reintroducing the fringing at a fraction of the
  // cost. At frost 0 the blur is bypassed entirely and all three are
  // exact, so dispersion is unaffected where it is most visible.
  vec3 col;
  if (scatter < 0.5) {
    // No frost: sample each channel at its own refracted position, so
    // dispersion stays exact where it is most visible.
    col.r = sampleBackdrop(uv + offR).r;
    col.g = sampleBackdrop(uv + offG).g;
    col.b = sampleBackdrop(uv + offB).b;
  } else {
    // Frosted: one blur, evaluated at the green centre. The red and blue
    // centres differ only by the few px of chromatic offset, which is far
    // smaller than the blur itself, so re-running the whole kernel for
    // each channel would cost 3x for a difference the blur has already
    // smeared out. Displacing the shared result reproduces the fringing
    // at a third of the sample count.
    col = blurredBackdrop(uv + offG, scatter);
    vec2 dR = (offR - offG) * uResolution;
    vec2 dB = (offB - offG) * uResolution;
    // Only worth a second look if the channels actually separated by
    // something the eye could resolve through this much blur.
    if (max(length(dR), length(dB)) > scatter * 0.25) {
      col.r = blurredBackdrop(uv + offR, scatter).r;
      col.b = blurredBackdrop(uv + offB, scatter).b;
    }
  }

  // Only the artistic saturation control acts here. Frost no longer
  // desaturates: averaging many directions of the SAME scene does not
  // pull colour toward grey, it just softens detail. A red wall seen
  // through etched glass stays red.
  col = saturate3(col, uSaturation);

  /* --- corner weight -------------------------------------------------
     How much of the rounded corner this pixel sits on, 0 along a straight
     edge and 1 at the middle of an arc.

     The rounded-rect SDF is built from a box inset by `radius`: outside
     that inner box the distance is measured radially from a corner point,
     inside it the nearest edge is a flat side. So `max(q,0)` - the
     overshoot past the inset box - is nonzero on exactly the two axes that
     are curving, and its two components being *simultaneously* nonzero is
     precisely the definition of being on a corner arc. Their geometric
     mean, normalised by the radius, rises from 0 at the tangent point
     where the arc meets the straight edge to 1 at 45 degrees.

     Deriving it from the SDF rather than from the pixel's angle is what
     keeps it correct on non-square panels, where the corner occupies a
     different share of the contour on each side. */
  vec2 cq = max(abs(local) - (half_ - radius), 0.0);
  float corner = radius > 0.5
    ? clamp(sqrt(cq.x * cq.y) / (radius * 0.5), 0.0, 1.0)
    : 0.0;

  // A corner curves in two directions at once, so it gathers light from a
  // wider arc than a straight edge and genuinely reads brighter. Squaring
  // concentrates the boost into the arc itself instead of bleeding it down
  // the sides, which is what would make the whole rim look uniformly hot.
  float cornerGain = 1.0 + (uCornerLight - 1.0) * corner * corner;

  /* ---- 7. Fresnel + specular --------------------------------------- */
  // Schlick: glass reflects ~4% head-on, ~100% at grazing angles.
  float cosTheta = clamp(dot(N, -I), 0.0, 1.0);
  float F0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
  float fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);

  vec3 reflectTint = vec3(0.92, 0.96, 1.0);
  col = mix(col, reflectTint, fresnel * 0.55);

  /* --- the light vector, evaluated per pixel ------------------------
     This is what makes the border a real gradient rather than a static
     sweep: for a positional source every pixel of the rim sees its own
     direction to the lamp, so the highlight is brightest where the
     surface faces it and decays smoothly around the shape.

     N.xy was built from -grad in y-down space, so uLight needs the same
     sign convention for the highlight to land on the lit side. */
  vec3 dirL = normalize(vec3(-uLight, 0.85));

  // Vector from this pixel to the lamp, in the same y-down pixel space.
  vec3 toLamp = vec3(uLightPos - p, max(uLightHeight, 1.0));
  float lampDist = length(toLamp);
  vec3 posL = toLamp / max(lampDist, 1e-4);

  float mode = clamp(uLightMode, 0.0, 1.0);
  vec3 L = normalize(mix(dirL, posL, mode));

  // Inverse-square falloff, softened to a rational curve so the lamp
  // stays usable at UI distances: 1 / (1 + (d/range)^2) reaches half
  // brightness at exactly `range` instead of diverging near the source.
  float falloff = 1.0;
  if (uLightRange > 0.0) {
    float dr = lampDist / uLightRange;
    falloff = 1.0 / (1.0 + dr * dr);
  }
  // Only a positional light falls off; a directional one is at infinity.
  float attenuation = mix(1.0, falloff, mode);

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  // Rough surfaces spread the highlight over a wider, dimmer lobe: a
  // frosted panel glows softly where a polished one gives a sharp glint.
  // A physically larger source does the same, so the apparent radius
  // widens the lobe alongside roughness - that is what separates a bare
  // bulb's hard glint from a softbox's broad sheen.
  // Named lightRadius, not radius: `radius` is already the corner radius.
  float lightRadius = clamp(uLightRadius, 0.0, 1.0);
  float shininess = mix(140.0, 18.0, frost) * mix(1.0, 0.12, lightRadius);
  float spec = pow(ndh, max(shininess, 1.0)) * mix(1.0, 0.45, frost);
  // Energy conservation: spreading the same light over a wider lobe must
  // dim its peak, otherwise a big source just looks like a brighter one.
  spec *= mix(1.0, 0.35, lightRadius);
  // ...plus a softer, wider lobe for the sheen. Kept weak: a strong wide
  // lobe wraps the whole rim and the panel starts reading as chrome.
  float sheen = pow(ndh, 26.0) * 0.10;
  // Confine both to the bevel. On the flat top the normal is constant, so
  // an unconfined highlight would flood the entire face.
  float bevelMask = smoothstep(1.0, 0.35, t);
  float specGain = uSpecular * uLightIntensity * attenuation * cornerGain;
  col += (spec * 1.1 + sheen) * specGain * bevelMask * uLightColor;

  /* ---- 8. tint + edge highlight ------------------------------------ */
  col = mix(col, uTintColor, uTint * (1.0 - fresnel * 0.5));

  /* --- border gradient, driven by the light source ------------------
     The rim is where glass reads as glass, so this is a real shading
     term rather than a decorative gradient: the border is lit by the
     same L used above, so moving the lamp sweeps the bright band around
     the shape and changing its colour tints the edge.

     `grad` points outward from the shape, so it IS the border's own
     surface normal in-plane. Lambert against the light direction gives
     the gradient - continuous around the whole contour, no seams. */
  float rim = smoothstep(clamp(uRimWidth, 0.05, 1.0), 0.0, t);

  float lightFacing = clamp(dot(grad, L.xy), -1.0, 1.0);

  // Wrap: a broad source keeps lighting the surface past the 90-degree
  // terminator. The classic half-Lambert remap, with the wrap amount
  // setting how far round the corner the gradient reaches.
  float wrap = clamp(uLightWrap, 0.0, 1.0);
  float lambert = clamp((lightFacing + wrap) / (1.0 + wrap), 0.0, 1.0);

  // A larger source also softens the terminator itself, so the lit band
  // fades in over a wider arc instead of snapping on.
  float edge0 = mix(0.10, 0.00, lightRadius);
  float edge1 = mix(0.95, 0.60, lightRadius);
  float lit = smoothstep(edge0, edge1, lambert);

  // The shadowed side is the complement, and is NOT wrapped: light that
  // bends round the edge fills shadow, it does not deepen it.
  float dark = smoothstep(0.10, 0.95, -lightFacing);

  // Ambient keeps the unlit border visible - a rim that reaches pure
  // black reads as a cut-out rather than a lit edge.
  float ambient = clamp(uLightAmbient, 0.0, 1.0);
  float borderLight = (ambient + (1.0 - ambient) * lit) * attenuation;

  col += rim * borderLight * cornerGain * 0.34 * uSpecular * uLightIntensity * uLightColor;
  col *= 1.0 - rim * dark * 0.16 * (1.0 - ambient);

  // Thin dark contact line just inside the edge reads as glass thickness.
  float contact = smoothstep(0.0, 1.0, t) * (1.0 - smoothstep(0.10, 0.30, t));
  col *= 1.0 - contact * 0.10;

  /* --- specular edge line --------------------------------------------
     A crisp ~1.5px line hugging the contour, bright on the side facing
     the light and faint on the far side - the "inset 0 1.5px 0 white"
     every CSS recreation of Apple's material reaches for. It is a MIX
     toward the light colour, not an addition: a real edge highlight
     saturates to white over any backdrop instead of blowing out.

     Measured in px inside the contour rather than in bevel units, so it
     stays a hairline as the bevel widens; the wobble is already in `d`,
     so the line follows the liquid motion. */
  // Starts half a pixel in so the line sits clear of the antialiased
  // boundary; overlapping it there costs the line most of its brightness.
  float edgePx = -d - 0.5;
  float ew = max(uEdgeWidth, 0.5);
  float edgeBand = smoothstep(0.0, ew * 0.6, edgePx)
                 * (1.0 - smoothstep(ew, ew * 2.2, edgePx));
  // The far side keeps a real bounce, not a token one. An edge is a
  // discontinuity in the surface all the way round, so it catches light
  // from the environment even where it faces away from the key: on a real
  // panel the line reads as a continuous thread that merely dims on the
  // shadow side, never as a highlight that stops partway round.
  //
  // The floor was low enough (0.16) that `attenuation` and `cornerGain`
  // could drive the far side to nothing, leaving the rim visibly broken -
  // a lit arc on the key side and bare contour opposite. Keeping the
  // ambient term clear of those two factors is what closes the loop.
  float edgeAmbient = 0.45;
  float edgeGlow = edgeAmbient
                 + (1.0 - edgeAmbient) * lit * attenuation * cornerGain;
  float edgeMix = clamp(edgeBand * edgeGlow * uEdgeLine * 0.85, 0.0, 1.0);
  col = mix(col, uLightColor, edgeMix);

  fragColor = vec4(col, inside);
}
