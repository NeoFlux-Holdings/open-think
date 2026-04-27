import { describe, expect, it, vi } from "vitest";
import { rpcStream } from "../src/oauth/codexRpc";

/**
 * Mock a ws:// upgrade by returning a fake Response with a synthetic WebSocket
 * implementation that replays a scripted sequence of server-to-client frames.
 */
function makeMockWebSocket() {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  let sent: string[] = [];
  let closed = false;

  const ws = {
    accept() {},
    send(payload: string) {
      sent.push(payload);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.close?.forEach((fn) => fn({ code: 1000 }));
    },
    addEventListener(type: string, fn: (event: unknown) => void) {
      (listeners[type] ||= []).push(fn);
    }
  };

  function emitMessage(frame: unknown) {
    const data = JSON.stringify(frame);
    listeners.message?.forEach((fn) => fn({ data }));
  }

  function getSent() {
    return sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  return { ws, emitMessage, getSent, wasClosed: () => closed };
}

describe("rpcStream", () => {
  it("yields every notification frame and stops on the terminal id match", async () => {
    const mock = makeMockWebSocket();

    const fetchImpl = vi.fn(
      async () =>
        ({
          status: 101,
          webSocket: mock.ws
        } as unknown as Response)
    );

    const framesPromise = (async () => {
      const frames = [];
      for await (const frame of rpcStream(
        {
          url: "wss://bridge.example/rpc",
          fetchImpl: fetchImpl as unknown as typeof globalThis.fetch
        },
        { method: "turn/start", params: { thread_id: "thr_1" }, id: "rpc-1" }
      )) {
        frames.push(frame);
      }
      return frames;
    })();

    // Let the generator send its upgrade/message before we emit.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Verify the outbound JSON-RPC request shape.
    const sent = mock.getSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "turn/start"
    });

    mock.emitMessage({ jsonrpc: "2.0", method: "turn/delta", params: { text: "Hello " } });
    mock.emitMessage({ jsonrpc: "2.0", method: "turn/delta", params: { text: "world" } });
    mock.emitMessage({
      jsonrpc: "2.0",
      id: "rpc-1",
      result: { turn_id: "trn_1", output: [{ type: "text", text: "Hello world" }] }
    });

    const frames = await framesPromise;
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({ method: "turn/delta", params: { text: "Hello " } });
    expect(frames[2]).toMatchObject({ id: "rpc-1" });
    expect((frames[2] as { result: unknown }).result).toBeTruthy();
    expect(mock.wasClosed()).toBe(true);
  });

  it("rejects non-ws URLs", async () => {
    await expect(
      (async () => {
        for await (const _ of rpcStream(
          { url: "https://bridge.example/rpc" },
          { method: "turn/start" }
        )) {
          // never
        }
      })()
    ).rejects.toThrowError(/ws\(s\):\/\//);
  });

  it("surfaces terminal error frames", async () => {
    const mock = makeMockWebSocket();
    const fetchImpl = vi.fn(
      async () =>
        ({
          status: 101,
          webSocket: mock.ws
        } as unknown as Response)
    );

    const framesPromise = (async () => {
      const frames = [];
      for await (const frame of rpcStream(
        {
          url: "wss://bridge.example/rpc",
          fetchImpl: fetchImpl as unknown as typeof globalThis.fetch
        },
        { method: "turn/start", id: "err-1" }
      )) {
        frames.push(frame);
      }
      return frames;
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));

    mock.emitMessage({
      jsonrpc: "2.0",
      id: "err-1",
      error: { code: -32000, message: "bad turn" }
    });

    const frames = await framesPromise;
    expect(frames).toHaveLength(1);
    expect((frames[0] as { error: { message: string } }).error.message).toBe("bad turn");
  });

  it("fails upgrade when status is not 101", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          status: 502,
          text: async () => "bad gateway"
        } as unknown as Response)
    );

    await expect(
      (async () => {
        for await (const _ of rpcStream(
          {
            url: "wss://bridge.example/rpc",
            fetchImpl: fetchImpl as unknown as typeof globalThis.fetch
          },
          { method: "turn/start" }
        )) {
          // never
        }
      })()
    ).rejects.toThrowError(/upgrade failed.*502/);
  });
});
