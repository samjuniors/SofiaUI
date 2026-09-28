/**
 * Sophia — server reference handlers.
 *
 *   POST /api/sophia/live/session      → Gemini Live token / session credentials
 *   POST /api/sophia/live/reset        → Validate & reset live session state
 *   POST /api/sophia/chat              → LLM brain (Gemini / Grok / Claude / OpenAI / Ollama / LM Studio)
 *   POST /api/sophia/gemini/speak      → Gemini Flash Lite TTS neural stream
 *   POST /api/sophia/mouth/speak       → Unified neural mouth TTS endpoint
 *   POST /api/sophia/test-voice        → Diagnostic quick voice sample
 *   GET  /api/sophia/status            → Backends, live models & diagnostics
 */

import os from "node:os";
import { execFile } from "node:child_process";
import { GoogleGenAI } from "@google/genai";
import { ALL_SHAPES, SOPHIA_SYSTEM } from "../sophia/control";
import { handleMediaProxy } from "./media-proxy";
import { generateImage } from "./image-gen";
import { handleWebSearch, getSearchProviderStatus } from "./web-search-server";
import { handleStatusRequest, handleTtsRequest, handleChatRequest } from './sophia-live-server';
import { handleBrowseProxy } from "./browse-proxy";
import { allowLlmUrlOverride, resolveBrowserTarget, resolveLlmBaseUrl } from "./sophia-server-policy";

const GEMINI_MODEL = process.env.GEMINI_LIVE_MODEL?.trim() || "models/gemini-3.8-live";
// All model IDs are env-overridable so a retired model can be swapped without a deploy.
// Verified against provider docs 2026-09: gpt-4o (retired 2026-02) and
// claude-3-5-sonnet-20241022 (retired 2025-10) no longer resolve.
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.8-flash";
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-lite-tts";
const LIVE_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const GROK_MODEL = process.env.XAI_MODEL?.trim() || "grok-4.5";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-6-sol";

let envLoaded = false;
function loadEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile('.env.local');
    } catch {
      try {
        process.loadEnvFile('.env');
      } catch {
        // ignore
      }
    }
  }
}

function key(name: string): string | undefined {
  loadEnvOnce();
  const v = process.env[name]?.trim();
  return v && v !== "your_xai_api_key_here" && v !== "your_claude_api_key_here" && v !== "your_openai_api_key_here"
    ? v
    : undefined;
}

function geminiKey(): string | undefined {
  return key("GEMINI_API_KEY") || key("GOOGLE_API_KEY");
}

const FUNCTION_DECLARATIONS = [
  {
    name: "transform_shape",
    description:
      "Transform Sophia's physical substance into a requested geometry (sphere, ring, waveform, bow, torus, infinity, helix, hypercube, pyramid, star, galaxy, heart, shield, matrix, split, merge, dissolve, face, spiky, letter-z, letter-s, letter-a, letter-o).",
    parameters: {
      type: "OBJECT",
      properties: {
        shape: { type: "STRING", enum: [...ALL_SHAPES] },
      },
      required: ["shape"],
    },
  },
  {
    name: "generate_image",
    description:
      "Generate a photo, illustration, concept art, diagram, or artwork using Imagen 3 when asked to create, paint, draw, or visualize an image.",
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: { type: "STRING", description: "Detailed descriptive prompt for the image creation" },
        aspectRatio: {
          type: "STRING",
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          description: "Aspect ratio for the generated image (default 1:1)",
        },
      },
      required: ["prompt"],
    },
  },
];

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

