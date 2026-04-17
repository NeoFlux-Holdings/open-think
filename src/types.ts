export interface ArtifactRepoHandle {
  remote: string;
  token: string;
  fork(name: string, options?: { readOnly?: boolean }): Promise<ArtifactRepoHandle>;
}

export interface ArtifactsBinding {
  create(name: string): Promise<ArtifactRepoHandle>;
  get(name: string): Promise<ArtifactRepoHandle>;
  import(input: {
    source: { url: string; branch?: string };
    target: { name: string };
  }): Promise<{ remote: string; token: string }>;
}

export interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AGENT_TOKEN?: string;
  MPP_API_KEY?: string;
  ENABLED_PLUGINS: string;
  ALLOWED_HOSTS: string;
  MODEL_DEFAULT?: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_ERROR_RATE_PCT?: string;
  ARTIFACTS?: ArtifactsBinding;
}

export interface InvokeRequest {
  action: string;
  input?: unknown;
}
