/**
 * ShapeGenerator — produces target GEOMETRY, not animations.
 *
 * Every command ("waveform", "torus", "infinity", "helix", "hypercube",
 * "pyramid", "star", "galaxy", "heart", "shield", "matrix", "split", "merge",
 * "dissolve", "face", "letter-z", etc.) resolves to a point set in Sophia's
 * object space (unit = her radius, y up).
 *
 * The ParticleRenderer flows the particle mesh toward whatever set it is handed.
 */

import type { SophiaShape } from './types';

export type SophiaForm = 'sphere' | 'ring';

const TAU = Math.PI * 2;

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussish(rng: () => number): number {
  return (rng() + rng() + rng() - 1.5) / 1.5;
}

/** projected sphere: uniform surface distribution */
function spherePoint(rng: () => number, out: Float32Array, i: number, cx: number, cy: number, r: number) {
  const lon = rng() * TAU;
  const y = 1 - 2 * rng();
  const rxy = Math.sqrt(Math.max(0, 1 - y * y));
  out[i * 2] = cx + Math.cos(lon) * rxy * r;
  out[i * 2 + 1] = cy + y * r;
}

/** thin ring loop */
function ringPoint(rng: () => number, out: Float32Array, i: number, cx: number, cy: number, r: number) {
  const th = rng() * TAU;
  const rr = r * (1 + (rng() - 0.5) * 0.05);
  out[i * 2] = cx + Math.cos(th) * rr;
  out[i * 2 + 1] = cy + Math.sin(th) * rr;
}

function sampleForm(count: number, rng: () => number, form: SophiaForm): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    if (form === 'ring') ringPoint(rng, out, i, 0, 0, 1);
    else spherePoint(rng, out, i, 0, 0, 0.99);
  }
  return out;
}

/* ---------------- Audio Agent Shapes ---------------- */

/** Waveform: multi-frequency audio equalizer sine-wave ribbon */
function sampleWaveform(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const u = (i / count) * 2 - 1; // -1 to 1
    const x = u * 1.35;
    // Harmonic envelope fading towards edges
    const env = Math.pow(Math.cos((u * Math.PI) / 2), 1.2);
    const wave =
      Math.sin(u * Math.PI * 3.5) * 0.38 +
      Math.sin(u * Math.PI * 7.0 + 0.6) * 0.18 +
      Math.sin(u * Math.PI * 14.0) * 0.07;
    const thickness = (rng() - 0.5) * 0.14 * env;
    const y = (wave + thickness) * env;
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}

/**
 * Bow / smile arc — multi-layer U-curve matching the reference ribbon.
 * Several parallel arcs with slight phase offsets produce the cyan→green→
 * purple→magenta stack that reads like Deepgram's idle indicator.
 */
function sampleBow(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  // 5 parallel ribbons with vertical offsets and slight scale differences
  const layers = [
    { yOff: 0.00, scale: 1.00, weight: 0.28 },
    { yOff: 0.07, scale: 0.96, weight: 0.22 },
    { yOff: 0.14, scale: 0.92, weight: 0.18 },
    { yOff: -0.06, scale: 1.04, weight: 0.18 },
    { yOff: 0.20, scale: 0.88, weight: 0.14 },
  ];
  const cum = layers.reduce((s, l) => s + l.weight, 0);
  for (let i = 0; i < count; i++) {
    // pick layer by weighted random
    let r = rng() * cum;
    let layer = layers[0];
    for (const l of layers) {
      r -= l.weight;
      if (r <= 0) { layer = l; break; }
    }
    // parametric U-curve: t in [-1,1], deeper at center
    const t = (rng() * 2 - 1);
    const absT = Math.abs(t);
    // classic smile / hanging cable shape
    const baseY = 0.55 * (t * t) - 0.42;
    // gentle side lift so ends rise like the reference
    const endLift = Math.pow(absT, 1.6) * 0.18;
    const y = (baseY + endLift + layer.yOff) * layer.scale;
    const x = t * 1.28 * layer.scale;
    // thin ribbon thickness
    const thick = (rng() - 0.5) * 0.055 * (1 - absT * 0.35);
    out[i * 2] = x + thick * 0.4;
    out[i * 2 + 1] = y + thick;
  }
  return out;
}

