/**
 * lib/world-map.test.ts — continent mask + globe maths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_H,
  WORLD_W,
  fibonacciSphere,
  landAt,
  landFraction,
  maskBytes,
  project,
} from './world-map.ts';

test('mask decodes to 120x60 with an Earth-like land fraction', () => {
  assert.equal(WORLD_W, 120);
  assert.equal(WORLD_H, 60);
  assert.equal(maskBytes().length, 900);
  const f = landFraction();
  assert.ok(f > 0.25 && f < 0.35, `land fraction ${f} is not Earth-like`);
});

test('known land and ocean probes', () => {
  assert.equal(landAt(38, -98), true); // US midwest
  assert.equal(landAt(51, 0), true); // London
  assert.equal(landAt(-23.7, 133.9), true); // Alice Springs (Sydney itself is coastal at 110m)
  assert.equal(landAt(-22, -47), true); // São Paulo
  assert.equal(landAt(20, -150), false); // mid-Pacific
  assert.equal(landAt(10, -30), false); // mid-Atlantic
  assert.equal(landAt(0, -140), false); // equatorial Pacific
});

test('longitude wraps and latitude clamps without throwing', () => {
  assert.equal(landAt(38, 262), landAt(38, -98));
  assert.equal(landAt(38, -458), landAt(38, -98));
  assert.doesNotThrow(() => landAt(91, 0));
  assert.doesNotThrow(() => landAt(-91, 0));
  assert.doesNotThrow(() => landAt(NaN, NaN));
});

test('fibonacci sphere is deterministic and spread out', () => {
  const a = fibonacciSphere(500);
  const b = fibonacciSphere(500);
  assert.equal(a.length, 500);
  assert.deepEqual(a, b);
  const lats = a.map((p) => Math.abs(p.lat));
  assert.ok(Math.min(...lats) < 5, 'nothing near the equator');
  assert.ok(Math.max(...lats) > 80, 'nothing near the poles');
  assert.equal(fibonacciSphere(0).length, 1);
});

test('orthographic projection faces +z with rotation', () => {
  const front = project(0, 0, 0, 0);
  assert.ok(Math.abs(front.x) < 1e-9 && Math.abs(front.y) < 1e-9);
  assert.equal(front.visible, true);
  assert.equal(project(0, 180, 0, 0).visible, false);
  // Half a turn swaps near/far sides.
  assert.equal(project(0, 0, Math.PI, 0).visible, false);
  assert.equal(project(0, 180, Math.PI, 0).visible, true);
  // Tilt keeps the math bounded.
  for (const [lat, lon] of [[80, 40], [-60, -120], [23, 77], [0, 0]]) {
    const p = project(lat, lon, 1.7);
    assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1);
  }
});
