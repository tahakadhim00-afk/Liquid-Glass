/**
 * The optical profile.
 *
 * The library ships one material: a water drop. Its parameters are the
 * *material identity* of the glass - the set of physical values that make
 * it read as a bead of liquid rather than a sheet or a stone. It is not a
 * theme: every value here feeds the refraction model, not a palette.
 *
 * Every parameter is a plain default. A caller overrides any of them per
 * instance (`new LiquidGlass(el, { ior: 1.5 })`), at runtime
 * (`glass.set('motion', 0)`), or registers a named variant to reuse
 * (`registerProfile('brand', { extends: 'water', tint: 0.1 })`).
 *
 * The vocabulary:
 *
 *   SHAPE      radius, bevel, bevelPower, surface, splay
 *   OPTICS     ior, dispersion, thickness, frost, saturation
 *   SURFACE    tint, tintColor, specular
 *   LIGHT      light*, the configurable source driving the border gradient
 *   MOTION     motion, the idle liquid wobble
 *
 * `surface` picks the height profile (kube.io's family):
 *   0   convex  - a dome, bulging toward the viewer
 *   0.5 lip     - raised rim over a shallow centre dish
 *   1   concave - dished inward
 *
 * `splay` is the biggest structural lever: 0 is a bevelled *sheet* whose
 * centre is optically flat and whose bending is confined to the rim; 1 is
 * a thick *lens* whose whole face curves and magnifies.
 */

/**
 * The water drop - surface tension made visible. These are the defaults
 * every instance starts from.
 *
 * Water's real IOR is 1.33, and a droplet is a dome, so the surface is
 * fully convex (0) with a low bevelPower (1.8) to round the profile off
 * instead of chamfering it. The bevel is nearly as wide as the shape,
 * which is what turns a rounded rect into a bead of liquid; splay 0.55
 * lets the face itself curve so it magnifies a little. Frost is near zero
 * because water is clear, and motion is high because the whole point is
 * that it wobbles.
 */
export const BASE_PROFILE = {
  // --- shape ---------------------------------------------------------
  /** Corner radius, px. Adopted from the host's CSS when it has one. */
  radius: 110,
  /** Width of the refracting rim, px. */
  bevel: 90,
  /** Superellipse exponent: 2 = circle, 4 = squircle. */
  bevelPower: 1.8,
  /** 0 convex, 0.5 lip, 1 concave. */
  surface: 0.0,
  /** 0 bevelled sheet, 1 thick lens. */
  splay: 0.55,

  // --- optics --------------------------------------------------------
  ior: 1.33,
  dispersion: 0.012,
  thickness: 86,
  frost: 0.05,
  saturation: 1.10,

  // --- surface treatment ---------------------------------------------
  tint: 0.02,
  tintColor: [1.0, 1.0, 1.0],
  specular: 1.20,

  // --- light source ---------------------------------------------------
  light: [-0.45, -0.85],
  lightMode: 0,
  lightPos: null,
  lightHeight: 180,
  lightColor: [1.0, 1.0, 1.0],
  lightIntensity: 1.0,
  lightRange: 600,
  /** A tight source: droplets give a sharp glint. */
  lightRadius: 0.12,
  lightWrap: 0.25,
  lightAmbient: 0.10,

  // --- motion / cost ---------------------------------------------------
  motion: 1.4,
  quality: 1.0,

  // --- overall strength -------------------------------------------------
  /**
   * Master gain on the optical effect. 1 = the drop as authored.
   *
   * It exists because the alternative - telling a caller to raise `ior`,
   * `thickness`, `dispersion` and `frost` together - requires knowing how
   * those interact, and getting the ratios wrong is what turns glass into
   * plastic. Scaling them as a group preserves the material's identity:
   * the drop at 2 is still unmistakably water, only stronger.
   */
  intensity: 1.0,
  /** Extra gain on the corner rim light specifically. */
  cornerLight: 1.0,

  // --- edge treatment ---------------------------------------------------
  /** Width of the soft border-light band, as a fraction of the bevel. */
  rimWidth: 0.55,
  /** Strength of a thin specular line at the very edge, 0..1. Off: a
   *  droplet has no hard edge to catch one. */
  edgeLine: 0.0,
  /** Width of that line in CSS px, when enabled. */
  edgeWidth: 1.5,
};

/**
 * Apply `intensity` by scaling the parameters that carry optical strength.
 *
 * Only the four that read as "how much glass is this" are scaled. Shape
 * (radius, bevel, surface) is identity, not strength - scaling it would
 * change what you are looking at rather than how strong it is.
 *
 * IOR is scaled about 1.0 because that is air: an IOR of 1 bends nothing,
 * so the strength of the refraction is the *excess* over 1, not the value
 * itself. Doubling 1.33 naively would give 2.66, past diamond.
 *
 * @param {object} params  a resolved parameter set
 * @returns {object} the same shape, with strength terms scaled
 */
export function applyIntensity(params) {
  const k = Math.max(params.intensity ?? 1, 0);
  if (k === 1) return params;
  return {
    ...params,
    ior: 1 + (params.ior - 1) * k,
    thickness: params.thickness * k,
    dispersion: params.dispersion * k,
    frost: Math.min(params.frost * k, 1),
  };
}

/** The built-in profile: the water drop, i.e. the defaults as they are. */
const BUILTIN = {
  water: { label: 'Water drop' },
};

/** Custom profiles registered at runtime. */
const custom = new Map();

/**
 * Register a named variant, optionally extending an existing one.
 *
 * A variant is a set of overrides you want to reuse. The common case is a
 * brand wanting the same drop in its own tint:
 *
 *   registerProfile('brand', { extends: 'water', tintColor: [0.9, 0.95, 1] });
 *
 * @param {string} name
 * @param {object} definition  parameter values, plus optional `extends`
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

/** @returns {string[]} every known profile name, built-in first. */
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
export function resolveProfile(profile = 'water') {
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

/** Built-in profile names. */
export const PROFILES = Object.freeze(Object.keys(BUILTIN));
