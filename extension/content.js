/**
 * Sofia Hands — content script (Phase 29). Runs in the isolated world:
 * page JS cannot see or touch it. Executes one DOM method per message and
 * answers with JSON-able data. Query results are cached as refs (e0, e1…)
 * so click/type can target the exact element the agent saw.
 */
(() => {
  if (globalThis.__sophiaHands) return;
  globalThis.__sophiaHands = true;

  /** Latest query cache: ref → element. Replaced by every dom_query. */
  let refCache = new Map();

  const textOf = (el) => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const describe = (el, ref) => {
    const r = el.getBoundingClientRect();
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      text: textOf(el).slice(0, 160),
      href: el.tagName === 'A' ? String(el.href ?? '').slice(0, 300) : undefined,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };

  function query(params) {
    const selector = String(params.selector ?? 'a, button, input, textarea, select, [role="button"], [onclick]').slice(0, 300);
    const wantText = String(params.text ?? '').toLowerCase().slice(0, 200);
    const limit = Math.min(Math.max(Number(params.limit) || 30, 1), 100);
    let els;
    try {
      els = [...document.querySelectorAll(selector)];
    } catch {
      return { ok: false, error: `bad selector: ${selector.slice(0, 80)}` };
    }
    if (wantText) els = els.filter((el) => textOf(el).toLowerCase().includes(wantText));
    els = els.filter(visible).slice(0, limit);
    refCache = new Map();
    const matches = els.map((el, i) => {
      const ref = `e${i}`;
      refCache.set(ref, el);
      return describe(el, ref);
    });
    return { ok: true, result: { url: location.href, title: document.title, matches } };
  }

  function resolve(params) {
    if (typeof params.ref === 'string' && refCache.has(params.ref)) return refCache.get(params.ref);
    const q = query({ ...params, limit: 1 });
    if (!q.ok || !q.result.matches.length) return null;
    return refCache.get(q.result.matches[0].ref) ?? null;
  }

  function click(params) {
    const el = resolve(params);
    if (!el) return { ok: false, error: 'no matching element (query first, then click its ref)' };
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch { /* then just click */ }
    el.click();
    return { ok: true, result: { clicked: describe(el, params.ref ?? ''), url: location.href } };
  }

  /** Set value through the native setter so React/Vue listeners fire. */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function type(params) {
    const el = resolve(params);
    if (!el) return { ok: false, error: 'no matching field (query first, then type into its ref)' };
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !el.isContentEditable) {
      return { ok: false, error: `ref is a ${el.tagName.toLowerCase()}, not a typeable field` };
    }
    const keys = String(params.keys ?? params.text ?? '').slice(0, 2000);
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch { /* then just type */ }
    el.focus();
    if (el.isContentEditable && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, keys);
    } else if (params.append) {
      setNativeValue(el, el.value + keys);
    } else {
      setNativeValue(el, keys);
    }
    if (params.submit) {
      const form = el.closest('form');
      if (form) form.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    return { ok: true, result: { typed: keys.length, url: location.href } };
  }

  function read() {
    const main = document.querySelector('main, article, [role="main"], #content, body');
    const text = ((main?.innerText ?? document.body?.innerText ?? '')).replace(/[ \t]+\n/g, '\n').slice(0, 20000);
    return { ok: true, result: { url: location.href, title: document.title, text } };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    try {
      const params = msg?.params ?? {};
      switch (msg?.method) {
        case 'dom_query': reply(query(params)); break;
        case 'dom_click': reply(click(params)); break;
        case 'dom_type': reply(type(params)); break;
        case 'dom_read': reply(read()); break;
        default: reply({ ok: false, error: `unknown method ${String(msg?.method).slice(0, 40)}` });
      }
    } catch (e) {
      reply({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
    }
    return false;
  });
})();
