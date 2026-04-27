import type { Env } from "../types";
import { AppError } from "../core/errors";

/**
 * Codex OAuth device-code scaffolding.
 *
 * The full end-to-end flow requires a registered OpenAI OAuth client. Until
 * Open Think is registered (or until OpenAI enables public device-code auth),
 * these endpoints return structured guidance rather than dispatching real
 * OAuth requests. The shape matches RFC 8628 so wiring the live flow later
 * is a one-function change.
 *
 * Endpoints are namespaced under /oauth/codex/* on the Worker.
 */

export interface DeviceCodeStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
  status: "pending_configuration" | "pending_approval";
  hint?: string;
}

export interface DeviceCodePoll {
  status: "pending" | "authorized" | "expired" | "error" | "pending_configuration";
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
  hint?: string;
}

function oauthClientId(env: Env): string | undefined {
  return env.CODEX_OAUTH_CLIENT_ID;
}

export async function startDeviceCode(env: Env): Promise<DeviceCodeStart> {
  const clientId = oauthClientId(env);
  if (!clientId) {
    return {
      device_code: "unavailable",
      user_code: "CONFIGURE",
      verification_uri: "https://developers.openai.com/codex/auth#device-code",
      expires_in: 0,
      interval: 5,
      status: "pending_configuration",
      hint:
        "Set CODEX_OAUTH_CLIENT_ID to a registered OpenAI OAuth client id. Until then, use the codex:chatgpt-tokens auth mode — run `codex login` locally and paste the resulting CODEX_ACCESS_TOKEN / CODEX_ID_TOKEN as Worker secrets."
    };
  }

  throw new AppError(
    "E_OAUTH_NOT_IMPLEMENTED",
    "Device-code flow is wired but not yet dispatched to OpenAI. Drop in the fetch() call in startDeviceCode() once the client id is verified against OpenAI's auth service.",
    501
  );
}

export async function pollDeviceCode(env: Env, deviceCode: string): Promise<DeviceCodePoll> {
  if (!deviceCode || typeof deviceCode !== "string") {
    throw new AppError("E_BAD_REQUEST", "device_code is required", 400);
  }
  if (!oauthClientId(env)) {
    return {
      status: "pending_configuration",
      hint: "Set CODEX_OAUTH_CLIENT_ID to enable the device-code flow."
    };
  }
  return {
    status: "pending",
    hint: "Device-code poll is scaffolded — exchange is not yet dispatched."
  };
}
