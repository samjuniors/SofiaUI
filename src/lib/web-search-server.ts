/**
 * lib/web-search-server.ts
 *
 * Server-side web search — multi-provider fallback chain.
 *
 * Provider priority (first configured wins):
 *   1. Tavily        TAVILY_API_KEY         — 1 000 req/month free, AI-optimised
 *   2. Brave Search  BRAVE_SEARCH_API_KEY   — 2 000 req/month free
 *   3. DuckDuckGo    (no key)               — free, instant answers only
 *   4. Gemini        GEMINI_API_KEY         — Google Search grounding via existing key
 *
 * Returns:
 *   { query, results: SearchResultItem[], summary, provider, timestamp }
 *
 * The summary is a concise paragraph that Sofia can speak verbatim.
 */

import { GoogleGenAI } from '@google/genai';

/* ── Types (inlined so this file is standalone on the server) ── */
export interface SearchResultItem {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt?: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResultItem[];
  summary: string;
  provider: 'tavily' | 'brave' | 'duckduckgo' | 'wikipedia' | 'gemini' | 'none';
  timestamp: string;
  error?: string;
}

/* ── Env helpers ── */
function loadEnv() {
  if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile('.env.local'); } catch { /* ignore */ }
    try { process.loadEnvFile('.env'); } catch { /* ignore */ }
  }
}

let _envLoaded = false;
function getKey(name: string): string | undefined {
  if (!_envLoaded) { loadEnv(); _envLoaded = true; }
  const v = process.env[name]?.trim();
  return v || undefined;
}

function geminiKey() { return getKey('GEMINI_API_KEY') || getKey('GOOGLE_API_KEY'); }

/* ── Source extraction ── */
function extractSource(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/* ── Provider 1: Tavily (recommended free tier) ───────────────────────────── */
async function searchTavily(query: string): Promise<WebSearchResponse | null> {
  const key = getKey('TAVILY_API_KEY');
  if (!key) return null;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        include_answer: true,
        include_raw_content: false,
        max_results: 6,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string; published_date?: string }>;
    };

    const results: SearchResultItem[] = (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      source: extractSource(r.url),
      snippet: r.content.slice(0, 300),
      publishedAt: r.published_date,
    }));

    const summary = data.answer
      ? String(data.answer)
      : synthesiseSummary(query, results);

    return { query, results, summary, provider: 'tavily', timestamp: new Date().toISOString() };
  } catch { return null; }
}

/* ── Provider 2: Brave Search ─────────────────────────────────────────────── */
async function searchBrave(query: string): Promise<WebSearchResponse | null> {
  const key = getKey('BRAVE_SEARCH_API_KEY');
  if (!key) return null;

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&result_filter=web`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      web?: {
        results?: Array<{ title: string; url: string; description: string; age?: string }>;
      };
    };

    const results: SearchResultItem[] = (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      source: extractSource(r.url),
      snippet: r.description.slice(0, 300),
      publishedAt: r.age,
    }));

    return {
      query,
      results,
      summary: synthesiseSummary(query, results),
      provider: 'brave',
      timestamp: new Date().toISOString(),
    };
  } catch { return null; }
}

/* ── Provider 3: DuckDuckGo Instant Answer API (no key) ─────────────────── */
async function searchDuckDuckGo(query: string): Promise<WebSearchResponse | null> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=sophia_ai`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SofiaAI/1.0 (voice assistant)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      Abstract?: string;
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Heading?: string;
      Answer?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Name?: string }>;
    };

    const results: SearchResultItem[] = [];

    // Main abstract
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        source: data.AbstractSource || 'DuckDuckGo',
        snippet: data.AbstractText.slice(0, 400),
      });
    }

    // Related topics
    for (const topic of (data.RelatedTopics ?? []).slice(0, 5)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Name || topic.Text.slice(0, 60),
          url: topic.FirstURL,
          source: extractSource(topic.FirstURL),
          snippet: topic.Text.slice(0, 250),
        });
      }
    }

    if (!results.length && !data.Answer) return null;

    const summary = data.Answer
      ? String(data.Answer)
      : data.AbstractText
        ? data.AbstractText.slice(0, 500)
        : synthesiseSummary(query, results);

    return { query, results, summary, provider: 'duckduckgo', timestamp: new Date().toISOString() };
  } catch { return null; }
}

