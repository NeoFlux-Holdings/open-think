import { describe, expect, it } from "vitest";
import { MetricsStore } from "../src/core/metrics";

describe("MetricsStore", () => {
  it("tracks request, error, and invoke counters", () => {
    const store = new MetricsStore();

    store.recordRequest(10);
    store.recordRequest(20);
    store.recordError();
    store.recordPluginInvoke();
    store.recordSkillInvoke();

    const snapshot = store.snapshot();

    expect(snapshot.requestsTotal).toBe(2);
    expect(snapshot.errorsTotal).toBe(1);
    expect(snapshot.pluginInvokes).toBe(1);
    expect(snapshot.skillInvokes).toBe(1);
    expect(snapshot.avgDurationMs).toBe(15);
  });
});