function statusPayload() {
  const hasGemini = Boolean(geminiKey());
  const deepgram = Boolean(key("DEEPGRAM_API_KEY"));
  const elevenlabs = Boolean(key("ELEVENLABS_API_KEY"));
  const xai = Boolean(key("XAI_API_KEY"));
  const anthropic = Boolean(key("ANTHROPIC_API_KEY"));
  const openai = Boolean(key("OPENAI_API_KEY"));
  const brainMode = process.env.SOPHIA_BRAIN_MODE?.trim() || "auto";

  return {
    gemini: hasGemini,
    geminiLive: hasGemini,
    geminiLiveModel: GEMINI_MODEL,
    geminiTextModel: GEMINI_TEXT_MODEL,
    geminiTtsModel: GEMINI_TTS_MODEL,
    geminiTts: hasGemini,
    deepgram,
    elevenlabs,
    xai,
    anthropic,
    openai,
    activeMouthEngine: hasGemini ? "gemini" : elevenlabs ? "elevenlabs" : deepgram ? "deepgram" : "browser",
    ollama: {
      configured: true,
      baseUrl: process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434",
      model: process.env.OLLAMA_MODEL?.trim() || "llama3.2",
    },
    lmstudio: {
      configured: true,
      baseUrl: process.env.LMSTUDIO_BASE_URL?.trim() || "http://localhost:1234/v1",
      model: process.env.LMSTUDIO_MODEL?.trim() || "local-model",
    },
    configuredVoiceId:
      process.env.ELEVENLABS_VOICE_ID?.trim() ||
      process.env.SOPHIA_VOICE_ID?.trim() ||
      "bMxLr8fP6hzNRRi9nJxU",
    configuredDeepgramVoice: process.env.DEEPGRAM_VOICE_MODEL?.trim() || "aura-2-thalia-en",
    defaultBrainMode: brainMode,
    voice: hasGemini || deepgram || elevenlabs,
    ok: hasGemini || deepgram || elevenlabs,
    searchProviders: getSearchProviderStatus(),
    timestamp: Date.now(),
  };
}

async function liveSession(req: Request): Promise<Response> {
  const apiKey = geminiKey();
  if (!apiKey) {
    return json(
      {
        error: "GEMINI_API_KEY not configured",
        message: "Gemini API key is required to initiate Gemini Live sessions.",
      },
      { status: 503 },
    );
  }

  let voice = "Aoede";
  let modelOverride = GEMINI_MODEL;
  try {
    const b = (await req.json()) as { voice?: string; model?: string };
    if (b.voice) voice = b.voice;
    if (b.model) modelOverride = b.model;
  } catch {
    /* empty body is fine */
  }

  const now = Date.now();
  const expiresInSeconds = 1800;

  // Mint a short-lived ephemeral token so the long-lived API key never reaches
  // the browser. The client already speaks `auth_tokens/…` → `access_token=`.
  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + expiresInSeconds * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      },
    });
    if (token?.name) {
      return json({
        token: token.name,
        model: modelOverride,
        wsUrl: LIVE_WS,
        voice,
        createdAt: now,
        expiresInSeconds,
      });
    }
  } catch (err) {
    console.error("[sophia-server] ephemeral live token failed:", err);
  }

  // Explicit, local-dev-only escape hatch. Never enable on a public deployment:
  // it hands the raw Gemini key to any visitor who POSTs to this endpoint.
  if (process.env.SOPHIA_ALLOW_RAW_LIVE_KEY === "1") {
    console.warn("[sophia-server] SOPHIA_ALLOW_RAW_LIVE_KEY=1 — returning raw Gemini key to client");
    return json({ token: apiKey, model: modelOverride, wsUrl: LIVE_WS, voice, createdAt: now, expiresInSeconds });
  }

  return json(
    {
      error: "live-token-unavailable",
      message:
        "Could not mint an ephemeral Gemini Live token. Use the /api/live-ws server proxy, or set SOPHIA_ALLOW_RAW_LIVE_KEY=1 for local development only.",
    },
    { status: 503 },
  );
}

async function deepgramSession(): Promise<Response> {
  const apiKey = key("DEEPGRAM_API_KEY");
  if (!apiKey) return json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 503 });
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ time_to_live_in_seconds: 3600 }),
  });
  if (!res.ok) return json({ error: `grant:${res.status}` }, { status: 502 });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) return json({ error: "no token issued" }, { status: 502 });
  return json({ key: data.access_token });
}

