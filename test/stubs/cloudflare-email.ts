/**
 * Unit-test stub for `cloudflare:email`. Mirrors the production shape.
 * Only `EmailMessage` is exported at the time of writing.
 */
export class EmailMessage {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly raw: string
  ) {}
}
