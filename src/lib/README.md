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
is a plain default, and **all of them are overridable** — at construction,
at runtime, or through a named variant.

### The three ways to set any parameter

```js
// 1. at construction
const glass = new LiquidGlass(el, { ior: 1.5, thickness: 40 });

// 2. at runtime — one key, or several at once
glass.set('ior', 1.6);
glass.set({ frost: 0.3, splay: 0.2 });

// 3. as a reusable named variant
registerProfile('card', { extends: 'water', thickness: 40, splay: 0.1 });
new LiquidGlass(el, { profile: 'card' });
```

All three accept every parameter in the table below. `glass.getParams()`
returns the current resolved set.

### The parameters

| Parameter | Default | Range | What it does |
|---|---|---|---|
| `ior` | `1.33` | `1`–`2.4` | Index of refraction. `1` bends nothing (air), `1.33` water, `1.5` glass, `2.4` diamond. The single biggest lever on how much the backdrop distorts. |
| `thickness` | `86` | `0`–`200` px | Virtual slab thickness. Scales displacement: how *far* a refracted ray travels before it hits the backdrop. Lower it behind text. |
| `bevel` | `90` | `1`–`300` px | Width of the refracting rim. Small = a thin bevelled edge on a flat sheet; large = the whole panel reads as a bead of liquid. |
| `bevelPower` | `1.8` | `1`–`8` | Bevel sharpness. `2` is a circular arc, `4` a squircle, higher a harder chamfer. Low values round the profile off. |
| `surface` | `0` | `0`–`1` | Height profile. `0` convex dome, `0.5` lip (raised rim over a shallow dish), `1` concave. |
| `splay` | `0.55` | `0`–`1` | Lens vs bevel. `0` = bevelled sheet with an optically flat centre; `1` = thick lens whose whole face curves and magnifies. |
| `dispersion` | `0.012` | `0`–`0.35` | Chromatic fringing — per-channel IOR, the prism effect. Concentrated where the surface tilts hardest. |
| `frost` | `0.05` | `0`–`1` | Surface roughness. `0` polished, `1` heavily etched. A true blur, not a milky haze. |
| `specular` | `1.20` | `0`–`3` | Highlight strength. `0` removes the glint entirely. |
| `saturation` | `1.10` | `0`–`2` | Backdrop saturation multiplier. `0` renders the refracted image greyscale. |
| `tint` | `0.02` | `0`–`1` | Tint strength toward `tintColor` (default white). Pair the two to colour the glass. |
| `radius` | `110` | `0`–`∞` px | Corner radius. **Adopted from the host's CSS `border-radius` whenever it has one**, so this default only applies to elements with no radius of their own. |
| `motion` | `1.40` | `0`–`4` | Idle liquid wobble. `0` freezes the surface. Forced to `0` under `prefers-reduced-motion`. |

> **Four of these need the WebGL tier**: `splay`, `specular`, `tint` and
> `motion` are stored but inert on the SVG and blur fallbacks, which have
> no per-pixel lighting. Pass a `backdrop` source to opt into WebGL. The
> library logs once rather than failing silently.

### Recipes

```js
// Behind body copy: less displacement, flatter face, more scatter.
new LiquidGlass(el, { thickness: 40, splay: 0.1, frost: 0.25 });

// A hero panel: exaggerated, over a photo.
new LiquidGlass(el, { intensity: 1.8, edgeLine: 0.8 });

// Static, cheap: no wobble, no glint.
new LiquidGlass(el, { motion: 0, specular: 0.4, dispersion: 0 });

// A hard-edged pane rather than a droplet.
new LiquidGlass(el, { splay: 0, bevel: 24, bevelPower: 4, edgeLine: 0.9 });
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