/** Torus: 3D donut with tilted perspective projection */
function sampleTorus(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  const R = 0.72; // major radius
  const r = 0.32; // minor radius
  for (let i = 0; i < count; i++) {
    const u = rng() * TAU;
    const v = rng() * TAU;
    // 3D coordinates
    const x3 = (R + r * Math.cos(v)) * Math.cos(u);
    const y3 = (R + r * Math.cos(v)) * Math.sin(u);
    const z3 = r * Math.sin(v);
    // 3D tilt rotation (pitch 45°, roll 20°)
    const cosP = 0.7071, sinP = 0.7071;
    const yRot = y3 * cosP - z3 * sinP;
    const zRot = y3 * sinP + z3 * cosP;
    out[i * 2] = x3 * 1.05;
    out[i * 2 + 1] = yRot * 0.9 + zRot * 0.15;
  }
  return out;
}

/** Infinity: figure-8 Lemniscate of Bernoulli */
function sampleInfinity(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const t = rng() * TAU;
    const scale = 1.15;
    const denom = 1 + Math.sin(t) * Math.sin(t);
    const x = (scale * Math.cos(t)) / denom;
    const y = (scale * Math.sin(t) * Math.cos(t)) / denom;
    const jitter = gaussish(rng) * 0.035;
    out[i * 2] = x + jitter;
    out[i * 2 + 1] = y * 1.45 + jitter;
  }
  return out;
}

/** Helix: 3D rotating DNA double helix with cross-rungs */
function sampleHelix(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const m = rng();
    if (m < 0.78) {
      // Main 2 spiral strands
      const strand = rng() < 0.5 ? 0 : Math.PI;
      const t = (rng() * 2 - 1) * 3.8; // vertical range
      const r = 0.48;
      const x = Math.cos(t * 1.8 + strand) * r;
      const y = t * 0.28;
      out[i * 2] = x + gaussish(rng) * 0.02;
      out[i * 2 + 1] = y + gaussish(rng) * 0.02;
    } else {
      // Cross rungs connecting the strands
      const step = Math.floor(rng() * 12) - 6;
      const t = (step / 6) * 3.0;
      const frac = rng(); // 0 to 1 between strand 1 and 2
      const x1 = Math.cos(t * 1.8) * 0.48;
      const x2 = Math.cos(t * 1.8 + Math.PI) * 0.48;
      const x = x1 + (x2 - x1) * frac;
      const y = t * 0.28;
      out[i * 2] = x + gaussish(rng) * 0.015;
      out[i * 2 + 1] = y + gaussish(rng) * 0.015;
    }
  }
  return out;
}

/** Hypercube: 3D rotating tesseract / concentric wireframe cubes */
function sampleHypercube(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  // Cube edges definition
  const outerSize = 0.78;
  const innerSize = 0.42;

  // 12 edges per cube, plus 8 connecting struts
  for (let i = 0; i < count; i++) {
    const m = rng();
    let p3 = [0, 0, 0];
    if (m < 0.48) {
      // Outer cube
      p3 = sampleCubeEdge(rng, outerSize);
    } else if (m < 0.82) {
      // Inner cube
      p3 = sampleCubeEdge(rng, innerSize);
    } else {
      // Diagonal connector struts
      const corner = Math.floor(rng() * 8);
      const cx = (corner & 1 ? 1 : -1);
      const cy = (corner & 2 ? 1 : -1);
      const cz = (corner & 4 ? 1 : -1);
      const t = rng();
      const s = innerSize + (outerSize - innerSize) * t;
      p3 = [cx * s, cy * s, cz * s];
    }
    // Isometric 3D projection
    const x = (p3[0] - p3[2]) * 0.7071;
    const y = (p3[0] + 2 * p3[1] + p3[2]) * 0.4082;
    out[i * 2] = x + gaussish(rng) * 0.015;
    out[i * 2 + 1] = y + gaussish(rng) * 0.015;
  }
  return out;
}

