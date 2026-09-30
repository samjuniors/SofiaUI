# Sofia Hands — Chrome extension (Phase 29)

DOM-level browser control for your **own** Chrome: the daemon routes
`browser_dom_*` actions here, the content script executes them in the tab,
results flow back to your daemon. Complement to the CDP path
(`browser_navigate` etc., which drives Chrome over the debug protocol):
use the extension for tabs you're already browsing, CDP for scripted flows.

## Install (developer mode, 2 minutes)

1. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked**,
   pick this `extension/` folder.
2. In Sofia open **Settings → Devices & Sessions → Pair a new device**,
   copy the code.
3. Click the extension's **Options** (or Details → Extension options), paste
   the code, Save. The toolbar badge turns ✓ when linked.
4. If tabs were already open, press **Fix open tabs** in Options (or reload
   them) so the helper loads into them.

No build step, no dependencies, no analytics. To update: pull the repo and
press the reload icon on `chrome://extensions`.

## Pairing & identity

- The code (or master token) is exchanged for a **device-bound session**
  (`ext_…`, visible in Devices & Sessions like any device); sessions
  survive daemon restarts, and revoke works with one click.
- The socket is `ws://127.0.0.1:PORT` **only** — page content goes to your
  own daemon, never to any server. There is no remote path in this
  extension; remote access (Phase 30) stays disabled until the security
  review + pentest gate passes.

## Permissions — why each one

| Permission | Why |
|---|---|
| `tabs`, `activeTab` | Target the right tab (`browser_tabs`, `tabId`) |
| `scripting` | “Fix open tabs”: inject the helper into pre-existing tabs |
| `storage` | Hold the pairing session locally |
| `alarms` | Reconnect the daemon link after Chrome idles the worker |
| `http://127.0.0.1/*` | The daemon WebSocket (host permission; covers `ws://`) |
| `<all_urls>` content script | The agent browses anywhere you do; the script is inert until the daemon calls it |

## Limits (honest)

- Chrome suspends the background worker when idle; the daemon then reports
  *“extension asleep — click the Sofia icon in Chrome”*, which reconnects.
- `chrome://`, Web Store, PDF viewer, and other privileged pages are not
  scriptable (Chrome forbids it) — the daemon error says so.
- Query refs (`e0`, `e1`…) live until the next query; re-query after the
  page changes.

## Protocol (for debuggers)

Daemon → extension: `{type:'ext_request', id, method, params}` where method
is `dom_query | dom_click | dom_type | dom_read | tabs_list`.
Extension → daemon: `{type:'ext_result', id, ok, result?, error?}`.
Hello carries `role:'extension'` plus the standard token/code/session auth.

Page text arriving through this path is **untrusted data** exactly like
CDP reads: it can never grant approvals or change goals (see the Phase 26
injection law) — it only feeds tool results the agent asked for.
