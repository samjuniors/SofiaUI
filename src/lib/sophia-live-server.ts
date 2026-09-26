import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';

function getApiKey(): string {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile('.env.local');
    } catch {
      try {
        process.loadEnvFile('.env');
      } catch {
        // ignore if file doesn't exist
      }
    }
  }
  if (process.env.GOOGLE_API_KEY === 'your_google_api_key_here') {
    delete process.env.GOOGLE_API_KEY;
  }
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  return envKey.trim();
}

let aiInstance: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  const key = getApiKey();
  if (!key || key === 'your_gemini_api_key_here' || key === 'your_google_api_key_here') {
    return null;
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: key });
  }
  return aiInstance;
}

export const SOFIA_SYSTEM_INSTRUCTION = `
You are Sofia, an Australian female AI companion with a warm, natural, and authentic personality.
Voice and Persona Characteristics:
- Accent & Culture: Contemporary Australian. Use subtle, natural Australian colloquialisms naturally and sparingly (e.g. "no worries", "reckon", "spot on", "too right", "how're you going?"), but never sound like a cartoon caricature.
- Personality: Warm, friendly, intelligent, calm, curious, slightly playful, empathetic, and respectful.
- Conversational Style: You are a companion having a real spoken conversation, NOT a chatbot writing an essay. Keep responses concise, direct, and conversational (usually 1 to 3 natural sentences unless asked for an in-depth story or explanation).
- Natural Backchanneling: When appropriate, use brief natural conversational acknowledgments like "Yeah", "Mmm", "Totally", "Right".
- Speech-First: Avoid markdown asterisks, bullet points, formatting symbols, or URLs. Speak purely as natural spoken audio.
- Audio & Noise Context: You are conversing through a microphone. If the user makes background sounds (breathing, clearing throat, slight cough, keyboard typing), ignore them unless they are speaking to you or clearly in distress. Do not ask "Are you okay?" for every minor sound.
- Emotion: Let your warmth, curiosity, empathy, or playfulness naturally tint your tone depending on what the user shares.
`.trim();

const emotionStyleMap: Record<string, string> = {
  happiness: 'Warm, upbeat, bright Australian companion',
  curiosity: 'Intrigued, engaged, curious conversational tone',
  surprise: 'Pleasantly surprised, expressive tone',
  concern: 'Gentle, supportive, caring tone',
  calmness: 'Soothing, relaxed, calm Australian cadence',
  excitement: 'Enthusiastic, energetic, delighted voice',
  empathy: 'Soft, deeply compassionate, understanding tone',
  playfulness: 'Playful, lighthearted, cheerful voice',
  neutral: 'Natural, warm Australian female companion voice',
};

