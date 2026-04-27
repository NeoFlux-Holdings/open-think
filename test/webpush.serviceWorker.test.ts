/**
 * Service-worker source smoke tests. We don't run the SW in a headless
 * browser here — that's CI-grade and lives in a follow-up. We do verify the
 * source string we serve at /sw.js has the three handlers a Web Push SW
 * needs and references the right resources.
 */
import { describe, expect, it } from "vitest";
import { ICON_SVG, SERVICE_WORKER_JS } from "../src/webpush/serviceWorker";

describe("service worker source", () => {
  it("registers all three lifecycle + push event handlers", () => {
    expect(SERVICE_WORKER_JS).toContain("addEventListener('install'");
    expect(SERVICE_WORKER_JS).toContain("addEventListener('activate'");
    expect(SERVICE_WORKER_JS).toContain("addEventListener('push'");
    expect(SERVICE_WORKER_JS).toContain("addEventListener('notificationclick'");
  });

  it("calls showNotification on push", () => {
    expect(SERVICE_WORKER_JS).toContain("self.registration.showNotification");
  });

  it("opens a window on notificationclick", () => {
    expect(SERVICE_WORKER_JS).toContain("openWindow");
  });

  it("references the icon at /icon.svg", () => {
    expect(SERVICE_WORKER_JS).toContain("/icon.svg");
  });

  it("activates immediately (skipWaiting + clients.claim)", () => {
    expect(SERVICE_WORKER_JS).toContain("skipWaiting");
    expect(SERVICE_WORKER_JS).toContain("clients.claim");
  });
});

describe("icon source", () => {
  it("is a 192x192 SVG with the brand orange tick", () => {
    expect(ICON_SVG).toMatch(/<svg[^>]*viewBox="0 0 192 192"/);
    expect(ICON_SVG).toMatch(/#f38020/);
  });
});
