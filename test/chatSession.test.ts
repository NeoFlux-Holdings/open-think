/**
 * ChatSessionDO protocol smoke tests.
 *
 * The full handleUserMessage path requires mocking AgentRuntime + plugins +
 * providers — that's out of scope here (covered by the conductor.test.ts
 * suite at the runtime layer). What we test:
 *
 *   - ping → pong
 *   - malformed JSON → error event broadcast
 *   - unknown command kind → error event broadcast
 *   - interrupt command → halted event broadcast (V1 placeholder)
 *   - broadcast() reaches every connected socket
 *
 * Heavyweight integration (live conductor + WS handshake) belongs in an
 * E2E test against a deployed worker. This keeps the unit test fast.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ChatSessionDO } from "../src/durable/chatSession";

/* ---------------- minimal mock ctx + WebSocket ---------------- */

interface MockWS {
  sent: string[];
  attachment: unknown;
  readyState: number;
  send(data: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  close(code?: number, reason?: string): void;
}

function makeMockWebSocket(): MockWS {
  return {
    sent: [],
    attachment: null,
    readyState: 1, // OPEN
    send(data: string) {
      this.sent.push(data);
    },
    serializeAttachment(value: unknown) {
      this.attachment = value;
    },
    deserializeAttachment() {
      return this.attachment;
    },
    close() {
      this.readyState = 3;
    }
  };
}

function makeMockCtx(sockets: MockWS[] = []) {
  const accepted: MockWS[] = [...sockets];
  return {
    accepted,
    acceptWebSocket(ws: MockWS) {
      accepted.push(ws);
    },
    getWebSockets() {
      return accepted as unknown as WebSocket[];
    },
    waitUntil() {}
  };
}

function makeDO(sockets: MockWS[] = []): ChatSessionDO {
  const ctx = makeMockCtx(sockets);
  // Bypass the DurableObject constructor's typing; the unit test only
  // exercises message + broadcast logic.
  const env = {} as never;
  const instance = new ChatSessionDO(ctx as never, env);
  return instance;
}

/* ---------------- tests ---------------- */

describe("ChatSessionDO · WS message routing", () => {
  let ws: MockWS;
  let other: MockWS;
  let dom: ChatSessionDO;

  beforeEach(() => {
    ws = makeMockWebSocket();
    other = makeMockWebSocket();
    dom = makeDO([ws, other]);
  });

  it("responds to ping with pong on the same socket only", async () => {
    await dom.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ kind: "ping" }));
    expect(ws.sent.length).toBe(1);
    const event = JSON.parse(ws.sent[0]);
    expect(event.kind).toBe("pong");
    // Pong is direct, not broadcast → other socket sees nothing.
    expect(other.sent.length).toBe(0);
  });

  it("emits an error event on malformed JSON", async () => {
    await dom.webSocketMessage(ws as unknown as WebSocket, "not-json");
    expect(ws.sent.length).toBe(1);
    const event = JSON.parse(ws.sent[0]);
    expect(event.kind).toBe("error");
    expect(event.message).toMatch(/invalid JSON/);
  });

  it("emits an error event on unknown command kind", async () => {
    await dom.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ kind: "nonsense" })
    );
    expect(ws.sent.length).toBe(1);
    const event = JSON.parse(ws.sent[0]);
    expect(event.kind).toBe("error");
    expect(event.message).toMatch(/unknown command kind/);
  });

  it("broadcasts halted on interrupt (V1 placeholder)", async () => {
    await dom.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ kind: "interrupt" })
    );
    // Both sockets see the halted event.
    expect(ws.sent.length).toBe(1);
    expect(other.sent.length).toBe(1);
    const evtA = JSON.parse(ws.sent[0]);
    const evtB = JSON.parse(other.sent[0]);
    expect(evtA.kind).toBe("halted");
    expect(evtB.kind).toBe("halted");
    expect(evtA.reason).toMatch(/interrupt/);
  });

  it("rejects empty user-message content", async () => {
    await dom.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ kind: "user-message", content: "" })
    );
    expect(ws.sent.length).toBe(1);
    const event = JSON.parse(ws.sent[0]);
    expect(event.kind).toBe("error");
    expect(event.message).toMatch(/empty/);
  });

  it("broadcasts only to sockets in OPEN state", async () => {
    other.readyState = 3; // CLOSED
    await dom.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ kind: "interrupt" })
    );
    expect(ws.sent.length).toBe(1);
    expect(other.sent.length).toBe(0); // skipped
  });
});

describe("ChatSessionDO · WS upgrade", () => {
  it("rejects non-upgrade requests with 426", async () => {
    const dom = makeDO();
    const r = await dom.fetch(new Request("https://chat-do/?session=test"));
    expect(r.status).toBe(426);
  });

  // The full upgrade-handshake test (Response with status: 101) requires the
  // Cloudflare Workers runtime — Node's Response constructor rejects 101 as
  // out of range (200-599). The protocol logic ABOVE the upgrade is fully
  // covered by the WS message-routing tests; the upgrade itself is an
  // integration concern best validated against a deployed Worker.
  it.skip("attaches sessionName on upgrade + greets with ready event (Workers-only)", () => {
    // Intentionally empty — see comment above.
  });
});
