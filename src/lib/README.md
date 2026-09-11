# Liquid Glass - component API

```bash
npm install @taha_kadhim/liquid-glass
```

Attach the glass material to elements you already have.

```js
import { LiquidGlass } from '@taha_kadhim/liquid-glass';

new LiquidGlass(document.querySelector('.card'), { profile: 'apple' });
```

The library styles **only the material**. Your element keeps its own
layout, padding, radius, children and event handlers.

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
new LiquidGlass(el, { profile: 'crystal' });        // named
new LiquidGlass(el, { profile: 'crystal', ior: 2 }); // named + override
```

### Custom profiles

A brand usually wants an existing material in its own colour, not a new
optical model, so profiles are extendable:

```js
import { registerProfile } from '@taha_kadhim/liquid-glass';

registerProfile('brand', {
  extends: 'apple',
  tintColor: [1.0, 0.86, 0.72],
  lightColor: [1.0, 0.92, 0.82],
});

new LiquidGlass(el, { profile: 'brand' });
```

`resolveProfile(nameOrObject)` returns the full parameter set, so profiles
can be inspected, diffed, or serialised into a design system.

---

## Parameters

Anything below can be set per instance, or baked into a profile.

**Shape** - `radius` (adopted from the host's CSS when it has one),
`bevel`, `bevelPower` (2 = circular, hard edge; 4 = squircle, Apple),
`surface` (0 convex / 0.5 lip / 1 concave), `splay` (0 sheet -> 1 lens).

**Optics** - `ior`, `dispersion`, `thickness`, `frost`, `saturation`.

**Surface** - `tint`, `tintColor`, `specular`.

**Light** - `lightMode` (0 directional / 1 positional), `lightPos`,
`lightHeight`, `lightColor`, `lightIntensity`, `lightRange`,
`lightRadius`, `lightWrap`, `lightAmbient`.

**Motion** - `motion`, `quality`.

```js
glass.set('ior', 1.6);
glass.set({ frost: 0.3, tint: 0.1 });
glass.setProfile('lens');
```

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
new LiquidGlass(card, { profile: 'apple' });

// Over media you control - full shader pipeline.
new LiquidGlass(overlay, { profile: 'crystal', backdrop: videoEl });
```

Parameters the active tier cannot honour (the light source, `splay`,
`tint`) are stored but inert; the library logs once rather than failing
silently, since on Safari those tiers are the norm.

Force a tier for testing with `tier: 'svg' | 'blur' | 'webgl'`.

---

## Lifecycle

```js
const glass = new LiquidGlass(el, { profile: 'apple' });
glass.set({ frost: 0.4 });
glass.setBackdrop(video);   // enables/updates the WebGL source
glass.getParams();
glass.destroy();            // removes every layer, listener and GPU resource
```

`applyLiquidGlass('.card', { profile: 'apple' })` attaches to a selector
and returns the instances.

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
