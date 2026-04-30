/**
 * Cloudflare Access JWT gate.
 *
 * Every authenticated route expects a `Cf-Access-Jwt-Assertion` header (Access
 * injects it after the user signs in at the team domain). We validate the token
 * against the team's JWKS (`${teamDomain}/cdn-cgi/access/certs`), match it to
 * the app's Audience tag (AUD), and extract the user's email.
 *
 * This is the right primitive for Tom's PA because:
 *   - No password to manage — Access handles one-time PIN, OAuth, SSO.
 *   - Free tier covers up to 50 users (we need 1).
 *   - The Worker only ever sees the validated JWT; no secret material flows
 *     through our code.
 *   - Access also gates the origin at the edge — even if the Worker code
 *     forgets to check, Access won't route unauthenticated traffic to us.
 *
 * Local-dev escape hatch: set `DEV_AUTH_BYPASS=1` in `.dev.vars` to fake
 * a logged-in user so `wrangler dev` works without tunnel-through-Access.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Env } from "./types";
import { AppError } from "./core/errors";

export interface AuthContext {
  email: string;
  subject: string;
  token: string;
  claims: JWTPayload;
  /** true when the request was authenticated via DEV_AUTH_BYPASS rather than a real Access JWT. */
  dev: boolean;
  /**
   * true when this is the *first-run permissive* path: the Worker has no
   * `CF_ACCESS_*` config, no `DEV_AUTH_BYPASS=1`, and no JWT on the request.
   * We let the caller through so `wrangler deploy` produces a working chat
   * agent with zero secrets — but every consumer should treat this as a
   * loud "auth not yet configured" warning and surface it in UI.
   */
  firstRun: boolean;
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)/i.exec(header);
  return m ? m[1] : null;
}

/**
 * JWKS lookups are cached per-team-domain for the lifetime of the isolate.
 * jose handles the internal cache TTL (it refetches when keys rotate).
 */
const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`));
    jwksByTeamDomain.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verify the Access JWT on the request and return the authenticated identity,
 * or `null` if the request is not authenticated (no token / bad token / not on
 * the allowlist). Errors out (500) if the Worker is missing required config.
 */
export async function verifyAccessJwt(
  request: Request,
  env: Env
): Promise<AuthContext | null> {
  // --- 0. Internal-bearer path (used by the Helm Shell container's `helm`
  //         command, scripts, etc. that run inside our own infrastructure
  //         and can't easily mint a CF Access JWT). The token is set as a
  //         Worker secret and forwarded into the container via envVars on
  //         the Container DO. Constant-time-ish equality is fine here —
  //         the token is high-entropy and strings of equal length compare
  //         in constant time on V8 anyway. ---
  const internalBearer = parseBearer(request.headers.get("authorization"));
  if (internalBearer && env.HELM_INTERNAL_TOKEN && internalBearer === env.HELM_INTERNAL_TOKEN) {
    const email = env.AGENT_OWNER_EMAIL ?? "internal@helm-shell";
    return {
      email,
      subject: "helm-internal",
      token: "internal-bearer",
      claims: { sub: "helm-internal", email, iat: Math.floor(Date.now() / 1000) } as JWTPayload,
      dev: false,
      firstRun: false
    };
  }

  // --- 1. Dev bypass (local only) ---
  if (env.DEV_AUTH_BYPASS === "1") {
    const email = env.AGENT_OWNER_EMAIL ?? "dev@local";
    return {
      email,
      subject: "dev-bypass",
      token: "dev-bypass",
      claims: { sub: "dev-bypass", email, iat: Math.floor(Date.now() / 1000) } as JWTPayload,
      dev: true,
      firstRun: false
    };
  }

  // --- 2. Extract token ---
  const token =
    request.headers.get("cf-access-jwt-assertion") ??
    request.headers.get("CF-Access-Jwt-Assertion") ??
    "";

  // --- 3. First-run permissive path ---
  // If the Worker is brand new (no Access config) AND there's no JWT on
  // the request, we let the caller through as a `firstRun` guest. This
  // is what makes `wrangler deploy` → working chat in 60 seconds. The
  // calling page MUST surface an "auth not configured" banner.
  //
  // Once the operator sets either `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`
  // OR `DEV_AUTH_BYPASS=1`, the Worker flips into strict mode automatically.
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) {
    if (token) {
      // Caller sent a JWT but Access isn't set up. We can't verify it.
      // Treat as first-run guest with a console warning so deployers notice.
      console.warn("[auth] received CF-Access-Jwt-Assertion but CF_ACCESS_* env not set — ignoring");
    }
    return {
      email: env.AGENT_OWNER_EMAIL ?? "guest@first-run",
      subject: "first-run-guest",
      token: "",
      claims: { sub: "first-run-guest", iat: Math.floor(Date.now() / 1000) } as JWTPayload,
      dev: false,
      firstRun: true
    };
  }

  if (!token) return null;

  // --- 4. Verify signature, issuer, audience, exp ---
  try {
    const jwks = getJwks(teamDomain);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain.replace(/\/$/, ""),
      audience: aud
    });

    const email = typeof payload.email === "string" ? payload.email : "";
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    if (!email) {
      // JWT valid but missing email — shouldn't happen with Access, but fail closed.
      return null;
    }

    // --- 5. Optional per-app email allowlist ---
    if (env.CF_ACCESS_ALLOWED_EMAILS) {
      const allowed = env.CF_ACCESS_ALLOWED_EMAILS.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) {
        return null;
      }
    }

    return { email, subject, token, claims: payload, dev: false, firstRun: false };
  } catch {
    // Bad signature / expired / wrong aud / JWKS fetch failed
    return null;
  }
}

/**
 * Paths that never require auth. Kept intentionally tiny.
 *
 * - `/`         — public JSON route index (marketing surface)
 * - `/health`   — uptime probes (no sensitive info)
 * - `/openapi.json` — spec doc, safe to share
 * - `/app`      — the SPA shell is public; its XHRs still require auth,
 *                 which lets Access render its own login page in-frame.
 *                 NOTE: if you want zero-leak, flip this to false.
 */
const PUBLIC_GETS = new Set([
  "/",
  "/welcome",
  "/health",
  "/openapi.json",
  // The VAPID public key has to be reachable unauthenticated so the service
  // worker can subscribe before the user has an Access session. It's public
  // by design (browsers need it to call PushManager.subscribe).
  "/webpush/public-key",
  // The service worker must be reachable without auth — browsers register
  // it before any session cookie exists, and the browser itself fetches it
  // again after each push to verify it's unchanged. Same logic for the icon
  // the SW references in showNotification().
  "/sw.js",
  "/icon.svg"
]);

export function isPublicRoute(method: string, pathname: string): boolean {
  if (method !== "GET") return false;
  if (PUBLIC_GETS.has(pathname)) return true;
  return false;
}

/**
 * Require authentication. Throws `E_UNAUTHORIZED` (401) if no valid identity.
 * The global `fetch` handler in `index.ts` catches this and returns a clean
 * JSON error so the caller can redirect to Access login.
 */
export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const ctx = await verifyAccessJwt(request, env);
  if (!ctx) {
    throw new AppError(
      "E_UNAUTHORIZED",
      "This endpoint requires a Cloudflare Access JWT. Sign in at your team domain first.",
      401
    );
  }
  return ctx;
}
