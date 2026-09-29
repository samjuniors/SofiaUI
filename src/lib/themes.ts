/**
 * lib/themes.ts — the four UI colour themes (Phase 5 Theatre).
 *
 * The Tailwind `sky-*` utilities used across the whole UI are remapped in
 * `styles.css` to runtime variables (`--th-sky-*`), so switching the
 * `data-theme` attribute on `<html>` re-skins every panel instantly. The
 * orb entity keeps its own colours — this is chrome, not soul.
 */

export type UiThemeId = 'sofia' | 'ember' | 'verdant' | 'nebula';

export interface UiTheme {
  id: UiThemeId;
  label: string;
  hint: string;
  /** Picker dot / primary accent. */
  swatch: string;
  /** Deep accent for gradients and glows. */
  glow: string;
}

export const UI_THEMES: UiTheme[] = [
  { id: 'sofia', label: 'Sofia', hint: 'Signature sky', swatch: '#38bdf8', glow: '#0ea5e9' },
  { id: 'ember', label: 'Ember', hint: 'Warm hearth orange', swatch: '#fb923c', glow: '#f97316' },
  { id: 'verdant', label: 'Verdant', hint: 'Deep forest emerald', swatch: '#34d399', glow: '#10b981' },
  { id: 'nebula', label: 'Nebula', hint: 'Cosmic violet', swatch: '#a78bfa', glow: '#8b5cf6' },
];

export const DEFAULT_UI_THEME: UiThemeId = 'sofia';

export function isUiThemeId(value: unknown): value is UiThemeId {
  return (
    value === 'sofia' || value === 'ember' || value === 'verdant' || value === 'nebula'
  );
}

export function themeById(id: unknown): UiTheme {
  return UI_THEMES.find((t) => t.id === id) ?? UI_THEMES[0];
}

/** Activate a theme. Safe to call anywhere (no-op without a DOM). */
export function applyUiTheme(id: UiThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = id;
}

export function currentUiTheme(): UiThemeId {
  if (typeof document === 'undefined') return DEFAULT_UI_THEME;
  const v = document.documentElement.dataset?.theme;
  return isUiThemeId(v) ? v : DEFAULT_UI_THEME;
}
