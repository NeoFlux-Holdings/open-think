/**
 * In-memory pub/sub for Server-Sent Event frames with a bounded replay buffer.
 *
 * Designed to live inside a Durable Object so multiple subscribers (e.g. browser
 * tabs) can watch the same upstream stream. The replay buffer ensures a late joiner
 * picks up recent history rather than starting mid-thought.
 */

export interface BufferedEvent {
  event: string;
  data: string;
  ts: number;
}

export interface EventBusOptions {
  /** Maximum events retained for replay. */
  bufferLimit?: number;
}

interface Subscriber {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  joinedAt: number;
  alive: boolean;
}

export class EventBus {
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly buffer: BufferedEvent[] = [];
  private readonly encoder = new TextEncoder();
  private readonly bufferLimit: number;
  private closed = false;

  constructor(options: EventBusOptions = {}) {
    this.bufferLimit = options.bufferLimit ?? 500;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  subscriberCount(): number {
    let count = 0;
    for (const s of this.subscribers.values()) if (s.alive) count += 1;
    return count;
  }

  bufferedEvents(): ReadonlyArray<BufferedEvent> {
    return this.buffer.slice();
  }

  publish(event: string, data: unknown): void {
    if (this.closed) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const record: BufferedEvent = { event, data: payload, ts: Date.now() };
    this.buffer.push(record);
    while (this.buffer.length > this.bufferLimit) {
      this.buffer.shift();
    }
    const frame = this.encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
    for (const sub of this.subscribers.values()) {
      if (!sub.alive) continue;
      this.tryWrite(sub, frame);
    }
  }

  subscribe(id: string, writer: WritableStreamDefaultWriter<Uint8Array>): {
    unsubscribe: () => void;
    replayed: number;
  } {
    if (this.closed) {
      // Close the subscriber immediately — session is already over.
      writer.close().catch(() => undefined);
      return { unsubscribe: () => undefined, replayed: 0 };
    }
    const sub: Subscriber = { id, writer, joinedAt: Date.now(), alive: true };
    this.subscribers.set(id, sub);

    let replayed = 0;
    for (const evt of this.buffer) {
      if (!sub.alive) break;
      const frame = this.encoder.encode(`event: ${evt.event}\ndata: ${evt.data}\n\n`);
      this.tryWrite(sub, frame);
      replayed += 1;
    }

    return {
      unsubscribe: () => this.disconnect(id),
      replayed
    };
  }

  disconnect(id: string): void {
    const sub = this.subscribers.get(id);
    if (!sub) return;
    sub.alive = false;
    this.subscribers.delete(id);
    sub.writer.close().catch(() => undefined);
  }

  async close(finalEvent?: { event: string; data: unknown }): Promise<void> {
    if (this.closed) return;
    // Publish the terminal event BEFORE flipping `closed`, so subscribers actually see it.
    if (finalEvent) {
      this.publish(finalEvent.event, finalEvent.data);
    }
    this.closed = true;
    const closings: Promise<void>[] = [];
    for (const sub of this.subscribers.values()) {
      sub.alive = false;
      closings.push(sub.writer.close().catch(() => undefined));
    }
    this.subscribers.clear();
    await Promise.all(closings);
  }

  private tryWrite(sub: Subscriber, chunk: Uint8Array): void {
    sub.writer.write(chunk).catch(() => {
      sub.alive = false;
      this.subscribers.delete(sub.id);
    });
  }
}
