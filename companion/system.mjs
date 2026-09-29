/**
 * companion/system.mjs — computer control backends per OS.
 *   darwin → osascript / cliclick(optional)
 *   win32  → PowerShell (System.Windows.Forms / SendKeys-free APIs)
 *   linux  → xdotool
 * Nothing is ever built into a shell string; everything goes through execFile arg arrays.
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";

const run = (cmd, args, timeout = 15000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 10e6, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));

const esc = (s) => String(s).replace(/["\\]/g, "\\$&");

async function xdotool(args) { return run("xdotool", args); }
async function osascript(script) { return run("osascript", ["-e", script]); }
async function powershell(cmd) { return run("powershell", ["-NoProfile", "-Command", cmd]); }

export async function systemAction(action, a = {}) {
  const p = platform();

  switch (action) {
    case "open_url": {
      if (p === "darwin") await osascript(`open location "${esc(a.url)}"`);
      else if (p === "win32") await run("cmd", ["/c", "start", "", a.url]);
      else await run("xdg-open", [a.url]);
      return { opened: a.url };
    }

    case "open_app": {
      const app = String(a.app || "");
      if (p === "darwin") await osascript(`tell application "${esc(app)}" to activate`);
      else if (p === "win32") await run("cmd", ["/c", "start", app]);
      else await run("sh", ["-c", `nohup ${app} >/dev/null 2>&1 &`]);
      return { opened: app };
    }

    case "notify": {
      const title = String(a.title || "Sofia");
      const body = String(a.text || "");
      if (p === "darwin") await osascript(`display notification "${esc(body)}" with title "${esc(title)}"`);
      else if (p === "win32") await powershell(`Add-Type -AssemblyName System.Windows.Forms;$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;$n.Visible=$true;$n.ShowBalloonTip(4000,'${esc(title)}','${esc(body)}',[System.Windows.Forms.ToolTipIcon]::Info);Start-Sleep 4;$n.Dispose()`);
      else await run("notify-send", [title, body]).catch(() => {});
      return { notified: true };
    }

    case "screenshot": {
      const file = a.path || "";
      if (p === "darwin") { await run("screencapture", ["-x", file]); return { path: file }; }
      if (p === "win32") {
        await powershell(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size);$bmp.Save('${esc(file)}');$g.Dispose();$bmp.Dispose()`);
        return { path: file };
      }
      // linux: try common tools
      for (const [cmd, args] of [["gnome-screenshot", ["-f", file]], ["scrot", [file]], ["import", [file]]]) {
        try { await run(cmd, args); return { path: file }; } catch { /* next */ }
      }
      throw new Error("No screenshot tool found (install gnome-screenshot or scrot).");
    }

    case "get_cursor": {
      if (p === "linux") {
        const out = await xdotool(["getmouselocation"]);
        const m = out.match(/x:(\d+) y:(\d+)/);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: -1, y: -1 };
      }
      if (p === "darwin") {
        const out = await osascript('tell application "System Events" to return position of the mouse');
        const [x, y] = out.trim().split(", ").map(Number);
        return { x, y };
      }
      const out = await powershell("[System.Windows.Forms.Cursor]::Position | ConvertTo-Json");
      const j = JSON.parse(out);
      return { x: j.X, y: j.Y };
    }

    case "move_mouse": {
      const { x, y } = a;
      if (p === "linux") await xdotool(["mousemove", String(x), String(y)]);
      else if (p === "darwin") await run("cliclick", [`m:${x},${y}`]).catch(() => osascript(`do shell script "osascript -e 'tell app \\"System Events\\" to set position of the mouse to {${x},${y}}'"`));
      else await powershell(`[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Number(x)},${Number(y)})`);
      return { moved: { x, y } };
    }

    case "click": case "double_click": case "right_click": {
      if (a.x !== undefined) await systemAction("move_mouse", a);
      if (p === "linux") {
        const btn = action === "right_click" ? "3" : "1";
        await xdotool(["click", action === "double_click" ? "--repeat 2 --delay 60" : "", btn].filter(Boolean));
      } else if (p === "darwin") {
        await run("cliclick", [action === "right_click" ? "rc:." : action === "double_click" ? "dc:." : "c:."]).catch(() => osascript('tell application "System Events" to click'));
      } else {
        const btn = action === "right_click" ? "Right" : "Left";
        const clicks = action === "double_click" ? 2 : 1;
        await powershell(`Add-Type @'\nusing System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")] public static extern void mouse_event(uint f,int x,int y,int d,int i);}\n'@;$dn=0x0002;$up=0x0004;${btn === "Right" ? "$dn=0x0008;$up=0x0010;" : ""}for($i=0;$i -lt ${clicks};$i++){[M]::mouse_event($dn,0,0,0,0);[M]::mouse_event($up,0,0,0,0)}`);
      }
      return { clicked: action };
    }

    case "scroll": {
      const dy = Number(a.dy ?? a.amount ?? 3);
      if (p === "linux") await xdotool(["click", dy > 0 ? "5" : "4"]);
      else if (p === "darwin") await run("cliclick", [`kd:shift`, `m:+0,${dy > 0 ? -100 : 100}`]).catch(() => {});
      else await powershell(`Add-Type @'\nusing System.Runtime.InteropServices;public class W{[DllImport("user32.dll")] public static extern void mouse_event(uint f,int x,int y,int d,int i);}\n'@;[W]::mouse_event(0x0800,0,0,${dy > 0 ? -120 : 120},0)`);
      return { scrolled: dy };
    }

    case "type_text": {
      const text = String(a.text ?? "");
      if (p === "linux") await xdotool(["type", "--clearmodifiers", "--delay", "12", text]);
      else if (p === "darwin") await osascript(`tell application "System Events" to keystroke "${esc(text)}"`);
      else await powershell(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, "{$&}")}')`);
      return { typed: text.length };
    }

    case "hotkey": {
      const keys = String(a.keys ?? a.combo ?? "");
      if (p === "linux") await xdotool(["key", keys.toLowerCase().replace(/\+/g, "+")]);
      else if (p === "darwin") {
        const parts = keys.toLowerCase().split("+");
        const main = parts.pop();
        const mods = parts.length ? ` using {${parts.map((m) => `${m} down`).join(", ")}}` : "";
        await osascript(`tell application "System Events" to keystroke "${main}"${mods}`);
      } else await powershell(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/\+/g, "+").replace(/ctrl/i, "^").replace(/alt/i, "%").replace(/shift/i, "+")}')`);
      return { hotkey: keys };
    }

    case "drag": {
      if (p === "linux") {
        await xdotool(["mousemove", String(a.fromX), String(a.fromY), "mousedown", "1", "mousemove", String(a.toX), String(a.toY), "mouseup", "1"]);
      } else throw new Error("drag is currently supported on Linux (xdotool).");
      return { dragged: true };
    }

    case "get_active_window": {
      if (p === "linux") { const out = await xdotool(["getactivewindow", "getwindowname"]); return { title: out.trim() }; }
      if (p === "darwin") { const out = await osascript('tell application "System Events" to get name of first application process whose frontmost is true'); return { title: out.trim() }; }
      const out = await powershell("(Get-Process | Where-Object {$_.MainWindowHandle -eq (Add-Type @'\nusing System;using System.Runtime.InteropServices;public class F{[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();}\n'@;[F]::GetForegroundWindow())}).MainWindowTitle");
      return { title: out.trim() };
    }

    case "set_volume": {
      const level = Math.max(0, Math.min(100, Number(a.level ?? 50)));
      if (p === "darwin") await osascript(`set volume output volume ${level}`);
      else if (p === "win32") await run("powershell", ["-NoProfile", "-Command", `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`]); // fallback: mute key
      else await run("amixer", ["sset", "Master", `${level}%`]).catch(() => run("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${level}%`]));
      return { level };
    }

    case "get_volume": {
      if (p === "darwin") { const out = await osascript("output volume of (get volume settings)"); return { level: Number(out.trim()) }; }
      if (p === "linux") { const out = await run("amixer", ["sget", "Master"]).catch(() => ""); const m = out.match(/\[(\d+)%\]/); return { level: m ? Number(m[1]) : -1 }; }
      return { level: -1 };
    }

    default: throw new Error(`Unsupported system action ${action}`);
  }
}
