/**
 * Tests for cloud/sessions — the replay-safe layer that prevents one
 * Stripe session_id from authorizing two deploys.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  bindClaimToDeployment,
  claimSession,
  getClaimBySession,
  issueIntentCookie,
  readIntentCookieRaw,
  signIntentCookie,
  verifyIntentCookie,
  _testing
} from "../src/cloud/sessions";

const MASTER = "test-master-key-32-bytes-of-entropy";

/* ---------------- A trivially small in-memory D1 fake ----------------
 * We re-implement the few operations sessions.ts uses against D1.
 * This is intentionally minimal — we're not testing D1 itself.
 */
function makeFakeDb() {
  const claims = new Map<string, Record<string, unknown>>();
  const sql = {
    insertClaim: (
      sessionId: string,
      customerId: string,
      email: string | null,
      claimedAt: string,
      cookieExpiresAt: string
    ) => {
      if (claims.has(sessionId)) throw new Error("UNIQUE constraint failed");
      claims.set(sessionId, {
        sessionId,
        customerId,
        email,
        claimedAt,
        cookieExpiresAt,
        deploymentId: null
      });
    },
    getClaim: (sessionId: string) => claims.get(sessionId),
    bindDeployment: (sessionId: string, deploymentId: string) => {
      const r = claims.get(sessionId);
      if (r && r.deploymentId === null) r.deploymentId = deploymentId;
    }
  };
  return {
    _claims: claims,
    prepare: (q: string) => {
      // Match on the query shape — minimum we need.
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (q.includes("INSERT INTO cloud_session_claims")) {
              sql.insertClaim(
                args[0] as string,
                args[1] as string,
                (args[2] as string) ?? null,
                args[3] as string,
                args[4] as string
              );
              return { meta: {} };
            }
            if (q.includes("UPDATE cloud_session_claims SET deployment_id")) {
              sql.bindDeployment(args[1] as string, args[0] as string);
              return { meta: {} };
            }
            throw new Error("unknown query: " + q);
          },
          first: async () => {
            if (q.includes("FROM cloud_session_claims WHERE session_id")) {
              return sql.getClaim(args[0] as string) ?? null;
            }
            throw new Error("unknown query: " + q);
          },
          all: async () => {
            throw new Error("unknown query: " + q);
          }
        })
      };
    }
  } as unknown as D1Database;
}

/* ---------------- Tests ---------------- */

