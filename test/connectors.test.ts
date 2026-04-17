import { describe, expect, it } from "vitest";
import { JsonHttpConnector } from "../src/core/connectors";

describe("JsonHttpConnector", () => {
  it("sends default headers and parses JSON", async () => {
    let capturedAuth = "";

    const connector = new JsonHttpConnector(
      async (_input, init) => {
        capturedAuth = (init?.headers as Record<string, string>).Authorization;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      {
        baseUrl: "https://api.example.com",
        defaultHeaders: { Authorization: "Bearer demo" }
      }
    );

    const response = await connector.get("/health");

    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ ok: true });
    expect(capturedAuth).toBe("Bearer demo");
  });
});
