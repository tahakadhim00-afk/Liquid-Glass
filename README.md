# Liquid Glass

An Apple-style **Liquid Glass** effect for the web: real optical refraction in a WebGL2 fragment shader, with a configurable light source and graceful fallbacks for browsers without WebGL2.

Not `backdrop-filter: blur()`. Blur *scatters* light; this *bends* it — straight lines behind the panel visibly kink at the rim, which is the thing that separates Apple's material from the frosted "glassmorphism" that came before it.

```bash
npm install
npm run dev      # http://localhost:5173
```

Drag the panel. Move the pointer to steer the light. Arrow keys nudge when focused.

## Install

```bash
npm install @taha_kadhim/liquid-glass
```

## Two ways to use it

**As a library**, attached to elements you already have:

```js
import { LiquidGlass } from '@taha_kadhim/liquid-glass';

new LiquidGlass(document.querySelector('.card'), { profile: 'apple' });
```

Five optical profiles - `apple`, `water`, `crystal`, `lens`, `subtle` -
each a physical material rather than a theme, all extendable. The library
styles only the material: your element keeps its layout, radius, children
and handlers. Ships as a single dependency-free ES module with TypeScript types. See
[`src/lib/README.md`](src/lib/README.md) for the full API, and
`npm run dev` then open `/lib-demo.html` for a working page.

**As a playground**, the shader demo at `/` with every parameter exposed
on sliders. That is the tuning surface; the library is the delivery
surface.

## What it does

Per pixel, in one draw call:

| Stage | Technique |
|---|---|
| Shape | Rounded-rect SDF, `fwidth` antialiasing |
| Surface | A blend of convex, concave and "lip" height profiles (superellipse-based), selectable per panel |
| Normals | Central-difference derivative of the profile, rotated -90 degrees |
| Refraction | Snell's law via GLSL `refract()`, ray-marched to the backdrop plane so displacement is real geometry, not a tuned constant |
| Dispersion | Three IORs, one per colour channel, weighted by local surface tilt |
| Frost | Surface roughness as a true mip-based Gaussian blur — no milky haze, no desaturation, just scatter |
| Fresnel | Schlick approximation |
| Specular | Blinn-Phong, tight lobe + soft sheen, masked to the bevel |
| Border light | A configurable point or directional source shading the rim in real time — position, colour, intensity, falloff, size and wrap all live |

## Renderer tiers

Detected at runtime and shown in the UI:

1. **WebGL2** (~98% of browsers) — the full pipeline above.
2. **SVG displacement** (Chromium without WebGL) — `feImage` + three `feDisplacementMap` passes, with per-channel scale derived from the same refraction physics as the WebGL tier. Real refraction, no per-pixel border lighting. `backdrop-filter: url()` is Chromium-only.
3. **CSS blur** (universal) — `backdrop-filter: blur() saturate()` plus layered inset shadows.

`prefers-reduced-motion` drops the idle liquid animation.

Force a tier for testing: `window.__forceTier = 'svg' | 'blur'` before load.

## Testing on your own image

**Upload image** in the controls, or drop a file anywhere on the page. The image replaces the demo scene as the backdrop, cover-fit and cropped rather than stretched; **Use demo scene** restores the original.

Worth doing: a synthetic gradient is smooth enough to hide sampling errors that a real photo exposes immediately. Photos with hard straight edges — architecture, text, window frames — are the most revealing, because a bent straight line is unambiguous evidence of refraction where a blurred one could be anything.

## Tuning

Live parameters and five presets — *Apple-ish*, *Water drop*, *Crystal*, *Subtle*, *Lens (Figma-like)*. The ones that change the character most:

- **Bevel sharpness** (`bevelPower`) — 1.8 is a water droplet, 4 is the Apple squircle, 6+ is a cut crystal chamfer.
- **Surface profile** — convex, concave, or the "lip" blend between them (raised rim, shallow centre dip). Lip is the default and is closest to Apple's control layer.
- **Splay** — bevelled sheet (0) vs thick lens (1). This is the biggest structural control. At 0 the centre of the panel is optically flat and all the bending happens at the rim: correct for a sheet of glass with shaped edges, and the closest match to Apple's control layer. At 1 the whole face curves, so content is displaced and magnified right across the panel — the behaviour Figma's Glass effect produces, and what reads as *thick* glass rather than a pane.
- **Index of refraction** — 1.33 water, 1.5 glass, 1.9+ prismatic.
- **Frost** — surface roughness, 0 polished to 1 etched. A scatter-radius slider only: it widens the backdrop blur and nothing else. It does not add haze or drain colour — a rough glass *surface* redistributes the light passing through it, it does not behave like a translucent solid.

The border gradient is shaded by a real light, not a static CSS gradient — moving the pointer steers a directional source and the rim brightens and darkens accordingly, rather than a fixed sheen baked into the shape. The underlying model (position, colour, intensity, falloff, source size, wrap) is a panel option (`LiquidGlassPanel` constructor / `setOption`) rather than exposed in the demo UI.

Compare *Apple-ish* against *Subtle* over the same background: *Subtle* is deliberately near-frosted-glass, so the difference is exactly the contribution of refraction.

## Using it elsewhere

The backdrop is pluggable. `renderer.setBackdrop()` accepts any `TexImageSource`, so swap [`src/core/backdrop.js`](src/core/backdrop.js) for a video frame, a WebGL scene, or an `html2canvas` raster without touching the shader.

```js
import { LiquidGlassPanel } from './core/panel.js';
const panel = new LiquidGlassPanel(document.body, { width: 400, height: 220, ior: 1.48 });
```

## Performance

One draw call, no framebuffers, no post passes. A scissor rect confines rasterization to the panel's bounding box. The backdrop texture carries a mip chain (regenerated only when the backdrop actually changes) so the frost blur samples a pre-filtered level instead of scaling its tap count with radius — cost stays constant whether the blur is 5px or 500px. DPR is capped at 2.

## Tests

```bash
npm test
```

Four suites, all driven through a headless Chromium (SwiftShader software rendering, so results hold without a GPU):

- **orientation** — the backdrop is sampled upright. Every stage of the sampling path (`grad`, `N.xy`, `refract().xy`, `uv`) stays in one y-down space; a stray axis flip mirrors the page behind the glass, and is invisible at the panel centre where refraction is zero.
- **lens** — a bevelled sheet's interior is optically flat (zero displacement) while a thick lens bends light progressively across its whole face.
- **light** — the border's bright band tracks a moved light source, dims with distance, and picks up the source's colour.
- **frost** — the blur actually blurs, brightness and saturation survive it unchanged, and the result stays smooth (no sampling grain) at every radius.

## Research

[`docs/RESEARCH.md`](docs/RESEARCH.md) — the physics, the technology comparison, the rendering pipeline, and the reasoning behind each corrected implementation detail (surface profiles and ray-marched refraction, the configurable border light, and the frost/blur rewrite).
