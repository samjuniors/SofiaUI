# Trust: pairing, devices, sessions (Phase 28)

Two modes, one protocol. The daemon binds **127.0.0.1 only** — every socket
below is either local software or (Phase 30) a loopback-attached relay port.

## Modes

| | Installed | Web / local |
|---|---|---|
| Daemon | Electron spawns it, token bundled via preload | User runs `node companion/server.mjs` |
| Pairing | None needed (bundled master token) | Zero-typing: the page fetches `GET /pairing` over loopback; fallback: type the console token or scan the on-screen QR |
| Hello | `{token, device}` | `{pairing_code, device}` then `{session, device}` |

All three hellos return `{session, scope, expires_at}`. Bad hellos all close
**4003** identically (no oracle); >20 failures/min per IP is ignored for a
minute; pairing codes additionally rate-limit (10/min) and expire (10 min).

## Scopes

- **view** — read-only telemetry (default-deny allowlist `VIEW_ACTIONS` in
  `pairing.mjs`: ping, screenshot, observe, file reads, memory reads, …).
  Anything else answers `view_only`, including `confirm` redemption.
- **control** — everything, still subject to the SafetyPolicy risk gates.

Quick-code sessions grant **control immediately**: reading the code off the
PC screen (or loopback, same-machine only) IS the physical-presence
approval. Weaker channels start view-only and escalate per session:

```
view socket → control_request → approval (5-min TTL, console + event fan-out)
            → control session: approvals_resolve{id, ok}
            → grant: control for 1h (then back to view; session itself 24h)
```

Nobody can self-approve. Every step is audit-logged with the device id.

## Devices & sessions

- Devices register with `{id, name, pubkey}`; the pubkey is **TOFU-pinned**
  (a known id with a new key is rejected: `device_key_mismatch`).
- Sessions persist in `pairing.json` as **sha256 hashes only** — the tokens
  live in client localStorage. A daemon restart neither kicks sessions nor
  strands approvals.
- **One-click revoke**: `devices_revoke` kills the device's sessions +
  sockets immediately (close 4009); `sessions_revoke` ends one session.
  Both audit-logged. UI: Settings → Devices & Sessions.

## Audit

`pair_accepted / pair_rejected / control_request / control_approved /
control_denied / device_revoked / session_revoked` land in the same audit
log as action receipts (`actions_recent`), each carrying the device id.

## What's next (Phase 30: relay — NOT SHIPPED)

Remote (phone off-machine) rides an E2E-encrypted relay: ECDH P-256
(daemon × device keys) + signed pairing requests, approval on the PC,
view-only default, 1h control grants, auto-expiry, revoke. The crypto
(`ecdhSecret`, `signBytes`/`verifyBytes`, node↔WebCrypto cross-tested in
`pairing.test.mjs`) and the approval queue ship in Phase 28; the relay
itself ships **disabled** until the remote checklist ("C") is complete
**and** independently pen-tested. No hosted relay exists.
