export interface MetricsSnapshot {
  requestsTotal: number;
  errorsTotal: number;
  pluginInvokes: number;
  skillInvokes: number;
  avgDurationMs: number;
}

export class MetricsStore {
  private requestsTotal = 0;
  private errorsTotal = 0;
  private pluginInvokes = 0;
  private skillInvokes = 0;
  private durationSumMs = 0;

  recordRequest(durationMs: number): void {
    this.requestsTotal += 1;
    this.durationSumMs += durationMs;
  }

  recordError(): void {
    this.errorsTotal += 1;
  }

  recordPluginInvoke(): void {
    this.pluginInvokes += 1;
  }

  recordSkillInvoke(): void {
    this.skillInvokes += 1;
  }

  snapshot(): MetricsSnapshot {
    return {
      requestsTotal: this.requestsTotal,
      errorsTotal: this.errorsTotal,
      pluginInvokes: this.pluginInvokes,
      skillInvokes: this.skillInvokes,
      avgDurationMs: this.requestsTotal > 0 ? this.durationSumMs / this.requestsTotal : 0
    };
  }
}

export const metricsStore = new MetricsStore();
