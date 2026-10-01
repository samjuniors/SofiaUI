/**
 * Sofia Hands — background service worker (Phase 29).
 *
 * Holds ONE WebSocket to the local daemon (ws://127.0.0.1:PORT, token from
 * the options page) and executes DOM requests in tabs. The daemon routes
 * `browser_dom_*` actions here; page content flows daemon→UI only, never
 * to any server (the socket cannot reach beyond loopback).
 *
 * Chrome suspends service workers when idle: an hourly alarm + action click
 * + option-page visits all reconnect. While suspended the daemon reports
 * "extension asleep — click the Sofia icon in Chrome", which wakes us.
 */

const RECONNECT_MS = 5000;
let ws = null;
let wantUp = true;
let deviceId = null;

function looksLikeCode(v) {
  return /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/i.test(String(v ?? '').trim());
}

async function settings() {
  const s = await chrome.storage.local.get({ auth: null, token: '', port: 7788, deviceId: '' });
  if (!s.deviceId) {
    const alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    s.deviceId = 'ext_' + [...bytes].map((b) => alpha[b % alpha.length]).join('');
    await chrome.storage.local.set({ deviceId: s.deviceId });
  }
  // Migrate the legacy bare-token field to typed auth.
  if (!s.auth && s.token) {
    s.auth = { kind: looksLikeCode(s.token) ? 'code' : 'token', value: s.token };
    await chrome.storage.local.set({ auth: s.auth, token: '' });
  }
  deviceId = s.deviceId;
  return s;
}

function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* options-only contexts */ }
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const { auth, port } = await settings();
  if (!auth?.value) {
    setBadge('!', '#b00');
    return; // options page explains pairing
  }
  let sock;
  try {
    sock = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch {
    return scheduleReconnect();
  }
  ws = sock;
  const hello = { type: 'hello', role: 'extension', device: { id: deviceId, name: 'Chrome extension' } };
  if (auth.kind === 'code') hello.pairing_code = auth.value;
  else if (auth.kind === 'session') hello.session = auth.value;
  else hello.token = auth.value;
  sock.onopen = () => sock.send(JSON.stringify(hello));
  sock.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.type === 'welcome') {
      setBadge('✓', '#0a0');
      // Sessions survive daemon restarts; tokens/codes don't — keep the best.
      if (typeof msg.session === 'string' && msg.session && auth.kind !== 'session') {
        await chrome.storage.local.set({ auth: { kind: 'session', value: msg.session } });
      }
      return;
    }
    if (msg.type === 'ext_request' && typeof msg.id !== 'undefined') {
      const { ok, result, error } = await runMethod(msg.method, msg.params ?? {});
      try {
        sock.send(JSON.stringify({ type: 'ext_result', id: msg.id, ok, result, error }));
      } catch { /* daemon went away; onclose reschedules */ }
    }
  };
  sock.onclose = async (ev) => {
    if (ws === sock) ws = null;
    if ((ev?.code === 4003 || ev?.code === 4009) && auth.kind === 'session') {
      // Session dead (revoked/expired): stop presenting it; the user re-pairs.
      await chrome.storage.local.set({ auth: null });
      setBadge('!', '#b00');
      return;
    }
    setBadge('…', '#a80');
    scheduleReconnect();
  };
  sock.onerror = () => { try { sock.close(); } catch {} };
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (!wantUp || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, RECONNECT_MS);
}

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0]?.id ?? null;
}

async function runMethod(method, params) {
  try {
    if (method === 'tabs_list') {
      const tabs = await chrome.tabs.query({});
      return { ok: true, result: { tabs: tabs.map((t) => ({ id: t.id, title: t.title ?? '', url: t.url ?? '' })) } };
    }
    const tabId = Number.isInteger(params.tabId) ? params.tabId : await activeTabId();
    if (tabId == null) return { ok: false, error: 'no tab available' };
    const res = await chrome.tabs.sendMessage(tabId, { method, params: { ...params, tabId } });
    return res && typeof res === 'object' ? res : { ok: false, error: 'empty tab reply' };
  } catch (e) {
    const m = String(e?.message ?? e);
    if (m.includes('Could not establish connection') || m.includes('Receiving end does not exist')) {
      return { ok: false, error: 'page not scriptable (try reloading the tab; chrome:// and store pages are off-limits)' };
    }
    return { ok: false, error: m.slice(0, 300) };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 1 });
  void connect();
});
chrome.runtime.onStartup.addListener(() => void connect());
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'keepalive') void connect(); });
chrome.action.onClicked.addListener(() => void connect());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.auth || changes.port)) {
    try { ws?.close(); } catch {}
    ws = null;
    void connect();
  }
});

void connect();
