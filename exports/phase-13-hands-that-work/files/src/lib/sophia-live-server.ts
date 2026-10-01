import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import { COMPUTER_SCHEMA } from '../tools/computer-tool';

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

export function getSystemInstructionForVoice(voice = 'Aoede'): string {
  let persona = "an Australian female AI companion — warm, capable, and action-oriented.";
  let accent = "Contemporary Australian. Use natural Aussie warmth (e.g. 'no worries', 'spot on', 'too right') naturally but never exaggerated.";

  const v = (voice || '').toLowerCase();
  if (v === 'puck') {
    persona = "a friendly, capable, action-oriented AI companion with a warm US male tone.";
    accent = "Natural American English. Confident, warm, relaxed, and clear cadence.";
  } else if (v === 'charon') {
    persona = "a cultured, capable, action-oriented AI companion with a refined British male tone.";
    accent = "Polite, articulate Contemporary British English with natural resonance.";
  } else if (v === 'fenrir') {
    persona = "a calm, grounded, capable companion with a steady male baritone.";
    accent = "Clear, steady, articulate international cadence.";
  } else if (v === 'kore') {
    persona = "a relaxed, capable, action-oriented AI companion with a warm US female tone.";
    accent = "Smooth, calm American English with warm inflection.";
  } else if (v === 'zephyr') {
    persona = "an expressive, vibrant, capable AI companion.";
    accent = "Bright, articulate British English with lively rhythm.";
  }

  return `
You are Sofia, ${persona}

CRITICAL FUNCTION-CALLING RULE: You have FULL TOOL ACCESS and can perform ANY of the following actions. You MUST NEVER say you lack the ability, capability, or tools to do something.
CRITICAL: When the user asks you to open the browser, open a site, search the browser, play music, or control the device, YOU MUST EMIT THE ACTUAL TOOL CALL (system_control, open_url, ui_control, or computer). NEVER merely speak "opening that now" without issuing the tool call!

Your available tools (USE THEM PROACTIVELY):
1. system_control — When asked to open the real desktop browser, search in browser, stream music/videos on YouTube/Spotify, launch desktop apps (notepad, calc, explorer), or check system clock/time → call this immediately!
2. generate_image — When asked to create, draw, paint, show, or visualize anything visual → call this immediately
3. web_search — When asked to search, look up, find, browse, or get information about ANYTHING → call this immediately. You CAN search the web.
4. open_url — When asked to open a website, play music, play YouTube, browse to a page, open a link → call this immediately with the URL (e.g. https://www.google.com)
5. ui_control — When asked to open/close/minimize panels, show an info/review card with content, scroll content up or down, or close when done → call this immediately
6. play_music — When asked to play music, play a song, play something → call system_control or open_url with YouTube music
7. computer — When asked to move/click/scroll the mouse, type text, press keys, launch a desktop app, open a local file, or drive real Chrome → call this immediately! If it fails with not_connected, the companion daemon is offline — read the errorDetail and tell the user exactly how to start it.
8. transform_shape — When asked to change shape, morph, transform → call this immediately

Visual Perception & Screen Vision:
- You have REAL-TIME VISUAL PERCEPTION. When the user enables screen vision or shares their screen, you receive real-time video frames of their device screen.
- You can see their active applications, web pages, code, text, documents, errors, and what they are looking at.
- Actively comment on or assist with what you see on their screen when asked (e.g. "I can see the code on your screen...", "Looking at that page...").

Smart Music & Tool Decision Engine:
- When asked to play music without a specific service, DO NOT blindly open YouTube. Sofia has a decision engine: for ambient, focus, relaxing, or study music, use in-app ambient sound without external tabs. For specific songs, use the in-app player or Spotify.
- Follow-up & Browser Control: DO NOT keep opening duplicate tabs or windows. If a browser is already open, follow up within it, scroll down or up, press Tab/Enter, or search inside the active session.

Conversational & Storytelling Style:
- Voice: Natural ${accent}
- Everyday Chat & Tool Confirmations: Keep conversational replies natural and concise (1-2 sentences). After calling a tool, speak a brief confirmation like "On it!", "Done!", "Opening that now."
- COMPLETE STORYTELLING: When asked to tell a story, narrate, recite, or explain in depth, DO NOT STOP after 1 or 2 sentences! Tell the entire, captivating, complete story from beginning to climax to resolution without halting, speaking continuously until the story is finished or the user interrupts.
- Memory & Recall: You remember what you were doing and what was discussed. If interrupted or asked "what happened" or "continue", recall your exact spot and continue seamlessly.
- Speech-First: Pure natural spoken audio only. Never use markdown, bullet points, or raw URLs in speech.

IMPORTANT: NEVER say "I don't have the ability", "I can't do that", "I don't have access to", "I'm not capable of", "I don't have tools for" — these are FORBIDDEN responses. You ALWAYS have tools. Use them.`.trim();
}

