/**
 * Shared helpers for the Cloudflare Sandbox SDK.
 *
 * The /shell/ws and /shell/exec routes (src/index.ts) delegate to
 * `session.terminal(request)` and `session.exec(cmd, opts)` directly —
 * they don't need this file. These helpers exist for the OTHER callers
 * that used to hit the old `env.SHELL_CONTAINER.fetch("/exec")` proxy:
 *   - artifacts plugin (`git clone`, `git push`, etc. against the
 *     Artifacts remote — runs inside the sandbox so the long-lived
 *     token never reaches the Worker)
 *   - helm-toml + helm-setup plugins (drift checks, file mutations)
 *
 * Centralizing the call site means a future SDK upgrade or session-id
 * scheme change touches one file instead of four.
 */

import { getSandbox } from "@cloudflare/sandbox";
import type { Env } from "./types";

/**
 * Plain shape the artifact/helm-toml plugins consumed from the OLD
 * shell-container HTTP /exec endpoint. We translate Sandbox's
 * `ExecResult` to this so callers don't need to change.
 */
export interface ShellExecResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  /** Exit code; -1 when the call never reached the sandbox. */
  code: number;
  /** Wall-clock duration of the command. */
  durationMs?: number;
}

export interface ShellExecOptions {
  cwd?: string;
  /** Maximum wall-clock the command may run before sandbox kills it. */
  timeoutMs?: number;
  /** Override the per-user session id. Defaults to the helm-shell namespace's "default" session. */
  sessionId?: string;
}

/**
 * Run a single bash command inside the user's Helm Shell sandbox.
 * Returns the same `{ ok, stdout, stderr, code }` shape the legacy
 * shell-container proxy used so callers don't have to migrate.
 *
 * Returns `{ ok: false, code: -1, stderr: "..." }` when the Sandbox
 * binding isn't bound (deploy missing the wrangler.toml block) — same
 * fail-soft contract the artifacts plugin already expected.
 */
export async function execInSandbox(
  env: Env,
  cmd: string,
  options: ShellExecOptions = {}
): Promise<ShellExecResult> {
  if (!env.Sandbox) {
    return {
      ok: false,
      stderr: "Sandbox binding missing — redeploy with v0.13+ wrangler.toml (auto-set by /deploy/cloud)",
      code: -1
    };
  }
  try {
    const sandbox = getSandbox(env.Sandbox, "helm-shell");
    const session = await sandbox.getSession(options.sessionId ?? "default");
    const r = await session.exec(cmd, {
      cwd: options.cwd,
      timeout: options.timeoutMs
    });
    return {
      ok: r.success,
      stdout: r.stdout,
      stderr: r.stderr,
      code: r.exitCode,
      durationMs: r.duration
    };
  } catch (err) {
    return {
      ok: false,
      stderr: `Sandbox exec failed: ${err instanceof Error ? err.message : String(err)}`,
      code: -1
    };
  }
}
