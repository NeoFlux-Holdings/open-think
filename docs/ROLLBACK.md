# Rollback

Destructive Cloudflare MCP operations (creating KV namespaces, D1 databases, R2 buckets, DNS records, Workers, Queues, AI Gateways, Hyperdrive configs) now attach a **rollback hint** to the session message that records them. A single `POST /sessions/:name/apply-rollback` replays the inverse.

## The guarantee

- **Undo is always opt-in.** Rollback hints are attached, not auto-applied. The user decides when (or whether) to undo.
- **The registry is conservative.** Only operations with an unambiguous inverse are registered (see the table below). Operations that mutate existing state (DNS record updates, zone settings) need a before/after diff, which is a separate primitive entirely and is explicitly out of scope.
- **First apply wins.** Each pending rollback can be applied once; subsequent calls return `E_NO_ROLLBACK`.

## Registry (shipped)

### Create/delete — inverse generated from response at execution time

| Original MCP tool | Inverse | How we reconstruct the input |
| --- | --- | --- |
| `kv_namespace_create` | `kv_namespace_delete` | `id` / `namespace_id` from response |
| `d1_database_create` | `d1_database_delete` | `uuid` / `id` from response |
| `r2_bucket_create` | `r2_bucket_delete` | `name` from response, falling back to input |
| `hyperdrive_config_create` | `hyperdrive_config_delete` | `id` / `hyperdrive_id` from response |
| `ai_gateway_create` | `ai_gateway_delete` | `id` / `gateway_id` from response |
| `dns_record_create` | `dns_record_delete` | `zone_id` from input + `id` from response |
| `worker_create` | `worker_delete` | `script_name` / `name` from input |
| `queue_create` | `queue_delete` | `queue_id` from response, else `queue_name` |

### Update — pre-mutation capture, restore by re-applying the captured state

| Original MCP tool | Capture tool | Restore tool | What gets captured |
| --- | --- | --- | --- |
| `dns_record_update` | `dns_record_get` | `dns_record_update` | `type`, `name`, `content`, `ttl`, `proxied`, `priority`, `data`, `comment`, `tags` |
| `kv_namespace_update` | `kv_namespace_get` | `kv_namespace_update` | `title` |
| `hyperdrive_config_edit` | `hyperdrive_config_get` | `hyperdrive_config_edit` | `name`, `origin`, `caching`, `mtls` |

For update-style entries, the `mcp-client` plugin automatically runs the capture tool before the mutation. If the capture fails, the mutation still runs but no rollback hint is attached (and the plugin logs the capture failure). If the capture succeeds, the rollback hint re-applies the captured fields when Undo is tapped.

See [`src/rollback.ts`](../src/rollback.ts) for the full `build()` / `buildCaptureInput()` / `buildRestoreInput()` logic per entry.

## Flow

```
User → Helm proposes mcp-call-tool(name="kv_namespace_create", ...)
User approves → /skills/invoke/mcp-call-tool runs
               ↓
mcp-client plugin gets the MCP response
               ↓
planMcpRollback(toolName, input, response) → returns a RollbackHint
               ↓
Plugin attaches the hint to result.data as _rollback
               ↓
Helm stores the tool message with { rollback: {...}, rollbackStatus: "available" }
               ↓
Later: POST /sessions/:name/apply-rollback (optionally with messageId)
               ↓
Runtime invokes the hint's skill with the hint's input
               ↓
Original message marked rollbackStatus = "applied"
               ↓
A new "role: tool" message records the rollback result + references the original id
```

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/sessions/:name/rollbacks` | GET | List messages with a pending rollback (most recent first, max 50) |
| `/sessions/:name/apply-rollback` | POST | Apply the rollback for `messageId` (or the most recent pending if omitted) |
| `/rollback/support` | GET | List every registered MCP tool + its inverse (registry introspection) |

## UI

- Every completed streaming turn calls `GET /sessions/:name/rollbacks` on completion and surfaces a warm-bordered **↻ Undo** card for each pending rollback.
- Clicking the Undo card posts to `/apply-rollback`, shows the inverse's result inline, and disables the button once applied.
- The Helm's system prompt describes rollbacks in plain terms so LLM-authored narration matches what the UI renders.

## Design decisions

**Why attach the hint at plugin execution time, not at Helm execution time?**

The plugin is the only place that sees the MCP tool call + its response together. Moving the logic up to the Helm would either (a) require re-parsing the response again or (b) make rollback Helm-specific and unavailable to direct `/skills/invoke` calls. Putting it in `mcp-client` means every path that invokes an MCP tool gets rollback-ready results automatically.

**Why store the hint in the session DO rather than a separate rollback log?**

Sessions already have a durable, ordered message stream. Attaching `rollback` to the message that recorded the mutation means:

- Undo UX is co-located with the action it reverses
- Rollback history is automatically scoped to the conversation
- No separate retention / cleanup logic

**Why not auto-rollback on errors?**

Most MCP errors leave nothing to roll back. And the rare case where a partial success needs reversal is better handled by a deliberate user decision than by a framework that thinks it knows better. The Helm can still propose a rollback as its next move if it judges the previous step undesirable.

## Extending the registry

Add an entry to [`MCP_ROLLBACK_REGISTRY`](../src/rollback.ts) with:

```ts
{
  mcpTool: "my_resource_create",
  inverseMcpTool: "my_resource_delete",
  label: "Delete my resource",
  build: (input, response) => {
    const result = findResultObject(response);
    const id = pickString(result, "id");
    return id ? { name: "my_resource_delete", arguments: { id } } : null;
  }
}
```

Return `null` from `build()` when you can't confidently construct the inverse — that produces a clean "no rollback available" UX rather than a broken undo.

## Roadmap

- More update-style entries — `worker_settings_put`, `zone_setting_update`, `queue_settings_update` once we verify the CF MCP tool names + field shapes.
- Multi-step rollback — undo the last N operations as a batch, not just the most recent.
- Rollback preview — dry-run mode that shows exactly what would be called before the user commits.
- Rollback-of-rollback — if a rollback fails, capture enough state to retry or manually reverse the attempted reversal.
- Before/after diff renderer — in the UI, show the captured state next to the current state so the user sees precisely what "undo" will restore.
