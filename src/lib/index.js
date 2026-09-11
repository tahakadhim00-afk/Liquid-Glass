/**
 * Liquid Glass - public API.
 *
 *   import { LiquidGlass } from 'liquid-glass';
 *
 *   new LiquidGlass(document.querySelector('.card'), { profile: 'apple' });
 *
 * Everything below is the whole surface area. The internals (renderer,
 * shader, displacement maps, tier adapters) are deliberately not exported:
 * they are implementation, and freezing them as API would make the
 * optical model impossible to improve.
 */

export { LiquidGlass, applyLiquidGlass } from './glass-element.js';

export {
  resolveProfile,
  registerProfile,
  profileNames,
  hasProfile,
  PROFILES,
  BASE_PROFILE,
} from './profiles.js';

export { detectCapabilities, pickTier } from './capabilities.js';
