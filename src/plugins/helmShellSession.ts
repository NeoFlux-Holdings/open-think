/**
 * Per-user shell session naming. The browser's /shell/ws handler in
 * src/index.ts derives a session name `u-<8-hex>` from the auth email
 * via FNV-1a so each user gets their own container instance (one per
 * email, isolated from other tabs/users).
 *
 * The agent (helm-exec, helm-toml-*) MUST land in the SAME container
 * the user is using in their browser, otherwise commands like
 * `git clone` done by the user are invisible to the agent and vice
 * versa. We replicate the exact hash here so agent-side calls produce
 * the same name as the browser-side path.
 *
 * Resolution order (sharedDeriveSession):
 *   1. Explicit `input.session`
 *   2. Hash of env.AGENT_OWNER_EMAIL (the user's email — set during setup)
 *   3. Hash of env.OWNER_EMAIL (alternative key)
 *   4. "agent-default" — last-ditch fallback so the skill still does
 *      something rather than 404'ing
 */

import type { Env } from "../types";

/** FNV-1a 32-bit. Same routine as the /shell/ws route. */
function fnv1a32Hex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function deriveUserSession(email: string): string {
  return `u-${fnv1a32Hex(email.toLowerCase())}`;
}

export function resolveShellSession(env: Env, explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const ownerEmail = env.AGENT_OWNER_EMAIL || env.OWNER_EMAIL;
  if (ownerEmail) return deriveUserSession(ownerEmail);
  return "agent-default";
}
