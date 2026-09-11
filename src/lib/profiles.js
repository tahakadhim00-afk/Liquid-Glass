/**
 * Optical profiles.
 *
 * A profile is the *material identity* of a piece of glass: the set of
 * physical parameters that make it read as a thin Apple control layer, a
 * water droplet, a cut crystal, or a thick lens. It is not a theme - every
 * value here feeds the refraction model, not a colour palette.
 *
 * Profiles are data, deliberately. They carry no DOM, no renderer and no
 * lifecycle, so they can be inspected, diffed, serialised into a design
 * system, or authored by a designer without touching the shader.
 *
 * Each is built from the same small vocabulary:
 *
 *   SHAPE      radius, bevel, bevelPower, surface, splay
 *   OPTICS     ior, dispersion, thickness, frost, saturation
 *   SURFACE    tint, tintColor, specular
 *   LIGHT      light*, the configurable source driving the border gradient
 *   MOTION     motion, the idle liquid wobble
 *
 * `surface` picks the height profile (kube.io's family):
 *   0   convex  - a dome, bulging toward the viewer
 *   0.5 lip     - raised rim over a shallow centre dish (Apple's look)
 *   1   concave - dished inward
 *
 * `splay` is the biggest structural lever: 0 is a bevelled *sheet* whose
 * centre is optically flat and whose bending is confined to the rim; 1 is
 * a thick *lens* whose whole face curves and magnifies.
 */

/** Parameters every profile may set, with the neutral baseline. */
export const BASE_PROFILE = {
  // --- shape ---------------------------------------------------------
  radius: 44,
  bevel: 34,
  bevelPower: 4.0,
  surface: 0.5,
  splay: 0.0,

  // --- optics --------------------------------------------------------
  ior: 1.48,
  dispersion: 0.022,
  thickness: 46,
  frost: 0.22,
  saturation: 1.28,

  // --- surface treatment ---------------------------------------------
  tint: 0.06,
  tintColor: [1.0, 1.0, 1.0],
  specular: 0.85,

  // --- light source ---------------------------------------------------
  light: [-0.45, -0.85],
  lightMode: 0,
  lightPos: null,
  lightHeight: 180,
  lightColor: [1.0, 1.0, 1.0],
  lightIntensity: 1.0,
  lightRange: 600,
  lightRadius: 0.25,
  lightWrap: 0.25,
  lightAmbient: 0.10,

  // --- motion / cost ---------------------------------------------------
  motion: 0.5,
  quality: 1.0,
};

/**
 * The built-in profiles.
 *
 * Every entry states *why* its numbers are what they are, because the
 * values are meaningless without the physical intent behind them.
 */
