/**
 * MCP rollback registry.
 *
 * Small, explicit table of "for this Cloudflare MCP tool call, here's the inverse".
 * Helm attaches a `rollback` hint to tool-result messages when the
 * executed tool matches the registry; users can later hit `POST /sessions/:name/rollback`
 * to execute the inverse.
 *
 * This is intentionally conservative — only operations where the inverse is
 * unambiguous are registered. Operations that mutate existing rows (DNS updates,
 * zone settings, etc.) need a before/after diff, which is a different primitive
 * entirely. Those fall through to "no rollback available".
 */

export interface RollbackHint {
  /** Skill id to call to undo (always `mcp-call-tool` for CF MCP operations). */
  skill: string;
  /** Input payload for the undo call. */
  input: Record<string, unknown>;
  /** Human-readable label shown on the Undo button. */
  label: string;
  /** Short sentence for audit log / UI tooltip. */
  notes: string;
  /** Provenance: which MCP tool produced this hint. */
  producedBy: string;
}

export interface ResponseLens {
  (response: unknown): Record<string, unknown> | null;
}

interface CreateDeleteEntry {
  kind: "create-delete";
  /** MCP tool name that was called. */
  mcpTool: string;
  /** Inverse MCP tool name. */
  inverseMcpTool: string;
  /** Label shown on the Undo button. */
  label: string;
  /** How to build the inverse call's input from (originalInput, originalResponse). */
  build: (
    originalInput: Record<string, unknown>,
    response: unknown
  ) => Record<string, unknown> | null;
}

interface UpdateEntry {
  kind: "update";
  /** MCP tool name of the update. */
  mcpTool: string;
  /** MCP tool to call to read the current state before mutating. */
  captureTool: string;
  /** MCP tool used to restore the prior state (usually the same as `mcpTool`). */
  restoreTool: string;
  /** Label shown on the Undo button. */
  label: string;
  /** Build the input payload for the capture call given the original update input. */
  buildCaptureInput: (
    originalInput: Record<string, unknown>
  ) => Record<string, unknown> | null;
  /** Build the restore call's input from (originalInput, captureResponse). */
  buildRestoreInput: (
    originalInput: Record<string, unknown>,
    beforeResponse: unknown
  ) => Record<string, unknown> | null;
}

type RegistryEntry = CreateDeleteEntry | UpdateEntry;

function pickString(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function findResultObject(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;
  if (r.result && typeof r.result === "object") return r.result as Record<string, unknown>;
  // MCP call responses sometimes nest under `content` or `data`.
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") {
          try {
            const parsed = JSON.parse(b.text);
            if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
          } catch {
            // not JSON, ignore
          }
        }
      }
    }
  }
  return r;
}

/**
 * Registry. Lazy-evaluated so new entries can be appended without plumbing.
 *
 * For CF MCP operations, the inverse tool names follow the `<resource>_<verb>`
 * convention documented in Cloudflare's MCP server.
 */
