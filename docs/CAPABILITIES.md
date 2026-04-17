# Plugin Capability Compatibility Matrix

This document defines the capability contract used by `AgentPlugin.capabilities`.

## Allowed capabilities

- `tools` — performs operational tool-style actions.
- `mcp` — integrates with MCP server workflows.
- `cloudflare-api` — performs Cloudflare API operations.
- `connectors` — talks to external providers/connectors.
- `models` — model/provider-specific model operations.
- `artifacts` — Cloudflare Artifacts repository operations.

Runtime validation now enforces:

1. Plugin IDs must be unique in registry.
2. Each plugin must declare at least one capability.
3. Every declared capability must be in the allowed set above.

## First-party plugin mapping

| Plugin ID | Capabilities |
| --- | --- |
| `cloudflare-api-mcp` | `cloudflare-api`, `mcp`, `tools` |
| `mpp` | `models`, `connectors` |
| `artifacts` | `artifacts`, `tools` |

## Guidance for contributors

- Choose the smallest capability set that matches behavior.
- Do not mark capabilities "just in case".
- If a new capability is truly needed, update:
  - `src/core/plugin.ts` union type
  - `src/core/runtime.ts` capability validator set
  - this document