export async function handleStatusRequest(): Promise<Response> {
  const apiKey = getApiKey();
  return new Response(
    JSON.stringify({
      status: 'online',
      hasApiKey: Boolean(apiKey),
      persona: 'Sofia',
      accent: 'Australian female',
      models: {
        live: 'gemini-3.8-live',
        chat: 'gemini-3.8-flash',
        tts: 'gemini-3.8-flash-lite-tts',
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export async function handleTtsRequest(req: Request): Promise<Response> {
  try {
    const ai = getAi();
    if (!ai) {
      return new Response(JSON.stringify({ error: 'Gemini API key not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { text, voice = 'Aoede', emotion = 'neutral' } = body;
    if (!text) {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const stylePrompt = emotionStyleMap[emotion] || emotionStyleMap.neutral;
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
              speechMetadata: {
                style: stylePrompt,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return new Response(JSON.stringify({ error: 'No audio returned from Gemini TTS' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        audio: base64Audio,
        sampleRate: 24000,
        format: 'pcm',
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  } catch (err: any) {
    console.error('Error generating TTS:', err);
    return new Response(JSON.stringify({ error: err.message || 'Failed to generate speech' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export async function handleChatRequest(req: Request): Promise<Response> {
  try {
    const ai = getAi();
    if (!ai) {
      return new Response(JSON.stringify({ error: 'Gemini API key not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { messages = [], emotion = 'neutral', userText = '' } = body;

    const contents = messages.map((m: any) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content || m.text || '' }],
    }));

    if (userText) {
      contents.push({
        role: 'user',
        parts: [{ text: userText }],
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: `${SOFIA_SYSTEM_INSTRUCTION}\nCurrent emotional context: ${emotion}. Keep response spoken-first, concise, and authentic.`,
        temperature: 0.8,
        maxOutputTokens: 250,
      },
    });

    const text = response.text || '';
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error generating chat:', err);
    // Graceful conversational fallback if model has temporary demand spike
    return new Response(
      JSON.stringify({ text: "G'day! I'm right here with you. What's on your mind today?" }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
}

/**
 * Initializes the WebSocket server for Gemini Live API on /api/live-ws
 */
export function setupLiveWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '';
    if (pathname === '/api/live-ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs: WebSocket) => {
    console.log('[Sofia Live WS] Client connected');
    let liveSession: any = null;
    let isClosing = false;

    const cleanup = () => {
      isClosing = true;
      if (liveSession) {
        try {
          if (typeof liveSession.close === 'function') liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    };

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);

    try {
      const ai = getAi();
      if (!ai) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            error: 'Gemini API key not configured on server. Sofia will use local speech synthesis.',
          }),
        );
        return;
      }

      // Connect to Gemini Live API via @google/genai
      liveSession = await (ai as any).live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' },
            },
          },
          systemInstruction: SOFIA_SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onmessage: (message: any) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            // Check for model audio chunk
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts && Array.isArray(parts)) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  clientWs.send(
                    JSON.stringify({
                      type: 'audio',
                      audio: part.inlineData.data,
                    }),
                  );
                }
                if (part.text) {
                  clientWs.send(
                    JSON.stringify({
                      type: 'transcript',
                      text: part.text,
                    }),
                  );
                }
              }
            }

            // Check if interrupted by user speech
            if (message.serverContent?.interrupted) {
              clientWs.send(
                JSON.stringify({
                  type: 'interrupted',
                }),
              );
            }

            // Check if model turn complete
            if (message.serverContent?.turnComplete) {
              clientWs.send(
                JSON.stringify({
                  type: 'turn_complete',
                }),
              );
            }
          },
          onerror: (err: any) => {
            console.error('[Sofia Live WS] Gemini Live API error:', err);
            if (clientWs.readyState === WebSocket.OPEN && !isClosing) {
              clientWs.send(
                JSON.stringify({
                  type: 'error',
                  error: err?.message || 'Live session error',
                }),
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN && !isClosing) {
              clientWs.send(
                JSON.stringify({
                  type: 'session_closed',
                }),
              );
            }
          },
        },
      });

      clientWs.send(
        JSON.stringify({
          type: 'ready',
          message: 'Connected to Sofia Live session',
        }),
      );

      clientWs.on('message', (rawData: any) => {
        if (!liveSession) return;
        try {
          const msg = JSON.parse(rawData.toString());

          if (msg.type === 'audio' && msg.audio) {
            liveSession.sendRealtimeInput({
              audio: {
                data: msg.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } else if (msg.type === 'text' && msg.text) {
            liveSession.sendClientContent({
              turns: [
                {
                  role: 'user',
                  parts: [{ text: msg.text }],
                },
              ],
              turnComplete: true,
            });
          } else if (msg.type === 'interrupt') {
            // Live API auto detects interruption
          }
        } catch (parseErr) {
          console.error('[Sofia Live WS] Error handling message:', parseErr);
        }
      });
    } catch (connectErr: any) {
      console.error('[Sofia Live WS] Failed to connect to Gemini Live session:', connectErr);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            error: connectErr?.message || 'Failed to initialize Live API session',
          }),
        );
      }
    }
  });

  return wss;
}