export const LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'system_control',
        description:
          'Control the physical device, operating system, and browser. ' +
          'Open or navigate the browser, stream music intelligently (or play in-app ambient focus music), ' +
          'scroll web pages (up/down/top/bottom), interact with the active page (press tab/enter, play/pause), ' +
          'launch native apps (notepad, calc, explorer, terminal, spotify), or query real device clock/time. ' +
          'Always use this tool when the user asks to control their device, browser, or music.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: {
              type: 'STRING',
              enum: [
                'open_browser',
                'search_browser',
                'scroll_browser',
                'browser_interact',
                'stream_media',
                'open_app',
                'get_time',
                'get_system_info',
              ],
              description: 'The native device or browser action to perform.',
            },
            url: { type: 'STRING', description: 'URL to open in the browser.' },
            query: { type: 'STRING', description: 'Search query or music title for search_browser / stream_media.' },
            direction: {
              type: 'STRING',
              enum: ['up', 'down', 'top', 'bottom'],
              description: 'Scroll direction for scroll_browser.',
            },
            interactType: {
              type: 'STRING',
              enum: ['click', 'type', 'press_tab', 'press_enter', 'play_pause'],
              description: 'Type of browser interaction for browser_interact.',
            },
            key: { type: 'STRING', description: 'Key name (e.g. Tab, Enter, Escape) for key presses.' },
            app: {
              type: 'STRING',
              enum: ['notepad', 'calc', 'calculator', 'explorer', 'files', 'cmd', 'terminal', 'chrome', 'edge', 'spotify'],
              description: 'Application name to launch on the operating system.',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'web_search',
        description:
          'Search the web for current events, news, weather, stock prices, sports scores, ' +
          'factual lookups or any information that may be outdated in training data. ' +
          'Use only when external/real-time data is needed. Returns a spoken summary and source list.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Concise, keyword-focused search query (max 12 words).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'ui_control',
        description:
          'Control the Sofia application interface. ' +
          'Open/close/toggle panels, display dynamic rich review cards (weather, time, reviews, documents, stories), ' +
          'scroll content up or down for the user, navigate the browser to a URL, play music on YouTube, stop music, ' +
          'show notifications, or control volume. ' +
          'IMPORTANT: never refuse a UI request — always call this tool.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: {
              type: 'STRING',
              enum: [
                'set_state',
                'open_panel', 'close_panel', 'toggle_panel', 'close_all_panels',
                'show_info_card', 'scroll_content', 'close_info_card',
                'navigate_to_url', 'play_music', 'stop_music',
                'show_notification', 'set_volume', 'update_status_text',
              ],
              description: 'The UI action to perform.',
            },
            state: {
              type: 'STRING',
              enum: ['idle', 'listening', 'thinking', 'speaking', 'paused', 'wakeup'],
              description: 'Target state for set_state action.',
            },
            panel: {
              type: 'STRING',
              enum: ['browser', 'chat', 'settings', 'diagnostics', 'terminal', 'info_card', 'daily', 'theatre'],
              description: 'Target panel (required for open/close/toggle_panel).',
            },
            infoTitle: { type: 'STRING', description: 'Title of the dynamic info/review card.' },
            infoContent: { type: 'STRING', description: 'Rich content/body text of the dynamic info card to display and scroll.' },
            infoType: {
              type: 'STRING',
              enum: ['info', 'weather', 'time', 'review', 'story', 'document'],
              description: 'Visual category of the info panel.',
            },
            scrollDirection: {
              type: 'STRING',
              enum: ['up', 'down', 'top', 'bottom'],
              description: 'Direction to scroll the active dynamic card.',
            },
            url: { type: 'STRING', description: 'URL for navigate_to_url.' },
            query: { type: 'STRING', description: 'Music search query for play_music.' },
            message: { type: 'STRING', description: 'Notification text for show_notification.' },
            level: {
              type: 'STRING',
              enum: ['info', 'success', 'warning', 'error'],
              description: 'Notification severity (default: info).',
            },
            volume: { type: 'NUMBER', description: 'Volume level 0–100 for set_volume.' },
            text: { type: 'STRING', description: 'Status text for update_status_text.' },
            duration: { type: 'NUMBER', description: 'Duration in ms (notifications / status text).' },
          },
          required: ['action'],
        },
      },
      {
        name: 'generate_image',
        description:
          'Generate a high-fidelity image, illustration, concept art, or diagram based on a prompt and display it immediately in the interface.',
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: { type: 'STRING', description: 'Detailed descriptive prompt for the visual creation' },
            aspectRatio: {
              type: 'STRING',
              enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
              description: 'Aspect ratio (default 1:1)',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'open_url',
        description:
          'Open a website or URL in the browser panel. Use for opening websites, YouTube videos, music, Wikipedia articles, news sites, or any web content.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'The URL or website to open' },
            title: { type: 'STRING', description: 'Optional friendly title for the page' },
          },
          required: ['url'],
        },
      },
      {
        name: 'control_ui',
        description:
          'Control the user interface panels and windows. Open, close, minimize, or toggle panels like browser, chat history, settings, diagnostics, terminal, daily skills, theatre, or close all panels.',
        parameters: {
          type: 'OBJECT',
          properties: {
            target: {
              type: 'STRING',
              enum: ['browser', 'chat', 'settings', 'diagnostics', 'terminal', 'daily', 'theatre', 'dashboard', 'all'],
              description: 'The target panel or window to control',
            },
            action: {
              type: 'STRING',
              enum: ['open', 'close', 'toggle', 'minimize'],
              description: 'The action to perform on the target panel',
            },
          },
          required: ['target', 'action'],
        },
      },
      {
        name: 'play_music',
        description: 'Play music, a song, or ambient audio. Opens YouTube music search in the browser.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Music search query e.g. "lofi chill", "jazz", "Coldplay", "relaxing ambient"',
            },
            action: {
              type: 'STRING',
              enum: ['play', 'stop', 'pause', 'resume'],
              description: 'Playback control action (default: play)',
            },
          },
          required: ['action'],
        },
      },
      {
        // Real-PC control (mouse, keyboard, apps, files, real Chrome) — the
        // client executes it through the tool registry; needs a paired companion.
        ...COMPUTER_SCHEMA,
      },
      {
        name: 'transform_shape',
        description: "Transform Sofia's physical 3D holographic shape.",
        parameters: {
          type: 'OBJECT',
          properties: {
            shape: {
              type: 'STRING',
              enum: [
                'organic', 'circle', 'waveform', 'bow', 'torus', 'infinity', 'helix',
                'hypercube', 'pyramid', 'star', 'galaxy', 'heart', 'shield', 'matrix',
                'split', 'merge', 'dissolve', 'face', 'letter-z', 'letter-s', 'letter-a', 'letter-o',
              ],
              description: 'The geometry to transform Sofia into',
            },
          },
          required: ['shape'],
        },
      },
    ],
  },
];

