/**
 * Sophia — server reference handlers.
 *
 *   POST /api/sophia/live/session  → Gemini Live ephemeral token
 *   POST /api/sophia/dg/session    → Deepgram grant token
 *   POST /api/sophia/chat          → LLM brain (xAI Grok → Gemini text)
 *   POST /api/sophia/dg/speak      → Deepgram Aura TTS stream
 *   GET  /api/sophia/status        → which backends are configured (no secrets)
 */

import { ALL_SHAPES, SOPHIA_SYSTEM } from "../sophia/control";

const GEMINI_MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const LIVE_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const GROK_MODEL = "grok-4.5";

function key(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

const FUNCTION_DECLARATIONS = [
  {
    name: "transform_shape",
    description:
      "Transform Sophia's physical substance into a requested geometry (sphere, ring, waveform, bow, torus, infinity, helix, hypercube, pyramid, star, galaxy, heart, shield, matrix, split, merge, dissolve, face, letter-z, letter-s, letter-a, letter-o).",
    parameters: {
      type: "OBJECT",
      properties: {
        shape: { type: "STRING", enum: [...ALL_SHAPES] },
      },
      required: ["shape"],
    },
  },
];

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

function statusPayload() {
  const gemini = Boolean(key("GOOGLE_API_KEY"));
  const deepgram = Boolean(key("DEEPGRAM_API_KEY"));
  const xai = Boolean(key("XAI_API_KEY"));
  const brain = xai ? "xai" : gemini ? "gemini" : "none";
  return {
    gemini,
    deepgram,
    brain,
    voice: gemini || deepgram,
    ok: gemini || deepgram,
  };
}

async function liveSession(req: Request): Promise<Response> {
  const apiKey = key("GOOGLE_API_KEY");
  if (!apiKey) return json({ error: "GOOGLE_API_KEY not configured" }, { status: 503 });
  let voice = "Aoede";
  try {
    voice = ((await req.json()) as { voice?: string }).voice ?? voice;
  } catch {
    /* empty body is fine */
  }
  const now = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/authTokens?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authToken: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 90_000).toISOString(),
      },
    }),
  });
  if (!res.ok) return json({ error: `authTokens:${res.status}` }, { status: 502 });
  const data = (await res.json()) as { name?: string };
  if (!data.name) return json({ error: "no token issued" }, { status: 502 });
  return json({ token: data.name, model: GEMINI_MODEL, wsUrl: LIVE_WS, voice });
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

type ChatBody = {
  lastUser: string;
  history: Array<{ role: string; text: string; final: boolean }>;
};

async function chatWithGrok(body: ChatBody, apiKey: string): Promise<Response | null> {
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
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      max_tokens: 220,
      temperature: 0.7,
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "transform_shape",
            description: FUNCTION_DECLARATIONS[0].description,
            parameters: FUNCTION_DECLARATIONS[0].parameters,
          },
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const msg = data.choices?.[0]?.message;
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const tc of msg?.tool_calls ?? []) {
    if (!tc.function?.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    toolCalls.push({ name: tc.function.name, args });
  }
  return json({ text: (msg?.content ?? "").trim(), toolCalls, brain: "xai" });
}

async function chatWithGemini(body: ChatBody, apiKey: string): Promise<Response> {
  const contents = body.history
    .filter((t) => t.final && t.role !== "system")
    .map((t) => ({ role: t.role === "sophia" ? "model" : "user", parts: [{ text: t.text }] }));
  if (contents.length === 0 && body.lastUser) {
    contents.push({ role: "user", parts: [{ text: body.lastUser }] });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SOPHIA_SYSTEM }] },
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        contents,
      }),
    },
  );
  if (!res.ok) return json({ error: `generate:${res.status}` }, { status: 502 });
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let text = "";
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const p of parts) {
    if (typeof p.text === "string") text += p.text;
    const fc = p.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
    if (fc?.name) toolCalls.push({ name: fc.name, args: fc.args ?? {} });
  }
  return json({ text: text.trim(), toolCalls, brain: "gemini" });
}

async function chat(req: Request): Promise<Response> {
  const body = (await req.json()) as ChatBody;
  const xai = key("XAI_API_KEY");
  if (xai) {
    const grok = await chatWithGrok(body, xai);
    if (grok) return grok;
  }
  const gemini = key("GOOGLE_API_KEY");
  if (gemini) return chatWithGemini(body, gemini);
  return json({ error: "no LLM brain configured (XAI_API_KEY or GOOGLE_API_KEY)" }, { status: 503 });
}

async function deepgramSpeak(req: Request): Promise<Response> {
  const apiKey = key("DEEPGRAM_API_KEY");
  if (!apiKey) return json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 503 });
  const { text, voice = "aura-2-thalia-en" } = (await req.json()) as { text: string; voice?: string };
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

export async function handleSophiaRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/api\/sophia/, "") || "/";

  if (req.method === "GET" && (path === "/" || path === "/status" || path === "")) {
    return json(statusPayload());
  }
  if (req.method !== "POST") return json({ error: "method" }, { status: 405 });

  switch (path) {
    case "/live/session":
      return liveSession(req);
    case "/dg/session":
      return deepgramSession();
    case "/chat":
      return chat(req);
    case "/dg/speak":
      return deepgramSpeak(req);
    default:
      return json({ error: "not-found", path }, { status: 404 });
  }
}