function sampleCubeEdge(rng: () => number, s: number): [number, number, number] {
  const edge = Math.floor(rng() * 12);
  const t = rng() * 2 - 1; // -1 to 1
  const xSign = (edge & 1) ? 1 : -1;
  const ySign = (edge & 2) ? 1 : -1;
  const axis = Math.floor(edge / 4); // 0 = x variable, 1 = y variable, 2 = z variable
  if (axis === 0) return [t * s, xSign * s, ySign * s];
  if (axis === 1) return [xSign * s, t * s, ySign * s];
  return [xSign * s, ySign * s, t * s];
}

/** Pyramid: 3D Sacred Geometry tetrahedron / pyramid */
function samplePyramid(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  const apex = [0, 0.82, 0];
  const base = [
    [-0.75, -0.55, -0.6],
    [0.75, -0.55, -0.6],
    [0.85, -0.45, 0.6],
    [-0.85, -0.45, 0.6],
  ];
  for (let i = 0; i < count; i++) {
    const m = rng();
    let pt = [0, 0, 0];
    if (m < 0.52) {
      // 4 edges to apex
      const k = Math.floor(rng() * 4);
      const b = base[k];
      const t = rng();
      pt = [apex[0] * t + b[0] * (1 - t), apex[1] * t + b[1] * (1 - t), apex[2] * t + b[2] * (1 - t)];
    } else {
      // 4 base edges
      const k = Math.floor(rng() * 4);
      const b1 = base[k];
      const b2 = base[(k + 1) % 4];
      const t = rng();
      pt = [b1[0] * t + b2[0] * (1 - t), b1[1] * t + b2[1] * (1 - t), b1[2] * t + b2[2] * (1 - t)];
    }
    // Perspective project
    const x = pt[0] * 1.05;
    const y = pt[1] + pt[2] * 0.18;
    out[i * 2] = x + gaussish(rng) * 0.015;
    out[i * 2 + 1] = y + gaussish(rng) * 0.015;
  }
  return out;
}

/** Star: celestial radiant starburst */
function sampleStar(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  const points = 5;
  for (let i = 0; i < count; i++) {
    const m = rng();
    if (m < 0.65) {
      // Star perimeter
      const seg = Math.floor(rng() * (points * 2));
      const t = rng();
      const a1 = (seg * Math.PI) / points - Math.PI / 2;
      const a2 = ((seg + 1) * Math.PI) / points - Math.PI / 2;
      const r1 = seg % 2 === 0 ? 0.95 : 0.42;
      const r2 = seg % 2 === 0 ? 0.42 : 0.95;
      const x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
      const x2 = Math.cos(a2) * r2, y2 = Math.sin(a2) * r2;
      out[i * 2] = x1 + (x2 - x1) * t + gaussish(rng) * 0.02;
      out[i * 2 + 1] = y1 + (y2 - y1) * t + gaussish(rng) * 0.02;
    } else {
      // Radiant interior stardust
      const th = rng() * TAU;
      const r = Math.pow(rng(), 0.7) * 0.45;
      out[i * 2] = Math.cos(th) * r;
      out[i * 2 + 1] = Math.sin(th) * r;
    }
  }
  return out;
}

