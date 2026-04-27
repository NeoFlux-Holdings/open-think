/**
 * Unit-test stub for `cloudflare:workers`. We only need the bits the Helm
 * code imports — `WorkflowEntrypoint` and its companion types.
 */
export class WorkflowEntrypoint<TEnv = unknown, TParams = unknown> {
  readonly env: TEnv;
  readonly ctx: unknown;
  constructor(ctx: unknown, env: TEnv) {
    this.ctx = ctx;
    this.env = env;
  }
  async run(_event: WorkflowEvent<TParams>, _step: WorkflowStep): Promise<unknown> {
    return {};
  }
}

export interface WorkflowEvent<T> {
  payload: T;
  timestamp?: string;
  instanceId?: string;
}

export interface WorkflowStep {
  do<T>(
    name: string,
    configOrFn: unknown,
    fn?: () => Promise<T>
  ): Promise<T>;
  sleep?(name: string, duration: string): Promise<void>;
}

/**
 * DurableObject stub — Workers' base class. The companion bridge-worker's
 * CodexAuthDO extends this; we never instantiate it in unit tests.
 */
export class DurableObject<Env = unknown> {
  readonly ctx: unknown;
  readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
