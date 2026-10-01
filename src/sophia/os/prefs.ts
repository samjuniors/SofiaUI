/**
 * sophia/os/prefs.ts — persisted preferences: types, defaults, loader.
 * Extracted verbatim from SophiaOS (Phase 22 split). savePrefs/resetPrefs
 * stay on the class: they fan out to the director, haptics, theme, density,
 * form, and wake spotter, which all live in the runtime core.
 */

import { controlLayer } from '../control';
import type { SophiaForm } from '../ShapeGenerator';
import { DEFAULT_TUNE, type DensityTier, type ShapeTune } from '../VisualDirector';
import type { VoiceProviderId } from '../types';
import { DEFAULT_UI_THEME, isUiThemeId, type UiThemeId } from '../../lib/themes';

export type ProviderPref = VoiceProviderId | 'auto';
export type MotionPref = 'auto' | 'reduce' | 'full';
export type DensityPref = DensityTier | 'auto';

export interface Prefs {
  provider: ProviderPref;
  wake: boolean;
  motion: MotionPref;
  form: SophiaForm;
  density: DensityPref;
  tune: ShapeTune;
  haptics: boolean;
  theme: UiThemeId;
  voiceProfile?: string;
}

export const DEFAULT_PREFS: Prefs = {
  provider: 'auto',
  wake: true,
  motion: 'auto',
  form: 'sphere',
  density: 'auto',
  tune: { ...DEFAULT_TUNE },
  haptics: true,
  theme: DEFAULT_UI_THEME,
  voiceProfile: 'au-female',
};

export const PREF_KEY = 'sophia:prefs';

/** Read + sanitize stored prefs. Restores the saved voice profile into the brain. */
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      const prefs: Prefs = {
        ...DEFAULT_PREFS,
        ...parsed,
        tune: { ...DEFAULT_TUNE, ...(parsed.tune ?? {}) },
      };
      if (prefs.form !== 'sphere' && prefs.form !== 'ring') prefs.form = 'sphere';
      if (!isUiThemeId(prefs.theme)) prefs.theme = DEFAULT_UI_THEME;
      if (!['auto', 'low', 'medium', 'high'].includes(prefs.density)) prefs.density = 'auto';
      if (typeof prefs.haptics !== 'boolean') prefs.haptics = true;
      if (typeof prefs.voiceProfile === 'string') {
        controlLayer.voiceProfile = prefs.voiceProfile;
      }
      return prefs;
    }
  } catch {
    /* noop */
  }
  return { ...DEFAULT_PREFS, tune: { ...DEFAULT_TUNE } };
}