export const MCP_ROLLBACK_REGISTRY: RegistryEntry[] = [
  {
    kind: "create-delete",
    mcpTool: "kv_namespace_create",
    inverseMcpTool: "kv_namespace_delete",
    label: "Delete KV namespace",
    build: (input, response) => {
      const result = findResultObject(response);
      const id = pickString(result, "id", "namespace_id") ?? pickString(input, "id");
      if (!id) return null;
      return { name: "kv_namespace_delete", arguments: { namespace_id: id } };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "d1_database_create",
    inverseMcpTool: "d1_database_delete",
    label: "Delete D1 database",
    build: (input, response) => {
      const result = findResultObject(response);
      const id = pickString(result, "uuid", "id") ?? pickString(input, "uuid");
      if (!id) return null;
      return { name: "d1_database_delete", arguments: { database_id: id } };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "r2_bucket_create",
    inverseMcpTool: "r2_bucket_delete",
    label: "Delete R2 bucket",
    build: (input, response) => {
      const result = findResultObject(response);
      const bucketName = pickString(result, "name") ?? pickString(input, "name", "bucket_name");
      if (!bucketName) return null;
      return { name: "r2_bucket_delete", arguments: { bucket_name: bucketName } };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "hyperdrive_config_create",
    inverseMcpTool: "hyperdrive_config_delete",
    label: "Delete Hyperdrive config",
    build: (_input, response) => {
      const result = findResultObject(response);
      const id = pickString(result, "id", "hyperdrive_id");
      if (!id) return null;
      return { name: "hyperdrive_config_delete", arguments: { hyperdrive_id: id } };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "ai_gateway_create",
    inverseMcpTool: "ai_gateway_delete",
    label: "Delete AI Gateway",
    build: (input, response) => {
      const result = findResultObject(response);
      const id = pickString(result, "id", "gateway_id") ?? pickString(input, "id");
      if (!id) return null;
      return { name: "ai_gateway_delete", arguments: { gateway_id: id } };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "dns_record_create",
    inverseMcpTool: "dns_record_delete",
    label: "Delete DNS record",
    build: (input, response) => {
      const result = findResultObject(response);
      const id = pickString(result, "id");
      const zoneId = pickString(input, "zone_id");
      if (!id || !zoneId) return null;
      return {
        name: "dns_record_delete",
        arguments: { zone_id: zoneId, dns_record_id: id }
      };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "worker_create",
    inverseMcpTool: "worker_delete",
    label: "Delete Worker script",
    build: (input, _response) => {
      const name = pickString(input, "name", "script_name");
      if (!name) return null;
      return { name: "worker_delete", arguments: { script_name: name } };
    }
  },
  {
    kind: "create-delete",
    mcpTool: "queue_create",
    inverseMcpTool: "queue_delete",
    label: "Delete Queue",
    build: (input, response) => {
      const result = findResultObject(response);
      const id = pickString(result, "queue_id", "id");
      const name = pickString(result, "queue_name") ?? pickString(input, "queue_name", "name");
      if (id) return { name: "queue_delete", arguments: { queue_id: id } };
      if (name) return { name: "queue_delete", arguments: { queue_name: name } };
      return null;
    }
  },
  {
    kind: "update",
    mcpTool: "dns_record_update",
    captureTool: "dns_record_get",
    restoreTool: "dns_record_update",
    label: "Restore DNS record",
    buildCaptureInput: (input) => {
      const zoneId = pickString(input, "zone_id");
      const recordId = pickString(input, "dns_record_id", "id");
      if (!zoneId || !recordId) return null;
      return { zone_id: zoneId, dns_record_id: recordId };
    },
    buildRestoreInput: (input, beforeResponse) => {
      const result = findResultObject(beforeResponse);
      if (!result) return null;
      const zoneId = pickString(input, "zone_id");
      const recordId = pickString(input, "dns_record_id", "id") ?? pickString(result, "id");
      if (!zoneId || !recordId) return null;
      const restore: Record<string, unknown> = { zone_id: zoneId, dns_record_id: recordId };
      // Copy the fields a dns_record_update call typically accepts.
      for (const key of ["type", "name", "content", "ttl", "proxied", "priority", "data", "comment", "tags"]) {
        if (key in result) restore[key] = result[key];
      }
      return restore;
    }
  },
  {
    kind: "update",
    mcpTool: "kv_namespace_update",
    captureTool: "kv_namespace_get",
    restoreTool: "kv_namespace_update",
    label: "Restore KV namespace title",
    buildCaptureInput: (input) => {
      const id = pickString(input, "namespace_id", "id");
      if (!id) return null;
      return { namespace_id: id };
    },
    buildRestoreInput: (input, beforeResponse) => {
      const result = findResultObject(beforeResponse);
      if (!result) return null;
      const id = pickString(input, "namespace_id", "id") ?? pickString(result, "id");
      const title = pickString(result, "title");
      if (!id || !title) return null;
      return { namespace_id: id, title };
    }
  },
  {
    kind: "update",
    mcpTool: "hyperdrive_config_edit",
    captureTool: "hyperdrive_config_get",
    restoreTool: "hyperdrive_config_edit",
    label: "Restore Hyperdrive config",
    buildCaptureInput: (input) => {
      const id = pickString(input, "hyperdrive_id", "id");
      if (!id) return null;
      return { hyperdrive_id: id };
    },
    buildRestoreInput: (input, beforeResponse) => {
      const result = findResultObject(beforeResponse);
      if (!result) return null;
      const id = pickString(input, "hyperdrive_id", "id") ?? pickString(result, "id");
      if (!id) return null;
      const restore: Record<string, unknown> = { hyperdrive_id: id };
      for (const key of ["name", "origin", "caching", "mtls"]) {
        if (key in result) restore[key] = result[key];
      }
      return restore;
    }
  }
];

/**
 * Plan a rollback for a **create-delete** MCP tool call. Returns null when the
 * tool is not in the registry, is an update-style tool (those need pre-mutation
 * capture — see `getUpdateCaptureStrategy`), or the response lacks fields
 * needed to build the inverse.
 */
export function planMcpRollback(
  mcpToolName: string,
  originalInput: Record<string, unknown>,
  response: unknown
): RollbackHint | null {
  const entry = MCP_ROLLBACK_REGISTRY.find(
    (e): e is CreateDeleteEntry => e.kind === "create-delete" && e.mcpTool === mcpToolName
  );
  if (!entry) return null;
  const inverseInput = entry.build(originalInput, response);
  if (!inverseInput) return null;
  return {
    skill: "mcp-call-tool",
    input: inverseInput,
    label: entry.label,
    notes: `${entry.inverseMcpTool} inverse of ${entry.mcpTool}`,
    producedBy: entry.mcpTool
  };
}

/**
 * For **update-style** tools: returns a strategy object with the pre-mutation
 * capture call to run first and a builder that converts the capture's response
 * into a rollback hint. The caller (mcp-client plugin) is expected to:
 *
 *   1. Call `captureCall` before the mutation.
 *   2. Run the mutation.
 *   3. If both succeeded, invoke `buildHint(captureResponse)` and attach.
 *
 * Returns null when the tool is not an update-style entry, or when the capture
 * call can't be constructed from the input (missing ids, etc.).
 */
export function getUpdateCaptureStrategy(
  mcpToolName: string,
  originalInput: Record<string, unknown>
): {
  captureCall: { name: string; arguments: Record<string, unknown> };
  buildHint: (beforeResponse: unknown) => RollbackHint | null;
} | null {
  const entry = MCP_ROLLBACK_REGISTRY.find(
    (e): e is UpdateEntry => e.kind === "update" && e.mcpTool === mcpToolName
  );
  if (!entry) return null;
  const captureArgs = entry.buildCaptureInput(originalInput);
  if (!captureArgs) return null;
  return {
    captureCall: { name: entry.captureTool, arguments: captureArgs },
    buildHint: (beforeResponse) => {
      const restoreArgs = entry.buildRestoreInput(originalInput, beforeResponse);
      if (!restoreArgs) return null;
      return {
        skill: "mcp-call-tool",
        input: { name: entry.restoreTool, arguments: restoreArgs },
        label: entry.label,
        notes: `restore pre-update state of ${entry.mcpTool}`,
        producedBy: entry.mcpTool
      };
    }
  };
}

export function listMcpRollbackSupport(): Array<{
  tool: string;
  inverse: string;
  label: string;
  kind: "create-delete" | "update";
}> {
  return MCP_ROLLBACK_REGISTRY.map((e) =>
    e.kind === "create-delete"
      ? { tool: e.mcpTool, inverse: e.inverseMcpTool, label: e.label, kind: "create-delete" }
      : { tool: e.mcpTool, inverse: e.restoreTool, label: e.label, kind: "update" }
  );
}
