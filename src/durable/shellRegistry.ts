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
}

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
      const next: ShellSessionRecord = {
        session,
        email: existing?.email ?? email,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
        connections: Math.max(0, (existing?.connections ?? 0) + delta)
      };
      await this.ctx.storage.put(key, next);
      return Response.json({ ok: true, data: next });
    }

    if (request.method === "GET" && url.pathname === "/list") {
      const filterEmail = url.searchParams.get("email")?.toLowerCase() ?? null;
      const map = await this.ctx.storage.list<ShellSessionRecord>({ prefix: "s:" });
      const cutoff = Date.now() - STALE_MS;
      const items: ShellSessionRecord[] = [];
      for (const v of map.values()) {
        if (v.lastSeen < cutoff) continue;
        if (filterEmail && v.email !== filterEmail) continue;
        items.push(v);
      }
      items.sort((a, b) => b.lastSeen - a.lastSeen);
      return Response.json({ ok: true, data: { sessions: items } });
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
