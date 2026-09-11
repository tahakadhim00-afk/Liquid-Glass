# Liquid Glass — Research & Implementation Plan

Research notes behind the prototype in this repo. Answers the 13 deliverables in [plan.md](../plan.md).

---

## 1. What Liquid Glass actually consists of

Apple's own framing is the most useful starting point. From the [June 2025 newsroom post](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/):

> "This translucent material **reflects and refracts** its surroundings, while dynamically transforming to help bring greater focus to content."
> "Liquid Glass uses **real-time rendering** and dynamically reacts to movement with **specular highlights**."
> "Its color is **informed by surrounding content** and intelligently adapts between light and dark environments."

Three claims matter technically:

1. **Refraction, not just blur.** This is *the* distinction from the frosted "glassmorphism" that preceded it. Frosted glass **scatters** light — a diffuse average of the backdrop. Liquid Glass **bends** it — the backdrop is geometrically displaced, so straight lines behind the panel visibly kink near the edges. Blur is diffusion; refraction is displacement. No amount of `backdrop-filter: blur()` produces the second, because blur only recombines each pixel with its neighbours in place — it never moves a pixel somewhere else.
2. **Real-time, per-frame.** Apple runs Metal shaders against the actual composited frame buffer. Highlights track the gyroscope. The material re-renders continuously rather than being a cached texture.
3. **Adaptive.** Tint and contrast are derived from what is behind the panel, so the material stays legible over both a white document and a dark photo.

On top of that sit the "liquid" behaviours: elements morph, merge, and separate; controls stretch and settle with a springy, surface-tension-like motion; layers of the material stack (Dock, icons, widgets are each "multiple layers of Liquid Glass").

### The component checklist

| Component | Physical basis | Visual role |
|---|---|---|
| Refraction / lensing | Snell's law | The signature. Bends the backdrop at the rim |
| Bevel / thickness profile | Surface geometry | Controls *where* the bend happens |
| Chromatic dispersion | Wavelength-dependent IOR | Subtle colour fringing on edges |
| Frost | Surface microroughness / scattering | Legibility of overlaid text |
| Fresnel reflectivity | Fresnel equations | Edges brighten, centre stays clear |
| Specular highlights | Microfacet BRDF | Reacts to motion; reads as "glossy" |
| Edge / rim light | Total internal reflection at the rim | Defines the shape crisply |
| Tint + saturation | Absorption, Beer–Lambert | Keeps content readable, adds richness |
| Shadow | Occlusion | Separates the layer from the page |
| Morph / spring motion | Surface tension | The "liquid" half |

---

## 2. The physics involved — and which parts are worth simulating

### Actually necessary

**Snell's law.** `n₁·sin θ₁ = n₂·sin θ₂`. Air (n≈1.0) to glass (n≈1.5). Because the panel's top surface is flat in the middle and curved only at the bevel, refraction is *zero* in the centre and *maximum* at the rim. That single fact produces the whole characteristic look: a clear centre with a distorted, compressed ring of backdrop around the edge.

GLSL has `refract(I, N, eta)` built in, which implements exactly this vector form. The displacement in screen space is then the refracted ray direction × the virtual thickness of the slab.

**Fresnel / Schlick approximation.** `F = F₀ + (1-F₀)(1-cos θ)⁵`, with `F₀ = ((n-1)/(n+1))² ≈ 0.04` for glass. Glass reflects ~4% of light head-on but approaches 100% at grazing angles. Since the bevel's normals tilt steeply at the rim, Fresnel automatically brightens the edges — this is why real glass has luminous borders, and faking it with a plain white border always looks flat by comparison.

**Dispersion.** Real glass has a slightly different IOR per wavelength (blue bends more than red — Abbe number). Rendering the R, G and B channels with three slightly different IORs gives the faint prismatic fringe. Physically small, visually disproportionate: it is a major part of why an effect reads as "real glass" and not "a shape with a filter on it."

### Approximated

- **Frost (surface roughness).** Physically, a rough surface scatters each incoming ray into a cone rather than a single direction. Simulating that properly means importance-sampling a microfacet distribution — far too expensive per pixel. It is approximated with a Poisson-disc blur, but the *consequences* of roughness are kept coupled to one control, because they always co-occur in reality: wider scatter, blacks lifted toward milky white (light bouncing back out of the surface), reduced saturation (many directions averaging), and a broader, dimmer specular lobe. Driving those independently is what makes most web "glass" read as a blurred rectangle rather than a material. Apple's scattering is clearly stronger than physics would justify — it exists for *legibility* of overlaid text.
- **Specular.** Blinn-Phong with a fixed virtual light rather than a real environment map. Cheap and entirely convincing at UI scale.
- **Single refraction event.** Real glass refracts on entry *and* exit, and internally reflects. We model one bend against a backdrop assumed to be directly behind the glass. The error is invisible at these thicknesses.
- **No caustics, no shadows through the glass, no total internal reflection.** All skippable.

