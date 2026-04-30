import { describe, expect, it } from "vitest";
import { mergeTomlBlock, parseTomlBindings, diffBindings } from "../src/plugins/helmToml";

describe("parseTomlBindings", () => {
  it("extracts r2 + d1 + kv + ai bindings", () => {
    const toml = [
      `name = "helm"`,
      ``,
      `[ai]`,
      `binding = "AI"`,
      ``,
      `[[r2_buckets]]`,
      `binding = "WORKSPACE"`,
      `bucket_name = "helm-persist"`,
      ``,
      `[[d1_databases]]`,
      `binding = "DB"`,
      `database_name = "helm-pa"`,
      `database_id = "uuid-1"`,
      ``,
      `[[kv_namespaces]]`,
      `binding = "CACHE"`,
      `id = "abc"`
    ].join("\n");
    const bindings = parseTomlBindings(toml);
    expect(bindings).toEqual([
      { type: "r2_bucket", name: "WORKSPACE" },
      { type: "d1", name: "DB" },
      { type: "kv_namespace", name: "CACHE" },
      { type: "ai", name: "AI" }
    ]);
  });

  it("ignores blocks without a binding key", () => {
    const toml = `[[migrations]]\ntag = "v1"\nnew_classes = []`;
    expect(parseTomlBindings(toml)).toEqual([]);
  });
});

describe("mergeTomlBlock", () => {
  it("appends a brand-new array-table block", () => {
    const toml = `name = "helm"\n`;
    const snippet = `[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "x"`;
    const r = mergeTomlBlock(toml, snippet);
    expect(r.replaced).toBe(false);
    expect(r.unchanged).toBe(false);
    expect(r.next).toContain(`[[r2_buckets]]`);
    expect(r.next).toContain(`bucket_name = "x"`);
  });

  it("replaces an existing array-table block with the same binding", () => {
    const toml = [
      `[[r2_buckets]]`,
      `binding = "WORKSPACE"`,
      `bucket_name = "old"`,
      ``
    ].join("\n");
    const snippet = `[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "new"`;
    const r = mergeTomlBlock(toml, snippet);
    expect(r.replaced).toBe(true);
    expect(r.next).toContain(`bucket_name = "new"`);
    expect(r.next).not.toContain(`bucket_name = "old"`);
  });

  it("does not touch blocks with different binding name", () => {
    const toml = [
      `[[r2_buckets]]`,
      `binding = "OTHER"`,
      `bucket_name = "keep-me"`,
      ``
    ].join("\n");
    const snippet = `[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "new"`;
    const r = mergeTomlBlock(toml, snippet);
    expect(r.replaced).toBe(false);
    expect(r.next).toContain(`binding = "OTHER"`);
    expect(r.next).toContain(`bucket_name = "keep-me"`);
    expect(r.next).toContain(`binding = "WORKSPACE"`);
  });

  it("flags identical-block as unchanged (no-op)", () => {
    const snippet = `[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "x"`;
    const toml = snippet + "\n";
    const r = mergeTomlBlock(toml, snippet);
    expect(r.unchanged).toBe(true);
    expect(r.replaced).toBe(false);
  });

  it("merges single-table [ai] in place", () => {
    const toml = `[ai]\nbinding = "OLD"\n`;
    const snippet = `[ai]\nbinding = "AI"`;
    const r = mergeTomlBlock(toml, snippet);
    expect(r.replaced).toBe(true);
    expect(r.next).toContain(`binding = "AI"`);
    expect(r.next).not.toContain(`binding = "OLD"`);
  });
});

describe("diffBindings", () => {
  it("flags live bindings missing from TOML", () => {
    const live = [
      { type: "r2_bucket", name: "WORKSPACE", bucket_name: "helm-persist" },
      { type: "d1", name: "DB", database_name: "helm-pa", database_id: "u-1" }
    ];
    const toml = `[[r2_buckets]]\nbinding = "WORKSPACE"\nbucket_name = "helm-persist"\n`;
    const r = diffBindings(live, toml);
    expect(r.missingFromToml).toHaveLength(1);
    expect(r.missingFromToml[0]).toMatchObject({ type: "d1", name: "DB" });
    expect(r.missingFromLive).toHaveLength(0);
  });

  it("flags TOML bindings missing from live", () => {
    const live = [{ type: "r2_bucket", name: "WORKSPACE" }];
    const toml = [
      `[[r2_buckets]]`,
      `binding = "WORKSPACE"`,
      `bucket_name = "x"`,
      ``,
      `[[d1_databases]]`,
      `binding = "DB"`,
      `database_name = "y"`,
      `database_id = "z"`
    ].join("\n");
    const r = diffBindings(live, toml);
    expect(r.missingFromLive).toHaveLength(1);
    expect(r.missingFromLive[0]).toMatchObject({ type: "d1", name: "DB" });
    expect(r.missingFromToml).toHaveLength(0);
  });

  it("returns clean when fully in sync", () => {
    const live = [
      { type: "r2_bucket", name: "WORKSPACE" },
      { type: "ai", name: "AI" }
    ];
    const toml = [
      `[ai]`,
      `binding = "AI"`,
      ``,
      `[[r2_buckets]]`,
      `binding = "WORKSPACE"`,
      `bucket_name = "x"`
    ].join("\n");
    const r = diffBindings(live, toml);
    expect(r.missingFromLive).toHaveLength(0);
    expect(r.missingFromToml).toHaveLength(0);
  });
});
