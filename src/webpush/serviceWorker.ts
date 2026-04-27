/**
 * Service worker source served at `/sw.js`. Serves two roles:
 *   1. `push` event handler — decrypts payload (the browser does this), reads
 *      `{title, body, url, icon, tag}`, and shows a notification.
 *   2. `notificationclick` handler — opens (or focuses) the URL the
 *      notification carried.
 *
 * Returned as a string from a Worker route so it shares an origin with the
 * subscribe page (browsers require the SW be same-origin as the page that
 * registered it). We force a `/sw.js` scope which is the broadest the SW
 * itself can claim from that path; the subscribe code calls
 * `register('/sw.js', { scope: '/' })` to widen it.
 *
 * Style: vanilla JS, zero dependencies, runs in a service-worker global
 * context. Read literally — TypeScript compiles this to JS but it doesn't
 * execute in our Worker; we only export the string.
 */

export const SERVICE_WORKER_JS = `// Open Think Web Push service worker.
// Registers handlers for the two events the browser fires after the push
// service delivers our encrypted payload to the device.

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on first install — no waiting for old
  // tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Take control of pages already open at /app etc.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'Helm', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Helm';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.tag,
    data: { url: data.url, ...(data.data || {}) }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If a tab on our origin is already open, focus it and navigate.
    for (const client of all) {
      if ('focus' in client) {
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        } catch (err) {
          // Some browsers reject navigate(); fall through to openWindow.
        }
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
`;

/** Tiny inline icon (SVG, 192x192) — open-think aperture. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" fill="#fafaf5"/>
  <circle cx="96" cy="96" r="60" fill="none" stroke="#121212" stroke-width="6"/>
  <circle cx="96" cy="96" r="18" fill="#121212"/>
  <line x1="96" y1="20" x2="96" y2="42" stroke="#f38020" stroke-width="9" stroke-linecap="round"/>
</svg>`;
