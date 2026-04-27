/**
 * Token-encryption round-trip tests.
 *
 * If these pass, AES-256-GCM with a SHA-256-derived key from
 * `CLOUD_MASTER_KEY` reliably encrypts → stores → decrypts a CF API token.
 * Anything else (key drift, IV reuse, plaintext leaks) breaks the privacy
 * promise of Helm Cloud, so these are the most important tests in this
 * directory.
 */
import { describe, expect, it } from "vitest";
import { _testing, decryptCfToken, encryptCfToken, generateManageToken } from "../src/cloud/crypto";

const MASTER = "x".repeat(64); // 64-char dummy that meets the 16-min check

describe("encryptCfToken / decryptCfToken", () => {
  it("round-trips a typical CF token", async () => {
    const plaintext = "abc123-456def-789-cf-api-token-real";
    const enc = await encryptCfToken(plaintext, MASTER);
    expect(enc.ciphertextB64).not.toBe(plaintext);
    expect(enc.ciphertextB64.length).toBeGreaterThan(0);
    expect(enc.ivB64.length).toBeGreaterThan(0);
    const back = await decryptCfToken(enc, MASTER);
    expect(back).toBe(plaintext);
  });

  it("uses a fresh IV each call (same plaintext → different ciphertext)", async () => {
    const plaintext = "same-token";
    const a = await encryptCfToken(plaintext, MASTER);
    const b = await encryptCfToken(plaintext, MASTER);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
    expect(await decryptCfToken(a, MASTER)).toBe(plaintext);
    expect(await decryptCfToken(b, MASTER)).toBe(plaintext);
  });

  it("decrypt with the wrong master key fails", async () => {
    const enc = await encryptCfToken("secret", MASTER);
    await expect(decryptCfToken(enc, "y".repeat(64))).rejects.toThrow();
  });

  it("rejects a master key shorter than 16 chars", async () => {
    await expect(encryptCfToken("any", "short")).rejects.toThrowError(/at least 16/);
  });

  it("survives unicode and long tokens", async () => {
    const plaintext =
      "abc 🌱 ".repeat(20) + "X".repeat(500);
    const enc = await encryptCfToken(plaintext, MASTER);
    expect(await decryptCfToken(enc, MASTER)).toBe(plaintext);
  });
});

describe("generateManageToken", () => {
  it("produces a URL-safe 32-byte token", () => {
    const t = generateManageToken();
    // base64url of 32 bytes is 43 chars, no padding.
    expect(t.length).toBe(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("doesn't repeat across calls", () => {
    const a = generateManageToken();
    const b = generateManageToken();
    expect(a).not.toBe(b);
  });
});

describe("_testing.urlB64Encode/Decode", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 2, 254, 255, 128, 64]);
    const encoded = _testing.urlB64Encode(original);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = _testing.urlB64Decode(encoded);
    expect([...decoded]).toEqual([...original]);
  });
});
