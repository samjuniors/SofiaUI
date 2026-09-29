/**
 * companion/media.mjs — media playback & volume through the OS media layer.
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";

const run = (cmd, args, timeout = 8000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));

async function mediaKey(op) {
  const p = platform();
  const keys = { play_pause: "XF86AudioPlay", next: "XF86AudioNext", previous: "XF86AudioPrev", stop: "XF86AudioStop" };
  if (p === "linux") return run("xdotool", ["key", keys[op] || op]);
  if (p === "darwin") return run("osascript", ["-e", `tell application "System Events" to key code ${op === "next" ? 124 : op === "previous" ? 123 : 49} using {command down, option down}`]);
  return run("powershell", ["-NoProfile", "-Command", "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"]);
}

export async function mediaAction(action, a = {}) {
  switch (action) {
    case "media_control": {
      const op = String(a.op ?? a.action ?? "play_pause");
      if (op === "volume_up" || op === "volume_down") {
        const p = platform();
        if (p === "darwin") await run("osascript", ["-e", `set volume output volume ((output volume of (get volume settings)) ${op === "volume_up" ? "+" : "-"} 10)`]);
        else if (p === "linux") await run("amixer", ["sset", "Master", op === "volume_up" ? "5%+" : "5%-"]).catch(() => {});
        else await run("powershell", ["-NoProfile", "-Command", "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"]);
        return { op };
      }
      if (op === "mute") {
        const p = platform();
        if (p === "darwin") await run("osascript", ["-e", "set volume with output muted"]);
        else if (p === "linux") await run("amixer", ["sset", "Master", "toggle"]).catch(() => {});
        return { op };
      }
      if (op === "set_volume") {
        const level = Math.max(0, Math.min(100, Number(a.level ?? 50)));
        const p = platform();
        if (p === "darwin") await run("osascript", ["-e", `set volume output volume ${level}`]);
        else if (p === "linux") await run("amixer", ["sset", "Master", `${level}%`]).catch(() => run("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${level}%`]));
        return { op, level };
      }
      await mediaKey(op);
      return { op };
    }
    case "media_status": {
      const p = platform();
      if (p === "darwin") {
        try {
          const out = await run("osascript", ["-e", 'tell application "System Events" to return name of first application process whose name contains "Music" or name contains "Spotify"']);
          return { playing: Boolean(out.trim()), source: out.trim() };
        } catch { return { playing: false, source: null }; }
      }
      return { playing: null, source: null, note: "media_status is best-effort on this OS" };
    }
    default: throw new Error(`Unsupported media action ${action}`);
  }
}
