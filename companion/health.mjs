/**
 * companion/health.mjs — PC health snapshot: CPU/RAM/disk/battery/uptime,
 * top processes, warnings, and a 0–100 score.
 */
import { cpus, freemem, totalmem, uptime, platform } from "node:os";
import { execFile } from "node:child_process";

const run = (cmd, args, timeout = 8000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));

async function disks() {
  const p = platform();
  try {
    if (p === "win32") {
      const out = await run("powershell", ["-NoProfile", "-Command",
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select DeviceID,@{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,1)}} | ConvertTo-Json"]);
      const rows = JSON.parse(out);
      return (Array.isArray(rows) ? rows : [rows]).map((d) => ({
        mount: d.DeviceID, sizeGB: d.SizeGB, freeGB: d.FreeGB,
        pctFree: d.SizeGB ? Math.round((d.FreeGB / d.SizeGB) * 100) : 0,
      }));
    }
    const out = await run("df", p === "darwin" ? ["-g", "/"] : ["-BG", "--output=target,size,avail,pcent", "/"]);
    const lines = out.trim().split("\n").slice(1);
    return lines.map((l) => {
      const [mount, size, avail, pcent] = l.trim().split(/\s+/);
      const sizeGB = parseFloat(size);
      const freeGB = parseFloat(avail);
      return { mount, sizeGB, freeGB, pctFree: pcent ? 100 - parseInt(pcent) : Math.round((freeGB / sizeGB) * 100) };
    }).filter((d) => Number.isFinite(d.sizeGB));
  } catch { return []; }
}

async function battery() {
  try {
    const p = platform();
    if (p === "darwin") {
      const out = await run("pmset", ["-g", "batt"]);
      const m = out.match(/(\d+)%/);
      return m ? { level: Number(m[1]), charging: /AC Power|charging/i.test(out) } : null;
    }
    if (p === "win32") {
      const out = await run("powershell", ["-NoProfile", "-Command",
        "(Get-CimInstance Win32_Battery | Select -First 1).EstimatedChargeRemaining"]);
      const v = parseInt(out.trim());
      return Number.isFinite(v) ? { level: v, charging: false } : null;
    }
    const cap = await run("cat", ["/sys/class/power_supply/BAT0/capacity"]).catch(() => "");
    const st = await run("cat", ["/sys/class/power_supply/BAT0/status"]).catch(() => "");
    return cap ? { level: parseInt(cap), charging: /charging/i.test(st) } : null;
  } catch { return null; }
}

async function topProcesses(limit = 5) {
  try {
    const p = platform();
    if (p === "win32") {
      const out = await run("powershell", ["-NoProfile", "-Command",
        `Get-Process | Sort-Object WorkingSet64 -Descending | Select -First ${limit} Name,@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB,0)}} | ConvertTo-Json`]);
      const rows = JSON.parse(out);
      return (Array.isArray(rows) ? rows : [rows]).map((r) => ({ name: r.Name, memMB: r.MemMB }));
    }
    const out = await run("ps", ["-eo", "comm,rss", "-r"]);
    return out.trim().split("\n").slice(1, limit + 1).map((l) => {
      const parts = l.trim().split(/\s+/);
      const rss = parts.pop();
      return { name: parts.join(" "), memMB: Math.round(Number(rss) / 1024) };
    });
  } catch { return []; }
}

function cpuLoad() {
  const c = cpus();
  let idle = 0, total = 0;
  for (const cpu of c) {
    idle += cpu.times.idle;
    for (const t of Object.values(cpu.times)) total += t;
  }
  return total ? Math.round(100 - (idle / total) * 100) : 0;
}

export async function healthAction(action, a = {}) {
  switch (action) {
    case "health_snapshot": {
      const cpu = cpuLoad();
      const memTotalGB = totalmem() / 1e9;
      const memFreeGB = freemem() / 1e9;
      const memUsedPct = Math.round(100 - (memFreeGB / memTotalGB) * 100);
      const ds = await disks();
      const bat = await battery();
      const up = uptime();
      const warnings = [];
      if (memUsedPct > 90) warnings.push("Memory pressure is high (>90% used).");
      if (cpu > 90) warnings.push("CPU is pegged (>90%).");
      for (const d of ds) if (d.pctFree < 10) warnings.push(`Disk ${d.mount} is nearly full (${d.pctFree}% free).`);
      if (bat && bat.level < 15 && !bat.charging) warnings.push(`Battery low (${bat.level}%).`);
      const score = Math.max(0, Math.min(100,
        100 -
        Math.max(0, memUsedPct - 60) * 0.8 -
        Math.max(0, cpu - 60) * 0.4 -
        warnings.length * 6));
      return {
        score: Math.round(score),
        platform: platform(),
        cpu: { cores: cpus().length, loadPct: cpu },
        memory: { totalGB: Number(memTotalGB.toFixed(1)), usedPct: memUsedPct },
        disks: ds,
        battery: bat,
        uptime: { seconds: up, human: up > 86400 ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h` : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` },
        warnings,
      };
    }
    case "health_processes": {
      return { processes: await topProcesses(Number(a.limit) || 5) };
    }
    default: throw new Error(`Unsupported health action ${action}`);
  }
}
