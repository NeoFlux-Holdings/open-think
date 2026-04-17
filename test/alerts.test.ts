import { describe, expect, it } from "vitest";
import { evaluateErrorRateAlert } from "../src/core/alerts";

describe("evaluateErrorRateAlert", () => {
  it("triggers when error rate exceeds threshold", () => {
    const result = evaluateErrorRateAlert(
      {
        requestsTotal: 10,
        errorsTotal: 2,
        pluginInvokes: 0,
        skillInvokes: 0,
        avgDurationMs: 10
      },
      10
    );

    expect(result.triggered).toBe(true);
    expect(result.errorRatePct).toBe(20);
  });

  it("does not trigger when under threshold", () => {
    const result = evaluateErrorRateAlert(
      {
        requestsTotal: 10,
        errorsTotal: 0,
        pluginInvokes: 0,
        skillInvokes: 0,
        avgDurationMs: 10
      },
      10
    );

    expect(result.triggered).toBe(false);
  });
});
