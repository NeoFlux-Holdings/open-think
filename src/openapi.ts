export function openapiDocument(): object {
  return {
    openapi: "3.0.3",
    info: {
      title: "Open Think Agent Runtime",
      version: "0.2.0",
      description:
        "Cloudflare-native agent runtime inspired by Project Think. Exposes plugin and skill invocation plus a Durable Object-backed session API."
    },
    paths: {
      "/health": {
        get: {
          summary: "Liveness + plugin/skill counts",
          responses: { "200": { description: "ok" } }
        }
      },
      "/plugins": {
        get: {
          summary: "Loaded plugin metadata",
          responses: { "200": { description: "ok" } }
        }
      },
      "/skills": {
        get: {
          summary: "Available skills",
          responses: { "200": { description: "ok" } }
        }
      },
      "/metrics": {
        get: {
          summary: "In-memory counters",
          responses: { "200": { description: "ok" } }
        }
      },
      "/alerts/check": {
        post: {
          summary: "Evaluate error-rate alert, optionally fan-out to webhook",
          responses: { "200": { description: "ok" } }
        }
      },
      "/invoke/{pluginId}": {
        post: {
          summary: "Invoke a plugin action",
          parameters: [
            { name: "pluginId", in: "path", required: true, schema: { type: "string" } }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    action: { type: "string" },
                    input: {}
                  }
                }
              }
            }
          },
          responses: { "200": { description: "ok" } }
        }
      },
      "/skills/invoke/{skillId}": {
        post: {
          summary: "Invoke a predefined skill",
          parameters: [
            { name: "skillId", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/init": {
        post: {
          summary: "Initialize (or attach to) an agent session",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}": {
        get: {
          summary: "Describe a session",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/messages": {
        get: {
          summary: "List messages (flat, chronological)",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        },
        post: {
          summary: "Append a message to the session tree",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/tree": {
        get: {
          summary: "Return session messages as a tree",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/fork": {
        post: {
          summary: "Fork a new session from a given message id",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/compact": {
        post: {
          summary: "Record a compaction summary message",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/search": {
        post: {
          summary: "Search session messages by substring",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/fibers": {
        get: {
          summary: "List recent fibers (durable, idempotent jobs) in this session",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } }
        },
        post: {
          summary: "Upsert a fiber by idempotency key (first writer wins)",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["idempotencyKey"],
                  properties: {
                    idempotencyKey: { type: "string" },
                    input: {},
                    result: {},
                    status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
                    error: { type: "string" }
                  }
                }
              }
            }
          },
          responses: { "200": { description: "ok" } }
        }
      },
      "/sessions/{name}/fibers/{id}": {
        get: {
          summary: "Fetch a fiber by id",
          parameters: [
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: { "200": { description: "ok" } }
        }
      }
    }
  };
}
