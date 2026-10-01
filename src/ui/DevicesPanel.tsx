/**
 * ui/DevicesPanel.tsx — Phase 28: paired devices, sessions, approvals.
 *
 * The trust console for this PC: pending control-approval requests (approve
 * or deny here — approval can ONLY happen from a control session on this
 * machine), the device registry with one-click revoke, live sessions with
 * scopes and expiry, and the pair-new-device card (QR + code, 10-minute
 * lifetime). Refreshes on daemon events via `companion.onEvent`.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldX, Smartphone, MonitorSmartphone, QrCode, RefreshCw, Trash2, KeyRound, Eye, Gamepad2 } from 'lucide-react';
import { companion } from '../lib/companion-client';
import { pairPayloadText } from '../lib/device-identity';

interface DeviceRow {
  id: string;
  name: string;
  trust: string;
  created_at: number;
  last_seen: number;
  revoked: boolean;
}

interface SessionRow {
  id: string;
  device_id: string;
  scope: string;
  effectiveScope: string;
  grant: string;
  expires_at: number;
  grant_expires_at: number;
}

interface ApprovalRow {
  id: string;
  session_id: string;
  device_id: string;
  expires_at: number;
}

interface PairCode {
  code: string;
  expires_at: number;
  daemon_id: string;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function left(ts: number): string {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return 'expired';
  if (s < 90) return `${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m left`;
  return `${Math.floor(m / 60)}h left`;
}

export function DevicesPanel() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [pair, setPair] = useState<PairCode | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ownScope, setOwnScope] = useState('');

  const refresh = useCallback(async () => {
    if (!companion.connected) return;
    const [d, s, a, me] = await Promise.all([
      companion.send<{ devices: DeviceRow[] }>('devices_list'),
      companion.send<{ sessions: SessionRow[] }>('sessions_list'),
      companion.send<{ approvals: ApprovalRow[] }>('approvals_list'),
      companion.send<{ scope: string }>('session_info'),
    ]);
    if (d.ok && d.result) setDevices(d.result.devices ?? []);
    if (s.ok && s.result) setSessions(s.result.sessions ?? []);
    if (a.ok && a.result) setApprovals(a.result.approvals ?? []);
    if (me.ok && me.result) setOwnScope(String(me.result.scope ?? ''));
    else setOwnScope(companion.scope);
  }, []);

  useEffect(() => {
    void refresh();
    const onStatus = () => void refresh();
    const onEvent = () => void refresh();
    companion.addEventListener('status', onStatus);
    companion.addEventListener('companion-event', onEvent);
    const tick = window.setInterval(() => void refresh(), 15000);
    return () => {
      companion.removeEventListener('status', onStatus);
      companion.removeEventListener('companion-event', onEvent);
      window.clearInterval(tick);
    };
  }, [refresh]);

  const showPairCode = useCallback(async () => {
    setBusy(true);
    try {
      const r = await companion.send<PairCode>('pairing_code');
      if (!r.ok || !r.result) return;
      setPair(r.result);
      const { default: QRCode } = await import('qrcode');
      const text = pairPayloadText({
        v: 1,
        daemon: r.result.daemon_id,
        code: r.result.code,
        expires_at: r.result.expires_at,
        port: companion.info.port,
        pubkey: {},
      });
      setQr(await QRCode.toDataURL(text, { width: 220, margin: 2 }));
    } finally {
      setBusy(false);
    }
  }, []);

  const resolve = useCallback(
    async (id: string, ok: boolean) => {
      await companion.send('approvals_resolve', { id, ok });
      await refresh();
    },
    [refresh],
  );

  const revokeDevice = useCallback(
    async (id: string) => {
      await companion.send('devices_revoke', { id });
      await refresh();
    },
    [refresh],
  );

  const revokeSession = useCallback(
    async (id: string) => {
      await companion.send('sessions_revoke', { id });
      await refresh();
    },
    [refresh],
  );

  const requestControl = useCallback(async () => {
    await companion.send('control_request');
    await refresh();
  }, [refresh]);

  if (!companion.connected) {
    return <p className="text-[11px] font-light text-white/50">Pair the companion to manage devices.</p>;
  }

  const viewOnly = ownScope === 'view' || companion.scope === 'view';

  return (
    <div className="space-y-3">
      {viewOnly && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-300/25 bg-sky-300/[0.06] px-3 py-2">
          <Eye size={14} className="shrink-0 text-sky-200" />
          <p className="text-[11px] font-light text-sky-100/90">
            This session is view-only. Control needs approval on this PC.
          </p>
          <button
            type="button"
            onClick={() => void requestControl()}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-sky-500/30 px-2.5 py-1 text-[11px] font-semibold text-sky-50 transition hover:bg-sky-500/45"
          >
            <KeyRound size={12} /> Request control
          </button>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-100">
            <ShieldCheck size={13} /> Pending control requests ({approvals.length})
          </p>
          {approvals.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] text-white/70">
              <Smartphone size={13} className="text-white/40" />
              <span className="min-w-0 flex-1 truncate font-light">
                {devices.find((d) => d.id === a.device_id)?.name ?? a.device_id} · {left(a.expires_at)}
              </span>
              <button
                type="button"
                onClick={() => void resolve(a.id, true)}
                className="rounded-lg bg-emerald-600/60 px-2.5 py-1 font-semibold text-white transition hover:bg-emerald-600"
              >
                Approve 1h
              </button>
              <button
                type="button"
                onClick={() => void resolve(a.id, false)}
                className="rounded-lg border border-red-400/40 bg-red-600/20 px-2.5 py-1 font-semibold text-red-100 transition hover:bg-red-600/35"
              >
                Deny
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-white/10 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
          <QrCode size={13} /> Pair a new device
          <button
            type="button"
            onClick={() => void showPairCode()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={12} /> {pair ? 'Refresh code' : 'Show code'}
          </button>
        </div>
        {pair && (
          <div className="mt-2 flex items-center gap-3">
            {qr && <img src={qr} alt="Pairing QR code" className="h-28 w-28 rounded-lg border border-white/10" />}
            <div>
              <p className="font-mono text-xl font-bold tracking-[0.2em] text-white">{pair.code}</p>
              <p className="mt-1 text-[10px] font-light text-white/50">
                Type it on the new device, or scan. {left(pair.expires_at)}.
              </p>
              <p className="mt-0.5 text-[10px] font-light text-white/35">
                Anyone who reads this code controls this PC — show it only to people you trust.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
          <MonitorSmartphone size={13} /> Devices ({devices.filter((d) => !d.revoked).length})
        </p>
        <div className="mt-2 space-y-1.5">
          {devices.filter((d) => !d.revoked).map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[11px] text-white/70">
              <span className="min-w-0 flex-1 truncate font-light">
                {d.name} <span className="text-white/35">· {d.trust} · seen {ago(d.last_seen)}</span>
              </span>
              <button
                type="button"
                title="Revoke this device (kills its sessions immediately)"
                onClick={() => void revokeDevice(d.id)}
                className="flex items-center gap-1 rounded-lg border border-red-400/30 px-2 py-1 font-semibold text-red-200/80 transition hover:bg-red-600/25"
              >
                <Trash2 size={12} /> Revoke
              </button>
            </div>
          ))}
          {devices.filter((d) => !d.revoked).length === 0 && (
            <p className="text-[11px] font-light text-white/40">No devices yet.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
          <Gamepad2 size={13} /> Sessions ({sessions.length})
        </p>
        <div className="mt-2 space-y-1.5">
          {sessions.map((sess) => (
            <div key={sess.id} className="flex items-center gap-2 text-[11px] text-white/70">
              {sess.effectiveScope === 'control' ? (
                <ShieldCheck size={13} className="shrink-0 text-emerald-300/80" />
              ) : (
                <ShieldX size={13} className="shrink-0 text-sky-300/80" />
              )}
              <span className="min-w-0 flex-1 truncate font-light">
                {devices.find((d) => d.id === sess.device_id)?.name ?? sess.device_id} · {sess.effectiveScope} ·{' '}
                {left(sess.expires_at)}
              </span>
              <button
                type="button"
                title="End this session immediately"
                onClick={() => void revokeSession(sess.id)}
                className="rounded-lg border border-white/15 px-2 py-1 font-semibold text-white/70 transition hover:bg-white/10"
              >
                End
              </button>
            </div>
          ))}
          {sessions.length === 0 && <p className="text-[11px] font-light text-white/40">No sessions.</p>}
        </div>
      </div>
    </div>
  );
}