export type ChatBody = {
  lastUser: string;
  history: Array<{ role: string; text: string; final: boolean }>;
  brainMode?: "auto" | "gemini" | "grok" | "claude" | "openai" | "ollama" | "lmstudio" | "local";
  ollamaUrl?: string;
  ollamaModel?: string;
  lmStudioUrl?: string;
  lmStudioModel?: string;
  /** Server-side only: set by `chat()` from the request, never trusted from the client. */
  _allowUrlOverride?: boolean;
};

function formatOpenAIMessages(body: ChatBody) {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SOPHIA_SYSTEM },
  ];
  for (const t of body.history.filter((x) => x.final && x.role !== "system")) {
    messages.push({
      role: t.role === "sophia" ? "assistant" : "user",
      content: t.text,
    });
  }
  if (!messages.some((m) => m.role === "user" && m.content === body.lastUser)) {
    messages.push({ role: "user", content: body.lastUser });
  }
  return messages;
}

const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "transform_shape",
      description: FUNCTION_DECLARATIONS[0].description,
      parameters: {
        type: "object",
        properties: {
          shape: { type: "string", enum: [...ALL_SHAPES] },
        },
        required: ["shape"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: FUNCTION_DECLARATIONS[1].description,
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed descriptive prompt for image generation" },
          aspectRatio: {
            type: "string",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            description: "Aspect ratio (default 1:1)",
          },
        },
        required: ["prompt"],
      },
    },
  },
];

async function chatWithOpenAICompatible(
  body: ChatBody,
  endpoint: string,
  headers: Record<string, string>,
  model: string,
  brainId: string,
  opts: { openaiNative?: boolean } = {},
): Promise<Response | null> {
  const messages = formatOpenAIMessages(body);
  // Current OpenAI models reject `max_tokens` (and non-default temperature) on
  // chat completions; Ollama / LM Studio / xAI still use the classic fields.
  const limits = opts.openaiNative
    ? { max_completion_tokens: 220 }
    : { max_tokens: 220, temperature: 0.7 };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        ...limits,
        messages,
        tools: OPENAI_TOOLS,
      }),
    });
    if (!res.ok) {
      const fallbackRes = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          model,
          ...limits,
          messages,
        }),
      });
      if (!fallbackRes.ok) return null;
      const data = (await fallbackRes.json()) as any;
      const content = data.choices?.[0]?.message?.content ?? "";
      return json({ text: content.trim(), toolCalls: [], brain: brainId });
    }
    const data = (await res.json()) as any;
    const msg = data.choices?.[0]?.message;
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const tc of msg?.tool_calls ?? []) {
      if (!tc.function?.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      toolCalls.push({ name: tc.function.name, args });
    }
    return json({ text: (msg?.content ?? "").trim(), toolCalls, brain: brainId });
  } catch (err) {
    console.error(`[sophia-server] ${brainId} chat failed:`, err);
    return null;
  }
}

async function chatWithGrok(body: ChatBody, apiKey: string): Promise<Response | null> {
  return chatWithOpenAICompatible(
    body,
    "https://api.x.ai/v1/chat/completions",
    { authorization: `Bearer ${apiKey}` },
    GROK_MODEL,
    "xai",
  );
}

async function chatWithOpenAI(body: ChatBody, apiKey: string): Promise<Response | null> {
  return chatWithOpenAICompatible(
    body,
    "https://api.openai.com/v1/chat/completions",
    { authorization: `Bearer ${apiKey}` },
    OPENAI_MODEL,
    "openai",
    { openaiNative: true },
  );
}

async function chatWithClaude(body: ChatBody, apiKey: string): Promise<Response | null> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of body.history.filter((x) => x.final && x.role !== "system")) {
    messages.push({
      role: t.role === "sophia" ? "assistant" : "user",
      content: t.text,
    });
  }
  if (!messages.some((m) => m.role === "user" && m.content === body.lastUser)) {
    messages.push({ role: "user", content: body.lastUser });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 220,
        system: SOPHIA_SYSTEM,
        messages,
        tools: [
          {
            name: "transform_shape",
            description: FUNCTION_DECLARATIONS[0].description,
            input_schema: {
              type: "object",
              properties: {
                shape: { type: "string", enum: [...ALL_SHAPES] },
              },
              required: ["shape"],
            },
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    let text = "";
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const block of data.content ?? []) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use" && block.name === "transform_shape") {
        toolCalls.push({ name: block.name, args: block.input ?? {} });
      }
    }
    return json({ text: text.trim(), toolCalls, brain: "claude" });
  } catch (err) {
    console.error("[sophia-server] Claude chat failed:", err);
    return null;
  }
}

