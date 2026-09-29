import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { episodesAction, asVector, cosineSim, rrfFuse, __resetEpisodes } from "./episodes.mjs";

async function freshDir() {
  __resetEpisodes();
  return mkdtemp(join(tmpdir(), "episodes-test-"));
}

test("pure helpers: validation, cosine, RRF", () => {
  assert.deepEqual(asVector([1, 0]), [1, 0]);
  assert.equal(asVector([]), null);
  assert.equal(asVector([1, NaN]), null);
  assert.equal(asVector("nope"), null);
  assert.ok(Math.abs(cosineSim([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9);
  assert.equal(cosineSim([1], [1, 0]), 0, "dim mismatch scores zero");
  const fused = rrfFuse(
    [
      [{ key: "a", item: "A" }, { key: "b", item: "B" }],
      [{ key: "b", item: "B" }, { key: "c", item: "C" }],
    ],
    3,
  );
  assert.deepEqual(fused, ["B", "A", "C"], "in-both-legs outranks either alone");
});

test("keyword search still works; hybrid flag defaults false", async () => {
  const dir = await freshDir();
  await episodesAction("episodes_add", { text: "saw a red bicycle", role: "note" }, dir);
  const r = await episodesAction("episodes_search", { q: "bicycle" }, dir);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].text, "saw a red bicycle");
  assert.equal(r.hybrid, false);
});

test("vector leg recalls with zero keyword overlap and ranks first", async () => {
  const dir = await freshDir();
  await episodesAction("episodes_add", { text: "apple banana", embedding: [1, 0, 0] }, dir);
  await episodesAction("episodes_add", { text: "cherry date", embedding: [0, 1, 0] }, dir);
  const r = await episodesAction("episodes_search", { q: "zzzqqq", vector: [1, 0, 0], limit: 5 }, dir);
  assert.equal(r.hybrid, true);
  assert.equal(r.hits[0].text, "apple banana");
  assert.ok(!("embedding" in r.hits[0]), "stored vectors never ship in hits");
});

test("dim mismatch and invalid vectors degrade to keyword-only", async () => {
  const dir = await freshDir();
  await episodesAction("episodes_add", { text: "old model memory", embedding: [1, 0] }, dir);
  const mismatch = await episodesAction("episodes_search", { q: "memory", vector: [1, 0, 0] }, dir);
  assert.equal(mismatch.hybrid, false);
  assert.equal(mismatch.hits.length, 1);
  const invalid = await episodesAction("episodes_search", { q: "memory", vector: [1, "x"] }, dir);
  assert.equal(invalid.hybrid, false);
  assert.equal(invalid.hits.length, 1);
});

test("vector-less episodes stay invisible to the vector leg", async () => {
  const dir = await freshDir();
  await episodesAction("episodes_add", { text: "plain old note" }, dir);
  const r = await episodesAction("episodes_search", { q: "zzzqqq", vector: [1, 0] }, dir);
  assert.equal(r.hybrid, false);
  assert.deepEqual(r.hits, []);
});
