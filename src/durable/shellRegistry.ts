/**
 * ShellRegistryDO — singleton DO that tracks active Helm Shell sessions.
 *
 * The CF Container product doesn't expose "list active instances" via DO
 * binding, so we maintain our own tiny registry keyed by session name.
 * Each /shell/ws upgrade `touch`es this DO; the Sessions panel in /app
 * reads it via /shell/list.
 *
 * Storage format:
 *   key: "s:<sessionName>"
 *   value: { session, email, firstSeen, lastSeen, connections }
 *
 * Stale sessions (lastSeen older than the configurable cutoff, default
 * 30 days) are filtered out on read; we never explicitly garbage-
 * collect. Container DOs themselves auto-sleep after 15 min, so the
 * registry just records "this user touched this session at some point".
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

export interface ShellSessionRecord {
  session: string;
  email: string;
  firstSeen: number;
  lastSeen: number;
  /** Concurrent open WS connections at last touch. UI uses this to show
   *  live/idle state — 0 = idle, >0 = at least one tab connected. */
  connections: number;
  /**
   * Estimated total seconds the container was kept awake by this
   * session. Approximated from heartbeat deltas: while connections>0,
   * we accumulate (now - lastSeen). Capped at HEARTBEAT_CAP_MS per
   * touch so a single zombie connection doesn't inflate the number.
   * Resets to 0 if explicitly forgotten.
   */
  awakeMs: number;
  /** Last connection state we saw. Used to reset the awake counter
   *  cleanly when the user reconnects after a long gap. */
  lastDirection: "open" | "close" | "init";
}

/**
 * Per-touch cap on awake time accumulation. Heartbeats fire on every
 * /shell/ws upgrade (not periodically), so a tab open for 8 hours with
 * only one upgrade looks like one big delta. Cap each delta at 30 min
 * so we don't over-count for tabs left open overnight.
 */
const HEARTBEAT_CAP_MS = 30 * 60 * 1000;

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class ShellRegistryDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/touch") {
      const body = (await request.json().catch(() => ({}))) as {
        session?: string;
        email?: string;
        delta?: number; // +1 on connect, -1 on close
      };
      const session = String(body.session ?? "").trim();
      const email = String(body.email ?? "anon").trim().toLowerCase();
      if (!session) return new Response("session required", { status: 400 });
      const key = `s:${session}`;
      const existing = (await this.ctx.storage.get<ShellSessionRecord>(key)) ?? null;
      const now = Date.now();
      const delta = typeof body.delta === "number" ? body.delta : 0;
      // Accumulate awake time while at least one connection is open.
      // We only bump on the same touch that's already-active (existing
      // connections>0); new opens start the clock from now.
      let awakeMs = existing?.awakeMs ?? 0;
      if (existing && existing.connections > 0 && existing.lastSeen) {
        const elapsed = Math.min(now - existing.lastSeen, HEARTBEAT_CAP_MS);
        if (elapsed > 0) awakeMs += elapsed;
      }
      const next: ShellSessionRecord = {
        session,
        email: existing?.email ?? email,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
        connections: Math.max(0, (existing?.connections ?? 0) + delta),
        awakeMs,
        lastDirection: delta > 0 ? "open" : delta < 0 ? "close" : "init"
      };
      await this.ctx.storage.put(key, next);
      return Response.json({ ok: true, data: next });
    }

    if (request.method === "GET" && url.pathname === "/list") {
      const filterEmail = url.searchParams.get("email")?.toLowerCase() ?? null;
      const map = await this.ctx.storage.list<ShellSessionRecord>({ prefix: "s:" });
      const cutoff = Date.now() - STALE_MS;
      const items: Array<ShellSessionRecord & { estCostUsd: number; awakeMsLive: number }> = [];
      const now = Date.now();
      // CF Containers "basic" instance pricing: ~$0.000017 per second of
      // active vCPU + memory. We approximate the all-in rate as $0.00002/s
      // (~$0.07/hr) — close enough for a UI hint, conservative on the high side.
      const RATE_PER_MS = 0.00002 / 1000;
      for (const v of map.values()) {
        if (v.lastSeen < cutoff) continue;
        if (filterEmail && v.email !== filterEmail) continue;
        // If still connected, add the live tail (capped at 30 min like
        // the touch handler) so the UI shows growing time without
        // depending on the next heartbeat.
        let liveAdd = 0;
        if (v.connections > 0) {
          liveAdd = Math.min(now - v.lastSeen, HEARTBEAT_CAP_MS);
        }
        const awakeMsLive = (v.awakeMs ?? 0) + liveAdd;
        const estCostUsd = awakeMsLive * RATE_PER_MS;
        items.push({ ...v, estCostUsd, awakeMsLive });
      }
      items.sort((a, b) => b.lastSeen - a.lastSeen);
      // Fleet totals (today only — anything since midnight UTC)
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const today = items.filter((i) => i.lastSeen >= todayStart.getTime());
      const totals = {
        sessions: items.length,
        live: items.filter((i) => i.connections > 0).length,
        awakeMsToday: today.reduce((sum, i) => sum + i.awakeMsLive, 0),
        estCostTodayUsd: today.reduce((sum, i) => sum + i.estCostUsd, 0)
      };
      return Response.json({ ok: true, data: { sessions: items, totals } });
    }

    if (request.method === "POST" && url.pathname === "/forget") {
      const body = (await request.json().catch(() => ({}))) as { session?: string };
      const session = String(body.session ?? "").trim();
      if (!session) return new Response("session required", { status: 400 });
      await this.ctx.storage.delete(`s:${session}`);
      return Response.json({ ok: true, data: { forgotten: session } });
    }

    return new Response("not found", { status: 404 });
  }
}