/* ── Provider 4: Gemini Google Search grounding ──────────────────────────── */
async function searchGemini(query: string): Promise<WebSearchResponse | null> {
  const key = geminiKey();
  if (!key) return null;

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'];
  for (const model of models) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({
        model,
        contents: `Search the web and provide a direct, factual spoken answer for: "${query}". Include key facts, numbers, dates and current status. Keep it concise.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const metadata = response.candidates?.[0]?.groundingMetadata;
      const chunks = metadata?.groundingChunks ?? [];

      const results: SearchResultItem[] = chunks
        .filter((c: any) => Boolean(c.web?.uri && c.web?.title))
        .map((c: any) => ({
          title: c.web.title,
          url: c.web.uri,
          source: extractSource(c.web.uri),
          snippet: '',
        }));

      const text = response.text || '';
      if (!text.trim() && !results.length) continue;

      return {
        query,
        results,
        summary: text.trim() || synthesiseSummary(query, results),
        provider: 'gemini',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      console.warn(`[web-search] Gemini grounding with ${model} note:`, err);
      continue;
    }
  }
  return null;
}

/* ── Summary synthesis fallback ──────────────────────────────────────────── */
function synthesiseSummary(query: string, results: SearchResultItem[]): string {
  if (!results.length) return `I couldn't find reliable results for "${query}".`;
  const top = results.slice(0, 3);
  return top.map((r) => r.snippet).filter(Boolean).join(' ').slice(0, 600)
    || `Here are some results for "${query}": ${top.map((r) => r.title).join(', ')}.`;
}

/* ── Provider 5: Wikipedia Search API (open, zero-key, zero quota limits) ──── */
async function searchWikipedia(query: string): Promise<WebSearchResponse | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=5`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SofiaUI/1.0 (voice assistant)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: {
        search?: Array<{
          title: string;
          snippet: string;
          timestamp?: string;
        }>;
      };
    };

    const items = data.query?.search ?? [];
    if (!items.length) return null;

    const results: SearchResultItem[] = items.map((item) => {
      const cleanSnippet = item.snippet
        .replace(/<[^>]+>/g, '')
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .trim();
      return {
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        source: 'en.wikipedia.org',
        snippet: cleanSnippet,
        publishedAt: item.timestamp,
      };
    });

    const summary = synthesiseSummary(query, results);
    return {
      query,
      results,
      summary,
      provider: 'wikipedia',
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/* ── Main export ─────────────────────────────────────────────────────────── */
export async function handleWebSearch(req: Request): Promise<Response> {
  let query = '';
  try {
    const body = await req.json() as { query?: string };
    query = String(body.query ?? '').trim();
  } catch { /* ignore */ }

  if (!query) {
    return jsonResponse({ error: 'missing_query', message: 'query is required' }, 400);
  }

  // Try each provider in priority order
  const result =
    (await searchTavily(query)) ??
    (await searchBrave(query)) ??
    (await searchGemini(query)) ??
    (await searchDuckDuckGo(query)) ??
    (await searchWikipedia(query));

  if (!result || !result.results.length) {
    const empty: WebSearchResponse = {
      query,
      results: [],
      summary: `I searched for "${query}" but couldn't find results right now. You might want to check online directly.`,
      provider: 'none',
      timestamp: new Date().toISOString(),
      error: 'no_results',
    };
    return jsonResponse(empty, 200);
  }

  return jsonResponse(result, 200);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* ── Status helper for diagnostics ── */
export function getSearchProviderStatus(): {
  tavily: boolean; brave: boolean; duckduckgo: boolean; wikipedia: boolean; gemini: boolean;
} {
  return {
    tavily: Boolean(getKey('TAVILY_API_KEY')),
    brave: Boolean(getKey('BRAVE_SEARCH_API_KEY')),
    duckduckgo: true, // always available
    wikipedia: true,  // always available
    gemini: Boolean(geminiKey()),
  };
}