/** Galaxy: logarithmic cosmic spiral galaxy with dual arms and nucleus */
function sampleGalaxy(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const m = rng();
    if (m < 0.22) {
      // Galactic core nucleus
      const th = rng() * TAU;
      const r = Math.pow(rng(), 0.6) * 0.25;
      out[i * 2] = Math.cos(th) * r;
      out[i * 2 + 1] = Math.sin(th) * r * 0.85;
    } else {
      // Two spiral arms: r = a * exp(b * theta)
      const arm = rng() < 0.5 ? 0 : Math.PI;
      const theta = rng() * Math.PI * 3.2; // multiple rotations
      const r = 0.18 + Math.pow(theta / (Math.PI * 3.2), 0.85) * 0.82;
      const spread = (rng() - 0.5) * 0.18 * (r + 0.2);
      const th = theta + arm + spread;
      out[i * 2] = Math.cos(th) * r;
      out[i * 2 + 1] = Math.sin(th) * r * 0.72; // tilted perspective
    }
  }
  return out;
}

/** Heart: mathematical cardioid parametric curve */
function sampleHeart(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const t = rng() * TAU;
    // Cardioid heart formula
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const s = 0.055;
    const jitter = (rng() - 0.5) * 0.04;
    out[i * 2] = x * s + jitter;
    out[i * 2 + 1] = (y * s + 0.12) + jitter;
  }
  return out;
}

/** Shield: cybernetic aegis security contour */
function sampleShield(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const t = rng() * TAU;
    const side = Math.cos(t) >= 0 ? 1 : -1;
    const u = Math.abs(Math.cos(t));
    const v = Math.sin(t);
    // Shield boundary curves
    let x = 0, y = 0;
    if (v >= 0.3) {
      // Top flat arch
      x = side * u * 0.72;
      y = 0.72 - Math.pow(u, 2) * 0.15;
    } else {
      // Bottom converging pointed V
      const prog = (0.3 - v) / 1.3;
      x = side * (0.72 * (1 - Math.pow(prog, 0.85)));
      y = 0.3 - prog * 1.25;
    }
    const fill = rng() < 0.25 ? rng() : 1.0;
    out[i * 2] = x * fill + gaussish(rng) * 0.02;
    out[i * 2 + 1] = y * fill + gaussish(rng) * 0.02;
  }
  return out;
}

/** Matrix: computational quantum square lattice */
function sampleMatrix(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  const grid = 14;
  for (let i = 0; i < count; i++) {
    const gx = Math.floor(rng() * grid);
    const gy = Math.floor(rng() * grid);
    const x = ((gx + 0.5) / grid) * 1.6 - 0.8;
    const y = ((gy + 0.5) / grid) * 1.6 - 0.8;
    // Connective lines or node cluster
    const isLine = rng() < 0.45;
    const t = rng() * (1.6 / grid);
    const dir = rng() < 0.5;
    out[i * 2] = x + (isLine ? (dir ? t : 0) : gaussish(rng) * 0.02);
    out[i * 2 + 1] = y + (isLine ? (!dir ? t : 0) : gaussish(rng) * 0.02);
  }
  return out;
}

function sampleSplit(count: number, rng: () => number, form: SophiaForm): Float32Array {
  const out = new Float32Array(count * 2);
  const centers: Array<[number, number]> = [
    [-0.66, 0.04],
    [0.66, -0.04],
  ];
  for (let i = 0; i < count; i++) {
    const c = centers[i & 1];
    if (form === 'ring') ringPoint(rng, out, i, c[0], c[1], 0.5);
    else spherePoint(rng, out, i, c[0], c[1], 0.5);
  }
  return out;
}

function sampleDissolve(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const th = rng() * TAU;
    const d = Math.sqrt(rng()) * 2.2 + 0.1 * Math.abs(gaussish(rng));
    out[i * 2] = Math.cos(th) * d * 1.15 + gaussish(rng) * 0.15;
    out[i * 2 + 1] = Math.sin(th) * d + gaussish(rng) * 0.15;
  }
  return out;
}

