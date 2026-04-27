import { describe, expect, it } from "vitest";
import { EventBus } from "../src/durable/eventBus";

function captureStream() {
  // TransformStream has highWaterMark=0 by default, which applies immediate
  // backpressure on every write. EventBus fires writes synchronously without
  // awaiting, so we start draining eagerly to keep the pipeline clear.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  const drain = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  })();

  const collect = async (): Promise<string> => {
    await drain;
    return chunks.join("");
  };

  return { writer, collect };
}

describe("EventBus", () => {
  it("fans out a frame to every active subscriber", async () => {
    const bus = new EventBus({ bufferLimit: 10 });
    const a = captureStream();
    const b = captureStream();
    bus.subscribe("a", a.writer);
    bus.subscribe("b", b.writer);
    expect(bus.subscriberCount()).toBe(2);

    bus.publish("notification", { method: "turn/delta", params: { text: "hi" } });
    await bus.close({ event: "done", data: { reason: "test" } });

    const outA = await a.collect();
    const outB = await b.collect();
    expect(outA).toContain("event: notification\ndata: ");
    expect(outA).toContain("turn/delta");
    expect(outA).toContain("event: done");
    expect(outB).toContain("event: notification\ndata: ");
    expect(outB).toContain("event: done");
  });

  it("replays buffered frames to late joiners", async () => {
    const bus = new EventBus({ bufferLimit: 10 });
    bus.publish("notification", { method: "turn/delta", params: { text: "Hello " } });
    bus.publish("notification", { method: "turn/delta", params: { text: "world" } });

    const late = captureStream();
    const sub = bus.subscribe("late", late.writer);
    expect(sub.replayed).toBe(2);

    bus.publish("notification", { method: "turn/delta", params: { text: "!" } });
    await bus.close({ event: "done", data: {} });

    const out = await late.collect();
    expect(out.indexOf("Hello ")).toBeLessThan(out.indexOf("world"));
    expect(out.indexOf("world")).toBeLessThan(out.indexOf("!"));
    expect(out).toContain("event: done");
  });

  it("caps the buffer at the configured limit (drops oldest)", async () => {
    const bus = new EventBus({ bufferLimit: 3 });
    bus.publish("a", 1);
    bus.publish("b", 2);
    bus.publish("c", 3);
    bus.publish("d", 4);

    const buffer = bus.bufferedEvents();
    expect(buffer.map((e) => e.event)).toEqual(["b", "c", "d"]);

    const late = captureStream();
    const sub = bus.subscribe("late", late.writer);
    expect(sub.replayed).toBe(3);
    await bus.close();
    const out = await late.collect();
    expect(out).not.toContain("event: a\n");
    expect(out).toContain("event: d\n");
  });

  it("closing publishes a final event and closes subscribers", async () => {
    const bus = new EventBus({ bufferLimit: 10 });
    const sub = captureStream();
    bus.subscribe("s", sub.writer);
    bus.publish("notification", "before");
    await bus.close({ event: "done", data: { status: "ok" } });
    expect(bus.isClosed).toBe(true);
    expect(bus.subscriberCount()).toBe(0);

    const out = await sub.collect();
    expect(out).toContain("event: notification");
    expect(out).toContain("event: done");
    expect(out).toContain('"status":"ok"');
  });

  it("rejects new subscriptions after close", async () => {
    const bus = new EventBus();
    await bus.close();
    const sub = captureStream();
    const result = bus.subscribe("late", sub.writer);
    expect(result.replayed).toBe(0);
    expect(bus.subscriberCount()).toBe(0);
  });

  it("explicit disconnect removes a subscriber", async () => {
    const bus = new EventBus();
    const sub = captureStream();
    const { unsubscribe } = bus.subscribe("s", sub.writer);
    expect(bus.subscriberCount()).toBe(1);
    unsubscribe();
    expect(bus.subscriberCount()).toBe(0);
    bus.publish("x", 1);
    await bus.close();
    const out = await sub.collect();
    // We already unsubscribed, so we don't see the x frame
    expect(out).not.toContain("event: x");
  });
});
