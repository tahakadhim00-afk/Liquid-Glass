# Liquid Glass

[![npm](https://img.shields.io/npm/v/@taha_kadhim/liquid-glass)](https://www.npmjs.com/package/@taha_kadhim/liquid-glass)
[![license](https://img.shields.io/npm/l/@taha_kadhim/liquid-glass)](LICENSE)

**Liquid Glass** for the web: a water-drop material with real optical
refraction, every parameter overridable, and a drop-in component you
attach to elements you already have.

Not `backdrop-filter: blur()`. Blur *scatters* light; this *bends* it —
straight lines behind the panel visibly kink at the rim, which is what
separates Apple's material from the frosted "glassmorphism" that came
before it.

```bash
npm install @taha_kadhim/liquid-glass
```

```js
import { LiquidGlass } from '@taha_kadhim/liquid-glass';

new LiquidGlass(document.querySelector('.card'));                 // the water drop
new LiquidGlass(document.querySelector('.hero'), { ior: 1.5, motion: 0 }); // tuned
```

That is the whole integration. The library styles **only the material** —
your element keeps its own layout, padding, radius, children and event
handlers. Zero dependencies, ships with TypeScript types.

**[Full API reference →](src/lib/README.md)**

---

## The material

One material: a **water drop**. It is the default, so the simplest call is

```js
new LiquidGlass(el);
```

Its defaults — **every one overridable**, at construction, at runtime, or
through a named variant:

| Parameter | Default | Range | What it is |
|---|---|---|---|
| `ior` | `1.33` | `1`–`2.4` | Index of refraction — water's real value. `1` is air and bends nothing |
| `thickness` | `86` | `0`–`200` px | Virtual slab thickness. Scales the displacement |
| `bevel` | `90` | `1`–`300` px | Width of the refracting rim |
| `bevelPower` | `1.8` | `1`–`8` | Bevel sharpness: 2 = circle, 4 = squircle |
| `surface` | `0` | `0`–`1` | Height profile: 0 convex dome, 0.5 lip, 1 concave |
| `splay` | `0.55` | `0`–`1` | 0 = bevelled sheet (flat centre), 1 = thick lens |
| `dispersion` | `0.012` | `0`–`0.35` | Chromatic fringing at the edges |
| `frost` | `0.05` | `0`–`1` | Surface roughness: 0 polished, 1 etched |
| `specular` | `1.20` | `0`–`3` | Highlight strength |
| `saturation` | `1.10` | `0`–`2` | Backdrop saturation multiplier |
| `tint` | `0.02` | `0`–`1` | Tint strength, toward `tintColor` (default white) |
| `radius` | `110` | `0`+ px | Corner radius — see note |
| `motion` | `1.40` | `0`–`4` | Idle liquid wobble |

The three ways to set any of them:

```js
new LiquidGlass(el, { ior: 1.5, motion: 0 });   // at construction
glass.set({ frost: 0.2, specular: 0.8 });       // at runtime, several
glass.set('thickness', 60);                     // at runtime, one

registerProfile('card', { extends: 'water', thickness: 40 });
new LiquidGlass(el, { profile: 'card' });       // as a reusable variant
```

`splay`, `specular`, `tint` and `motion` need the WebGL tier; on the CSS
fallbacks they are stored but inert. See [which tier you
get](#understand-which-tier-you-get).

**[Full parameter reference, with ranges and recipes →](src/lib/README.md)**

**About `radius`:** the material adopts the element's own CSS
`border-radius` whenever it has one, so the shape follows your stylesheet
and the `110` default only applies to elements with no radius of their own.

A named variant is a set of overrides you want to reuse:

```js
import { registerProfile } from '@taha_kadhim/liquid-glass';

registerProfile('brand', {
  extends: 'water',
  tintColor: [1.0, 0.86, 0.72],
  tint: 0.10,
});

new LiquidGlass(el, { profile: 'brand' });
```

### Turning it up or down

`intensity` is a master gain on the optical effect. It scales `ior`,
`thickness`, `dispersion` and `frost` together, so the material keeps its
identity — the drop at 2 is still unmistakably water, just stronger.

```js
new LiquidGlass(el, { intensity: 2 });     // double
new LiquidGlass(el, { intensity: 0.5 });   // half
glass.set('intensity', 1.4);               // at runtime
```

| Value | Effect |
|---|---|
| `0` | Plain air. No refraction at all. |
| `0.5` | Half strength — restrained, good for dense UI. |
| `1` | The drop exactly as authored (default). |
| `2`+ | Exaggerated. Useful for hero panels. |

Reach for `intensity` before tuning `ior`/`thickness`/`dispersion` by hand:
those four interact, and raising one without the others is what makes glass
read as plastic. IOR is scaled about `1.0` (air), not about zero, because
the strength of a refraction is its *excess* over air.

It works on every tier, including the CSS fallbacks.

### Corner light

`cornerLight` adds gain to the rim light on the rounded corners only. A real
bevel curves in two directions where it turns a corner, so it gathers light
from a wider arc and reads brighter than the straight edges do.

```js
new LiquidGlass(el, { cornerLight: 2.5 });
```

`1` is physically neutral; higher exaggerates the corner glint the way
product renders do. Straight edges are left untouched at any value. WebGL
tier only — it needs per-pixel lighting.

### Edge treatment

Three parameters shape how the edge itself is drawn. The drop leaves the
hairline off — a bead of water has no hard edge to catch one — but turning
it on gives a harder, glassier rim:

| Parameter | What it does | Default |
|---|---|---|
| `edgeLine` | Strength of a thin specular line hugging the contour — bright on the side facing the light, faint on the far side. | `0` |
| `edgeWidth` | Its width in CSS px. Stays a hairline no matter how large the element is. | `1.5` |
| `rimWidth` | Width of the soft border-light band, as a fraction of the bevel. Narrow reads as glass; wide reads as an acrylic block. | `0.55` |

```js
new LiquidGlass(el, { edgeLine: 0.8, rimWidth: 0.3 }); // a crisp, hard-edged drop
```

WebGL tier only. On the CSS tiers, `inset 0 1.5px 0 rgba(255,255,255,.85)`
on the host is the equivalent.

---

## Guidelines

Practical rules for getting a good result. Most "it doesn't look like the
screenshots" reports come down to one of these.

### Give it something to refract

**Refraction is only visible when there is detail behind the panel.** Over
a flat colour, glass and blur look identical — that is physics, not a bug.
Put the panel over a photo, a gradient mesh, text, or anything with hard
edges. A bent straight line is unambiguous evidence of displacement; a
blurred gradient could be anything.

### Style the element, not the material

Set size, padding, border-radius and layout in your own CSS. The library
reads the host's box and **adopts its corner radius**, so the material
conforms to the shape you designed rather than imposing one.

```css
.card { border-radius: 26px; padding: 26px; }   /* yours */
```

```js
new LiquidGlass(card);                           /* material only */
```

### Keep text legible

Glass is a background treatment; contrast is still your job. The drop's
defaults displace enough to make small text swim, so behind body copy
lower `thickness` (say 40) and `splay` (0–0.2), and raise `frost` to push
the backdrop back. Remember `tint` only affects the WebGL tier.

### Understand which tier you get

This decides how good the effect can be, and it is the one thing worth
reading twice.

| Tier | Backdrop | Refraction | Availability |
|---|---|---|---|
| `webgl` | A texture **you supply** | Full shader: Snell refraction, dispersion, per-pixel light | Needs `backdrop:` |
| `svg` | Live DOM, free | Real displacement, no per-pixel lighting | Chromium |
| `blur` | Live DOM, free | None — scatter only | Universal |
| `none` | — | None | No `backdrop-filter` |

The reason for the split: **WebGL needs the backdrop as a texture it can
sample, and a browser will not let anyone read the composited page.** So
over ordinary page content the library uses `backdrop-filter`, which the
browser feeds the real backdrop for free. WebGL is opted into by handing
over a source:

```js
// Over page content — zero setup, SVG refraction on Chromium.
new LiquidGlass(card);

// Over media you control — the full shader pipeline.
new LiquidGlass(overlay, { backdrop: videoEl });
```

Parameters the active tier cannot honour (the light source, `splay`,
`tint`) are stored but inert. The library logs once rather than failing
silently, since on Safari those tiers are the norm.

### Clean up

Call `destroy()` when the element goes away — in a framework's unmount
hook, or before removing the node. It releases GPU resources and
listeners, and restores the host exactly as it was.

```js
useEffect(() => {
  const glass = new LiquidGlass(ref.current);
  return () => glass.destroy();
}, []);
```

### Use it sparingly

Each panel is a compositing layer. A handful is fine; a hundred is not.
Offscreen panels park their render loop automatically, but the cheapest
panel is the one you did not add.

---

## How it works

Per pixel, in one draw call:

| Stage | Technique |
|---|---|
| Shape | Rounded-rect SDF, `fwidth` antialiasing |
| Surface | A blend of convex, concave and "lip" height profiles (superellipse-based) |
| Normals | Central-difference derivative of the profile, rotated -90 degrees |
| Refraction | Snell's law via GLSL `refract()`, ray-marched to the backdrop plane so displacement is real geometry, not a tuned constant |
| Dispersion | Three IORs, one per colour channel, weighted by local surface tilt |
| Frost | Surface roughness as a true mip-based Gaussian blur — no milky haze, no desaturation, just scatter |
| Fresnel | Schlick approximation |
| Specular | Blinn-Phong, tight lobe + soft sheen, masked to the bevel |
| Border light | A configurable point or directional source shading the rim in real time — position, colour, intensity, falloff, size and wrap all live |

**Performance.** One draw call, no framebuffers, no post passes. A scissor
rect confines rasterization to the panel's bounding box. The backdrop
texture carries a mip chain, so the frost blur samples a pre-filtered
level instead of scaling its tap count with radius — cost stays constant
whether the blur is 5px or 500px. DPR is capped at 2, and
`prefers-reduced-motion` disables the idle wobble.

---

## Repository layout

```
src/lib/      the published library
src/core/     renderer, backdrop, tier fallbacks
src/shaders/  the GLSL
demo/         two demo pages (not published)
test/         Playwright suites
docs/         research notes
```

```bash
npm install
npm run dev          # demos at http://localhost:5173
npm test             # full suite, headless
npm run build:lib    # the publishable bundle
```

`npm run dev` serves two pages:

- **`/`** — the library used the way a site would use it.
- **`/playground.html`** — the shader with every parameter on a slider.
  Drag the panel, drop in your own image. This is the tuning surface; the
  library is the delivery surface.

### Tests

Six suites, all driven through headless Chromium with SwiftShader
software rendering, so results hold without a GPU. They assert behaviour,
not screenshots:

- **orientation** — the backdrop is sampled upright. A stray axis flip
  mirrors the page behind the glass and is invisible at the panel centre,
  where refraction is zero.
- **lens** — a bevelled sheet's interior is optically flat (zero
  displacement) while a thick lens bends light across its whole face.
- **light** — the border's bright band tracks a moved light source, dims
  with distance, and picks up the source's colour.
- **frost** — the blur actually blurs, brightness and saturation survive
  it unchanged, and the result stays smooth at every radius.
- **library** — the integration contract: content, layout and
  accessibility preserved; profiles resolve and override; geometry adopted
  from the host; `destroy()` leaves no trace; instances coexist; and
  toggling the material provably changes pixels.
- **params** — the parameter contract: every parameter the README
  documents as overridable provably moves pixels, by all three routes a
  caller has (construction, `set()`, and a registered profile). Asserting
  rendered output rather than `getParams()` is the point — a value that
  never reaches the shader would pass a state check.

The dev server must be running (`npm run dev`) before `npm test`.

---

## Contributing

Issues and pull requests are welcome.

- **Optical changes need a test.** The physics is subtle enough that
  "looks right to me" has been wrong more than once in this codebase — the
  frost model was rebuilt twice because a metric, not an eyeball, caught
  the problem. If you change the shader, add or extend an assertion.
- **Keep the tiers consistent.** A change to the WebGL optics usually
  needs the matching change in `src/core/fallback.js`, or the SVG tier
  drifts away from it.
- **Comment the why, not the what.** The existing comments explain the
  physical reasoning behind each constant; that is what makes the code
  maintainable.
- Run `npm test` before opening a PR.

---

## Research

[`docs/RESEARCH.md`](docs/RESEARCH.md) — the physics, the technology
comparison, the rendering pipeline, and the reasoning behind each
implementation decision: surface profiles and ray-marched refraction, the
configurable border light, and the frost/blur rewrite.

## License

MIT
