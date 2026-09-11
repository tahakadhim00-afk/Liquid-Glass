# Liquid Glass

[![npm](https://img.shields.io/npm/v/@taha_kadhim/liquid-glass)](https://www.npmjs.com/package/@taha_kadhim/liquid-glass)
[![license](https://img.shields.io/npm/l/@taha_kadhim/liquid-glass)](LICENSE)

Apple-style **Liquid Glass** for the web. Real optical refraction, five
material profiles, and a drop-in component you attach to elements you
already have.

Not `backdrop-filter: blur()`. Blur *scatters* light; this *bends* it —
straight lines behind the panel visibly kink at the rim, which is what
separates Apple's material from the frosted "glassmorphism" that came
before it.

```bash
npm install @taha_kadhim/liquid-glass
```

```js
import { LiquidGlass } from '@taha_kadhim/liquid-glass';

new LiquidGlass(document.querySelector('.card'), { profile: 'apple' });
```

That is the whole integration. The library styles **only the material** —
your element keeps its own layout, padding, radius, children and event
handlers. Zero dependencies, ships with TypeScript types.

**[Full API reference →](src/lib/README.md)**

---

## Profiles

Five built-in optical profiles. Each is a physical material, not a theme.

| Profile | Character | Key parameters |
|---|---|---|
| `apple` | Thin control-layer sheet. Flat centre, bending gathered at the rim. | `splay 0`, `surface 0.5` (lip), `ior 1.48` |
| `water` | Convex droplet. Wide soft bevel, clear, wobbles. | `surface 0` (convex), `ior 1.33`, `motion 1.4` |
| `crystal` | Cut stone. Hard circular edge, prismatic fringes. | `ior 1.9`, `dispersion 0.075`, `bevelPower 2` |
| `lens` | Figma-style. The whole face curves and magnifies. | `splay 0.85`, `frost 0` |
| `subtle` | Near-frosted, for dense UI. The A/B control. | `ior 1.18`, `frost 0.42` |

```js
new LiquidGlass(el, { profile: 'crystal' });         // named
new LiquidGlass(el, { profile: 'crystal', ior: 2 }); // named + override
```

A brand usually wants an existing material in its own colour, not a new
optical model, so profiles are extendable:

```js
import { registerProfile } from '@taha_kadhim/liquid-glass';

registerProfile('brand', {
  extends: 'apple',
  tintColor: [1.0, 0.86, 0.72],
});
```

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
new LiquidGlass(card, { profile: 'apple' });     /* material only */
```

### Keep text legible

Glass is a background treatment; contrast is still your job. Prefer
`apple` or `subtle` behind body copy — `crystal` and `water` displace
enough to make small text swim. Raise `frost` to push the backdrop back,
and remember `tint` only affects the WebGL tier.

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
new LiquidGlass(card, { profile: 'apple' });

// Over media you control — the full shader pipeline.
new LiquidGlass(overlay, { profile: 'crystal', backdrop: videoEl });
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
  const glass = new LiquidGlass(ref.current, { profile: 'apple' });
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

Five suites, all driven through headless Chromium with SwiftShader
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
