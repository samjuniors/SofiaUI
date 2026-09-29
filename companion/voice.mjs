/**
 * companion/voice.mjs — airplane-mode voice: local TTS + local STT (Phase 8).
 *
 *   voice_info           → which engines are present (tts/stt, offline-ready?)
 *   tts_local { text }   → WAV (base64) spoken entirely on this machine
 *   stt_local { data }   → text from a 16-bit mono WAV (base64), via Whisper
 *
 * Engines (first available wins):
 *   TTS: piper → macOS `say` → Windows SAPI (System.Speech) → espeak-ng/espeak
 *   STT: whisper-cli / whisper-cpp / whisper (whisper.cpp), or SOPHIA_STT_URL
 *        (any OpenAI-compatible /v1/audio/transcriptions server)
 * Pure helpers (engine selection + WAV parsing) are exported and unit-tested;
 * missing binaries degrade into per-OS install hints, never a crash.
 */
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

const MAX_TEXT = 2000;
const run = (cmd, args, timeout = 30000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 20e6, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));
const exists = async (cmd) => { try { await run(process.platform === "win32" ? "where" : "which", [cmd], 2000); return true; } catch { return false; } };

/* ── engine selection (pure) ───────────────────────────────────────────────── */

export function pickTtsEngine(p = platform(), env = process.env) {
  if (env.SOPHIA_TTS_ENGINE) return env.SOPHIA_TTS_ENGINE; // explicit override: piper|say|sapi|espeak
  if (p === "darwin") return "say";
  if (p === "win32") return "sapi";
  return "piper-or-espeak"; // resolved at runtime by availability
}

export const STT_BINARIES = ["whisper-cli", "whisper-cpp", "whisper"];

export function ttsHint(p = platform()) {
  if (p === "win32") return "Windows SAPI is built in; for higher quality install Piper (github.com/rhasspy/piper).";
  if (p === "darwin") return "`say` is built in; for higher quality install Piper (brew install piper-tts).";
  return "Install espeak-ng (`sudo apt install espeak-ng`) or Piper (github.com/rhasspy/piper) for local speech.";
}

export function sttHint() {
  return "Install whisper.cpp (whisper-cli on PATH) or point SOPHIA_STT_URL at an OpenAI-compatible transcription server.";
}

/* ── WAV handling (pure) ─────────────────────────────────────────────────────── */

/** Parse a RIFF/WAVE header. Returns geometry + where raw PCM starts. */
export function parseWav(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let off = 12;
  let fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = {
        audioFormat: b.readUInt16LE(off + 8),
        channels: b.readUInt16LE(off + 10),
        sampleRate: b.readUInt32LE(off + 12),
        bitsPerSample: b.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error("Malformed WAV (missing fmt/data chunks)");
  return { ...fmt, dataOffset: dataOff, dataLength: Math.min(dataLen, b.length - dataOff) };
}

/** Extract little-endian 16-bit mono PCM from a WAV, downmixing if needed. */
export function wavToPcm16(buf) {
  const w = parseWav(buf);
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (w.bitsPerSample !== 16) throw new Error(`Unsupported WAV bit depth ${w.bitsPerSample}`);
  const raw = b.subarray(w.dataOffset, w.dataOffset + w.dataLength);
  if (w.channels === 1) return { pcm: new Uint8Array(raw), sampleRate: w.sampleRate };
  const frames = Math.floor(raw.length / (2 * w.channels));
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < w.channels; c++) sum += raw.readInt16LE((i * w.channels + c) * 2);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / w.channels))), i * 2);
  }
  return { pcm: new Uint8Array(out), sampleRate: w.sampleRate };
}

/** Build a minimal 16-bit mono WAV around raw PCM. */
export function pcm16ToWav(pcm, sampleRate = 16000) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/* ── actions ───────────────────────────────────────────────────────────────── */

async function ttsViaPiper(text, file) {
  const model = process.env.SOPHIA_PIPER_MODEL || join(homedir(), ".sophia", "piper-voice.onnx");
  try { await fs.access(model); } catch { throw new Error(`Piper voice model not found at ${model}. Download one (e.g. en_US-lessac-medium.onnx) and set SOPHIA_PIPER_MODEL.`); }
  const child = spawn("piper", ["--model", model, "--output_file", file], { stdio: ["pipe", "inherit", "pipe"] });
  child.stdin.write(text); child.stdin.end();
  await new Promise((resolve, reject) => { child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`piper exited ${c}`)))); child.on("error", reject); });
}

