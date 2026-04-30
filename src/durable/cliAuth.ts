/**
 * CliAuthDO — singleton DO that brokers the CLI device-code login flow.
 *
 * Three-leg flow, modeled after OAuth 2.0 device authorization grant:
 *
 *   1. CLI                → POST /cli-auth/start   { name? }
 *      DO mints (deviceCode, userCode); 10-min TTL
 *      Returns: { deviceCode, userCode, verifyUrl, interval }
 *
 *   2. CLI prints verifyUrl + userCode, user opens it in a browser.
 *      Browser hits GET /cli-auth/approve?code=<userCode> (CF Access
 *      gates this, so we know who clicked). Page renders an "Approve"
 *      button. User clicks → POST /cli-auth/approve { userCode }
 *      DO mints a long-lived bearer bound to the authenticated email,
 *      pairs it to the deviceCode.
 *
 *   3. CLI polls POST /cli-auth/poll { deviceCode } every `interval` s.
 *      DO returns:
 *         pending  → keep polling
 *         denied   → user denied
 *         expired  → device code TTL hit
 *         token    → here's your bearer; CLI saves to ~/.config/open-think/auth.json
 *
 * The minted bearer authenticates the CLI as the same email that
 * approved it. verifyAccessJwt() picks it up via the existing
 * Authorization: Bearer path (we add a fourth check for the
 * registry-stored token).
 *
 * Storage:
 *   "device:<deviceCode>" → { deviceCode, userCode, expiresAt, status, email?, token? }
 *   "user:<userCode>"     → deviceCode (lookup index)
 *   "token:<token>"       → email      (lookup index for auth gate)
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

export type DeviceStatus = "pending" | "approved" | "denied" | "expired";

export interface DeviceRecord {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  status: DeviceStatus;
  email?: string;
  token?: string;
  appName?: string;
  /** First seen UA, for the "Approve this device" page so the user can sanity-check. */
  cliInfo?: string;
}

function rand(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function userCodeFromBytes(): string {
  // 8-character base32-ish code, easy to type. Avoid 0/O/1/I.
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("").replace(/(....)/, "$1-");
}

export class CliAuthDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/start") {
      const body = (await request.json().catch(() => ({}))) as {
        cliInfo?: string;
        appName?: string;
      };
      const deviceCode = rand(32);
      const userCode = userCodeFromBytes();
      const record: DeviceRecord = {
        deviceCode,
        userCode,
        expiresAt: Date.now() + DEVICE_CODE_TTL_MS,
        status: "pending",
        appName: body.appName,
        cliInfo: body.cliInfo
      };
      await this.ctx.storage.put(`device:${deviceCode}`, record);
      await this.ctx.storage.put(`user:${userCode}`, deviceCode);
      return Response.json({
        ok: true,
        data: {
          deviceCode,
          userCode,
          interval: 2,
          expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000)
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/lookup") {
      // Browser-side: resolve a userCode (typed in by the user) to the
      // pending device record so we can show "are you sure you want to
      // approve this CLI from <ip>?".
      const userCode = url.searchParams.get("code") ?? "";
      const dc = await this.ctx.storage.get<string>(`user:${userCode}`);
      if (!dc) return Response.json({ ok: false, error: "no such code" }, { status: 404 });
      const rec = await this.ctx.storage.get<DeviceRecord>(`device:${dc}`);
      if (!rec) return Response.json({ ok: false, error: "expired" }, { status: 404 });
      // Don't leak the device code via lookup — only the user code +
      // metadata + expiry the browser needs.
      return Response.json({
        ok: true,
        data: {
          userCode: rec.userCode,
          status: rec.status,
          expiresAt: rec.expiresAt,
          appName: rec.appName,
          cliInfo: rec.cliInfo
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/approve") {
      const body = (await request.json().catch(() => ({}))) as {
        userCode?: string;
        email?: string;
        deny?: boolean;
      };
      const userCode = String(body.userCode ?? "");
      const dc = await this.ctx.storage.get<string>(`user:${userCode}`);
      if (!dc) return Response.json({ ok: false, error: "unknown user code" }, { status: 404 });
      const rec = await this.ctx.storage.get<DeviceRecord>(`device:${dc}`);
      if (!rec) return Response.json({ ok: false, error: "expired" }, { status: 410 });
      if (rec.expiresAt < Date.now()) {
        rec.status = "expired";
        await this.ctx.storage.put(`device:${dc}`, rec);
        return Response.json({ ok: false, error: "expired" }, { status: 410 });
      }
      if (body.deny) {
        rec.status = "denied";
        await this.ctx.storage.put(`device:${dc}`, rec);
        return Response.json({ ok: true, data: { status: "denied" } });
      }
      const email = String(body.email ?? "anon").trim().toLowerCase();
      // Mint the bearer.
      const token = `cli_${rand(32)}`;
      rec.status = "approved";
      rec.email = email;
      rec.token = token;
      await this.ctx.storage.put(`device:${dc}`, rec);
      await this.ctx.storage.put(`token:${token}`, {
        email,
        userCode,
        approvedAt: Date.now(),
        expiresAt: Date.now() + TOKEN_TTL_MS
      });
      return Response.json({ ok: true, data: { status: "approved", token } });
    }

    if (request.method === "POST" && url.pathname === "/poll") {
      const body = (await request.json().catch(() => ({}))) as { deviceCode?: string };
      const dc = String(body.deviceCode ?? "");
      const rec = await this.ctx.storage.get<DeviceRecord>(`device:${dc}`);
      if (!rec) return Response.json({ ok: false, error: "unknown device code" }, { status: 404 });
      if (rec.expiresAt < Date.now() && rec.status === "pending") {
        rec.status = "expired";
        await this.ctx.storage.put(`device:${dc}`, rec);
      }
      if (rec.status === "approved" && rec.token) {
        // Hand the token over once and clear it from the device record
        // so a second poll can't re-fetch it (defense-in-depth).
        const token = rec.token;
        rec.token = undefined;
        await this.ctx.storage.put(`device:${dc}`, rec);
        return Response.json({
          ok: true,
          data: { status: "approved", token, email: rec.email }
        });
      }
      return Response.json({ ok: true, data: { status: rec.status } });
    }

    if (request.method === "GET" && url.pathname === "/verify-token") {
      // Internal route — auth.ts uses this to resolve a Bearer cli_*
      // token to an email. Returns 404 if unknown/expired.
      const token = url.searchParams.get("token") ?? "";
      const tokenRec = await this.ctx.storage.get<{
        email: string;
        userCode: string;
        approvedAt: number;
        expiresAt: number;
      }>(`token:${token}`);
      if (!tokenRec) {
        return Response.json({ ok: false, error: "unknown" }, { status: 404 });
      }
      if (tokenRec.expiresAt < Date.now()) {
        await this.ctx.storage.delete(`token:${token}`);
        return Response.json({ ok: false, error: "expired" }, { status: 401 });
      }
      return Response.json({ ok: true, data: { email: tokenRec.email } });
    }

    if (request.method === "POST" && url.pathname === "/revoke") {
      const body = (await request.json().catch(() => ({}))) as { token?: string };
      const t = String(body.token ?? "");
      if (!t) return Response.json({ ok: false, error: "token required" }, { status: 400 });
      await this.ctx.storage.delete(`token:${t}`);
      return Response.json({ ok: true, data: { revoked: true } });
    }

    return new Response("not found", { status: 404 });
  }
}
