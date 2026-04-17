import type { MetricsSnapshot } from "./metrics";

export interface AlertEvaluation {
  triggered: boolean;
  errorRatePct: number;
  thresholdPct: number;
  reason: string;
}

export function evaluateErrorRateAlert(
  metrics: MetricsSnapshot,
  thresholdPct: number
): AlertEvaluation {
  const errorRatePct = metrics.requestsTotal > 0 ? (metrics.errorsTotal / metrics.requestsTotal) * 100 : 0;
  const triggered = metrics.requestsTotal > 0 && errorRatePct >= thresholdPct;

  return {
    triggered,
    errorRatePct,
    thresholdPct,
    reason: triggered
      ? `error rate ${errorRatePct.toFixed(2)}% exceeded threshold ${thresholdPct.toFixed(2)}%`
      : `error rate ${errorRatePct.toFixed(2)}% within threshold ${thresholdPct.toFixed(2)}%`
  };
}

export async function sendAlertWebhook(
  fetchImpl: typeof globalThis.fetch,
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<void> {
  await fetchImpl(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
