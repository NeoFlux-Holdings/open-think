# Plugin Capability Compatibility Matrix

This document defines the capability contract used by `AgentPlugin.capabilities`.

## Allowed capabilities

- `tools` — performs operational tool-style actions.
- `mcp` — integrates with MCP server workflows (inbound or outbound).
- `cloudflare-api` — performs Cloudflare API operations.
- `connectors` — talks to external providers/connectors.
- `models` — model/provider-specific model operations.
- `artifacts` — Cloudflare Artifacts repository operations.
- `admin` — runtime introspection and setup control (reserved for the `admin` plugin).

Runtime validation enforces:

1. Plugin IDs must be unique in the registry.
2. Each plugin must declare at least one capability.
3. Every declared capability must be in the allowed set above.

## First-party plugin mapping

| Plugin ID | Capabilities | Binding / secret required |
| --- | --- | --- |
| `admin` | `admin`, `tools` | `runtime` introspection handle (provided automatically) |
| `cloudflare-api-mcp` | `cloudflare-api`, `mcp`, `tools` | `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_AGENT_TOKEN` |
| `workers-ai` | `models`, `tools` | `env.AI` binding |
| `anthropic` | `models`, `connectors` | `ANTHROPIC_API_KEY` |
| `openai-compatible` | `models`, `connectors` | `OPENAI_COMPATIBLE_URL` (+ optional key) |
| `mcp-client` | `mcp`, `tools`, `connectors` | `MCP_DEFAULT_URL` (or per-call `serverUrl`) |
| `browser` | `tools`, `connectors` | `env.BROWSER` binding |
| `sandbox` | `tools`, `connectors` | `env.SANDBOX` service binding |
| `artifacts` | `artifacts`, `tools` | `env.ARTIFACTS` binding |
| `mpp` | `models`, `connectors` | `MPP_API_KEY` |

## Guidance for contributors

- Choose the smallest capability set that matches behavior.
- Do not mark capabilities "just in case".
- If a new capability is truly needed, update:
  - `src/core/plugin.ts` union type
  - `src/core/runtime.ts` capability validator set
  - this document
