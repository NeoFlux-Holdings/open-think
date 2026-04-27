/**
 * Stripe Checkout + Webhook integration for open-think.app.
 *
 * Intentionally minimal:
 *   - Checkout Session creation for each price id we ship (Pro monthly, Pro annual, Concierge one-shot)
 *   - Webhook handler that verifies signatures and upserts customer / subscription / order rows in D1
 *   - Customer Portal session creation so subscribers manage their own billing
 *
 * Source of truth lives with Stripe. D1 is a cache for fast gate checks.
 */

import { json } from "../layout";

export interface StripeEnv {
  DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_ANNUAL?: string;
  STRIPE_PRICE_CONCIERGE_ONESHOT?: string;
  STRIPE_PRICE_HELM_CLOUD?: string;
  SITE_URL?: string;
}

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/** Encode a nested object into Stripe's dot-bracket form-URL-encoded body. */
function encodeParams(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          out.push(...encodeParams(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (v && typeof v === "object") {
      out.push(...encodeParams(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripe(
  env: StripeEnv,
  path: string,
  body?: Record<string, unknown>,
  method: "POST" | "GET" = "POST"
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!env.STRIPE_SECRET_KEY) {
    return {
      ok: false,
      status: 500,
      data: {
        error: {
          message: "STRIPE_SECRET_KEY not configured. Set it with `wrangler secret put`."
        }
      }
    };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Stripe-Version": "2024-06-20"
  };
  let init: RequestInit = { method, headers };
  if (method === "POST" && body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    init = { ...init, body: encodeParams(body).join("&") };
  }
  const response = await fetch(`${STRIPE_API_BASE}${path}`, init);
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: response.ok, status: response.status, data: parsed };
}

export interface CheckoutIntent {
  plan: "pro-monthly" | "pro-annual" | "concierge" | "helm-cloud";
  email?: string;
  customerId?: string;
}

export async function createCheckoutSession(env: StripeEnv, intent: CheckoutIntent) {
  const siteUrl = (env.SITE_URL ?? "https://open-think.app").replace(/\/$/, "");
  const priceMap: Record<CheckoutIntent["plan"], string | undefined> = {
    "pro-monthly": env.STRIPE_PRICE_PRO_MONTHLY,
    "pro-annual": env.STRIPE_PRICE_PRO_ANNUAL,
    concierge: env.STRIPE_PRICE_CONCIERGE_ONESHOT,
    "helm-cloud": env.STRIPE_PRICE_HELM_CLOUD
  };
  const priceId = priceMap[intent.plan];
  if (!priceId) {
    return {
      ok: false,
      error: `No price configured for plan '${intent.plan}'. Set STRIPE_PRICE_${intent.plan.toUpperCase().replace(/-/g, "_")} via wrangler secret put.`
    };
  }

  const mode = intent.plan === "concierge" ? "payment" : "subscription";
  // After Helm Cloud checkout, drop the user back at /deploy/cloud with the
  // session id; the deploy page will exchange it for a customer_id and
  // mark this deploy as subscribed before persisting.
  const successUrl =
    intent.plan === "helm-cloud"
      ? `${siteUrl}/deploy/cloud?session_id={CHECKOUT_SESSION_ID}`
      : `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`;
  const body: Record<string, unknown> = {
    mode,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: successUrl,
    cancel_url: `${siteUrl}/pricing?status=cancelled`,
    allow_promotion_codes: "true",
    billing_address_collection: "auto"
  };
  if (intent.email) body.customer_email = intent.email;
  if (intent.customerId) body.customer = intent.customerId;
  if (mode === "subscription") {
    body["subscription_data[metadata][plan]"] = intent.plan;
  } else {
    body["payment_intent_data[metadata][plan]"] = intent.plan;
  }

  const result = await stripe(env, "/checkout/sessions", body);
  if (!result.ok) {
    return { ok: false, error: (result.data as { error?: { message?: string } })?.error?.message ?? "Stripe error" };
  }
  const session = result.data as { id?: string; url?: string };
  return { ok: true, session };
}

export async function createPortalSession(env: StripeEnv, customerId: string) {
  const siteUrl = (env.SITE_URL ?? "https://open-think.app").replace(/\/$/, "");
  const result = await stripe(env, "/billing_portal/sessions", {
    customer: customerId,
    return_url: `${siteUrl}/account`
  });
  if (!result.ok) {
    return { ok: false, error: "portal error" };
  }
  return { ok: true, portal: result.data as { url?: string } };
}

/* ---------------- Webhook verification (HMAC-SHA256 over signed payload) ---------------- */

async function importWebhookKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function hexFromBuffer(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSec = 300
): Promise<{ ok: boolean; reason?: string }> {
  const parts = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2)
  ) as Record<string, string>;
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return { ok: false, reason: "missing sig parts" };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > toleranceSec) {
    return { ok: false, reason: "outside tolerance window" };
  }

  const key = await importWebhookKey(secret);
  const payload = `${timestamp}.${rawBody}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = hexFromBuffer(sig);
  if (!timingSafeEqual(expected, v1)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/* ---------------- Webhook handling ---------------- */

export async function handleWebhook(env: StripeEnv, request: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ ok: false, error: "webhook secret not configured" }, 500);
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ ok: false, error: "missing stripe-signature" }, 400);

  const rawBody = await request.text();
  const verify = await verifyWebhookSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verify.ok) return json({ ok: false, error: verify.reason }, 400);

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }

  // Idempotency: only record/process each event once.
  if (env.DB && event.id) {
    const existing = await env.DB.prepare("SELECT id FROM webhook_events WHERE id = ?").bind(event.id).first();
    if (existing) return json({ ok: true, dedup: true });
    await env.DB.prepare(
      "INSERT INTO webhook_events (id, type, received_at, payload_json) VALUES (?, ?, ?, ?)"
    )
      .bind(event.id, event.type ?? "", new Date().toISOString(), rawBody)
      .run();
  }

  try {
    await dispatch(env, event);
    if (env.DB && event.id) {
      await env.DB.prepare("UPDATE webhook_events SET processed_ok = 1 WHERE id = ?").bind(event.id).run();
    }
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }

  return json({ ok: true });
}

async function dispatch(
  env: StripeEnv,
  event: { type?: string; data?: { object?: Record<string, unknown> } }
) {
  const obj = event.data?.object ?? {};
  const now = new Date().toISOString();
  if (!env.DB) return;

  switch (event.type) {
    case "checkout.session.completed": {
      const customerId = String(obj.customer ?? "");
      const email = String(obj.customer_email ?? obj.customer_details_email ?? (obj.customer_details as { email?: string } | undefined)?.email ?? "");
      if (customerId && email) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO customers (id, email, created_at, metadata_json) VALUES (?, ?, ?, ?)"
        )
          .bind(customerId, email, now, JSON.stringify(obj.metadata ?? {}))
          .run();
      }
      if (obj.mode === "payment" && obj.payment_intent) {
        // Concierge one-shot
        await env.DB.prepare(
          "INSERT OR IGNORE INTO concierge_orders (id, customer_id, amount_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(
            String(obj.payment_intent),
            customerId,
            Number(obj.amount_total ?? 0),
            String(obj.currency ?? "usd"),
            "paid",
            now
          )
          .run();
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const id = String(obj.id ?? "");
      const customerId = String(obj.customer ?? "");
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? [];
      const priceId = items[0]?.price?.id ?? "";
      const status = String(obj.status ?? "");
      const currentPeriodEnd = obj.current_period_end
        ? new Date(Number(obj.current_period_end) * 1000).toISOString()
        : null;
      const cancelFlag = obj.cancel_at_period_end ? 1 : 0;
      await env.DB.prepare(
        `INSERT INTO subscriptions (id, customer_id, price_id, status, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           price_id = excluded.price_id,
           current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end,
           updated_at = excluded.updated_at`
      )
        .bind(id, customerId, priceId, status, currentPeriodEnd, cancelFlag, now, now)
        .run();
      break;
    }
    case "customer.subscription.deleted": {
      const id = String(obj.id ?? "");
      const customerId = String(obj.customer ?? "");
      await env.DB.prepare(
        "UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?"
      )
        .bind(now, id)
        .run();
      // Helm Cloud: auto-pause every cloud_deployment owned by this customer
      // so the cron stops pushing to it. The deployment + encrypted token
      // stay in D1 until the customer either resubscribes or asks us to
      // delete (manage page → "Forget my deployment").
      if (customerId) {
        await env.DB
          .prepare(
            `UPDATE cloud_deployments SET paused = 1 WHERE customer_id = ? AND paused = 0`
          )
          .bind(customerId)
          .run()
          .catch(() => {
            /* table may not exist yet on environments without migration 0002 */
          });
      }
      break;
    }
    default:
      // No-op for unhandled events; stored in webhook_events for audit.
      break;
  }
}

/**
 * Exchange a Stripe Checkout `session_id` for the customer it belongs to.
 * Used by `/deploy/cloud` after Helm Cloud subscription completes — we
 * pull the customer_id (and email) so the deploy persistence can attribute
 * the resulting cloud_deployment row to the right subscriber.
 *
 * Enforces `status: "complete"` AND `payment_status: "paid"` before
 * returning success. An open or unpaid session is rejected — without this
 * check, anyone with a guessed/stolen session_id could call exchange-session
 * before the legit user even paid.
 *
 * The replay-safety layer (one-time claim + signed cookie) lives a level up
 * in `cloud/sessions.ts`; this function is just the Stripe API call.
 */
export async function lookupCheckoutSession(
  env: StripeEnv,
  sessionId: string
): Promise<
  | { ok: true; customerId: string; email: string; subscriptionId?: string }
  | { ok: false; error: string }
> {
  if (!sessionId.startsWith("cs_")) {
    return { ok: false, error: "session_id must start with 'cs_'" };
  }
  const r = await stripe(env, `/checkout/sessions/${sessionId}`, undefined, "GET");
  if (!r.ok) {
    return {
      ok: false,
      error:
        (r.data as { error?: { message?: string } })?.error?.message ??
        `Stripe lookup failed (${r.status})`
    };
  }
  const obj = r.data as {
    customer?: string;
    customer_email?: string;
    customer_details?: { email?: string };
    subscription?: string;
    status?: string;
    payment_status?: string;
    mode?: string;
  };
  const customerId = String(obj.customer ?? "");
  const email = String(obj.customer_email ?? obj.customer_details?.email ?? "");
  if (!customerId) {
    return { ok: false, error: "session has no customer (incomplete checkout?)" };
  }
  // Subscription sessions: status="complete" + payment_status="paid".
  // (For test-mode + zero-dollar trials Stripe sets payment_status="no_payment_required",
  // which we also accept to avoid breaking trials.)
  const status = String(obj.status ?? "");
  const paid = String(obj.payment_status ?? "");
  if (status !== "complete") {
    return { ok: false, error: `session not complete (status=${status})` };
  }
  if (paid !== "paid" && paid !== "no_payment_required") {
    return { ok: false, error: `session not paid (payment_status=${paid})` };
  }
  return {
    ok: true,
    customerId,
    email,
    subscriptionId: obj.subscription ? String(obj.subscription) : undefined
  };
}

export async function lookupCustomerSubscription(env: StripeEnv, customerId: string) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT id, status, price_id, current_period_end FROM subscriptions WHERE customer_id = ? AND status IN ('active', 'trialing') ORDER BY updated_at DESC LIMIT 1"
  )
    .bind(customerId)
    .first();
  return row;
}
