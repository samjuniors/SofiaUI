/**
 * Sophia — server reference handlers.
 *
 * These are runtime-agnostic Request/Response handlers.
 *
 *   POST /api/sophia  → (via handleSophiaRequest)
 *     /api/live/session  → mints a Gemini Live ephemeral token
 *     /api/dg/session    → mints a short-lived Deepgram token
 *     /api/chat          → the ONE control-layer brain (fallback path)
 *     /api/dg/speak      → Deepgram Aura TTS stream
 */

const GEMINI_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const LIVE_WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

const SOPHIA_SYSTEM = [
  'You are Sophia, the voice-first living interface of SamJuniors OS.',
  'You are not a chatbot: you are a calm, precise, warm computational presence.',
  'Speak in short, natural, voice-first sentences. Never use markdown, lists, or emoji.',
  'Keep spoken answers under two sentences unless the user explicitly asks for more.',
  'You have a physical form: an abstract luminous particle substance. When the user asks you',
  'to change shape — letters, a circle, splitting, merging, dissolving, showing a face — call',
  'the transform_shape tool immediately, then confirm verbally in five words or fewer.',
  'When the user is done or says goodbye, stay warm and brief.',
].join(' ');

const FUNCTION_DECLARATIONS = [
  {
    name: 'transform_shape',
    description:
      'Transform Sophia\'s physical substance into a requested geometry (sphere, ring, waveform, torus, infinity, helix, hypercube, pyramid, star, galaxy, heart, shield, matrix, split, merge, dissolve, face, letter-z, letter-s, letter-a, letter-o).',
    parameters: {
      type: 'OBJECT',
      properties: {
        shape: {
          type: 'STRING',
          enum: [
            'organic',
            'circle',
            'waveform',
            'torus',
            'infinity',
            'helix',
            'hypercube',
            'pyramid',
            'star',
            'galaxy',
            'heart',
            'shield',
            'matrix',
            'split',
            'merge',
            'dissolve',
            'face',
            'letter-z',
            'letter-s',
            'letter-a',
            'letter-o',
          ],
        },
      },
      required: ['shape'],
    },
  },
];

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

async function liveSession(req: Request): Promise<Response> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return json({ error: 'GOOGLE_API_KEY not configured' }, { status: 503 });
  let voice = 'Aoede';
  try {
    voice = ((await req.json()) as { voice?: string }).voice ?? voice;
  } catch {
    /* empty body is fine */
  }
  const now = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/authTokens?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  if (!data.name) return json({ error: 'no token issued' }, { status: 502 });
  return json({ token: data.name, model: GEMINI_MODEL, wsUrl: LIVE_WS, voice });
}

async function deepgramSession(): Promise<Response> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return json({ error: 'DEEPGRAM_API_KEY not configured' }, { status: 503 });
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ time_to_live_in_seconds: 3600 }),
  });
  if (!res.ok) return json({ error: `grant:${res.status}` }, { status: 502 });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) return json({ error: 'no token issued' }, { status: 502 });
  return json({ key: data.access_token });
}

async function chat(req: Request): Promise<Response> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return json({ error: 'GOOGLE_API_KEY not configured' }, { status: 503 });
  const body = (await req.json()) as {
    lastUser: string;
    history: Array<{ role: string; text: string; final: boolean }>;
  };
  const contents = body.history
    .filter((t) => t.final && t.role !== 'system')
    .map((t) => ({ role: t.role === 'sophia' ? 'model' : 'user', parts: [{ text: t.text }] }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
  let text = '';
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const p of parts) {
    if (typeof p.text === 'string') text += p.text;
    const fc = p.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
    if (fc?.name) toolCalls.push({ name: fc.name, args: fc.args ?? {} });
  }
  return json({ text: text.trim(), toolCalls });
}

async function deepgramSpeak(req: Request): Promise<Response> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return json({ error: 'DEEPGRAM_API_KEY not configured' }, { status: 503 });
  const { text, voice = 'aura-2-thalia-en' } = (await req.json()) as { text: string; voice?: string };
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) return json({ error: `speak:${res.status}` }, { status: 502 });
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') ?? 'audio/mpeg' },
  });
}

export async function handleSophiaRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== 'POST') return json({ error: 'method' }, { status: 405 });
  
  // we adjust the pathname to match the expected handlers
  const path = url.pathname.replace('/api/sophia', '');
  
  switch (path) {
    case '/live/session':
      return liveSession(req);
    case '/dg/session':
      return deepgramSession();
    case '/chat':
      return chat(req);
    case '/dg/speak':
      return deepgramSpeak(req);
    default:
      return json({ error: 'not-found' }, { status: 404 });
  }
}