async function ttsEngines(text, file) {
  const p = platform();
  const pref = pickTtsEngine(p);
  if (pref === "piper" || (pref === "piper-or-espeak" && (await exists("piper")))) { await ttsViaPiper(text, file); return "piper"; }
  if (pref === "say" && p === "darwin") { await run("say", ["-o", file, "--data-format=LEI16@24000", text]); return "say"; }
  if (pref === "sapi" && p === "win32") {
    const ps = `Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.SetOutputToWaveFile('${file.replace(/'/g, "''")}');$s.Speak('${text.replace(/'/g, "''")}');$s.Dispose()`;
    await run("powershell", ["-NoProfile", "-Command", ps]); return "sapi";
  }
  const bin = (await exists("espeak-ng")) ? "espeak-ng" : (await exists("espeak")) ? "espeak" : null;
  if (bin) { await run(bin, ["-w", file, text]); return bin; }
  throw new Error(ttsHint(p));
}

async function sttTranscribe(file) {
  const url = process.env.SOPHIA_STT_URL;
  if (url) {
    const body = new FormData();
    body.append("file", new Blob([await fs.readFile(file)], { type: "audio/wav" }), "audio.wav");
    body.append("model", process.env.SOPHIA_STT_MODEL || "whisper-1");
    const res = await fetch(url.replace(/\/$/, "") + "/v1/audio/transcriptions", { method: "POST", body });
    if (!res.ok) throw new Error(`STT server ${res.status}`);
    const j = await res.json();
    return { text: String(j.text ?? "").trim(), engine: "http" };
  }
  for (const bin of STT_BINARIES) {
    if (!(await exists(bin))) continue;
    const model = process.env.SOPHIA_WHISPER_MODEL || join(homedir(), ".sophia", "ggml-base.en.bin");
    try { await fs.access(model); } catch { throw new Error(`Whisper model not found at ${model}. Download ggml-base.en.bin and set SOPHIA_WHISPER_MODEL. (${sttHint()})`); }
    const out = await run(bin, ["-m", model, "-f", file, "-nt", "-np", "--no-prints"]);
    return { text: out.trim(), engine: bin };
  }
  throw new Error(sttHint());
}

export async function voiceAction(action, a = {}) {
  switch (action) {
    case "voice_info": {
      const p = platform();
      const tts = { piper: await exists("piper"), espeak: (await exists("espeak-ng")) || (await exists("espeak")), say: p === "darwin", sapi: p === "win32" };
      const stt = { whisper: (await exists("whisper-cli")) || (await exists("whisper-cpp")) || (await exists("whisper")), http: Boolean(process.env.SOPHIA_STT_URL) };
      return {
        platform: p,
        tts: { available: Object.values(tts).some(Boolean), engines: tts, hint: ttsHint(p) },
        stt: { available: stt.whisper || stt.http, engines: stt, hint: sttHint() },
      };
    }
    case "tts_local": {
      const text = String(a.text ?? "").trim().slice(0, MAX_TEXT);
      if (!text) throw new Error("Nothing to say.");
      const file = join(tmpdir(), `sophia-tts-${Date.now()}.wav`);
      try {
        const engine = await ttsEngines(text, file);
        const wav = await fs.readFile(file);
        const w = parseWav(wav);
        return { mime: "audio/wav", data: wav.toString("base64"), engine, sampleRate: w.sampleRate, chars: text.length };
      } finally { await fs.unlink(file).catch(() => {}); }
    }
    case "stt_local": {
      const data = String(a.data ?? "");
      if (data.length < 100) throw new Error("No audio data.");
      const buf = Buffer.from(data, "base64");
      parseWav(buf); // validate before shelling out
      const file = join(tmpdir(), `sophia-stt-${Date.now()}.wav`);
      try {
        await fs.writeFile(file, buf);
        return await sttTranscribe(file);
      } finally { await fs.unlink(file).catch(() => {}); }
    }
    default: throw new Error(`Unsupported voice action ${action}`);
  }
}