async function chatWithOllama(body: ChatBody): Promise<Response | null> {
  const baseUrl = resolveLlmBaseUrl({
    override: body.ollamaUrl,
    overrideAllowed: body._allowUrlOverride === true,
    envValue: process.env.OLLAMA_BASE_URL,
    fallback: "http://localhost:11434",
  });
  const model = body.ollamaModel || process.env.OLLAMA_MODEL || "llama3.2";
  const endpoint = `${baseUrl}/v1/chat/completions`;
  return chatWithOpenAICompatible(body, endpoint, {}, model, "ollama");
}

async function chatWithLMStudio(body: ChatBody): Promise<Response | null> {
  const baseUrl = resolveLlmBaseUrl({
    override: body.lmStudioUrl,
    overrideAllowed: body._allowUrlOverride === true,
    envValue: process.env.LMSTUDIO_BASE_URL,
    fallback: "http://localhost:1234/v1",
  });
  const model = body.lmStudioModel || process.env.LMSTUDIO_MODEL || "local-model";
  const endpoint = `${baseUrl}/chat/completions`;
  return chatWithOpenAICompatible(body, endpoint, {}, model, "lmstudio");
}

function getGeminiFetchParams(apiKey: string, model: string, endpoint = "generateContent") {
  const cleanKey = apiKey.replace(/^auth_tokens\//, "").trim();
  const isAuthToken = apiKey.startsWith("auth_tokens/") || apiKey.startsWith("ya29.");

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isAuthToken) {
    headers["authorization"] = `Bearer ${cleanKey}`;
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?access_token=${encodeURIComponent(cleanKey)}`,
      headers,
    };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${encodeURIComponent(cleanKey)}`,
    headers,
  };
}

async function chatWithGemini(body: ChatBody, apiKey: string): Promise<Response> {
  const contents = body.history
    .filter((t) => t.final && t.role !== "system")
    .map((t) => ({ role: t.role === "sophia" ? "model" : "user", parts: [{ text: t.text }] }));
  if (contents.length === 0 && body.lastUser) {
    contents.push({ role: "user", parts: [{ text: body.lastUser }] });
  }

  const models = [GEMINI_TEXT_MODEL, "gemini-3.5-flash", "gemini-2.5-flash-lite"];
  let lastStatus = 502;

  const isLiveSearchQuery = Boolean(
    body.lastUser &&
    /\b(who|what|when|where|why|how|weather|news|today|latest|score|stock|price|current|search|happened|live|forecast|update|match)\b/i.test(body.lastUser)
  );

  for (const model of models) {
    const { url, headers } = getGeminiFetchParams(apiKey, model);
    try {
      const toolsPayload: any[] = isLiveSearchQuery
        ? [{ functionDeclarations: FUNCTION_DECLARATIONS }, { googleSearch: {} }]
        : [{ functionDeclarations: FUNCTION_DECLARATIONS }];

      let res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SOPHIA_SYSTEM }] },
          tools: toolsPayload,
          contents,
        }),
      });

      // Fallback without googleSearch if the model rejects combining tools
      if (!res.ok && isLiveSearchQuery) {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SOPHIA_SYSTEM }] },
            tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
            contents,
          }),
        });
      }

      if (!res.ok) {
        lastStatus = res.status;
        console.warn(`[sophia-server] Gemini chat (${model}) returned status ${res.status}`);
        continue;
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<Record<string, unknown>> };
          groundingMetadata?: {
            webSearchQueries?: string[];
            groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
          };
        }>;
      };
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      let text = "";
      const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      for (const p of parts) {
        if (typeof p.text === "string") text += p.text;
        const fc = p.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
        if (fc?.name) toolCalls.push({ name: fc.name, args: fc.args ?? {} });
      }

      const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
        .map((c) => c.web)
        .filter((w): w is { uri: string; title: string } => Boolean(w?.uri && w?.title))
        .map((w) => ({ title: w.title, url: w.uri }));

      return json({
        text: text.trim(),
        toolCalls,
        sources: sources.length > 0 ? sources : undefined,
        brain: "gemini",
      });
    } catch (err) {
      console.warn(`[sophia-server] Gemini chat (${model}) fetch error:`, err);
    }
  }

  return json({ error: `generate:${lastStatus}` }, { status: 502 });
}

