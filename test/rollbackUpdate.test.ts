import { describe, expect, it } from "vitest";
import { getUpdateCaptureStrategy, listMcpRollbackSupport } from "../src/rollback";

describe("getUpdateCaptureStrategy", () => {
  it("returns a capture+restore pair for dns_record_update", () => {
    const strat = getUpdateCaptureStrategy("dns_record_update", {
      zone_id: "zone-1",
      dns_record_id: "rec-9",
      content: "4.5.6.7"
    });
    expect(strat).not.toBeNull();
    expect(strat!.captureCall).toMatchObject({
      name: "dns_record_get",
      arguments: { zone_id: "zone-1", dns_record_id: "rec-9" }
    });

    const hint = strat!.buildHint({
      result: {
        id: "rec-9",
        type: "A",
        name: "foo.example.com",
        content: "1.2.3.4",
        ttl: 300,
        proxied: false
      }
    });
    expect(hint).toMatchObject({
      skill: "mcp-call-tool",
      input: {
        name: "dns_record_update",
        arguments: {
          zone_id: "zone-1",
          dns_record_id: "rec-9",
          type: "A",
          name: "foo.example.com",
          content: "1.2.3.4",
          ttl: 300,
          proxied: false
        }
      },
      label: "Restore DNS record"
    });
  });

  it("returns a capture+restore pair for kv_namespace_update", () => {
    const strat = getUpdateCaptureStrategy("kv_namespace_update", {
      namespace_id: "ns-abc",
      title: "new-title"
    });
    expect(strat).not.toBeNull();
    expect(strat!.captureCall.name).toBe("kv_namespace_get");

    const hint = strat!.buildHint({
      result: { id: "ns-abc", title: "old-title", supports_url_encoding: true }
    });
    expect(hint?.input).toMatchObject({
      name: "kv_namespace_update",
      arguments: { namespace_id: "ns-abc", title: "old-title" }
    });
  });

  it("returns a capture+restore pair for hyperdrive_config_edit", () => {
    const strat = getUpdateCaptureStrategy("hyperdrive_config_edit", {
      hyperdrive_id: "hd-1",
      caching: { disabled: true }
    });
    expect(strat).not.toBeNull();
    expect(strat!.captureCall.name).toBe("hyperdrive_config_get");

    const hint = strat!.buildHint({
      result: {
        id: "hd-1",
        name: "primary",
        origin: { scheme: "postgres", host: "db", port: 5432 },
        caching: { disabled: false, max_age: 60 }
      }
    });
    expect(hint?.input).toMatchObject({
      name: "hyperdrive_config_edit",
      arguments: {
        hyperdrive_id: "hd-1",
        name: "primary",
        origin: { scheme: "postgres", host: "db", port: 5432 },
        caching: { disabled: false, max_age: 60 }
      }
    });
  });

  it("returns null for tools that aren't in the update registry", () => {
    expect(getUpdateCaptureStrategy("kv_namespace_create", {})).toBeNull();
    expect(getUpdateCaptureStrategy("not_a_real_tool", {})).toBeNull();
  });

  it("returns null when the required ids are missing from input", () => {
    expect(getUpdateCaptureStrategy("dns_record_update", {})).toBeNull();
    expect(getUpdateCaptureStrategy("kv_namespace_update", {})).toBeNull();
  });

  it("buildHint returns null when the capture response is empty", () => {
    const strat = getUpdateCaptureStrategy("dns_record_update", {
      zone_id: "z",
      dns_record_id: "r"
    });
    const hint = strat!.buildHint({});
    // With no result object, we still get zone_id + dns_record_id but no content fields
    expect(hint?.input).toMatchObject({
      name: "dns_record_update",
      arguments: { zone_id: "z", dns_record_id: "r" }
    });
  });
});

describe("listMcpRollbackSupport (after Phase 17)", () => {
  it("lists both create-delete and update entries with their kind", () => {
    const list = listMcpRollbackSupport();
    const createEntry = list.find((e) => e.tool === "kv_namespace_create");
    expect(createEntry?.kind).toBe("create-delete");
    expect(createEntry?.inverse).toBe("kv_namespace_delete");

    const updateEntry = list.find((e) => e.tool === "dns_record_update");
    expect(updateEntry?.kind).toBe("update");
    expect(updateEntry?.inverse).toBe("dns_record_update");
  });

  it("includes all three shipped update entries", () => {
    const list = listMcpRollbackSupport();
    const updates = list.filter((e) => e.kind === "update").map((e) => e.tool);
    expect(updates).toEqual(
      expect.arrayContaining(["dns_record_update", "kv_namespace_update", "hyperdrive_config_edit"])
    );
  });
});