### Deliberately unphysical

- Scattering that increases with edge proximity (physics says the *bend* increases there, not the roughness) — but it hides the sampling artefacts where displacement is largest, and matches Apple's look.
- Saturation boost on the backdrop. Purely an aesthetic choice; real glass *reduces* saturation slightly.

---

## 3. The rendering pipeline

The plan proposed: `Background → Blur → Distortion → Refraction → Lighting → Specular → Edge → Tint → Shadow → Animation`.

That's close but the ordering is wrong in two places, and it conflates two pairs of stages. The corrected model, which is what the shader implements:

```
0. Capture backdrop                → texture
1. Shape (SDF)                     → coverage + signed distance
2. Height field (bevel profile)    → thickness at each pixel
3. Normals (∇ of the height field) → surface orientation
4. Refraction (Snell, per channel) → displaced sample coordinates
5. Sample backdrop + frost         → refracted, scattered, milky backdrop
6. Fresnel                         → mix backdrop toward reflected sky
7. Specular + rim light            → additive highlights
8. Tint / saturation               → adaptive colour
9. Composite (alpha, shadow)       → onto the page
```

Two corrections worth stating explicitly:

- **Scattering must come *after* refraction, not before.** "Distortion" and "refraction" in the original list are the same stage. You displace the sample coordinate first, then blur around the *displaced* position. Blurring first and displacing second loses the ability to vary blur radius with bend amount, and costs an extra full-screen pass.
- **Normals come from a height field, not directly from the shape.** The step the naive model misses. The SDF gives you distance-to-edge; you must map that through a *bevel profile* to get thickness, and differentiate *that* to get normals. The choice of profile curve is what makes glass look like Apple's squircle bevel versus a water droplet.

The bevel profile used here is a superellipse:

```
h(t) = (1 - (1-t)^p)^(1/p)      t = distance from edge, normalised over bevel width
```

`p ≈ 1.8` gives a dome (water). `p ≈ 4` gives a flat top with a fast roll-off — the Apple look. `p ≈ 6+` gives a nearly sharp chamfer (crystal).

### Bevel vs lens: the structural choice

A bevel profile saturates to a flat top, so the interior of the panel refracts **nothing** — `slope → 0`, `N → (0,0,1)`. That is physically right for a sheet of glass with shaped edges, and it is what Apple's control layer looks like: a clear centre with the distortion concentrated in a ring at the rim.

It is *not* what thicker glass does, and not what Figma's Glass effect produces. There, the whole surface curves, so content is displaced and magnified across the entire face — the panel behaves like a **lens**, not a pane. Reproducing that needs a second height profile with continuous curvature; a spherical cap `h = sqrt(1 - r²)` works, blended against the bevel by a `splay` control.

Two details make the blend behave:

- **Normalise `r` per-axis** (`local / half_`), not from the SDF depth. SDF depth saturates at the *short* axis, so on a wide panel the entire middle stays flat and the lens is indistinguishable from a bevel exactly where it should differ most.
- **Blend the curvature *directions* too.** The bevel falls away from the nearest edge (following the SDF gradient); the lens falls away from the centre. Mixing only the slopes leaves the normal inconsistent with the height field.

The cap's analytic derivative `-r/sqrt(1-r²)` divided by a panel-sized radius is sub-pixel, so it is treated as a *shape* scaled by `uThickness` like the bevel, not as a literal sphere the size of the panel.

---

## 4. Technology comparison

| | A. CSS only | B. CSS + SVG filter | C. Canvas/WebGL | D. WebGPU | E. Hybrid |
|---|---|---|---|---|---|
| Real refraction | ✗ | ✓ | ✓ | ✓ | ✓ |
| Dispersion | ✗ | ✓ (3 passes) | ✓ (free) | ✓ | ✓ |
| Per-pixel Fresnel | ✗ | ✗ | ✓ | ✓ | ✓ |
| Live DOM backdrop | ✓ | ✓ | ✗ (must rasterize) | ✗ | partial |
| Browser support | universal | **Chromium only** for `backdrop-filter: url()` | ~98% | ~75% | universal via tiers |
| Perf | free | poor at large sizes | good | best | good |
| Complexity | trivial | medium | medium-high | high | high |
| Similarity to Apple | ~40% | ~75% | ~90% | ~92% | ~90% |

