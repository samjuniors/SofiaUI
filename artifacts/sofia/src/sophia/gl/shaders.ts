/**
 * Sophia GPU programs.
 *
 * BODY_FS     — fullscreen signed-distance pass. Two strictly separated layers:
 *               (1) ATMOSPHERE  — slow drifting aurora/aura gradient, tinted and
 *                   animated per state. This is the only thing the background does.
 *               (2) THE BODY    — sphere ⇄ ring rim, membrane waves, specular, pool.
 *                   Its colour + glow are tinted per state. Invisible in
 *                   "just particles" mode (uShowBody = 0).
 * PARTICLE_VS — the computational point mesh: all shapes, all states, wake-up
 *               convergence, pause freeze, per-state colour + glow.
 * BLUR / COMPOSITE — HDR bloom + filmic tone-map (controlled, not neon).
 */

export const SCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}
`;

/** Shared: hue palette + cheap value-noise fbm for the aura. */
const COMMON = `
const float TAU = 6.28318530718;
uniform float uHue;
float gauss(float x, float s){ return exp(-x*x/(2.0*s*s)); }
float angDiff(float a, float b){ float d = a - b; return abs(mod(d + 3.14159265, TAU) - 3.14159265); }
vec3 rimColor(float ang){
  // Multi-ribbon palette inspired by the reference: cyan → mint → violet → magenta
  vec3 c = vec3(0.18, 0.55, 1.0);
  float vw = clamp(0.95 + uHue * 0.85, 0.0, 2.0);
  float cw = clamp(0.90 - uHue * 0.60, 0.0, 1.5);
  c = mix(c, vec3(0.35, 0.95, 0.72), gauss(angDiff(ang, 0.15), 0.55) * 0.85); // mint
  c = mix(c, vec3(0.95, 0.42, 0.88), gauss(angDiff(ang, 1.15), 0.58) * vw);   // magenta
  c = mix(c, vec3(0.55, 0.38, 1.0),  gauss(angDiff(ang, 2.40), 0.65) * 0.9);  // violet
  c = mix(c, vec3(0.22, 0.88, 1.0),  gauss(angDiff(ang, 3.85), 0.70) * cw);   // cyan
  c = mix(c, vec3(0.70, 0.55, 1.0),  gauss(angDiff(ang, 5.20), 0.60) * 0.7);  // soft lilac
  return max(c, vec3(0.05, 0.14, 0.38));
}
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }
`;

/**
 * ATMOSPHERE — ultra-soft, silky, ethereal aura gradient.
 * Zero harsh noise grain or banding. Uses smooth multi-pole Gaussian
 * ethereal drift and gentle harmonic breathing so the aura feels
 * velvety, atmospheric, and deeply calming.
 */
const ATMOSPHERE = `
uniform float uTime;
uniform vec3  uBgDeep;      // deepest vignette navy
uniform vec3  uBgCore;      // near-centre field colour
uniform vec3  uBgAuraA;     // drifting mist colour 1
uniform vec3  uBgAuraB;     // drifting mist colour 2
uniform float uBgAuraAmt;   // mist strength 0..1
uniform float uBgSpeed;     // drift speed multiplier
uniform float uBgPulse;     // breathing strength 0..0.4
uniform float uBgPulseSpd;  // breathing rate
uniform float uBgVig;       // vignette strength
uniform float uBgLevel;     // live audio reactivity 0..1
uniform float uWake;        // 0..1 wake-up expansion (background side)
uniform float uPaused;      // 0..1 freeze + desaturate
uniform float uMotion;
vec3 atmosphere(vec2 q, float vq){
  float t = uTime * uBgSpeed * uMotion * 0.42;

  // 3 smooth wandering Gaussian aura poles that drift like silk ribbons
  vec2 p1 = vec2(sin(t * 0.65) * 0.42, cos(t * 0.52) * 0.32);
  vec2 p2 = vec2(cos(t * 0.44 + 2.1) * 0.52, sin(t * 0.58 + 1.2) * 0.38);
  vec2 p3 = vec2(sin(t * 0.32 + 4.3) * 0.28, cos(t * 0.38 + 3.1) * 0.44);

  // Broad, velvety Gaussian falloffs - completely smooth and buttery
  float a1 = exp(-dot(q - p1, q - p1) * 1.6);
  float a2 = exp(-dot(q - p2, q - p2) * 1.3);
  float a3 = exp(-dot(q - p3, q - p3) * 2.0);
  float centerHalo = exp(-dot(q, q) * 1.8);

  // Micro organic harmonic drift - zero pixelation
  float wave = 0.06 * sin(q.x * 2.2 + sin(q.y * 1.8 + t * 0.7) + t * 0.6);
  a1 = clamp(a1 + wave * a1, 0.0, 1.0);
  a2 = clamp(a2 - wave * a2, 0.0, 1.0);

  // Velvety deep backdrop
  vec3 col = mix(uBgDeep, uBgCore, 1.0 - smoothstep(0.0, 1.35, vq));

  // Blend in the luminous soft aura ribbons
  col += uBgAuraA * a1 * uBgAuraAmt * 0.27;
  col += uBgAuraB * a2 * uBgAuraAmt * 0.23;
  col += mix(uBgAuraA, uBgAuraB, 0.5) * a3 * uBgAuraAmt * 0.15;

  // Soft breathing central aura swell + audio lift
  float breath = 0.5 + 0.5 * sin(uTime * uBgPulseSpd * uMotion);
  col += (uBgAuraA * 0.58 + uBgAuraB * 0.42) * (uBgPulse * breath * 0.62 + uBgLevel * 0.10) * centerHalo;

  // Wake-up: soft radiant expansion
  col += mix(uBgAuraA, vec3(0.7, 0.9, 1.0), 0.35) * uWake * (1.0 - uWake) * 2.2 * centerHalo;

  // Vignette: gentle and soft
  col *= 1.0 - uBgVig * smoothstep(0.35, 1.45, vq) * 0.58;

  // Pause desaturation
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * vec3(0.82, 0.86, 1.0), uPaused * 0.55);
  return col;
}
`;

export const BODY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uVP;
uniform vec2 uCenter;
uniform float uR;
uniform float uDpr;
uniform float uForm;
uniform float uBody;
uniform float uShowBody;
uniform float uBodyScale;
uniform float uLevel;
uniform float uEnergy;
uniform float uThink;
uniform float uSpeak;
uniform float uListen;
uniform float uRender;
uniform vec2 uFocusDir;
uniform float uFocusAmt;
uniform float uOrbitPhase;
uniform float uWavePhase;
uniform float uArc;
uniform float uStarT;
uniform float uRimWidth;
uniform float uGlow;
uniform float uOrbits;
uniform float uWaveAmp;
uniform float uDock;
uniform float uBow;
uniform vec2  uHang;
// ---- per-state shape colour + glow (the body only) ----
uniform vec3  uShapeTint;
uniform float uShapeTintAmt;
uniform float uShapeGlow;
out vec4 frag;
${COMMON}
${ATMOSPHERE}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float rimLight(float ang, float focusAng){
  float l = 0.50 + 0.50 * max(gauss(angDiff(ang, 0.80), 0.92), gauss(angDiff(ang, 3.75), 1.15));
  l += uFocusAmt * 0.42 * gauss(angDiff(ang, focusAng), 0.85);
  l += uThink * 0.75 * gauss(angDiff(ang, uArc), 0.40);
  l += uRender * 0.55 * gauss(angDiff(ang, mod(uTime * 4.0, TAU)), 0.35);
  return l;
}
vec3 node(vec2 p, vec2 c, float sizePx, vec3 color, float k){
  float dpx = length(p - c) * uR / uDpr;
  float core = exp(-dpx*dpx/(sizePx*sizePx*0.5));
  float halo = exp(-dpx*dpx/(sizePx*sizePx*18.0)) * 0.08;
  return color * (core*1.5 + halo) * k;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 p = (fc - uCenter) / uR - uHang;
  float aspect = uVP.x / uVP.y;
  vec2 q = (vUv - vec2(0.5, 0.52)) * vec2(aspect, 1.0);
  float vq = length(q);

  /* ============ LAYER 1 : ATMOSPHERE (background only) ============ */
  vec3 col = atmosphere(q, vq);

  /* ============ LAYER 2 : THE BODY (hidden in "just particles") ============ */
  if (uShowBody <= 0.001) {
    // Wake-up shockwave still reads against pure particles.
    if (uWake > 0.001 && uWake < 1.0) {
      float wr = uWake * 2.3;
      col += vec3(0.55, 0.85, 1.0) * gauss(length(p) - wr, 0.05 + uWake * 0.07) * (1.0 - uWake) * 1.1;
    }
    frag = vec4(col, 1.0);
    return;
  }

  float dS = length(p);

  // stars
  {
    float cs = 96.0 * uDpr;
    vec2 cell = floor(fc / cs);
    vec2 h = hash22(cell);
    vec2 h2 = hash22(cell + 17.0);
    if (h.x < 0.16) {
      vec2 sp = (cell + 0.12 + 0.76*h2) * cs;
      float dd = length(fc - sp) / uDpr;
      float sz = 0.8 + h.y*0.9;
      float tw = 0.7 + 0.3*sin(uStarT*(0.5+h2.x) + h.x*40.0);
      float st = exp(-dd*dd/(sz*sz)) * tw * (0.30 + 0.5*h.y) * smoothstep(1.02, 1.2, dS);
      col += mix(vec3(0.62, 0.78, 1.0), vec3(0.80, 0.72, 1.0), h2.y) * st;
    }
  }

  // orbit rings + nodes (state-tinted)
  float px1 = uDpr / uR;
  float o1 = gauss(dS - 1.30, 0.55*px1);
  float o2 = gauss(dS - 1.52, 0.55*px1);
  vec2 pe = rot2(p, 0.42);
  pe.y /= 0.80;
  float o3 = gauss(length(pe) - 1.70, 0.55*px1);
  vec3 orbCol = mix(vec3(0.32, 0.50, 0.95), uShapeTint, uShapeTintAmt * 0.7);
  col += orbCol * (o1*0.22 + o2*0.16 + o3*0.07) * uOrbits;

  float ph = uOrbitPhase;
  vec2 n0 = 1.52 * vec2(cos(2.25 + ph*0.050), sin(2.25 + ph*0.050));
  vec2 n1 = 1.30 * vec2(cos(3.25 - ph*0.035), sin(3.25 - ph*0.035));
  vec2 n2 = 1.30 * vec2(cos(-0.12 + ph*0.042), sin(-0.12 + ph*0.042));
  vec2 n3 = rot2(vec2(cos(5.1 + ph*0.06), sin(5.1 + ph*0.06)*0.80) * 1.70, -0.42);
  vec3 ndCol = mix(vec3(1.0), uShapeTint * 1.6, uShapeTintAmt * 0.55);
  col += node(p, n0, 4.6, vec3(0.86, 0.84, 1.0) * ndCol, uOrbits);
  col += node(p, n1, 4.0, vec3(0.30, 0.55, 1.0) * ndCol, 0.9 * uOrbits);
  col += node(p, n2, 4.0, vec3(0.62, 0.90, 1.0) * ndCol, 0.9 * uOrbits);
  col += node(p, n3, 2.4, vec3(0.70, 0.55, 1.0) * ndCol, 0.6 * uOrbits);

  // ---- sphere ⇄ ring body ----
  // Deep U-bow for idle/pause so the SDF rim also reads as the hanging ribbon.
  vec2 pb = p;
  pb.y += 0.14 * uBow;
  pb.y /= mix(1.0, 0.68, uBow);
  pb.x /= mix(1.0, 0.94, uBow);
  pb.y -= pow(abs(pb.x), 1.55) * 0.18 * uBow;
  pb /= uBodyScale;
  float ang = atan(pb.y, pb.x);
  float wob = 1.0 + uMotion * (0.006*sin(ang*3.0 + uWavePhase*0.9) + 0.004*sin(ang*5.0 - uWavePhase*0.6)) * (1.0 + 2.0*uLevel*uSpeak);
  float d = length(pb) / wob;
  float e = d - 1.0;
  float focusAng = atan(uFocusDir.y, uFocusDir.x);

  // state-tinted body colour
  vec3 rc = mix(rimColor(ang), uShapeTint, uShapeTintAmt);
  float li = rimLight(ang, focusAng);

  // in dock mode, auto-adjust band thickness and sharpness for smaller radius
  float sBand = mix(0.026, 0.019, uForm) * uRimWidth * mix(1.0, 1.35, uDock);
  float sCore = mix(0.009, 0.0065, uForm) * uRimWidth * mix(1.0, 1.25, uDock);
  float band = gauss(e, sBand);
  float core = gauss(e, sCore);
  float haloOut = exp(-max(e, 0.0) / (mix(0.085, 0.065, uForm) * mix(1.0, 0.75, uDock))) * step(0.0, e);
  float haloIn = exp(-max(-e, 0.0) / 0.17) * step(e, 0.0) * (1.0 - uForm*0.78);
  float gain = mix(1.0, 1.32, uForm) * (0.92 + 0.08*uEnergy + 0.25*uLevel) * uGlow * uShapeGlow * mix(1.0, 1.15, uDock);

  vec3 rim = rc * (band*1.5 + core*0.9 + haloOut*0.46) * li * gain;
  rim += mix(vec3(0.92, 0.97, 1.0), uShapeTint * 1.25, uShapeTintAmt * 0.6) * core * 0.45 * li*li * gain;
  vec3 inner = rc * haloIn * 0.30 * li * (1.0 - uForm);

  float inside = 1.0 - smoothstep(0.975, 1.0, d);
  float lowFill = (1.0 - smoothstep(-0.95, 0.25, pb.y)) * inside;
  // while thinking the glass recedes so the crystalline particle core reads
  vec3 interior = mix(vec3(0.05, 0.16, 0.62), uShapeTint * 0.55, uShapeTintAmt) * lowFill * (0.22 + 0.22*uLevel) * (1.0 - uForm) * (1.0 - 0.55*uThink);
  interior += vec3(0.02, 0.03, 0.09) * inside * (1.0 - uForm) * 0.5 * (1.0 - 0.55*uThink);

  vec2 restL = normalize(vec2(-0.62, 0.72));
  vec2 lightDir = normalize(mix(restL, uFocusDir, uFocusAmt*0.55));
  vec2 hpos = lightDir * 0.60;
  float spec = exp(-dot(pb - hpos, pb - hpos) / (2.0*0.21*0.21)) * inside;
  float facing = max(0.0, dot(normalize(pb + vec2(1e-4, 0.0)), lightDir));
  float cres = gauss(d - 0.905, 0.045) * facing * facing * inside;
  vec3 light = (mix(vec3(0.55, 0.76, 1.0), uShapeTint, uShapeTintAmt*0.5) * spec * 0.20
             +  mix(vec3(0.70, 0.86, 1.0), uShapeTint, uShapeTintAmt*0.5) * cres * 0.30) * (1.0 - uForm);

  // membrane waves — state-tinted
  vec3 waves = vec3(0.0);
  {
    float wp = uWavePhase;
    float la = 1.0 + 1.1*uLevel;
    float env = inside * (1.0 - smoothstep(0.86, 1.0, abs(pb.x)));
    vec3 wA = mix(vec3(0.25, 0.70, 1.0), uShapeTint, uShapeTintAmt*0.55);
    vec3 wB = mix(vec3(0.46, 0.40, 1.0), uShapeTint, uShapeTintAmt*0.55);
    vec3 wC = mix(vec3(0.32, 0.86, 1.0), uShapeTint, uShapeTintAmt*0.55);
    vec3 wD = mix(vec3(0.20, 0.48, 1.0), uShapeTint, uShapeTintAmt*0.55);
    float y0 = -0.30 + 0.19*la*sin(pb.x*2.6 + 1.2 + wp*0.55) + 0.05*sin(pb.x*5.1 - wp*0.3);
    float w0 = pb.y - y0;
    float m0 = 0.65 + 0.35*cos(pb.x*2.6 + 1.2 + wp*0.55);
    waves += wA * (gauss(w0, 0.045*(1.0+0.5*uLevel))*0.42*m0 + (1.0 - smoothstep(-0.40, 0.02, w0))*0.10);
    float y1 = -0.40 + 0.15*la*sin(pb.x*2.1 + 2.5 - wp*0.42);
    float w1 = pb.y - y1;
    float m1 = 0.6 + 0.4*cos(pb.x*2.1 + 2.5 - wp*0.42);
    waves += wB * gauss(w1, 0.032) * 0.30 * m1;
    float y2 = -0.20 + 0.13*la*sin(pb.x*3.1 + 0.4 + wp*0.36);
    float w2 = pb.y - y2;
    waves += wC * gauss(w2, 0.028) * 0.24;
    float y3 = -0.52 + 0.10*la*sin(pb.x*1.8 + 3.7 + wp*0.48);
    float w3 = pb.y - y3;
    waves += wD * (gauss(w3, 0.06)*0.22 + (1.0 - smoothstep(-0.4, 0.02, w3))*0.08);
    waves *= env * (1.0 - uForm) * (0.85 + 0.15*uEnergy + 0.6*uLevel) * uWaveAmp * uShapeGlow * (1.0 - 0.6*uThink);
  }

  float fy = pb.y + 1.12;
  float refl = gauss(fy, 0.04) * gauss(pb.x, 0.60) * 0.50 + gauss(fy - 0.08, 0.20) * gauss(pb.x, 0.95) * 0.14;
  vec3 pool = mix(vec3(0.18, 0.42, 1.0), uShapeTint, uShapeTintAmt*0.6) * refl * (1.0 - uForm) * (1.0 - uDock);

  col += (rim + inner + interior + light + waves + pool) * uBody;

  // wake-up shockwave rides the body layer too
  if (uWake > 0.001 && uWake < 1.0) {
    float wr = uWake * 2.3;
    col += mix(uShapeTint, vec3(0.7, 0.9, 1.0), 0.4) * gauss(dS - wr, 0.05 + uWake*0.07) * (1.0 - uWake) * 1.2;
    col += uShapeTint * (1.0 - uWake) * exp(-dS*dS*2.0) * 0.45;
  }

  // pause: dim + desaturate the body layer as well
  float lumB = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lumB) * vec3(0.82, 0.86, 1.0), uPaused * 0.55) * (1.0 - 0.35 * uPaused);

  frag = vec4(col, 1.0);
}
`;