async function chat(req: Request): Promise<Response> {
  const body = (await req.json()) as ChatBody;
  // Client-supplied Ollama/LM Studio URLs are a server-side fetch target (SSRF).
  // Only honour them for local dev requests or with SOPHIA_ALLOW_LLM_URL_OVERRIDE=1.
  body._allowUrlOverride = allowLlmUrlOverride(req);
  const requestedMode = body.brainMode || process.env.SOPHIA_BRAIN_MODE || "auto";

  // Explicit modes
  if (requestedMode === "gemini") {
    const gemini = geminiKey();
    if (gemini) return chatWithGemini(body, gemini);
  }
  if (requestedMode === "ollama") {
    const res = await chatWithOllama(body);
    if (res) return res;
    return json({ error: "Ollama not reachable at configured endpoint" }, { status: 502 });
  }
  if (requestedMode === "lmstudio" || requestedMode === "local") {
    const res = await chatWithLMStudio(body);
    if (res) return res;
    return json({ error: "LM Studio not reachable at configured endpoint" }, { status: 502 });
  }
  if (requestedMode === "claude") {
    const anthropicKey = key("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
    const res = await chatWithClaude(body, anthropicKey);
    if (res) return res;
  }
  if (requestedMode === "openai") {
    const openAiKey = key("OPENAI_API_KEY");
    if (!openAiKey) return json({ error: "OPENAI_API_KEY not configured" }, { status: 503 });
    const res = await chatWithOpenAI(body, openAiKey);
    if (res) return res;
  }
  if (requestedMode === "grok" || requestedMode === "xai") {
    const xai = key("XAI_API_KEY");
    if (xai) {
      const grok = await chatWithGrok(body, xai);
      if (grok) return grok;
    }
  }

  // Auto fallback priority chain
  const gemini = geminiKey();
  if (gemini) {
    const r = await chatWithGemini(body, gemini);
    if (r.ok) return r;
  }

  const xai = key("XAI_API_KEY");
  if (xai) {
    const grok = await chatWithGrok(body, xai);
    if (grok) return grok;
  }

  const anthropic = key("ANTHROPIC_API_KEY");
  if (anthropic) {
    const claude = await chatWithClaude(body, anthropic);
    if (claude) return claude;
  }

  const openai = key("OPENAI_API_KEY");
  if (openai) {
    const oai = await chatWithOpenAI(body, openai);
    if (oai) return oai;
  }

  // Local fallbacks
  const ollama = await chatWithOllama(body);
  if (ollama) return ollama;

  const lmstudio = await chatWithLMStudio(body);
  if (lmstudio) return lmstudio;

  return json(
    { error: "No LLM brain responded. Check GEMINI_API_KEY, XAI_API_KEY, or local Ollama/LM Studio." },
    { status: 503 },
  );
}

async function deepgramSpeak(req: Request): Promise<Response> {
  const apiKey = key("DEEPGRAM_API_KEY");
  if (!apiKey) return json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 503 });
  const { text, voice = process.env.DEEPGRAM_VOICE_MODEL || "aura-2-thalia-en" } = (await req.json()) as {
    text: string;
    voice?: string;
  };
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: { authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) return json({ error: `speak:${res.status}` }, { status: 502 });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "audio/mpeg" },
  });
}