**The decisive constraint:** the browser gives no API to read the composited page as a texture. `backdrop-filter` is the *only* mechanism with real access to the backdrop — which is why the CSS/SVG route exists at all despite its limits. WebGL has full shader power but has to be handed its backdrop as pixels you rasterize yourself.

So the real trade-off is not quality vs. performance, it is **shader power vs. backdrop access**:

- **Option B** gets the live DOM backdrop but is limited to SVG's filter primitives (no true Fresnel, no per-pixel lighting, dispersion needs 3 duplicated displacement passes plus blends) and `backdrop-filter: url()` is Chromium-only — Firefox has no support, so it is a fallback anyway.
- **Option C** gets arbitrary shader math but you must supply the backdrop. For a *designed* page — where the background is a known canvas, image, video or WebGL scene — this costs nothing. For arbitrary DOM it needs `html2canvas`-style rasterization, which is slow and imperfect.
- **Option D** (WebGPU) is genuinely better — compute-shader blur, no per-frame texture re-upload — but ~75% support and no advantage at MVP scale.

### Recommendation: **Option E (hybrid), WebGL2-first**

- **Tier 1 — WebGL2 (~98% of browsers).** Full pipeline. Real Snell refraction, per-channel dispersion, Schlick Fresnel, Blinn-Phong specular, variable blur. One draw call, one fullscreen triangle.
- **Tier 2 — SVG displacement (Chromium, no WebGL).** `feImage` + three `feDisplacementMap` passes + `feBlend`. Real refraction over the live DOM, no per-pixel lighting.
- **Tier 3 — CSS blur (universal).** `backdrop-filter: blur() saturate()` plus layered inset shadows for the edge highlight. No refraction, still a credible glass panel.

Tier 1 was chosen as primary because the visual gap between "displaces the backdrop with real Fresnel" and "blurs the backdrop" is far larger than the gap between "live DOM backdrop" and "rasterized backdrop" — and because the WebGL tier works in Firefox and Safari, where the SVG tier does not.

---

## 5. Architecture

```
src/
  shaders/
    glass.vert.glsl   fullscreen triangle, no attributes
    glass.frag.glsl   the entire effect (~200 lines)
  core/
    renderer.js       WebGL2: program, uniforms, backdrop texture
    backdrop.js       paints the scene the glass refracts (swappable)
    panel.js          rect, drag, light, spring state, RAF loop
    fallback.js       tier detection + displacement-map generation
  main.js             wiring, presets, controls
```

The seam that matters is `backdrop.js`. The renderer accepts any `TexImageSource`, so the backdrop can be swapped for a video frame, a second WebGL scene, or an `html2canvas` raster of real DOM without touching the shader.

---

## 6. Open-source projects worth studying

