/**
 * Browser navigation bridge — allows non-React code (control layer, voice tools)
 * to imperatively navigate the BrowserPanel iframe without importing the component.
 */

let _navigateFn: ((url: string, title?: string) => void) | null = null;

export function registerBrowserNavigate(fn: (url: string, title?: string) => void) {
  _navigateFn = fn;
}

export function unregisterBrowserNavigate() {
  _navigateFn = null;
}

/** Navigate the browser panel to a URL. Silently does nothing if panel is not open. */
export function navigateBrowserTo(url: string, title?: string) {
  if (_navigateFn) _navigateFn(url, title);
}
