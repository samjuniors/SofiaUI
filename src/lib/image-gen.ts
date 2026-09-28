/**
 * image-gen — Generates photorealistic and conceptual visuals via Gemini & Imagen,
 * with high-fidelity Neural Generative fallback.
 *
 * Exposes generateImage(prompt, options) for Sophia's visual creation tool.
 * Returns a high-res base64 data URL and prompt metadata.
 */

import { GoogleGenAI } from '@google/genai';

function getGeminiApiKey(): string | undefined {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile('.env.local');
    } catch {
      try {
        process.loadEnvFile('.env');
      } catch {
        /* empty */
      }
    }
  }
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return k?.trim();
}

export interface GenerateImageResult {
  url: string;
  prompt: string;
  aspectRatio: string;
  source: string;
}

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
};

async function generateWithPollinations(
  prompt: string,
  aspectRatio: string
): Promise<GenerateImageResult> {
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio] || { width: 1024, height: 1024 };
  const seed = Math.floor(Math.random() * 1000000);
  const encoded = encodeURIComponent(prompt.trim());
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${dims.width}&height=${dims.height}&nologo=true&seed=${seed}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
    },
  });

  if (!res.ok) {
    throw new Error(`Visual generation provider returned status ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const dataUrl = `data:${contentType};base64,${base64}`;

  return {
    url: dataUrl,
    prompt,
    aspectRatio,
    source: 'pollinations-flux',
  };
}

export async function generateImage(
  prompt: string,
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' = '1:1'
): Promise<GenerateImageResult> {
  const apiKey = getGeminiApiKey();

  // Try Gemini image generation if API key is present
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const candidateModels = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'];

      for (const model of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseModalities: ['IMAGE'],
              imageConfig: {
                aspectRatio,
              },
            },
          });

          const parts = response.candidates?.[0]?.content?.parts;
          for (const p of parts || []) {
            if (p.inlineData?.data) {
              const mime = p.inlineData.mimeType || 'image/jpeg';
              return {
                url: `data:${mime};base64,${p.inlineData.data}`,
                prompt,
                aspectRatio,
                source: model,
              };
            }
          }
        } catch (_modelErr: any) {
          // Model quota or unavailable, proceed to next or fallback
        }
      }
    } catch (_aiErr) {
      // Proceed to fallback
    }
  }

  // Fast, reliable, high-definition neural fallback
  return generateWithPollinations(prompt, aspectRatio);
}
