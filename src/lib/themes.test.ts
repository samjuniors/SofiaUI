/**
 * lib/themes.test.ts — UI theme registry + the styles.css wiring contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_UI_THEME,
  UI_THEMES,
  applyUiTheme,
  currentUiTheme,
  isUiThemeId,
  themeById,
} from './themes.ts';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'styles.css');

test('four themes with unique ids, labels and valid hex accents', () => {
  assert.equal(UI_THEMES.length, 4);
  assert.deepEqual(UI_THEMES.map((t) => t.id), ['sofia', 'ember', 'verdant', 'nebula']);
  for (const t of UI_THEMES) {
    assert.ok(t.label.length > 0);
    assert.match(t.swatch, /^#[0-9a-f]{6}$/);
    assert.match(t.glow, /^#[0-9a-f]{6}$/);
  }
  assert.equal(DEFAULT_UI_THEME, 'sofia');
});

test('theme guards fall back to Sofia', () => {
  assert.equal(isUiThemeId('ember'), true);
  assert.equal(isUiThemeId('lava'), false);
  assert.equal(isUiThemeId(undefined), false);
  assert.equal(themeById('nebula').label, 'Nebula');
  assert.equal(themeById('nope').id, 'sofia');
});

test('apply/current round-trip through a stubbed document', () => {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).document = { documentElement: { dataset: store } };
  try {
    assert.equal(currentUiTheme(), 'sofia');
    applyUiTheme('verdant');
    assert.equal(currentUiTheme(), 'verdant');
    assert.equal(store.theme, 'verdant');
    store.theme = 'bogus';
    assert.equal(currentUiTheme(), 'sofia');
  } finally {
    delete (globalThis as Record<string, unknown>).document;
  }
});

test('styles.css remaps the sky ramp to theme variables', () => {
  const css = readFileSync(cssPath, 'utf8');
  for (const stop of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']) {
    assert.ok(
      css.includes(`--color-sky-${stop}: var(--th-sky-${stop})`),
      `sky-${stop} is not theme-mapped`,
    );
  }
  for (const id of ['sofia', 'ember', 'verdant', 'nebula']) {
    assert.ok(new RegExp(`\\[data-theme=['"]${id}['"]\\]`).test(css), `missing theme block ${id}`);
  }
  assert.ok(css.includes('--th-glow:'), 'missing glow triplet');
  assert.ok(!css.includes('rgba(56, 189, 248'), 'hardcoded sky glow remains');
  assert.ok(!css.includes('rgba(56,189,248'), 'hardcoded sky glow remains');
});
