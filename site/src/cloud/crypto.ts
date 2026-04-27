/**
 * Token encryption for Helm Cloud — AES-256-GCM under a single master key
 * stored as a Worker secret (`CLOUD_MASTER_KEY`).
 *
 * Threat model:
 *   - D1 leak alone is harmless (ciphertext only, fresh IV per record).
 *   - Master-key leak alone is harmless (no ciphertext to decrypt).
 *   - Both at once → attacker can recover tokens. Mitigation: instruct
 *     customers to revoke their token at dash → API Tokens after any
 *     suspected incident; rotate `CLOUD_MASTER_KEY` and re-encrypt
 *     everything (a one-shot migration).
 *
 * Why AES-GCM and not envelope encryption? GCM gives us authenticated
 * encryption in 32 lines via SubtleCrypto. Envelope encryption (per-
 * deployment data key wrapped under a master KEK) is the standard cloud-
 * KMS pattern but adds complexity without a meaningful security win at
 * our scale — we have one master key and we control the runtime.
 */

const KEY_USAGE: KeyUsage[] = ["encrypt", "decrypt"];
const IV_BYTES = 12;

function urlB64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function urlB64Decode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toAB(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/**
 * Derive an AES-256 key from the Worker's master secret. We hash the secret
 * with SHA-256 to get a 32-byte key regardless of how the operator entered
 * it (random hex, passphrase, etc.). For real KEK rotation you'd version
 * the key id; v1 is single-version.
 */
async function deriveAesKey(masterSecret: string): Promise<CryptoKey> {
  if (!masterSecret || masterSecret.length < 16) {
    throw new Error("CLOUD_MASTER_KEY must be at least 16 chars; generate one with `openssl rand -hex 32`.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(masterSecret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, KEY_USAGE);
}

export interface EncryptedToken {
  ciphertextB64: string;
  ivB64: string;
}

/**
 * Encrypt a CF API token. Returns base64url-encoded ciphertext + IV that
 * the deployments table stores verbatim. Callers who don't have a master
 * key configured get a clear error (we fail closed rather than store
 * plaintext).
 */
export async function encryptCfToken(
  plaintext: string,
  masterSecret: string
): Promise<EncryptedToken> {
  const key = await deriveAesKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toAB(iv) },
    key,
    toAB(new TextEncoder().encode(plaintext))
  );
  return {
    ciphertextB64: urlB64Encode(new Uint8Array(buf)),
    ivB64: urlB64Encode(iv)
  };
}

/**
 * Decrypt a CF API token. Throws if the ciphertext is malformed, the IV
 * doesn't match, or the master key has rotated.
 */
export async function decryptCfToken(
  encrypted: EncryptedToken,
  masterSecret: string
): Promise<string> {
  const key = await deriveAesKey(masterSecret);
  const iv = urlB64Decode(encrypted.ivB64);
  const ciphertext = urlB64Decode(encrypted.ciphertextB64);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toAB(iv) },
    key,
    toAB(ciphertext)
  );
  return new TextDecoder().decode(buf);
}

/**
 * Generate a 32-byte URL-safe random token used as a manage-page handle.
 * Independent of the master key — these don't decrypt anything; they just
 * authorize hitting `/cloud/manage` without re-OAuth.
 */
export function generateManageToken(): string {
  return urlB64Encode(crypto.getRandomValues(new Uint8Array(32)));
}

/** Exported for testing the b64url roundtrip. */
export const _testing = { urlB64Encode, urlB64Decode };