function sampleFace(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 2);
  const eyes: Array<[number, number]> = [
    [-0.32, 0.2],
    [0.32, 0.2],
  ];
  for (let i = 0; i < count; i++) {
    const m = rng();
    if (m < 0.3) {
      const e = eyes[i & 1];
      const th = rng() * TAU;
      const r = 0.085 + gaussish(rng) * 0.012;
      out[i * 2] = e[0] + Math.cos(th) * r;
      out[i * 2 + 1] = e[1] + Math.sin(th) * r;
    } else if (m < 0.38) {
      const e = eyes[i & 1];
      const th = rng() * TAU;
      const r = Math.sqrt(rng()) * 0.04;
      out[i * 2] = e[0] + Math.cos(th) * r;
      out[i * 2 + 1] = e[1] + Math.sin(th) * r;
    } else if (m < 0.72) {
      const th = Math.PI * (1.18 + rng() * 0.64);
      const r = 0.42 + gaussish(rng) * 0.018;
      out[i * 2] = Math.cos(th) * r;
      out[i * 2 + 1] = 0.02 + Math.sin(th) * r;
    } else {
      ringPoint(rng, out, i, 0, 0, 1);
    }
  }
  return out;
}

/** Glyphs: rasterize once, sample the alpha mask with extra weight on edges. */
function sampleGlyph(ch: string, count: number, rng: () => number): Float32Array {
  const S = 512;
  const out = new Float32Array(count * 2);
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return sampleForm(count, rng, 'ring');
  ctx.fillStyle = '#fff';
  ctx.font = '400 400px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, S / 2, S / 2 + 14);
  const img = ctx.getImageData(0, 0, S, S).data;
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : img[(y * S + x) * 4 + 3]);
  const cand: number[] = [];
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      if (alpha(x, y) <= 96) continue;
      const edge = alpha(x - 3, y) <= 96 || alpha(x + 3, y) <= 96 || alpha(x, y - 3) <= 96 || alpha(x, y + 3) <= 96;
      const reps = edge ? 3 : 1;
      for (let k = 0; k < reps; k++) cand.push(x, y);
    }
  }
  const n = cand.length / 2;
  if (n === 0) return sampleForm(count, rng, 'ring');
  for (let i = 0; i < count; i++) {
    const k = Math.floor(rng() * n) * 2;
    const x = ((cand[k] + rng() * 2 - S / 2) / (S / 2)) * 1.45;
    const y = (-(cand[k + 1] + rng() * 2 - S / 2) / (S / 2)) * 1.45;
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}

export const ShapeGenerator = {
  /** `count` target points (object space, y up) for a shape, relative to the live form. */
  createTargets(shape: SophiaShape, count: number, form: SophiaForm = 'sphere'): Float32Array {
    const rng = mulberry32(1337 + shape.length * 97 + (shape === 'dissolve' ? performance.now() | 0 : 0));
    switch (shape) {
      case 'organic':
      case 'merge':
        return sampleForm(count, rng, form);
      case 'circle':
        return sampleForm(count, rng, 'ring');
      case 'waveform':
        return sampleWaveform(count, rng);
      case 'bow':
        return sampleBow(count, rng);
      case 'torus':
        return sampleTorus(count, rng);
      case 'infinity':
        return sampleInfinity(count, rng);
      case 'helix':
        return sampleHelix(count, rng);
      case 'hypercube':
        return sampleHypercube(count, rng);
      case 'pyramid':
        return samplePyramid(count, rng);
      case 'star':
        return sampleStar(count, rng);
      case 'galaxy':
        return sampleGalaxy(count, rng);
      case 'heart':
        return sampleHeart(count, rng);
      case 'shield':
        return sampleShield(count, rng);
      case 'matrix':
        return sampleMatrix(count, rng);
      case 'split':
        return sampleSplit(count, rng, form);
      case 'dissolve':
        return sampleDissolve(count, rng);
      case 'face':
        return sampleFace(count, rng);
      case 'letter-z':
        return sampleGlyph('Z', count, rng);
      case 'letter-s':
        return sampleGlyph('S', count, rng);
      case 'letter-a':
        return sampleGlyph('A', count, rng);
      case 'letter-o':
        return sampleGlyph('O', count, rng);
      default:
        return sampleForm(count, rng, form);
    }
  },
};
