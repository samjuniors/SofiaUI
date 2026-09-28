/**
 * media-proxy — SSRF-guarded proxy for remote images and media.
 *
 * Inspired by J.A.R.V.I.S.:
 * Bypasses hotlink blocks and CORS restrictions for news thumbnails, web search
 * visuals, and audio/video snippets without leaking client IP or exposing the LAN.
 */

import { lookup } from 'node:dns/promises';

const BLOCKED_HOSTNAME = /(^|\.)(localhost|local|internal|intranet|home\.arpa)$/i;
const PROXY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function isBlockedAddress(ip: string): boolean {
  let addr = String(ip || '').toLowerCase().split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) addr = mapped[1];

  if (addr.includes('.')) {
    const parts = addr.split('.').map(Number);
    if (parts.length !== 4) return true;
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local & cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 192 && b === 0) return true; // 192.0.0.0/24
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailnet
    if (a >= 224) return true; // multicast / broadcast
    return false;
  }

  if (addr === '::' || addr === '::1') return true;
  return false;
}

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];

const ALLOWED_MEDIA_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/aac',
  'video/mp4',
  'video/webm',
];

export async function handleMediaProxy(req: Request, mode: 'img' | 'media'): Promise<Response> {
  const urlObj = new URL(req.url);
  const targetUrl = urlObj.searchParams.get('url')?.trim();

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url" query parameter' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new Response(JSON.stringify({ error: 'Only http and https protocols are supported' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (BLOCKED_HOSTNAME.test(parsed.hostname)) {
    return new Response(JSON.stringify({ error: 'Target host is blocked' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Resolve hostname and check IP against SSRF blocklist
  try {
    const resolved = await lookup(parsed.hostname, { all: true });
    for (const entry of resolved) {
      if (isBlockedAddress(entry.address)) {
        return new Response(JSON.stringify({ error: 'Target resolves to a restricted IP address' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `DNS lookup failed: ${err.message || 'unknown'}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const maxBytes = mode === 'img' ? 15 * 1024 * 1024 : 50 * 1024 * 1024;
  const allowedTypes = mode === 'img' ? ALLOWED_IMAGE_TYPES : ALLOWED_MEDIA_TYPES;

  try {
    const abortCtrl = new AbortController();
    const timeout = setTimeout(() => abortCtrl.abort(), 12000);

    const upstream = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': PROXY_UA,
        Accept: mode === 'img' ? 'image/*,*/*;q=0.8' : '*/*',
        'Accept-Encoding': 'identity',
      },
      signal: abortCtrl.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream returned status ${upstream.status}` }), {
        status: upstream.status === 404 ? 404 : 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const isAllowed = allowedTypes.some((t) => contentType.startsWith(t));
    if (!isAllowed) {
      return new Response(
        JSON.stringify({ error: `Refused content-type "${contentType}". Must be allowed media format.` }),
        { status: 415, headers: { 'content-type': 'application/json' } },
      );
    }

    const contentLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return new Response(JSON.stringify({ error: 'Payload exceeds maximum allowed proxy size' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers: Record<string, string> = {
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=600',
    };
    if (Number.isFinite(contentLength)) {
      headers['content-length'] = String(contentLength);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Proxy fetch failed: ${err.message || 'unknown'}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