| Project | Technique | Worth taking |
|---|---|---|
| [kube.io — Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css-svg/) | SVG displacement, derived from first principles | **The best writeup.** Snell's law → surface profiles → displacement-map encoding. The squircle bevel insight comes from here |
| [rizroze/liquid-glass](https://github.com/rizroze/liquid-glass) | Canvas-generated displacement map, 3-pass chromatic aberration, MIT | Clean tier-2 reference; the Canvas-over-SVG map generation trick |
| [PallavAg/liquid-glass-web-react](https://github.com/PallavAg/liquid-glass-web-react) | Filters the *content* rather than the backdrop | The cross-browser workaround for `backdrop-filter: url()` |
| [nikdelvin/liquid-glass](https://github.com/nikdelvin/liquid-glass) | Pure CSS+SVG components | Component API design |
| [Codrops — Infinite Liquid Glass Grid](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/) | Three.js + WebGPU + TSL | Multi-tap per-channel refraction loop; env-map reflection instead of render targets |
| [orectic — Refractive Glass with WebGL](https://zenn.dev/orectic/articles/liquid-glass-webgl-refraction?locale=en) | Raw GLSL, SDF + gradient normals | Closest to our approach; the DPR gotcha |
| [dashersw/liquid-glass-js](https://github.com/dashersw/liquid-glass-js) | WebGL, multiple shapes | Shape-specific SDF variants |
| [w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142) | Spec discussion | Where standardised backdrop refraction may land |

None were copied. The shader here is written from the physics, informed by the kube.io derivation and the Codrops per-channel tap structure.

---

## 7–8. MVP scope and phases

**In scope (built):** one draggable panel, live refraction of the backdrop, dispersion, blur, Fresnel, specular, rim light, adaptive tint, idle liquid motion, press response, pointer/gyroscope-driven light, three fallback tiers, live tuning controls, FPS readout.

| Phase | Status |
|---|---|
| 1. Scaffold, WebGL2 context, fullscreen triangle | ✅ |
| 2. SDF shape + antialiased coverage | ✅ |
| 3. Bevel height field + normals | ✅ |
| 4. Snell refraction + backdrop sampling | ✅ |
| 5. Dispersion + frost scattering | ✅ |
| 6. Fresnel + specular + rim | ✅ |
| 7. Interaction (drag, press spring, light tracking) | ✅ |
| 8. Fallback tiers + detection | ✅ |
| 9. Tuning UI + presets | ✅ |
| 10. Perf pass (DPR cap, dirty-flag repaint, adaptive taps) | ✅ |

---

## 9. Shader techniques required

- Rounded-rect SDF (Inigo Quilez) — shape, edge distance, free antialiasing via `fwidth`
- Superellipse height profile — the bevel
- Numerical gradient of the SDF — in-plane normal direction
- Finite-difference slope of the profile — normal tilt
- `refract()` — Snell, three times for dispersion
- Schlick — Fresnel
- Blinn-Phong, two lobes — tight specular + wide sheen
- Rotated Poisson disc — blur without banding
- `smoothstep` on the SDF — rim light and contact shadow

## 10. Performance

- **Scissor rect — the decisive optimization.** A fullscreen triangle rasterizes every pixel on screen even though only the panel survives the early-out. An early-`return` in the shader does *not* save the rasterization, only the shading. Confining `gl.scissor` to the panel's bounding box cut cost by ~10×.

  Measured at 1280×800 under **SwiftShader software rendering** (no GPU at all — a deliberately pessimistic floor):

  | | FPS |
  |---|---|
  | Fullscreen triangle | 9 |
  | Scissored to panel bbox | **64** |

  The scissor must clear the union of the current and previous frame's boxes, or a moving panel leaves trails.

- **One draw call.** No geometry, no framebuffers, no post passes.
- **DPR capped at 2.** 3× DPR triples fragment cost for no perceptible gain.
- **Dirty-flag backdrop.** The texture re-uploads only when the backdrop actually repaints. `texSubImage2D` of a full-screen canvas every frame is the main cost in naive implementations.
- **`texSubImage2D` over `texImage2D`** when dimensions are unchanged, avoiding reallocation.
- **Adaptive tap count** — `uQuality` scales blur taps 6→16.

### The texture orientation trap

The backdrop canvas is uploaded with `UNPACK_FLIP_Y_WEBGL = false`, which means its **top** row lands at `v = 0`. The texture is therefore **y-down** — the same space as `gl_FragCoord` once it has been flipped to match CSS. It is easy to assume "textures are y-up" out of habit, add a `uv.y = 1.0 - uv.y`, and mirror the entire backdrop.

The failure is deceptive because it is *invisible at the centre of the panel*. The bevel is flat there, so refraction is zero and the glass pixel matches the backdrop regardless of orientation. Only content with a readable direction — text, or an asymmetric gradient — exposes it, and then the panel renders the page behind it upside-down and mirrored.

The fix is to keep every stage in one space. `grad`, `N.xy`, `refract().xy`, `p` and `uv` are all y-down, so no axis flip appears anywhere in the sampling path. A second flip on the refraction offsets (`off.y = -off.y`) had been cancelling the first, which is why the bug survived earlier visual checks.

Guarded by `npm test` ([`test/orientation.test.mjs`](../test/orientation.test.mjs)): it samples the flat top of the panel, where refraction is negligible, and asserts each glass pixel matches the backdrop *directly behind it* — plus an explicit check that a pixel above centre does not match the backdrop below centre. Reintroducing the flip fails it.

### A verification trap worth recording

Reading back the canvas with `readPixels` *outside* a frame returns an empty buffer, because the browser discards the WebGL drawing buffer after compositing. During development this looked exactly like "the shader renders nothing" — the geometry, uniforms and texture were all provably correct while the readback showed zero drawn pixels.

`preserveDrawingBuffer: true` would also fix it, but it costs performance in normal operation. The right move is to fix the *test*: wrap `render()` and read back synchronously inside the same frame. Coverage then measured 8.53% against 8.59% expected for the panel's box — the small deficit being the rounded corners, which is the correct result.

## 11. Fallback strategy

`detectTier()` probes WebGL2 → `CSS.supports('backdrop-filter','url(#x)')` → blur, and also downgrades to a static tier under `prefers-reduced-motion`. Tier is surfaced in the UI so it can be verified rather than assumed. WebGL context-creation failure is caught at runtime and re-routed to a CSS tier rather than throwing.

## 12. How to test and compare

1. **The straight-line test.** Drag the panel over the grid lines. If the lines *kink* at the rim, refraction is working. If they only soften, it's just blur. This is the one test that distinguishes the effect from glassmorphism.

1b. **Automated lighting assertion.** Rim brightness is directional, so it can be asserted rather than eyeballed. Force the light to a known direction, then compare rim luminance on opposite edges:

   | Light direction | top | bottom | left | right |
   |---|---|---|---|---|
   | above `(0,-1)` | **109.5** | 39.2 | 47.5 | 58.8 |
   | below `(0,1)` | 46.7 | **98.5** | 48.4 | 58.8 |
   | left `(-1,0)` | 54.5 | 44.5 | **102.4** | 50.6 |

   The lit rim is ~2.8× brighter than the shadowed one in each case. This caught a genuine sign error: the shader works in y-down pixel space, and `uLight` was being negated inconsistently between the Blinn-Phong term and the rim term, which lit the *bottom* edge for a light placed above.
1c. **Frost monotonicity.** Frost claims three coupled effects, so all three are asserted across its range by sampling a block in the flat centre of the panel:

   | frost | mean luminance | local contrast | chroma |
   |---|---|---|---|
   | 0.00 | 46.1 | 17.4 | 43.4 |
   | 0.25 | 61.1 | 10.1 | 39.2 |
   | 0.50 | 76.0 | 6.0 | 35.6 |
   | 0.75 | 90.9 | 4.8 | 32.3 |
   | 1.00 | 105.9 | 4.8 | 29.1 |

   Luminance rises (milky haze), contrast falls (scattering), chroma falls (desaturation). A plain blur slider would move only the middle column — that difference is the whole point of the control.

2. **A/B against `subtle`.** The "Subtle" preset is deliberately near-frosted-glass. Toggle between it and "Apple-ish" over the same background.
3. **Side-by-side with a real screenshot.** Put an iOS 26 Control Centre screenshot behind the panel at matching size and compare rim brightness and bend radius.
4. **Text legibility.** Small type in the backdrop should smear and re-form at the edges but stay readable in the centre.
5. **Perf.** Watch the FPS readout while dragging; check on a low-power device.
6. **Tier verification.** Force each tier via `forceTier` and confirm all three render.

## 13. Improvements after the MVP

- **Real DOM backdrop** via `html2canvas` or the [HTML-in-Canvas](https://html-in-canvas.dev/) proposal, cached and re-rasterized only on mutation.
- **Multiple panels + morphing.** Panels that merge when close, via SDF `smin` — this is how Apple's controls fuse and split, and it comes almost free once shapes are SDFs.
- **WebGPU tier** with a compute-shader separable blur, replacing the Poisson disc.
- **Environment map** instead of a constant reflection tint, for genuine reflections.
- **Adaptive tint from backdrop luminance** — sample a mipmap of the backdrop and shift text/tint automatically, which is what Apple's "informed by surrounding content" actually means.
- **Spring physics on the shape itself** — stretch the SDF along the drag velocity vector so the panel deforms while moving.
- **Depth-of-field parallax** — offset the backdrop sample by device tilt for a sense of thickness.

---

## Sources

- [Apple Newsroom — a delightful and elegant new software design](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [kube.io — Liquid Glass in the Browser: Refraction with CSS and SVG](https://kube.io/blog/liquid-glass-css-svg/)
- [orectic — Creating Refractive Glass with WebGL Shaders](https://zenn.dev/orectic/articles/liquid-glass-webgl-refraction?locale=en)
- [Codrops — Building an Infinite Liquid Glass Grid with Three.js, WebGPU and TSL](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/)
- [rizroze/liquid-glass](https://github.com/rizroze/liquid-glass) · [PallavAg/liquid-glass-web-react](https://github.com/PallavAg/liquid-glass-web-react) · [nikdelvin/liquid-glass](https://github.com/nikdelvin/liquid-glass) · [dashersw/liquid-glass-js](https://github.com/dashersw/liquid-glass-js)
- [w3c/svgwg#1142 — interoperable backdrop displacement/refraction](https://github.com/w3c/svgwg/issues/1142)
- [MDN — backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)
- [LogRocket — How to create Liquid Glass effects with CSS and SVG](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/)

---

## 14. Refinements from kube.io's "Liquid Glass in the Browser"

Source: [kube.io/blog/liquid-glass-css-svg](https://kube.io/blog/liquid-glass-css-svg/).

The article builds the effect from a **ray simulation** rather than a hand-tuned
distortion, which exposed three places where our implementation was
physically ad-hoc. All three are now corrected in `glass.frag.glsl` and
mirrored in the SVG tier (`fallback.js`).

### 14.1 Ray travel is geometry, not a free parameter

The article traces a ray: it refracts at the surface, then travels in a
straight line until it reaches the backdrop plane. So the lateral offset is

```
displacement = height * tan(theta_refracted)
```

We previously used `depth = uThickness * mix(0.35, 1.0, h)`. That 0.35 floor
meant a **perfectly flat surface still displaced the backdrop by a third of
the slab** — even though a flat surface has a vertical normal and must not
bend light at all. The panel's interior drifted, which reads as a subtle
smear rather than clean glass.

Now `depth = uThickness * (h + uSplay)`. The `h` term is the surface relief;
the `uSplay` term is the solid body a thick lens adds, since a lens must
magnify across its whole face where a bevelled sheet must not. Measured: the
bevel interior went from a drifting offset to **exactly 0px**, while the lens
still bends progressively (0 → 4.7px toward the edge). Both are asserted in
`test/lens.test.mjs`.

### 14.2 `refract()` returns sin, but marching a ray needs tan

`refract()` hands back a **unit** vector, so its `.xy` is `sin(theta)`.
Multiplying that by a depth is only correct for small angles. Walking a ray
down to a plane needs the tangent:

```glsl
vec2 bendXY(vec3 I, vec3 N, float eta) {
  vec3 r = refract(I, N, eta);
  if (dot(r, r) < 1e-8) return vec2(0.0);   // total internal reflection
  return r.xy / max(abs(r.z), 0.25);
}
```

Dividing by `|z|` is what makes the bend *accelerate* as the surface steepens
near the rim. Using `.xy` alone quietly understates displacement exactly where
the glass bends hardest — the difference between "blur with a kink" and a real
optical edge.

### 14.3 Thickness was counted twice

The old normal was `normalize(vec3(-dir * slope * uThickness, 1.0))` while the
ray length *also* scaled with thickness. Raising thickness therefore steepened
the normal **and** lengthened the ray, so displacement grew quadratically and
tipped into total internal reflection early.

Slopes are now true rise/run gradients (each profile carries its own
`uThickness / span` factor), so the normal is the article's construction
exactly — the derivative rotated -90 degrees, `(-m, 1)` — and thickness is
applied once, via the ray length.

### 14.4 The surface-function family

The article defines four profiles on the bezel's `[0,1]` span:

| profile | formula |
|---|---|
| convex circle | `y = sqrt(1 - (1-x)^2)` |
| convex squircle | `y = (1 - (1-x)^4)^(1/4)` |
| concave | `y = 1 - convex(x)` |
| lip | `y = mix(convex, concave, smootherstep(x))` |

Our generalised superellipse `h = (1 - (1-t)^p)^(1/p)` already covered both
convex cases (`p=2` *is* the circle, `p=4` the squircle). Added `uProfile` to
reach the other two: **0 = convex, 0.5 = lip, 1 = concave**.

The **lip** is the important addition — a raised rim over a shallow centre
dip. It gathers light hard at the edge and releases it across a gently dished
face, which is closer to Apple's material than a single dome. It is now the
default (`profile: 0.5`) and the `apple` preset.

Smootherstep (`6t^5 - 15t^4 + 10t^3`) is used for the blend because its second
derivative vanishes at both ends, so the convex→concave transition leaves no
visible crease.

On circle vs squircle, the article's point is optical: the circle's slope is
*infinite* at the edge — a hard optical boundary — while the squircle keeps
the gradient smooth even when stretched around a long rectangle. That is why
`crystal` moved from `bevelPower: 6.0` to `2.0`: it wants the sharp circular
edge, where the Apple-like presets want the squircle's forgiveness.

### 14.5 Normalised displacement maps (SVG tier)

The article stores the map **normalised to its own maximum**, then reuses that
maximum as `feDisplacementMap`'s `scale`:

```js
r: 128 + x * 127,   // 0 -> -1,  128 -> neutral,  255 -> +1
g: 128 + y * 127,
```

This matters because an 8-bit channel has only 127 steps either side of
neutral: encoding raw pixel offsets wastes most of that range when
displacement is small and clips when it is large. `buildDisplacementMap()` now
runs the ray simulation in one pass, normalises in a second, and returns
`{ url, scale }`.

A side effect is that per-channel dispersion is now derived rather than
guessed. The three `feDisplacementMap` scales used to be fixed at
`thickness × {1.0, 0.94, 0.88}`; they now follow each channel's own IOR
through `(n - 1)`, so blue bends more than red because of the physics.
Measured for the default preset: **29.24 / 30.65 / 32.05 px**.

### 14.6 Known limitation

`backdrop-filter: url(#filter)` remains **Chromium-only**, so the SVG tier is
Chrome-only by construction — the article notes the same. Our WebGL tier is
the portable path; `detectTier()` still orders WebGL2 → SVG → blur.

---

## 15. The border gradient as a real light source

The rim used to be lit by a bare 2D direction (`uLight`). That is a
*directional* light — parallel rays, one incoming angle for the whole
border — so the gradient could rotate but never behave like a lamp at a
place in the scene. It is the shading equivalent of a static CSS gradient
that happens to be steerable.

The border is now shaded by a configurable source with position, colour,
intensity and falloff, evaluated **per pixel**.

### 15.1 Two source types, blended not branched

```glsl
vec3 dirL = normalize(vec3(-uLight, 0.85));            // sun
vec3 toLamp = vec3(uLightPos - p, max(uLightHeight, 1.0));
vec3 posL = toLamp / max(length(toLamp), 1e-4);        // lamp
vec3 L = normalize(mix(dirL, posL, clamp(uLightMode, 0.0, 1.0)));
```

`uLightMode` blends rather than branches, so the two types can be
cross-faded and animated without popping at the midpoint.

The important consequence is that for a positional source, **every pixel of
the border computes its own direction to the lamp**. That is what makes the
bright band sweep round the shape as the source moves, and what a fixed
gradient fundamentally cannot reproduce.

### 15.2 Falloff

```glsl
float dr = lampDist / uLightRange;
falloff = 1.0 / (1.0 + dr * dr);
```

Inverse-square, but expressed as a rational curve so it reaches exactly
half brightness at `uLightRange` instead of diverging as the source
approaches the surface. Only the positional term is attenuated —
`mix(1.0, falloff, mode)` — because a directional light is at infinity.
`uLightRange = 0` disables falloff entirely.

### 15.3 Source size, wrap and ambient

A point source gives a hard glint; a broad source (a softbox) wraps
further round the border and softens its terminator. Both follow from the
apparent radius:

```glsl
float lambert = clamp((lightFacing + wrap) / (1.0 + wrap), 0.0, 1.0);
float edge0 = mix(0.10, 0.00, lightRadius);
float edge1 = mix(0.95, 0.60, lightRadius);
float lit = smoothstep(edge0, edge1, lambert);
```

`uLightWrap` is the classic half-Lambert remap — light reaching past the
90° terminator. It is applied to the lit term only, never to the shadow
term: light bending round an edge *fills* shadow, it does not deepen it.

`uLightRadius` also widens the specular lobe, with a matching drop in peak
intensity (`spec *= mix(1.0, 0.35, lightRadius)`) so that enlarging a
source spreads its energy instead of simply adding more.

`uLightAmbient` is a floor that keeps the unlit border visible — a rim
falling to pure black reads as a cut-out rather than a lit edge.

### 15.4 Interaction with the refraction model

The lighting is deliberately layered *on top of* the §14 optics and does
not perturb them. `grad` — the outward SDF gradient already computed for
the bevel normal — doubles as the border's in-plane surface normal, so the
gradient is Lambertian shading of the real geometry rather than a
decorative overlay, and it is continuous round the whole contour with no
seams at the corners.

`uLightColor` multiplies the border and specular terms only, never the
refracted backdrop: a coloured lamp tints the *edge*, and light already
transmitted through the glass is left alone.

The `lens.test.mjs` refraction assertions are unchanged and still pass,
confirming the optics were not disturbed.

### 15.5 Verified

`test/light.test.mjs` asserts the three behaviours a static gradient could
not produce. Measured:

| lamp position | L | R | T | B |
|---|---|---|---|---|
| left | **222** | 93 | 76 | 101 |
| right | 137 | **239** | 77 | 101 |
| top | 83 | 101 | **215** | 89 |
| bottom | 83 | 101 | 106 | **241** |

The edge nearest the lamp is always brightest. Falloff dims a receding
lamp from 165.8 to 86.7, and a warm source gives a border of
`rgb(214,130,111)` where a cool one gives `rgb(78,130,246)` on the same edge.

Brightness is sampled from a page **screenshot**, not from the WebGL
canvas: reading the drawing buffer back after the frame is presented
returns empty pixels and would report zero regardless of what is on screen.

### 15.6 Note on the SVG tier

These are WebGL-tier uniforms. The SVG fallback keeps its previous static
edge treatment — `feDisplacementMap` has no lighting stage, and matching
this would need `feSpecularLighting` with an `fePointLight` whose position
is rewritten per frame. Worth doing if the SVG tier becomes a primary
target; it is currently the Chromium-only fallback.


---

## 16. Frost was modelling the wrong material

Compared against Figma's Glass effect, our frost was clearly wrong: at a
*low* setting (21) Figma produces a strong, clean blur over a backdrop
that stays **dark and fully saturated**, while ours produced a weak blur
buried under grey fog. Three faults, plus a latent sampling bug.

### 16.1 The milky term was physically misattributed

```glsl
// removed
col = mix(col, vec3(0.94, 0.96, 1.0), frost * 0.30);
```

This was justified as "light bounces back out, blacks lift toward milky
white". That is **subsurface scattering in a thick translucent solid** -
frosted plastic, wax, marble - where light enters a volume, bounces
repeatedly, and re-emerges diffusely.

A frosted glass *surface* is not that. It is a thin roughened boundary a
few microns deep: it changes the *direction* of transmitted light and
essentially nothing else. No volume, no multiple scattering, no white
veil. Modelling the thin surface as a scattering volume is what turned
every scene into flat haze.

### 16.2 Frost was also desaturating

```glsl
// removed
col = saturate3(col, mix(1.0, 0.82, frost));
```

Averaging many directions of the *same* scene does not pull colour toward
grey, it softens detail. Some saturation loss is inherent to blurring a
multicoloured scene - a plain `blur(120px)` of this repo's demo backdrop
loses ~17% on its own - but that is a consequence of averaging, not a
filter to stack on top of it.

### 16.3 The response curve made the good range unreachable

`frost * frost * 46.0` gave the "apple" preset (frost 0.44) just **8.9px**
of blur. Squaring pushed everything useful into the last third of the
slider, so reaching a normal frosted look meant pushing frost high, which
maximised both faults above. Now `pow(frost, 1.35) * 130.0`: fine control
near zero, genuinely strong blur by mid-slider. Presets were re-targeted
(apple 0.44 -> 0.22, subtle 0.72 -> 0.42, crystal 0.16 -> 0.07,
water 0.10 -> 0.05).

### 16.4 The sparse-disc blur could not be made clean

Raising the radius exposed the real bug. The blur scattered a rotated
16-tap Poisson disc across the radius; at 130px those taps sit tens of
pixels apart, so it was not a blur but a sparse average. Measured
high-frequency energy *rose* with radius - the opposite of blurring - and
it looked like grain and ghosting.

Mip-sampling the taps helped but did not fix it (peak grain 1.90 -> 1.10),
because a fixed tap budget spread over a growing radius always leaves
gaps, and the gaps are the grain. Per-pixel rotation only converts banding
into noise.

The fix is to stop asking the taps to span the radius at all, which is
what `backdrop-filter: blur()` and a real OS sidebar do. Choose a mip
level where sigma is only a couple of texels, then a small fixed kernel
covers it completely:

```glsl
float sigmaPx = radiusPx * 0.5;
float kernelTexels = (uQuality < 0.5 ? 2.0 : 3.0) / 1.35;
float lod = max(log2(sigmaPx / kernelTexels), 0.0);
float sigma = sigmaPx / exp2(lod);
```

A full 7x7 2D kernel, not a cross: sampling only along the axes leaves the
diagonals under-blurred, which reads as a faint plus shape around bright
spots. 49 taps is affordable precisely because the mip makes the cost
**constant** - a 500px blur costs the same as a 50px one, it just reads a
coarser level. The sigma cap is tied to the kernel radius so lowering
quality also picks a coarser mip, rather than truncating the gaussian.

The backdrop texture now carries a mip chain (`LINEAR_MIPMAP_LINEAR`,
regenerated on each upload).

### 16.5 Verified

`test/frost.test.mjs`, with lighting, tint and dispersion switched off so
the backdrop is isolated. (The rim and Fresnel terms lay a smooth ramp
across the panel; as blur flattens the backdrop that ramp becomes most of
the remaining signal and reads as rising "detail" even when the blur is
perfectly clean.)

| frost | detail | meanLum | saturation | grain |
|---|---|---|---|---|
| 0 | 4.29 | 58.5 | 0.509 | 3.097 |
| 0.21 | 0.78 | 58.4 | 0.498 | 0.381 |
| 0.5 | 0.55 | 58.6 | 0.479 | 0.256 |
| 1.0 | 0.54 | 59.0 | 0.446 | 0.252 |

Grain now **falls and stays flat** rather than climbing back. The decisive
assertion is `grain does not grow with radius`: the sparse-disc version
bottomed out at 0.43 and rose to 1.10 at full frost (2.5x), which that
check rejects. Mean luminance is flat across the whole range (58.5 ->
59.0), pinning down the milkiness regression - the old code lifted it by
tens of levels.

### 16.6 Cost

Measured under SwiftShader (a CPU rasteriser, so a worst case): sustained
throughput falls ~38% from frost 0 to frost 1. On a real GPU 49 texture
fetches over a panel-sized area is routine, and the mip keeps that cost
independent of blur radius. `uQuality < 0.5` drops to a 5x5 kernel.
