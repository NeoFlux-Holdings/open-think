/**
 * Helm Cloud session-claim layer — the replay-safe glue between Stripe
 * Checkout and our deploy persistence.
 *
 * Two pieces:
 *
 *   1. **D1 claim ledger** — `cloud_session_claims` rows mark a Stripe
 *      session_id as "spoken for" by exactly one browser. Second exchange
 *      attempt for the same session_id is rejected.
 *
 *   2. **Signed HTTP-only cookie** — the exchange endpoint issues a cookie
 *      bound to the claim. The deploy endpoint reads `customer_id` from this
 *      cookie, NOT from the client-supplied request body. An attacker who
 *      knows a session_id but doesn't possess the cookie can't deploy as
 *      the legit subscriber.
 *
 * Cookie format: `b64url(payloadJson).b64url(hmacSha256(payload))`
 *   payload: { sub, sid, exp }  // customer_id, session_id, unix-seconds expiry
 *   key:     SHA-256(CLOUD_MASTER_KEY) — same secret reuse as token-encryption
 */

const COOKIE_NAME = "oth_cloud_intent";
const COOKIE_TTL_SECONDS = 30 * 60; // 30 minutes — long enough for a thoughtful deploy, short enough that lost cookies don't linger

/* ---------------- D1 claim ledger ---------------- */

export interface SessionClaimRow {
  sessionId: string;
  customerId: string;
  email: string | null;
  claimedAt: string;
  cookieExpiresAt: string;
  deploymentId: string | null;
}

export interface ClaimAttemptInput {
  sessionId: string;
  customerId: string;
  email?: string;
  /** ISO string at which the issued cookie expires. */
  cookieExpiresAt: string;
}

export type ClaimResult =
  | { ok: true; claim: SessionClaimRow }
  | { ok: false; reason: "already-claimed"; existing: SessionClaimRow }
  | { ok: false; reason: "db-error"; error: string };

/**
 * Insert a claim row, failing if the session_id has already been claimed.
 * Idempotent for the legit caller — if the same {session_id, customer_id}
 * pair shows up again (e.g. browser refresh hit the endpoint twice before
 * the cookie was set), we return the existing row as success.
 */
export async function claimSession(
  db: D1Database,
  input: ClaimAttemptInput
): Promise<ClaimResult> {
  const existing = await getClaimBySession(db, input.sessionId);
  if (existing) {
    if (existing.customerId === input.customerId) {
      // Same browser re-asking — return the existing claim, no row written.
      return { ok: true, claim: existing };
    }
    return { ok: false, reason: "already-claimed", existing };
  }
  const row: SessionClaimRow = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    email: input.email ?? null,
    claimedAt: new Date().toISOString(),
    cookieExpiresAt: input.cookieExpiresAt,
    deploymentId: null
  };
  try {
    await db
      .prepare(
        `INSERT INTO cloud_session_claims
         (session_id, customer_id, email, claimed_at, cookie_expires_at, deployment_id)
         VALUES (?, ?, ?, ?, ?, NULL)`
      )
      .bind(row.sessionId, row.customerId, row.email, row.claimedAt, row.cookieExpiresAt)
      .run();
  } catch (err) {
    return { ok: false, reason: "db-error", error: (err as Error).message };
  }
  return { ok: true, claim: row };
}

export async function getClaimBySession(
  db: D1Database,
  sessionId: string
): Promise<SessionClaimRow | null> {
  if (!sessionId) return null;
  const r = await db
    .prepare(
      `SELECT session_id as sessionId, customer_id as customerId, email,
              claimed_at as claimedAt, cookie_expires_at as cookieExpiresAt,
              deployment_id as deploymentId
         FROM cloud_session_claims WHERE session_id = ?`
    )
    .bind(sessionId)
    .first<SessionClaimRow>();
  return r ?? null;
}

/**
 * Bind a successful deployment to the claim row that authorized it. Once
 * bound, even a re-exchange of the same session_id can't produce a second
 * deployment — we have a hard 1:1 link.
 */
