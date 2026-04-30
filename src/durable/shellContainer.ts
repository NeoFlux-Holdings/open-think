/**
 * ShellContainerDO — Cloudflare Container hosting an interactive bash
 * session, fronted by a Node WebSocket↔PTY bridge (see
 * docker/shell/server.mjs). One DO instance per session name; the
 * Container SDK auto-routes WebSocket upgrades from the Worker into
 * the underlying container.
 *
 * Lifecycle:
 *   - First request to a session wakes the container (~5–10s cold start)
 *   - sleepAfter=15m of WS idleness → SIGTERM → fresh disk next time
 *   - All disk is ephemeral (CF Containers spec). Persistent state must
 *     be written to D1/KV/R2 from the bash session via plugin commands
 *     OR via `wrangler` (if user installs it inside the shell).
 *
 * Auth: gated upstream by requireAuth() in src/index.ts. The container
 * itself binds to 0.0.0.0:7681 inside its private network — only the
 * Worker can reach it (CF Containers expose no public IP).
 *
 * Multi-tab: every connection to the same session lands on the same
 * container instance, but each WebSocket gets its own PTY (the bridge
 * spawns one per connection). Two browser tabs on session "default"
 * therefore share a container but see independent shells. We could
 * later add tmux multiplexing here so tabs share a single shell.
 *
 * Why a Container and not a Sandbox or pure DO? Containers give us a
 * real Linux userland with bash, git, vim, etc. — the value prop is
 * "shell access for the operator." Sandbox is more for one-shot exec.
 * DOs alone have no shell.
 */

import { Container } from "@cloudflare/containers";
import type { Env } from "../types";

export class ShellContainerDO extends Container<Env> {
  /** ttyd-style port the bridge listens on. Matches docker/shell/server.mjs. */
  defaultPort = 7681;

  /**
   * Auto-shutdown after 15 minutes of inactivity. The CF Container
   * scheduler counts "no incoming requests" as inactivity — open
   * WebSockets DO count as active, so a tab left open keeps it alive.
   */
  sleepAfter = "15m";

  /**
   * Env vars forwarded into the container's process environment. Three
   * groups:
   *
   *  1. Identity     — AGENT_NAME / AGENT_OWNER for prompt + scripts
   *  2. R2 persist   — credentials so entrypoint.sh can rclone-mount
   *                    /persist. All four must be set or the mount
   *                    is skipped (ephemeral disk only).
   *  3. helm REPL    — HELM_WORKER_HOST + HELM_INTERNAL_TOKEN so the
   *                    in-shell `helm` command can call back into the
   *                    conductor with bearer auth.
   */
  envVars = {
    HELM_AGENT_NAME: this.env.AGENT_NAME ?? "Helm",
    HELM_AGENT_OWNER: this.env.AGENT_OWNER ?? "you",
    // R2 persistence — set whichever you have; missing ones make /persist ephemeral
    R2_ACCOUNT_ID: this.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID ?? "",
    R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY ?? "",
    R2_BUCKET: this.env.R2_BUCKET ?? "",
    // helm REPL inside the container
    HELM_WORKER_HOST: this.env.HELM_WORKER_HOST ?? "",
    HELM_INTERNAL_TOKEN: this.env.HELM_INTERNAL_TOKEN ?? ""
  };

  /**
   * Allow outbound network so users can `git clone`, `curl`, `npm install`.
   * The container is on CF's network so it inherits CF's outbound DNS.
   */
  enableInternet = true;

  override async onStart(): Promise<void> {
    console.log(`[shell-container] start (sleepAfter=${this.sleepAfter})`);
  }

  override async onStop(): Promise<void> {
    console.log("[shell-container] stop");
  }

  override async onError(err: unknown): Promise<void> {
    console.error("[shell-container] error", err);
  }
}
