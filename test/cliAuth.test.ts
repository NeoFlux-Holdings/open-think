/**
 * CliAuthDO state-machine tests. We exercise the device-code flow end
 * to end without booting the Worker — the DO class is testable in
 * isolation if we hand it a fake DurableObjectState with a Map-backed
 * storage. Same approach used for cfApi tests.
 */
import { describe, expect, it } from "vitest";
import { CliAuthDO } from "../src/durable/cliAuth";
import type { Env } from "../src/types";

class FakeStorage {
  private store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.store.get(key) as T | undefined; }
  async put(key: string, value: unknown): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<boolean> { return this.store.delete(key); }
  async list<T>(opts?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of this.store) {
      if (!opts?.prefix || k.startsWith(opts.prefix)) out.set(k, v as T);
    }
    return out;
  }
}

function fakeState() {
  return { storage: new FakeStorage() } as unknown as DurableObjectState;
}

function makeDO(): CliAuthDO {
  return new CliAuthDO(fakeState(), {} as Env);
}

async function rpc<T>(d: CliAuthDO, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await d.fetch(new Request(`https://x${path}`, init));
  const text = await res.text();
  let parsed: T;
  try { parsed = JSON.parse(text); } catch { parsed = text as unknown as T; }
  return { status: res.status, body: parsed };
}

describe("CliAuthDO", () => {
  it("start → poll(pending) → approve → poll(approved+token)", async () => {
    const d = makeDO();
    const start = await rpc<{ ok: boolean; data: { deviceCode: string; userCode: string } }>(
      d, "POST", "/start", { cliInfo: "test", appName: "open-think-shell" }
    );
    expect(start.status).toBe(200);
    expect(start.body.data.deviceCode).toMatch(/^[a-f0-9]{64}$/);
    expect(start.body.data.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Pre-approval poll → pending
    const poll1 = await rpc<{ ok: boolean; data: { status: string; token?: string } }>(
      d, "POST", "/poll", { deviceCode: start.body.data.deviceCode }
    );
    expect(poll1.body.data.status).toBe("pending");
    expect(poll1.body.data.token).toBeUndefined();

    // Approve via the user-code endpoint (this is what the browser does).
    const approve = await rpc<{ ok: boolean; data: { status: string; token: string } }>(
      d, "POST", "/approve", { userCode: start.body.data.userCode, email: "tom@example.com" }
    );
    expect(approve.body.data.status).toBe("approved");
    expect(approve.body.data.token).toMatch(/^cli_[a-f0-9]{64}$/);

    // Now the CLI's poll picks up the token.
    const poll2 = await rpc<{ ok: boolean; data: { status: string; token?: string; email?: string } }>(
      d, "POST", "/poll", { deviceCode: start.body.data.deviceCode }
    );
    expect(poll2.body.data.status).toBe("approved");
    expect(poll2.body.data.token).toBe(approve.body.data.token);
    expect(poll2.body.data.email).toBe("tom@example.com");

    // Second poll for the same code does NOT return the token again
    // (defense-in-depth — token has been handed over once).
    const poll3 = await rpc<{ ok: boolean; data: { status: string; token?: string } }>(
      d, "POST", "/poll", { deviceCode: start.body.data.deviceCode }
    );
    expect(poll3.body.data.status).toBe("approved");
    expect(poll3.body.data.token).toBeUndefined();
  });

  it("deny path: poll returns 'denied' instead of a token", async () => {
    const d = makeDO();
    const start = await rpc<{ ok: boolean; data: { deviceCode: string; userCode: string } }>(
      d, "POST", "/start", {}
    );
    await rpc(d, "POST", "/approve", { userCode: start.body.data.userCode, deny: true });
    const poll = await rpc<{ ok: boolean; data: { status: string } }>(
      d, "POST", "/poll", { deviceCode: start.body.data.deviceCode }
    );
    expect(poll.body.data.status).toBe("denied");
  });

  it("verify-token resolves bearer to email; bogus token returns 404", async () => {
    const d = makeDO();
    const start = await rpc<{ ok: boolean; data: { deviceCode: string; userCode: string } }>(
      d, "POST", "/start", {}
    );
    const approve = await rpc<{ ok: boolean; data: { token: string } }>(
      d, "POST", "/approve", { userCode: start.body.data.userCode, email: "tom@example.com" }
    );
    const verify = await rpc<{ ok: boolean; data: { email: string } }>(
      d, "GET", `/verify-token?token=${encodeURIComponent(approve.body.data.token)}`
    );
    expect(verify.status).toBe(200);
    expect(verify.body.data.email).toBe("tom@example.com");

    const bad = await rpc<{ ok: boolean }>(d, "GET", "/verify-token?token=cli_unknown");
    expect(bad.status).toBe(404);
    expect(bad.body.ok).toBe(false);
  });

  it("revoke drops the token; subsequent verify returns 404", async () => {
    const d = makeDO();
    const start = await rpc<{ ok: boolean; data: { deviceCode: string; userCode: string } }>(
      d, "POST", "/start", {}
    );
    const approve = await rpc<{ ok: boolean; data: { token: string } }>(
      d, "POST", "/approve", { userCode: start.body.data.userCode, email: "tom@example.com" }
    );
    await rpc(d, "POST", "/revoke", { token: approve.body.data.token });
    const verify = await rpc<{ ok: boolean }>(
      d, "GET", `/verify-token?token=${encodeURIComponent(approve.body.data.token)}`
    );
    expect(verify.status).toBe(404);
  });

  it("approve with unknown user code returns 404", async () => {
    const d = makeDO();
    const r = await rpc<{ ok: boolean; error: string }>(
      d, "POST", "/approve", { userCode: "ABCD-1234", email: "x@y" }
    );
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
  });
});