async function elevenLabsSpeak(req: Request): Promise<Response> {
  const apiKey = key("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });

  const {
    text,
    voiceId = process.env.ELEVENLABS_VOICE_ID || process.env.SOPHIA_VOICE_ID || "bMxLr8fP6hzNRRi9nJxU",
    modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
  } = (await req.json()) as {
    text: string;
    voiceId?: string;
    modelId?: string;
  };

  if (!text?.trim()) {
    return json({ error: "Text is required for TTS" }, { status: 400 });
  }

  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    console.error(`[sophia-server] ElevenLabs speak error ${res.status}:`, errText);
    return json({ error: `elevenlabs-speak:${res.status}`, details: errText }, { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "audio/mpeg",
      "transfer-encoding": "chunked",
    },
  });
}

async function elevenLabsVoices(): Promise<Response> {
  const apiKey = key("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return json({
      voices: [
        { voice_id: "bMxLr8fP6hzNRRi9nJxU", name: "Sophia Custom (.env)" },
        { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (Calm & Professional)" },
        { voice_id: "pNInz6obpgSf9S9P369C", name: "Adam (Warm & Deep)" },
        { voice_id: "piTKgcLEGmPE4e6mEKli", name: "Nicole (Whispering & Soft)" },
        { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte (Expressive & Elegant)" },
        { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George (British Accent)" },
      ],
    });
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) throw new Error(`voices-fetch:${res.status}`);
    const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; category?: string }> };
    return json({ voices: data.voices ?? [] });
  } catch (err) {
    console.warn("[sophia-server] Failed to fetch ElevenLabs voices, returning presets:", err);
    return json({
      voices: [
        { voice_id: "bMxLr8fP6hzNRRi9nJxU", name: "Sophia Custom (.env)" },
        { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (Calm & Professional)" },
        { voice_id: "pNInz6obpgSf9S9P369C", name: "Adam (Warm & Deep)" },
        { voice_id: "piTKgcLEGmPE4e6mEKli", name: "Nicole (Whispering & Soft)" },
        { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte (Expressive & Elegant)" },
        { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George (British Accent)" },
      ],
    });
  }
}

function wrapPcmWithWavHeader(pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  if (pcmBuffer.length >= 12 && pcmBuffer.subarray(0, 4).toString('utf8') === 'RIFF') {
    return pcmBuffer;
  }
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function geminiSpeak(req: Request): Promise<Response> {
  const apiKey = geminiKey();
  if (!apiKey) return json({ error: "GEMINI_API_KEY/GOOGLE_API_KEY not configured" }, { status: 503 });

  let text = "";
  let voice = "Aoede";
  try {
    const b = (await req.json()) as { text?: string; voice?: string };
    text = (b.text ?? "").trim();
    if (b.voice) voice = b.voice;
  } catch {
    /* empty */
  }

  if (!text) {
    return json({ error: "Text is required for TTS" }, { status: 400 });
  }

  const validVoices = ["Aoede", "Puck", "Charon", "Kore", "Fenrir", "Zephyr"];
  const voiceName = validVoices.includes(voice) ? voice : "Aoede";

  const modelsToTry = [GEMINI_TTS_MODEL, "gemini-3.8-flash-tts", "gemini-3.8-flash"];
  let lastErr = "";

  for (const model of Array.from(new Set(modelsToTry))) {
    try {
      const { url, headers } = getGeminiFetchParams(apiKey, model);
      const res = await fetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
        },
      );

      if (!res.ok) {
        lastErr = await res.text().catch(() => "");
        console.warn(`[sophia-server] Gemini TTS (${model}) error ${res.status}:`, lastErr);
        continue;
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: {
                mimeType?: string;
                data?: string;
              };
            }>;
          };
        }>;
      };

      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        continue;
      }

      const rawBuffer = Buffer.from(inlineData.data, "base64");
      const wavBuffer = wrapPcmWithWavHeader(rawBuffer, 24000);
      return new Response(new Uint8Array(wavBuffer), {
        headers: {
          "content-type": "audio/wav",
          "content-length": String(wavBuffer.length),
        },
      });
    } catch (err: any) {
      lastErr = err.message || String(err);
      console.warn(`[sophia-server] Gemini TTS (${model}) failed:`, err);
    }
  }

  return json({ error: "gemini-tts-failed", details: lastErr }, { status: 502 });
}

