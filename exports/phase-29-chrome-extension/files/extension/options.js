/** Sofia Hands — options page (Phase 29): token storage + status + tab repair. */
const $ = (id) => document.getElementById(id);

function looksLikeCode(v) {
  return /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/i.test(v.trim());
}

async function refresh() {
  const s = await chrome.storage.local.get({ auth: null, port: 7788 });
  const value = s.auth?.value ?? '';
  if (document.activeElement !== $('code')) $('code').value = value;
  if (document.activeElement !== $('port')) $('port').value = s.port ?? 7788;
  const st = $('status');
  if (!value) {
    st.textContent = 'not paired — paste a code below';
    st.className = 'bad';
    return;
  }
  st.textContent = s.auth.kind === 'session'
    ? 'paired (session active — survives daemon restarts)'
    : looksLikeCode(value)
      ? 'code saved — connecting (a session takes over after the first hello)'
      : 'token saved — connecting…';
  st.className = 'dim';
}

$('save').addEventListener('click', async () => {
  const value = $('code').value.trim();
  const port = Math.min(65535, Math.max(1, Number($('port').value) || 7788));
  await chrome.storage.local.set({ auth: value ? { kind: looksLikeCode(value) ? 'code' : 'token', value } : null, port });
  await refresh();
});

$('inject').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  let n = 0;
  for (const t of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
      n++;
    } catch { /* chrome:// , store, pdf — skip */ }
  }
  $('status').textContent = `helper injected into ${n} tab(s)`;
  $('status').className = 'ok';
});

chrome.storage.onChanged.addListener(() => void refresh());
void refresh();
