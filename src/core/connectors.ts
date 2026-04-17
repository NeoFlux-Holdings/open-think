export interface ConnectorOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
}

export class JsonHttpConnector {
  constructor(
    private readonly fetchImpl: typeof globalThis.fetch,
    private readonly options: ConnectorOptions
  ) {}

  async get(path: string, headers?: Record<string, string>) {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        ...(this.options.defaultHeaders ?? {}),
        ...(headers ?? {})
      }
    });

    const data = await response.json<unknown>();
    return { ok: response.ok, status: response.status, data };
  }
}
