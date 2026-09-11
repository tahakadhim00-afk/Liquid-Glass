# Liquid Glass - component API

```bash
npm install @taha_kadhim/liquid-glass
```

Attach the glass material to elements you already have.

```js
import { LiquidGlass } from '@taha_kadhim/liquid-glass';

new LiquidGlass(document.querySelector('.card'));                  // the water drop
new LiquidGlass(document.querySelector('.hero'), { ior: 1.5, motion: 0 });
```

The library styles **only the material**. Your element keeps its own
layout, padding, radius, children and event handlers.

---

## The material

One material: a **water drop**. It is the default. Every parameter below
is a plain default you can override per instance or at runtime.

| Parameter | Default | What it is |
|---|---|---|
| `ior` | `1.33` | Index of refraction |
| `thickness` | `86` | Virtual slab thickness, px. Scales the displacement |
| `bevel` | `90` | Width of the refracting rim, px |
| `bevelPower` | `1.8` | Bevel sharpness: 2 = circle, 4 = squircle |
| `surface` | `0` | Height profile: 0 convex, 0.5 lip, 1 concave |
| `splay` | `0.55` | 0 = bevelled sheet, 1 = thick lens |
| `dispersion` | `0.012` | Chromatic fringing |
| `frost` | `0.05` | Surface roughness, 0..1 |
| `specular` | `1.20` | Highlight strength |
| `saturation` | `1.10` | Backdrop saturation multiplier |
| `tint` | `0.02` | Tint strength toward `tintColor` (default white) |
| `radius` | `110` | Corner radius, px. Adopted from the host's CSS when it has one |
| `motion` | `1.40` | Idle liquid wobble |

```js
new LiquidGlass(el, { thickness: 40, splay: 0.2 });  // at construction
glass.set('ior', 1.6);                               // at runtime
glass.set({ frost: 0.3, tint: 0.1 });
```

### Named variants

A variant is a set of overrides you want to reuse:

```js
import { registerProfile } from '@taha_kadhim/liquid-glass';

registerProfile('brand', {
  extends: 'water',
  tintColor: [1.0, 0.86, 0.72],
  lightColor: [1.0, 0.92, 0.82],
});

new LiquidGlass(el, { profile: 'brand' });
glass.setProfile('brand');
```

`resolveProfile(nameOrObject)` returns the full parameter set, so variants
can be inspected, diffed, or serialised into a design system.

### More parameters

**Strength** - `intensity` scales `ior`, `thickness`, `dispersion` and
`frost` together (1 = as authored, 2 = double). `cornerLight` adds gain to
the rim light at the rounded corners.

**Edge** - `edgeLine` (0..1) draws a thin specular line at the contour,
`edgeWidth` sets its width in px, `rimWidth` sets the soft border band as
a fraction of the bevel. The drop leaves the line off.

**Light** - `lightMode` (0 directional / 1 positional), `lightPos`,
`lightHeight`, `lightColor`, `lightIntensity`, `lightRange`,
`lightRadius`, `lightWrap`, `lightAmbient`.

**Cost** - `quality` (<0.5 uses a smaller blur kernel).

---

## Renderer tiers

The library picks a tier from what the browser can do **and** from whether
you gave it a backdrop to sample. This is the one thing worth
understanding, because it decides how good the effect can be.

| Tier | Backdrop | Refraction | Availability |
|---|---|---|---|
| `webgl` | A texture **you supply** | Full shader: Snell refraction, dispersion, per-pixel light | Needs `backdrop:` |
| `svg` | Live DOM, free | Real displacement, no per-pixel lighting | Chromium |
| `blur` | Live DOM, free | None - scatter only | Universal |
| `none` | - | None | No `backdrop-filter` |

The reason for the split: **WebGL needs the backdrop as a texture it can
sample, and a browser will not let anyone read the composited page.** So
over ordinary page content the library uses `backdrop-filter`, which the
browser feeds the real backdrop for free. WebGL is opted into by handing
over a source:

```js
// Over page content - zero setup, SVG refraction on Chromium.
new LiquidGlass(card);

// Over media you control - full shader pipeline.
new LiquidGlass(overlay, { backdrop: videoEl });
```

Parameters the active tier cannot honour (the light source, `splay`,
`tint`, the edge line) are stored but inert; the library logs once rather
than failing silently, since on Safari those tiers are the norm.

Force a tier for testing with `tier: 'svg' | 'blur' | 'webgl'`.

---

## Lifecycle

```js
const glass = new LiquidGlass(el, { motion: 0.5 });
glass.set({ frost: 0.4 });
glass.setBackdrop(video);   // enables/updates the WebGL source
glass.getParams();
glass.destroy();            // removes every layer, listener and GPU resource
```

`applyLiquidGlass('.card', { motion: 0 })` attaches to a selector and
returns the instances.

The component re-measures on resize, scroll and `ResizeObserver`, and an
`IntersectionObserver` parks the render loop for offscreen panels so a
page full of them does not burn frames. `prefers-reduced-motion` disables
the idle wobble.

---

## Integration notes

- The host needs a containing block. If it is `position: static` the
  library sets `relative` and restores it on destroy.
- Effect layers are `aria-hidden` with `pointer-events: none`, so
  accessibility and hit-testing are unaffected.
- For refraction to be *visible* there must be detail behind the panel.
  Over a flat colour, glass and blur look the same - that is physics, not
  a bug.