const BUILTIN = {
  /**
   * Apple-ish - the iOS control layer.
   *
   * A thin sheet, not a blob: splay 0 keeps the face optically flat so
   * content behind it stays readable, and all the bending is gathered at
   * the rim. The lip surface (0.5) gives the raised edge over a shallow
   * dish that reads as Apple's material rather than a dome. Dispersion is
   * deliberately low - visible prismatic colour is the fastest way to stop
   * looking like a system control.
   */
  apple: {
    label: 'Apple-ish',
    radius: 44, bevel: 34, bevelPower: 4.0, surface: 0.5, splay: 0.0,
    ior: 1.48, dispersion: 0.022, thickness: 46, frost: 0.22,
    saturation: 1.28, tint: 0.06, specular: 0.85, motion: 0.5,
  },

  /**
   * Water drop - surface tension made visible.
   *
   * Water's real IOR is 1.33, and a droplet is a dome, so surface goes
   * fully convex (0) with a low bevelPower (1.8) to round the profile off
   * instead of chamfering it. The bevel is nearly as wide as the shape,
   * which is what turns a rounded rect into a bead of liquid. Frost is
   * near zero because water is clear, and motion is high because the whole
   * point is that it wobbles.
   */
  water: {
    label: 'Water drop',
    radius: 110, bevel: 90, bevelPower: 1.8, surface: 0.0, splay: 0.55,
    ior: 1.33, dispersion: 0.012, thickness: 86, frost: 0.05,
    saturation: 1.10, tint: 0.02, specular: 1.20, motion: 1.4,
    lightRadius: 0.12,   // a tight source: droplets give a sharp glint
  },

  /**
   * Crystal - a cut, faceted stone.
   *
   * High IOR (1.9) bends hard, and wide dispersion (0.075) splits the
   * spectrum the way leaded glass does. bevelPower 2.0 is the circular
   * profile, whose slope is infinite at the edge - a genuinely hard
   * optical boundary, where the squircle would soften it. A narrow bevel
   * over a small radius keeps the facet crisp.
   */
  crystal: {
    label: 'Crystal',
    radius: 28, bevel: 26, bevelPower: 2.0, surface: 0.35, splay: 0.0,
    ior: 1.90, dispersion: 0.075, thickness: 64, frost: 0.07,
    saturation: 1.45, tint: 0.03, specular: 1.35, motion: 0.2,
    lightRadius: 0.08,   // hard glints, not a soft sheen
    lightWrap: 0.10,
  },

  /**
   * Lens - the Figma "Glass" behaviour.
   *
   * splay 0.85 is the whole story: the face curves rather than only the
   * rim, so content is displaced and magnified right across the panel.
   * Frost is zero because a magnifier that blurs is a contradiction, and
   * motion is zero because a lens is a solid object, not a liquid.
   */
  lens: {
    label: 'Lens',
    radius: 44, bevel: 60, bevelPower: 2.2, surface: 0.0, splay: 0.85,
    ior: 1.20, dispersion: 0.055, thickness: 34, frost: 0.0,
    saturation: 1.10, tint: 0.0, specular: 0.6, motion: 0.0,
  },

  /**
   * Subtle - minimal, for dense UI.
   *
   * Deliberately close to conventional frosted glass: low IOR, thin slab,
   * heavy frost. Useful both as a restrained option for real interfaces
   * and as an A/B control - the gap between this and `apple` over the same
   * background is precisely the contribution of refraction.
   */
  subtle: {
    label: 'Subtle',
    radius: 32, bevel: 20, bevelPower: 3.0, surface: 0.5, splay: 0.0,
    ior: 1.18, dispersion: 0.008, thickness: 18, frost: 0.42,
    saturation: 1.15, tint: 0.10, specular: 0.45, motion: 0.15,
    lightRadius: 0.5,    // broad, soft: nothing should catch the eye
    lightAmbient: 0.18,
  },
};

/** Custom profiles registered at runtime. */
const custom = new Map();

/**
 * Register a profile, optionally extending an existing one.
 *
 * Extending is the common case: a brand rarely wants a new *material*, it
 * wants Apple's material in its own tint.
 *
 *   registerProfile('brand', { extends: 'apple', tintColor: [0.9, 0.95, 1] });
 *
 * @param {string} name
 * @param {object} definition  profile values, plus optional `extends`
 * @returns {object} the resolved profile
 */
export function registerProfile(name, definition = {}) {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('registerProfile: name must be a non-empty string');
  }
  const { extends: parent, ...values } = definition;
  if (parent !== undefined && !hasProfile(parent)) {
    throw new Error(
      `registerProfile("${name}"): unknown parent profile "${parent}". ` +
      `Known: ${profileNames().join(', ')}`,
    );
  }
  const base = parent ? resolveProfile(parent) : { ...BASE_PROFILE };
  const resolved = { ...base, ...values, label: values.label ?? name };
  custom.set(name, resolved);
  return resolved;
}

/** @returns {boolean} whether `name` names a known profile. */
export function hasProfile(name) {
  return custom.has(name) || Object.hasOwn(BUILTIN, name);
}

/** @returns {string[]} every known profile name, built-ins first. */
export function profileNames() {
  return [...Object.keys(BUILTIN), ...custom.keys()];
}

/**
 * Resolve a profile name (or inline object) to a complete parameter set.
 *
 * Accepting an object as well as a name is what lets every entry point in
 * the library take `profile:` without callers having to register a profile
 * just to pass a one-off tweak.
 *
 * @param {string|object} profile
 * @returns {object} a complete, independent parameter set
 */
export function resolveProfile(profile = 'apple') {
  if (profile && typeof profile === 'object') {
    const { extends: parent, ...values } = profile;
    const base = parent ? resolveProfile(parent) : { ...BASE_PROFILE };
    return { ...base, ...values };
  }
  if (!hasProfile(profile)) {
    throw new Error(
      `Unknown profile "${profile}". Known: ${profileNames().join(', ')}`,
    );
  }
  // Spread over the base so a profile only has to state what it changes,
  // and so callers always receive every parameter the renderer expects.
  return { ...BASE_PROFILE, ...(custom.get(profile) ?? BUILTIN[profile]) };
}

/** Built-in profile names, in presentation order. */
export const PROFILES = Object.freeze(Object.keys(BUILTIN));
