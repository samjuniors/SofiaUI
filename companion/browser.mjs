/**
 * companion/browser.mjs — DOM-level browser control via Chrome DevTools Protocol.
 * Uses playwright-core against the user's own Chrome when available; degrades
 * into a clear hint otherwise. Never falls back to blind pixel clicks.
 */
import { execFile } from "node:child_process";

let pw = null;
let browser = null;

async function ensurePlaywright() {
  if (pw) return pw;
  try {
    pw = await import("playwright-core");
    return pw;
  } catch {
    throw new Error("Browser control needs playwright-core. Run: npm i playwright-core (inside companion/), and make sure Chrome is installed.");
  }
}

async function ensureBrowser() {
  if (browser) return browser;
  const { chromium } = await ensurePlaywright();
  const port = Number(process.env.SOPHIA_CDP_PORT || 9222);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 4000 });
    return browser;
  } catch {
    const exe = process.env.SOPHIA_CHROME_PATH || undefined;
    browser = await chromium.launch({ headless: false, executablePath: exe, args: ["--start-maximized"] });
    return browser;
  }
}

async function firstPage() {
  const b = await ensureBrowser();
  const ctx = b.contexts()[0] ?? await b.newContext();
  const pages = ctx.pages();
  return pages[0] ?? await ctx.newPage();
}

export async function browserAction(action, a = {}) {
  switch (action) {
    case "browser_navigate": {
      const page = await firstPage();
      await page.goto(String(a.url), { timeout: Number(a.timeout) || 20000, waitUntil: "domcontentloaded" });
      return { url: page.url(), title: await page.title() };
    }
    case "browser_open_read": {
      const page = await firstPage();
      await page.goto(String(a.url), { timeout: 20000, waitUntil: "domcontentloaded" });
      const text = await page.evaluate(() => {
        const main = document.querySelector("main, article, #content, body");
        return (main?.innerText || document.body.innerText || "").slice(0, 20000);
      });
      return { url: page.url(), title: await page.title(), text };
    }
    case "browser_click_text": {
      const page = await firstPage();
      const text = String(a.text ?? "");
      if (!text) throw new Error("missing text");
      const loc = page.getByText(text, { exact: false }).first();
      await loc.click({ timeout: Number(a.timeout) || 8000 });
      return { clicked: text, url: page.url() };
    }
    case "browser_type": {
      const page = await firstPage();
      const selector = String(a.selector ?? "input, textarea");
      const text = String(a.text ?? "");
      const loc = page.locator(selector).first();
      await loc.fill(text, { timeout: 8000 });
      return { typed: text.length, selector };
    }
    default: throw new Error(`Unsupported browser action ${action}`);
  }
}