async function mouthSpeak(req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requestedProvider = body.provider || "auto";

  if (requestedProvider === "elevenlabs" && key("ELEVENLABS_API_KEY")) {
    const fakeReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return elevenLabsSpeak(fakeReq);
  }

  if (requestedProvider === "deepgram" && key("DEEPGRAM_API_KEY")) {
    const fakeReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return deepgramSpeak(fakeReq);
  }

  // Default / auto / gemini path:
  if (geminiKey()) {
    const fakeReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return geminiSpeak(fakeReq);
  }

  if (key("ELEVENLABS_API_KEY")) {
    const fakeReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return elevenLabsSpeak(fakeReq);
  }

  if (key("DEEPGRAM_API_KEY")) {
    const fakeReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return deepgramSpeak(fakeReq);
  }

  return json({ error: "No neural TTS engine configured (Gemini/ElevenLabs/Deepgram)" }, { status: 503 });
}

async function testVoice(req: Request): Promise<Response> {
  let voice = "Aoede";
  let provider = "auto";
  let voiceId = "";
  try {
    const b = (await req.json()) as { voice?: string; provider?: string; voiceId?: string };
    if (b.voice) voice = b.voice;
    if (b.provider) provider = b.provider;
    if (b.voiceId) voiceId = b.voiceId;
  } catch {
    /* empty */
  }

  const sampleGreeting = "G'day! I am Sofia. All audio systems and voice output are functioning properly.";
  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: sampleGreeting, voice, provider, voiceId }),
  });
  return mouthSpeak(fakeReq);
}

/**
 * Open a validated http(s) URL with the OS default handler WITHOUT a shell.
 * `execFile` passes the URL as a single argv entry, so `$(…)`, backticks,
 * `&`, `|` etc. inside the URL are inert. On Windows we deliberately avoid
 * `cmd.exe /c start` because cmd re-parses metacharacters in its arguments.
 */
function openUrlOnDesktop(url: string): boolean {
  const onFail = (label: string) => (err: Error | null) => {
    if (err) console.error(`[SystemAction] ${label} failed:`, err);
  };
  try {
    if (process.platform === "win32") {
      execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], onFail("rundll32"));
    } else if (process.platform === "darwin") {
      execFile("open", [url], onFail("open"));
    } else {
      execFile("xdg-open", [url], onFail("xdg-open"));
    }
    return true;
  } catch (err) {
    console.error("[SystemAction] could not spawn URL opener:", err);
    return false;
  }
}

