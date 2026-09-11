/**
 * Liquid Glass - type definitions.
 *
 * Hand-written rather than generated: the source is plain JS, and these
 * are small enough that keeping them readable is worth more than the
 * build step a generator would add.
 */

/** A three-component colour, 0..1 per channel. */
export type RGB = [number, number, number];

/** Every parameter a profile or instance may set. */
export interface GlassParams {
  // --- shape ---------------------------------------------------------
  /** Corner radius in px. Adopted from the host's CSS when it has one. */
  radius: number;
  /** Width of the refracting rim, px. */
  bevel: number;
  /** Superellipse exponent: 2 = circle (hard edge), 4 = squircle (Apple). */
  bevelPower: number;
  /** Height profile: 0 convex, 0.5 lip (raised rim + dish), 1 concave. */
  surface: number;
  /** 0 = bevelled sheet (flat centre), 1 = thick lens (whole face curves). */
  splay: number;

  // --- optics --------------------------------------------------------
  /** Index of refraction. 1.33 water, 1.5 glass, 1.9+ prismatic. */
  ior: number;
  /** Per-channel IOR spread; produces chromatic fringing. */
  dispersion: number;
  /** Virtual slab thickness in px; scales the displacement. */
  thickness: number;
  /** Surface roughness, 0 polished to 1 etched. Scatter radius only. */
  frost: number;
  /** Backdrop saturation multiplier. */
  saturation: number;

  // --- surface treatment ---------------------------------------------
  tint: number;
  tintColor: RGB;
  specular: number;

  // --- light source (WebGL tier only) ---------------------------------
  /** Direction toward the light, y-down, for directional mode. */
  light: [number, number];
  /** 0 = directional (parallel rays), 1 = positional (point source). */
  lightMode: number;
  /** Position in px, y-down. null tracks the panel centre. */
  lightPos: [number, number] | null;
  lightHeight: number;
  lightColor: RGB;
  lightIntensity: number;
  /** Distance to half brightness, px. 0 disables falloff. */
  lightRange: number;
  /** Apparent source size: 0 point (hard glint), 1 broad softbox. */
  lightRadius: number;
  /** How far the lit band wraps past the terminator, 0..1. */
  lightWrap: number;
  /** Floor so the unlit border never goes fully black. */
  lightAmbient: number;

  // --- motion / cost ---------------------------------------------------
  /** Idle liquid wobble. Forced to 0 under prefers-reduced-motion. */
  motion: number;
  /** <0.5 uses a smaller blur kernel. */
  quality: number;

  // --- overall strength -------------------------------------------------
  /**
   * Master gain on the optical effect: scales ior, thickness, dispersion
   * and frost together, keeping the profile's material identity.
   * 1 = as authored, 0.5 = half strength, 2 = double. Default 1.
   */
  intensity: number;
  /** Extra gain on the rim light at the rounded corners. 1 = physical. */
  cornerLight: number;

  // --- edge treatment (WebGL tier only) ----------------------------------
  /** Width of the soft border-light band as a fraction of the bevel. */
  rimWidth: number;
  /** Strength of the thin specular line at the very edge, 0..1. */
  edgeLine: number;
  /** Width of that line in CSS px. ~1.5 matches a real device. */
  edgeWidth: number;
}

/** Built-in profile names. */
export type ProfileName = 'apple' | 'water' | 'crystal' | 'lens' | 'subtle';

/** A profile definition: any subset of params, optionally extending another. */
export type ProfileDefinition = Partial<GlassParams> & {
  extends?: string;
  label?: string;
};

/** A profile reference: a registered name, or an inline definition. */
export type ProfileRef = ProfileName | (string & {}) | ProfileDefinition;

/** Which renderer is in use. See the README for what each can do. */
export type Tier = 'webgl' | 'svg' | 'blur' | 'none';

/** Anything WebGL can upload as a texture. */
export type BackdropSource =
  | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
  | ImageBitmap | OffscreenCanvas;

export interface LiquidGlassOptions extends Partial<GlassParams> {
  /** Optical profile. Defaults to 'apple'. */
  profile?: ProfileRef;
  /** Texture source. Supplying one enables the WebGL tier. */
  backdrop?: BackdropSource | null;
  /** Force a tier, for testing. Honoured only if the browser supports it. */
  tier?: Tier;
  /** Light follows the pointer. Default true. */
  interactive?: boolean;
  /** Observe host resize. Default true. */
  observeResize?: boolean;
}

export interface Capabilities {
  webgl2: boolean;
  svgBackdrop: boolean;
  cssBackdrop: boolean;
  reducedMotion: boolean;
}

export declare class LiquidGlass {
  constructor(host: HTMLElement, options?: LiquidGlassOptions);

  /** The element the material is attached to. */
  readonly host: HTMLElement;
  /** The tier actually in use. */
  readonly tier: Tier;
  /** Name of the active profile, or 'custom' for an inline one. */
  readonly profileName: string;

  /** Update one parameter, or several at once. */
  set<K extends keyof GlassParams>(key: K, value: GlassParams[K]): this;
  set(values: Partial<GlassParams>): this;

  /** Switch profile, keeping explicit overrides applied since construction. */
  setProfile(profile: ProfileRef): this;

  /** Supply or replace the WebGL backdrop texture. */
  setBackdrop(source: BackdropSource | null): this;

  /** Re-read the host's box. Call after a layout change the component missed. */
  measure(): void;

  /** Current resolved parameters, as a copy. */
  getParams(): GlassParams;

  /** Remove every layer, listener and GPU resource this instance created. */
  destroy(): void;
}

/** Attach the material to a selector, element, or list of elements. */
export declare function applyLiquidGlass(
  target: string | Element | Iterable<Element>,
  options?: LiquidGlassOptions,
): LiquidGlass[];

/** Register a profile, optionally extending an existing one. */
export declare function registerProfile(
  name: string,
  definition?: ProfileDefinition,
): GlassParams;

/** Resolve a profile name or inline definition to a full parameter set. */
export declare function resolveProfile(profile?: ProfileRef): GlassParams;

/**
 * Scale a parameter set's optical strength by its own `intensity`.
 * Applied internally by every tier; exported so a caller can preview the
 * numbers a given intensity will actually produce.
 */
export declare function applyIntensity(params: GlassParams): GlassParams;

/** Whether `name` names a known profile. */
export declare function hasProfile(name: string): boolean;

/** Every known profile name, built-ins first. */
export declare function profileNames(): string[];

/** Probe what this browser can do. Cached for the page's lifetime. */
export declare function detectCapabilities(): Capabilities;

/** Choose a tier for the given situation. */
export declare function pickTier(opts?: {
  hasBackdropSource?: boolean;
  prefer?: Tier;
}): Tier;

/** Built-in profile names, in presentation order. */
export declare const PROFILES: readonly ProfileName[];

/** The neutral baseline every profile is built on. */
export declare const BASE_PROFILE: GlassParams;
