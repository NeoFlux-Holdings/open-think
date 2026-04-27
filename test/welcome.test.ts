/**
 * Welcome page tests.
 *
 * The welcome page is a single-shot HTML render that bakes in the agent
 * name + owner. We pin a few invariants so future redesigns don't break
 * the contract:
 *   - Returns valid-looking HTML (doctype, charset, viewport).
 *   - Auth banner element is present so the client-side script can show it.
 *   - Links to /app, /setup/status, /openapi.json, /health, /welcome.
 *   - Calls /setup/status to drive the checklist (so deployers can verify
 *     dynamic state is rendered, not baked in).
 *   - Escapes operator-supplied AGENT_NAME / AGENT_OWNER.
 */
import { describe, expect, it } from "vitest";
import { welcomeHtml } from "../src/welcome";

describe("welcomeHtml", () => {
  it("emits a complete HTML document", () => {
    const out = welcomeHtml({});
    expect(out).toMatch(/^<!doctype html>/i);
    expect(out).toMatch(/<meta charset="utf-8">/);
    expect(out).toMatch(/<meta name="viewport"/);
    expect(out).toMatch(/<\/html>$/);
  });

  it("includes the auth-not-configured banner element", () => {
    const out = welcomeHtml({});
    expect(out).toMatch(/id="auth-banner"/);
    expect(out).toMatch(/auth not configured/i);
    expect(out).toMatch(/CF_ACCESS_TEAM_DOMAIN/);
  });

  it("links to /app, /setup/status, /openapi.json, /health, /welcome", () => {
    const out = welcomeHtml({});
    expect(out).toMatch(/href="\/app"/);
    expect(out).toMatch(/href="\/setup\/status"/);
    expect(out).toMatch(/href="\/openapi.json"/);
    expect(out).toMatch(/href="\/health"/);
    expect(out).toMatch(/href="\/welcome"/);
  });

  it("fetches /setup/status to drive the checklist", () => {
    const out = welcomeHtml({});
    expect(out).toMatch(/fetch\(['"]\/setup\/status/);
  });

  it("interpolates AGENT_NAME without breaking out of attributes", () => {
    const out = welcomeHtml({ AGENT_NAME: 'Tom"</title><script>alert(1)</script>' });
    expect(out).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(out).toMatch(/&quot;|&lt;/);
  });

  it("interpolates AGENT_OWNER possessive cleanly", () => {
    const out = welcomeHtml({ AGENT_OWNER: "Tom" });
    // Apostrophe is HTML-escaped to &#39; by escapeHtml.
    expect(out).toMatch(/Tom&#39;s\s+Helm/);
  });

  it("falls back to 'Helm' when AGENT_NAME is unset", () => {
    const out = welcomeHtml({});
    expect(out).toMatch(/Helm/);
  });
});
