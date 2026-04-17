import { describe, expect, it, vi } from "vitest";
import { emitAuditEvent } from "../src/core/telemetry";

describe("emitAuditEvent", () => {
  it("writes structured JSON to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    emitAuditEvent({
      type: "request.info",
      requestId: "req-1",
      method: "GET",
      path: "/health",
      ok: true,
      durationMs: 12
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload.type).toBe("request.info");
    expect(payload.requestId).toBe("req-1");

    spy.mockRestore();
  });
});
