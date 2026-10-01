/**
 * scripts/eval-apps.mjs — Phase 30: reliability score per app.
 *
 * Maps every eval task (core + desktop) to the user-visible app/surface it
 * exercises, and aggregates run results into per-app pass rates for the
 * Diagnostics reliability card. Pure — no I/O.
 *
 * Desktop tasks inherit their app from the category (`desktop:notepad` →
 * Notepad); core tasks map by id prefix with explicit overrides. Anything
 * unmapped falls under "Core" (daemon plumbing, never a user app).
 */

export const DESKTOP_APPS = {
  'desktop:notepad': 'Notepad',
  'desktop:files': 'Files',
  'desktop:cross-app': 'Cross-App',
  'desktop:webform': 'Web Forms',
  'desktop:system': 'System',
  'desktop:injection': 'Safety',
};

/** Explicit id → app; wins over every rule below. */
export const TASK_APP_OVERRIDES = {
  skills_list_shape: 'Core', // action-registry shape, not procedural memory
};

const CORE_RULES = [
  [/^browser_|^extension_dom_/, 'Chrome'],
  [/^files_|^media_/, 'Files & Media'],
  [/^whatsapp/, 'WhatsApp'],
  [/voice|tts|stt/, 'Voice'],
  [/^(memory_|episodes_|store_|mirror_)/, 'Memory'],
  [/^(confirmation_|kill_|credentials_|pairing_|view_only|device_|actions_)|unknown_action/, 'Safety & Trust'],
];

/** One task → one app name. Pure. */
export function appForTask(id, category) {
  if (Object.hasOwn(TASK_APP_OVERRIDES, id)) return TASK_APP_OVERRIDES[id];
  if (typeof category === 'string' && category.startsWith('desktop:')) {
    return DESKTOP_APPS[category] ?? 'Desktop';
  }
  for (const [re, app] of CORE_RULES) {
    if (re.test(String(id))) return app;
  }
  return 'Core';
}

/**
 * Aggregate harness results into per-app scores. Pure.
 * Apps with zero ran tasks get rate null ("not run here", e.g. desktop
 * tasks on a headless box) — never 0%, which would mean failing.
 */
export function aggregateByApp(results) {
  const byApp = new Map();
  const failures = [];
  for (const r of results ?? []) {
    const app = appForTask(r.id, r.category);
    let row = byApp.get(app);
    if (!row) {
      row = { app, pass: 0, fail: 0, skip: 0 };
      byApp.set(app, row);
    }
    if (r.outcome === 'pass') row.pass++;
    else if (r.outcome === 'fail') {
      row.fail++;
      failures.push(String(r.id));
    } else row.skip++;
  }
  const apps = [...byApp.values()].map((row) => {
    const ran = row.pass + row.fail;
    return { ...row, ran, rate: ran ? Math.round((row.pass / ran) * 100) : null };
  });
  apps.sort((a, b) => (a.app < b.app ? -1 : 1));
  failures.sort();
  return { apps, failures };
}