export const PARTICLE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aSeed;
layout(location=1) in vec2 aTarget;
uniform vec2 uVP;
uniform vec2 uCenter;
uniform float uR;
uniform float uDpr;
uniform float uTime;
uniform float uForm;
uniform float uMorph;
uniform float uSpin;
uniform float uLevel;
uniform float uMotion;
uniform float uGain;
uniform float uBodyScale;
uniform float uThink;
uniform float uSpeak;
uniform float uListen;
uniform float uRender;
uniform float uOnlyParticles;
uniform float uParticleScale;
uniform float uSparkle;
uniform float uVisualState;
uniform float uDock;
uniform float uBow;
uniform vec2  uHang;
uniform vec3  uShapeTint;
uniform float uShapeTintAmt;
uniform float uShapeGlow;
uniform float uWake;
uniform float uPaused;
out vec4 vCol;
${COMMON}
void main(){
  float u = aSeed.x, v = aSeed.y;
  float lon = u*TAU + uSpin;
  float y0 = 1.0 - 2.0*v;
  float rxy = sqrt(max(0.0, 1.0 - y0*y0));
  vec3 s = vec3(cos(lon)*rxy, y0, sin(lon)*rxy);
  float ct = cos(0.35), st = sin(0.35);
  s = vec3(s.x, s.y*ct - s.z*st, s.y*st + s.z*ct);
  vec2 spherePos = s.xy * 0.99;
  float depth = s.z;
  float limb = pow(1.0 - abs(depth), 2.5);
  float ra = u*TAU + uSpin*0.35;
  float rr = 1.0 + (aSeed.z - 0.5) * 0.06 + (aSeed.w - 0.5) * 0.02;
  vec2 ringPos = vec2(cos(ra), sin(ra)) * rr;
  vec2 formPos = mix(spherePos, ringPos, uForm);
  float formA = mix(0.06 + 0.22*limb + 0.12*max(depth, 0.0), 0.35 + 0.35*aSeed.w, uForm);
  float delay = aSeed.w * 0.40;
  float mt = smoothstep(delay, delay + 0.60, uMorph);
  vec2 bulge = vec2(sin(aSeed.z*TAU), cos(aSeed.x*TAU)) * 0.22;
  vec2 mid = (formPos + aTarget) * 0.5 + bulge;
  vec2 pos = mix(mix(formPos, mid, mt), mix(mid, aTarget, mt), mt);

  float mo = uMotion * (1.0 - 0.92 * uPaused);
  float dockDisp = mix(1.0, 0.42, uDock);

  // 1. Ambient / Idle breathing (calibrated for dock scale)
  pos += vec2(sin(uTime*1.1 + aSeed.x*63.0), cos(uTime*0.9 + aSeed.y*57.0)) * (0.004 + 0.008*uLevel) * mo * dockDisp;

  // 2. Listening: radial acoustic ripple
  float radDist = length(pos);
  pos += normalize(pos + vec2(1e-4)) * sin(radDist*8.0 - uTime*6.0 + aSeed.x*TAU) * (0.015 + 0.045*uLevel) * uListen * mo * dockDisp;

  // 3. Thinking: boiling particle rim + calm crystalline core.
  //    Edge particles scatter, jitter and occasionally fling beyond the
  //    silhouette; interior dots snap into a quiet tilted lattice with a
  //    slow whole-form swirl — energy at the boundary, structure inside.
  float tEdge = smoothstep(0.58, 0.97, length(pos));
  if (uThink > 0.01) {
    float k = uThink * mo * dockDisp;
    // crystalline lattice snap for the core (tilted so it never reads gridded)
    float gs = 0.088;
    vec2 rp = rot2(pos, 0.26);
    vec2 snapped = (floor(rp / gs) + 0.5) * gs;
    pos = mix(pos, rot2(snapped, -0.26), 0.44 * k * (1.0 - tEdge));
    // gentle slow swirl of the whole form
    pos = rot2(pos, 0.12 * k * sin(uTime * 0.32));
    // faint interior wave texture
    pos += vec2(sin(pos.y * 6.0 + uTime * 0.6), cos(pos.x * 5.0 - uTime * 0.5)) * 0.008 * k * (1.0 - tEdge);
    // edge turbulence: noise-driven boil + tangential agitation
    float n1 = fbm(pos * 3.4 + uTime * 0.5);
    float n2 = fbm(pos * 5.6 - uTime * 0.42 + 7.7);
    vec2 dir = normalize(pos + 1e-4);
    vec2 tang = vec2(-dir.y, dir.x);
    pos += dir  * (n1 - 0.5) * 0.34 * k * tEdge;
    pos += tang * (n2 - 0.5) * 0.18 * k * tEdge;
    // a few sparks flung just beyond the rim
    float fling = step(0.955, aSeed.z);
    pos += dir * fling * (0.10 + 0.30 * n1) * k * tEdge;
  }

  // 4. Speaking: vocal soundwave
  if (uSpeak > 0.01) {
    float vocWave = sin(pos.x * 14.0 + uTime * 12.0 + aSeed.z * 6.28) * (0.02 + 0.09 * uLevel) * uSpeak * mo * dockDisp;
    pos.y += vocWave;
    pos.x += cos(pos.y * 10.0 - uTime * 8.0) * (0.01 + 0.03 * uLevel) * uSpeak * mo * dockDisp;
  }

  // 5. Rendering: quantum scanline
  float scanY = mod(uTime * 1.5, 2.8) - 1.4;
  float scanWave = gauss(abs(pos.y - scanY), 0.14) * uRender;
  pos += vec2(sin(aSeed.z * TAU), cos(aSeed.w * TAU)) * scanWave * 0.06 * mo * dockDisp;

  // 6. WAKE-UP : converge from a scattered shell into the form
  float wakeK = 1.0;
  if (uWake > 0.001 && uWake < 1.0) {
    wakeK = smoothstep(0.0, 1.0, uWake * 1.35 - aSeed.w * 0.35);
    float sa = aSeed.x * TAU + uTime * 0.15 * mo;
    vec2 scatter = vec2(cos(sa), sin(sa)) * (2.0 + aSeed.z * 1.6) + (aSeed.ww - 0.5) * 0.5;
    pos = mix(scatter, pos, wakeK);
  }

  // Idle / pause posture: deep U-bow (reference ribbon). Stronger foreshortening
  // + vertical settle so the form reads as a hanging multi-layer arc.
  // Extra transverse wave gives the Deepgram-style soft oscillation.
  float bowK = uBow;
  pos.y = pos.y * mix(1.0, 0.68, bowK) - 0.14 * bowK;
  pos.x *= mix(1.0, 0.94, bowK);
  // pull sides upward into a smile/U while compressing the center
  float sideLift = pow(abs(pos.x), 1.55) * 0.22 * bowK;
  pos.y += sideLift;
  pos.x *= 1.0 + 0.10 * bowK * clamp(-pos.y + 0.15, 0.0, 1.0);
  // soft traveling wave along the arc (Deepgram idle feel)
  float arcWave = sin(pos.x * 3.2 + uTime * 1.65) * 0.018 * bowK * mo
                + sin(pos.x * 6.8 - uTime * 2.1) * 0.008 * bowK * mo;
  pos.y += arcWave;
  pos += uHang;

  // ---- per-state colour + glow of the shape ----
  float pang = atan(pos.y, pos.x);
  vec3 c = mix(rimColor(pang), uShapeTint, uShapeTintAmt);
  c = mix(c, vec3(0.85, 0.95, 1.0), limb*0.5*(1.0-uForm)*(1.0-mt));
  c = mix(c, vec3(0.4, 0.95, 1.0) * 1.5, scanWave * 0.85);

  float spark = step(mix(0.992, 0.980, uSparkle), aSeed.z);
  float tw = 0.75 + 0.25 * sin(uTime * (2.0 + aSeed.x * 4.0) + aSeed.y * 20.0);

  float baseAlpha = mix(formA, 0.65 + 0.35*aSeed.w, mt);
  float onlyPartAlpha = mix(baseAlpha, baseAlpha * 1.85 + 0.25, uOnlyParticles);
  float a = onlyPartAlpha * uGain * tw * uShapeGlow * mix(1.0, 1.25, uDock);
  a *= 1.0 + spark * 1.8 * uSparkle;
  a += scanWave * 0.45;
  // thinking rim: bright, dense, alive; core: dim lattice with sparse lit nodes
  a *= 1.0 + uThink * tEdge * 1.75;
  float coreNode = step(0.958, aSeed.w);            // a few interior dots stay lit
  a *= mix(1.0, mix(0.22, 1.55, coreNode), uThink * (1.0 - tEdge));
  a *= mix(1.0, 0.45, uPaused);          // pause fades her back
  a *= 0.35 + 0.65 * wakeK;              // wake-up brightens as she lands

  float baseSize = 1.35 + 1.2*limb*(1.0-uForm) + 1.0*uForm + 1.5*mt;
  float size = baseSize * uDpr * uParticleScale * mix(1.0, 1.45, uOnlyParticles)
             * (1.0 + spark * 1.4 * uSparkle + scanWave * 0.8) * mix(1.0, 0.9, uPaused)
             * mix(1.0, 0.58, uDock);
  size *= 1.0 + uThink * tEdge * 0.7;               // rim particles swell
  size *= mix(1.0, 0.8, uThink * (1.0 - tEdge));    // core dots tighten to lattice points
  size *= mix(1.6, 1.0, wakeK);          // wake-up: points arrive large then settle

  // thinking: push the boiling rim toward hot white-cyan energy
  c = mix(c, vec3(1.0), uThink * tEdge * 0.3);
  // completed (visualState 7): soft emerald success wash + gentle sparkle
  if (uVisualState > 6.5) {
    c = mix(c, vec3(0.35, 0.98, 0.62), 0.55);
    a *= 1.0 + 0.25 * sin(uTime * 3.2 + aSeed.x * 12.0);
  }

  // pause desaturation
  float lumP = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(lumP) * vec3(0.82, 0.86, 1.0), uPaused * 0.55);

  vCol = vec4(c, clamp(a, 0.0, 1.0));
  gl_PointSize = max(1.0, size);
  vec2 scr = uCenter + pos * uR * uBodyScale;
  gl_Position = vec4(scr / uVP * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PARTICLE_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 frag;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q,q)*4.0;
  if (r2 > 1.0) discard;
  float a = exp(-r2*3.2) * (1.0 - r2*0.65);
  frag = vec4(vCol.rgb * vCol.a * a, 1.0);
}
`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 frag;
void main(){
  vec3 acc = texture(uTex, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  acc += (texture(uTex, vUv + o1).rgb + texture(uTex, vUv - o1).rgb) * 0.3162162162;
  acc += (texture(uTex, vUv + o2).rgb + texture(uTex, vUv - o2).rgb) * 0.0702702703;
  frag = vec4(acc, 1.0);
}
`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform float uExposure;
out vec4 frag;
void main(){
  vec3 sc = texture(uScene, vUv).rgb;
  vec3 b1 = texture(uB1, vUv).rgb;
  vec3 b2 = texture(uB2, vUv).rgb;
  vec3 c = sc + b1*0.62 + b2*0.42;
  c *= uExposure;
  c = (c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14);
  frag = vec4(c, 1.0);
}
`;