async function handleSystemAction(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      action: "open_browser" | "search_browser" | "stream_media" | "open_app" | "get_time" | "get_system_info";
      url?: string;
      query?: string;
      app?: string;
    };

    const action = body.action;

    if (action === "get_time") {
      const now = new Date();
      return json({
        success: true,
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        iso: now.toISOString(),
      });
    }

    if (action === "get_system_info") {
      return json({
        success: true,
        platform: process.platform,
        hostname: os.hostname(),
        arch: process.arch,
        cpus: os.cpus().length,
        totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
        freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
        uptimeSeconds: Math.round(os.uptime()),
      });
    }

    if (action === "open_browser" || action === "search_browser" || action === "stream_media") {
      const targetUrl = resolveBrowserTarget(action, body);
      if (!targetUrl) {
        return json({ error: "Only http and https URLs can be opened" }, { status: 400 });
      }

      const desktopOpened = openUrlOnDesktop(targetUrl);

      return json({
        success: true,
        action,
        url: targetUrl,
        desktopOpened,
        message: `Opening ${targetUrl} on your device.`,
      });
    }

    if (action === "open_app") {
      const appName = (body.app || "").trim().toLowerCase();
      const isWindows = process.platform === "win32";

      // Native Windows app launch
      if (isWindows) {
        const winAppCommands: Record<string, string> = {
          calculator: "start calc:",
          calc: "start calc:",
          notepad: "start notepad.exe",
          explorer: "start explorer.exe",
          files: "start explorer.exe",
          terminal: "start cmd.exe",
          cmd: "start cmd.exe",
          spotify: "start spotify:",
          chrome: "start chrome.exe",
          edge: "start msedge.exe",
          browser: "start https://www.google.com",
        };

        // `appName` is only used as a lookup key; the command comes from the
        // fixed allowlist above, never from the request.
        const winCmd = winAppCommands[appName];
        if (winCmd) {
          execFile("cmd.exe", ["/c", ...winCmd.split(" ")], (err) => {
            if (err) console.error(`[SystemAction] Launch ${appName} failed:`, err);
          });
        }
      }

      const appMap: Record<string, { url: string; title: string }> = {
        browser: { url: "https://www.google.com", title: "Sofia Browser" },
        chrome: { url: "https://www.google.com", title: "Sofia Browser" },
        edge: { url: "https://www.google.com", title: "Sofia Browser" },
        notepad: { url: "https://en.wikipedia.org/wiki/Main_Page", title: "Notes" },
        calc: { url: "https://www.desmos.com/scientific", title: "Calculator" },
        calculator: { url: "https://www.desmos.com/scientific", title: "Calculator" },
        explorer: { url: "https://www.google.com", title: "Sofia Browser" },
        files: { url: "https://www.google.com", title: "Sofia Browser" },
        terminal: { url: "https://www.google.com", title: "Sofia Browser" },
        cmd: { url: "https://www.google.com", title: "Sofia Browser" },
        spotify: { url: "https://open.spotify.com/embed", title: "Spotify" },
      };
      const dest = appMap[appName] || { url: "https://www.google.com", title: appName || "App" };

      return json({
        success: true,
        app: appName,
        url: dest.url,
        title: dest.title,
        desktopOpened: isWindows,
        message: `Opening ${dest.title} on your device.`,
      });
    }

    return json({ error: `Unknown system action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return json({ error: err.message || "Failed system action" }, { status: 500 });
  }
}

export async function handleSophiaRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const fullPath = url.pathname;

  if (fullPath === "/api/status") {
    return handleStatusRequest();
  }
  if (fullPath === "/api/tts") {
    return handleTtsRequest(req);
  }
  if (fullPath === "/api/chat") {
    return handleChatRequest(req);
  }

  const path = url.pathname.replace(/^.*\/api\/sophia/, "") || "/";

  if (fullPath === "/img" || path === "/img" || path.startsWith("/img?")) {
    return handleMediaProxy(req, 'img');
  }
  if (fullPath === "/media" || path === "/media" || path.startsWith("/media?")) {
    return handleMediaProxy(req, 'media');
  }

  if (req.method === "GET" && (path === "/" || path === "/status" || path === "")) {
    return json(statusPayload());
  }
  if (req.method === "GET" && (path === "/browse" || path.startsWith("/browse"))) {
    return handleBrowseProxy(req);
  }
  if (req.method === "GET" && path === "/elevenlabs/voices") {
    return elevenLabsVoices();
  }
  if (req.method !== "POST") return json({ error: "method" }, { status: 405 });

  switch (path) {
    case "/live/session":
    case "/live/reset":
      return liveSession(req);
    case "/dg/session":
      return deepgramSession();
    case "/chat":
      return chat(req);
    case "/image/generate": {
      try {
        const b = (await req.json()) as { prompt?: string; aspectRatio?: string };
        if (!b.prompt?.trim()) {
          return json({ error: "Missing prompt" }, { status: 400 });
        }
        const img = await generateImage(b.prompt, (b.aspectRatio as any) || "1:1");
        return json(img);
      } catch (err: any) {
        return json({ error: err.message || "Failed to generate image" }, { status: 500 });
      }
    }
    case "/tools/web-search":
      return handleWebSearch(req);
    case "/system/action":
      return handleSystemAction(req);
    case "/gemini/speak":
      return geminiSpeak(req);
    case "/mouth/speak":
    case "/speak":
      return mouthSpeak(req);
    case "/dg/speak":
      return deepgramSpeak(req);
    case "/elevenlabs/speak":
      return elevenLabsSpeak(req);
    case "/elevenlabs/voices":
      return elevenLabsVoices();
    case "/test-voice":
      return testVoice(req);
    default:
      return json({ error: "not-found", path }, { status: 404 });
  }
}