export async function bindClaimToDeployment(
  db: D1Database,
  sessionId: string,
  deploymentId: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE cloud_session_claims SET deployment_id = ? WHERE session_id = ? AND deployment_id IS NULL`
    )
    .bind(deploymentId, sessionId)
    .run();
}

/* ---------------- Signed cookie ---------------- */

export interface IntentPayload {
  /** Stripe customer_id (cus_…). The deploy endpoint trusts this. */
  sub: string;
  /** Stripe session_id (cs_…). For binding deployment back to claim. */
  sid: string;
  /** Email for display. Untrusted-for-billing, fine-for-UI. */
  email?: string;
  /** Unix seconds. */
  exp: number;
}

function urlB64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function urlB64Decode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(masterSecret: string): Promise<CryptoKey> {
  if (!masterSecret || masterSecret.length < 16) {
    throw new Error("CLOUD_MASTER_KEY required for cookie signing");
  }
  // SHA-256 the secret first so the HMAC key is exactly 32 bytes regardless
  // of what the operator provided. Same derivation as crypto.ts so a single
  // secret backs both flows.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(masterSecret));
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let r = 0;
  for (let i = 0; i < a.byteLength; i++) r |= a[i] ^ b[i];
  return r === 0;
}

/**
 * Sign an intent payload into an opaque cookie value. Caller wraps it in a
 * Set-Cookie header with HttpOnly + Secure + SameSite=Lax.
 */
export async function signIntentCookie(
  payload: IntentPayload,
  masterSecret: string
): Promise<string> {
  const json = JSON.stringify(payload);
  const payloadB64 = urlB64Encode(new TextEncoder().encode(json));
  const key = await importHmacKey(masterSecret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  const sigB64 = urlB64Encode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a cookie value and return the payload, or null on any failure
 * (bad shape, bad signature, expired). Never throws — callers shouldn't
 * have to wrap in try/catch for a routine "no/invalid cookie" case.
 */
export async function verifyIntentCookie(
  raw: string,
  masterSecret: string
): Promise<IntentPayload | null> {
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, sigB64] = raw.split(".", 2);
  if (!payloadB64 || !sigB64) return null;
  let key: CryptoKey;
  try {
    key = await importHmacKey(masterSecret);
  } catch {
    return null;
  }
  let expectedSig: ArrayBuffer;
  try {
    expectedSig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payloadB64)
    );
  } catch {
    return null;
  }
  let providedSig: Uint8Array;
  try {
    providedSig = urlB64Decode(sigB64);
  } catch {
    return null;
  }
  if (!timingSafeEqualBytes(new Uint8Array(expectedSig), providedSig)) return null;
  let payload: IntentPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(urlB64Decode(payloadB64))) as IntentPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    return null;
  }
  return payload;
}

/* ---------------- Cookie header helpers ---------------- */

export interface IssuedCookie {
  /** Raw cookie value (sign(payload).sig). */
  value: string;
  /** Set-Cookie header value, ready to slap into a Response. */
  setCookieHeader: string;
  /** ISO timestamp at which the cookie expires (for the D1 ledger). */
  expiresAtIso: string;
  /** Mirrors what's in the signed payload, for telemetry. */
  payload: IntentPayload;
}

/**
 * Build a fresh intent cookie + Set-Cookie header for a successful exchange.
 * Use the returned `expiresAtIso` when writing the claim row so the DB and
 * cookie agree on TTL.
 */
export async function issueIntentCookie(
  customerId: string,
  sessionId: string,
  masterSecret: string,
  options: { email?: string; ttlSeconds?: number; secure?: boolean } = {}
): Promise<IssuedCookie> {
  const ttl = options.ttlSeconds ?? COOKIE_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload: IntentPayload = {
    sub: customerId,
    sid: sessionId,
    exp,
    ...(options.email ? { email: options.email } : {})
  };
  const value = await signIntentCookie(payload, masterSecret);
  const secure = options.secure ?? true;
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${ttl}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) attrs.push("Secure");
  return {
    value,
    setCookieHeader: attrs.join("; "),
    expiresAtIso: new Date(exp * 1000).toISOString(),
    payload
  };
}

/** Build a Set-Cookie that immediately invalidates the intent cookie. */
export function clearIntentCookieHeader(secure = true): string {
  const attrs = [`${COOKIE_NAME}=`, "Max-Age=0", "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/**
 * Extract the intent cookie value from a request's Cookie header.
 * Returns null if the header is absent or doesn't contain our cookie.
 */
export function readIntentCookieRaw(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === COOKIE_NAME && v) return v;
  }
  return null;
}

/**
 * One-shot helper — read + verify in a single call. Returns the payload or
 * null if the cookie is missing/invalid/expired.
 */
export async function readVerifiedIntent(
  request: Request,
  masterSecret: string
): Promise<IntentPayload | null> {
  const raw = readIntentCookieRaw(request);
  if (!raw) return null;
  return await verifyIntentCookie(raw, masterSecret);
}

/** Exported for tests. */
export const _testing = {
  COOKIE_NAME,
  COOKIE_TTL_SECONDS,
  urlB64Encode,
  urlB64Decode
};
