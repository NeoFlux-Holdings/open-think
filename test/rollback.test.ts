import { describe, expect, it } from "vitest";
import { planMcpRollback, listMcpRollbackSupport } from "../src/rollback";

describe("listMcpRollbackSupport", () => {
  it("lists every registered mapping", () => {
    const list = listMcpRollbackSupport();
    expect(list.length).toBeGreaterThan(5);
    expect(list.map((e) => e.tool)).toContain("kv_namespace_create");
    expect(list.map((e) => e.tool)).toContain("d1_database_create");
    expect(list.find((e) => e.tool === "r2_bucket_create")?.inverse).toBe("r2_bucket_delete");
  });
});

describe("planMcpRollback", () => {
  it("builds the kv_namespace_delete inverse from the creation response", () => {
    const rollback = planMcpRollback(
      "kv_namespace_create",
      { title: "sessions" },
      { result: { id: "ns-abc", title: "sessions" } }
    );
    expect(rollback).toMatchObject({
      skill: "mcp-call-tool",
      input: {
        name: "kv_namespace_delete",
        arguments: { namespace_id: "ns-abc" }
      },
      label: "Delete KV namespace",
      producedBy: "kv_namespace_create"
    });
  });

  it("reaches into content[].text JSON for DeepSeek-style MCP responses", () => {
    const rollback = planMcpRollback(
      "d1_database_create",
      { name: "app" },
      {
        content: [
          { type: "text", text: JSON.stringify({ uuid: "db-123", name: "app" }) }
        ]
      }
    );
    expect(rollback?.input).toMatchObject({
      name: "d1_database_delete",
      arguments: { database_id: "db-123" }
    });
  });

  it("falls back to input fields when the response omits an id", () => {
    const rollback = planMcpRollback(
      "r2_bucket_create",
      { name: "artifacts" },
      { result: {} }
    );
    expect(rollback?.input).toMatchObject({
      name: "r2_bucket_delete",
      arguments: { bucket_name: "artifacts" }
    });
  });

  it("returns null when the tool is not in the registry", () => {
    const rollback = planMcpRollback("whatever_custom_tool", { foo: "bar" }, {});
    expect(rollback).toBeNull();
  });

  it("returns null when the response lacks the required id and input does too", () => {
    const rollback = planMcpRollback("d1_database_create", {}, { result: {} });
    expect(rollback).toBeNull();
  });

  it("handles dns_record_create with both zone_id and id", () => {
    const rollback = planMcpRollback(
      "dns_record_create",
      { zone_id: "zone-1", type: "A", name: "foo.example.com", content: "1.2.3.4" },
      { result: { id: "rec-9" } }
    );
    expect(rollback?.input).toMatchObject({
      name: "dns_record_delete",
      arguments: { zone_id: "zone-1", dns_record_id: "rec-9" }
    });
  });

  it("builds worker_delete from the input name (creation response often omits id)", () => {
    const rollback = planMcpRollback("worker_create", { script_name: "my-worker" }, {});
    expect(rollback?.input).toMatchObject({
      name: "worker_delete",
      arguments: { script_name: "my-worker" }
    });
  });
});