describe("claimSession", () => {
  let db: D1Database;
  beforeEach(() => {
    db = makeFakeDb();
  });

  it("inserts a fresh claim", async () => {
    const r = await claimSession(db, {
      sessionId: "cs_alice",
      customerId: "cus_alice",
      email: "alice@example.com",
      cookieExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claim.customerId).toBe("cus_alice");
      expect(r.claim.deploymentId).toBe(null);
    }
  });

  it("is idempotent for the same customer (browser refresh case)", async () => {
    const exp = new Date(Date.now() + 3600_000).toISOString();
    const first = await claimSession(db, {
      sessionId: "cs_alice",
      customerId: "cus_alice",
      cookieExpiresAt: exp
    });
    const second = await claimSession(db, {
      sessionId: "cs_alice",
      customerId: "cus_alice",
      cookieExpiresAt: exp
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("rejects a different customer trying to claim the same session", async () => {
    const exp = new Date(Date.now() + 3600_000).toISOString();
    await claimSession(db, {
      sessionId: "cs_alice",
      customerId: "cus_alice",
      cookieExpiresAt: exp
    });
    const mallory = await claimSession(db, {
      sessionId: "cs_alice",
      customerId: "cus_mallory",
      cookieExpiresAt: exp
    });
    expect(mallory.ok).toBe(false);
    if (!mallory.ok) {
      expect(mallory.reason).toBe("already-claimed");
      if (mallory.reason === "already-claimed") {
        expect(mallory.existing.customerId).toBe("cus_alice");
      }
    }
  });
});

describe("getClaimBySession", () => {
  it("returns null for unknown session_id", async () => {
    const db = makeFakeDb();
    expect(await getClaimBySession(db, "cs_nope")).toBe(null);
  });
  it("returns null for empty session_id", async () => {
    const db = makeFakeDb();
    expect(await getClaimBySession(db, "")).toBe(null);
  });
});

describe("bindClaimToDeployment", () => {
  it("links the claim row to a deployment", async () => {
    const db = makeFakeDb();
    await claimSession(db, {
      sessionId: "cs_alice",
      customerId: "cus_alice",
      cookieExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    await bindClaimToDeployment(db, "cs_alice", "depl-uuid-1");
    const claim = await getClaimBySession(db, "cs_alice");
    expect(claim?.deploymentId).toBe("depl-uuid-1");
  });
});

/* ---------------- Cookie crypto ---------------- */

describe("signIntentCookie / verifyIntentCookie", () => {
  it("round-trips a payload", async () => {
    const payload = {
      sub: "cus_alice",
      sid: "cs_alice",
      email: "alice@example.com",
      exp: Math.floor(Date.now() / 1000) + 600
    };
    const signed = await signIntentCookie(payload, MASTER);
    expect(signed.includes(".")).toBe(true);
    const verified = await verifyIntentCookie(signed, MASTER);
    expect(verified).not.toBe(null);
    expect(verified?.sub).toBe("cus_alice");
    expect(verified?.sid).toBe("cs_alice");
  });

  it("rejects a payload signed with a different key", async () => {
    const payload = {
      sub: "cus_alice",
      sid: "cs_alice",
      exp: Math.floor(Date.now() / 1000) + 600
    };
    const signed = await signIntentCookie(payload, MASTER);
    const verified = await verifyIntentCookie(signed, "different-key-xxxxxxxxxxxxxx");
    expect(verified).toBe(null);
  });

  it("rejects an expired cookie", async () => {
    const payload = {
      sub: "cus_alice",
      sid: "cs_alice",
      exp: Math.floor(Date.now() / 1000) - 10
    };
    const signed = await signIntentCookie(payload, MASTER);
    const verified = await verifyIntentCookie(signed, MASTER);
    expect(verified).toBe(null);
  });

  it("rejects a tampered payload", async () => {
    const payload = {
      sub: "cus_alice",
      sid: "cs_alice",
      exp: Math.floor(Date.now() / 1000) + 600
    };
    const signed = await signIntentCookie(payload, MASTER);
    // Tamper: swap the sub by editing the payload portion.
    const [, sig] = signed.split(".");
    const tamperedPayload = _testing.urlB64Encode(
      new TextEncoder().encode(
        JSON.stringify({ ...payload, sub: "cus_mallory" })
      )
    );
    const tampered = `${tamperedPayload}.${sig}`;
    const verified = await verifyIntentCookie(tampered, MASTER);
    expect(verified).toBe(null);
  });

  it("rejects malformed cookie strings", async () => {
    expect(await verifyIntentCookie("not-a-cookie", MASTER)).toBe(null);
    expect(await verifyIntentCookie("", MASTER)).toBe(null);
    expect(await verifyIntentCookie(".missingpayload", MASTER)).toBe(null);
    expect(await verifyIntentCookie("payload.", MASTER)).toBe(null);
  });
});

describe("issueIntentCookie", () => {
  it("produces a Set-Cookie header with the right attributes", async () => {
    const c = await issueIntentCookie("cus_alice", "cs_alice", MASTER, {
      email: "alice@example.com",
      ttlSeconds: 60,
      secure: true
    });
    expect(c.setCookieHeader).toContain("oth_cloud_intent=");
    expect(c.setCookieHeader).toContain("HttpOnly");
    expect(c.setCookieHeader).toContain("SameSite=Lax");
    expect(c.setCookieHeader).toContain("Secure");
    expect(c.setCookieHeader).toContain("Max-Age=60");
    expect(c.setCookieHeader).toContain("Path=/");
    // The signed value should verify back.
    const verified = await verifyIntentCookie(c.value, MASTER);
    expect(verified?.sub).toBe("cus_alice");
    expect(verified?.email).toBe("alice@example.com");
  });

  it("omits Secure when secure=false (for localhost)", async () => {
    const c = await issueIntentCookie("cus_alice", "cs_alice", MASTER, {
      ttlSeconds: 60,
      secure: false
    });
    expect(c.setCookieHeader).not.toContain("Secure");
  });
});

describe("readIntentCookieRaw", () => {
  it("extracts the cookie from a Cookie header", () => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "foo=bar; oth_cloud_intent=AAA.BBB; baz=qux" }
    });
    expect(readIntentCookieRaw(req)).toBe("AAA.BBB");
  });
  it("returns null when the cookie is absent", () => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "foo=bar; baz=qux" }
    });
    expect(readIntentCookieRaw(req)).toBe(null);
  });
  it("returns null when no Cookie header is set", () => {
    const req = new Request("https://example.com/");
    expect(readIntentCookieRaw(req)).toBe(null);
  });
});