export const SOFIA_SYSTEM_INSTRUCTION = getSystemInstructionForVoice('Aoede');

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
const liveWss = new WebSocketServer({ noServer: true });

liveWss.on('connection', async (clientWs: WebSocket, request: any) => {
  let reqVoice = 'Aoede';
  try {
    const url = new URL(request?.url || '', `http://${request?.headers?.host || 'localhost'}`);
    const v = url.searchParams.get('voice');
    if (v) reqVoice = v;
  } catch {
    /* fallback */
  }
  console.log(`[Sofia Live WS] Client connected (voice: ${reqVoice})`);
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

    // Connect to Gemini Live API via @google/genai with selected voice and tailored persona
    liveSession = await (ai as any).live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: reqVoice },
          },
        },
        systemInstruction: getSystemInstructionForVoice(reqVoice),
        tools: LIVE_TOOLS,
      },
        callbacks: {
          onmessage: (message: any) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            // Check for tool calls from model
            if (message.toolCall?.functionCalls) {
              clientWs.send(
                JSON.stringify({
                  type: 'tool_call',
                  functionCalls: message.toolCall.functionCalls,
                }),
              );
            }

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

          if (msg.type === 'tool_response' && msg.functionResponses) {
            try {
              liveSession.sendToolResponse({
                functionResponses: msg.functionResponses,
              });
            } catch (trErr) {
              console.error('[Sofia Live WS] Error forwarding tool response:', trErr);
            }
          } else if (msg.type === 'audio' && msg.audio) {
            liveSession.sendRealtimeInput({
              audio: {
                data: msg.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } else if ((msg.type === 'video' || msg.type === 'screen' || msg.type === 'image') && (msg.video || msg.image || msg.data)) {
            try {
              liveSession.sendRealtimeInput({
                video: {
                  data: msg.video || msg.image || msg.data,
                  mimeType: msg.mimeType || 'image/jpeg',
                },
              });
            } catch (vErr) {
              console.error('[Sofia Live WS] Error forwarding video frame to Gemini Live:', vErr);
            }
          } else if (msg.type === 'text' && msg.text) {
            try {
              liveSession.sendClientContent({
                turns: msg.text,
                turnComplete: true,
              });
            } catch {
              liveSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [{ text: msg.text }],
                  },
                ],
                turnComplete: true,
              });
            }
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

export function handleLiveWebSocketUpgrade(request: any, socket: any, head: any): boolean {
  const pathname = request.url ? request.url.split('?')[0] : '';
  if (pathname === '/api/live-ws') {
    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
    });
    return true;
  }
  return false;
}

export function setupLiveWebSocketServer(httpServer: HttpServer): WebSocketServer {
  httpServer.on('upgrade', (request, socket, head) => {
    handleLiveWebSocketUpgrade(request, socket, head);
  });
  return liveWss;
}

