-- open-think.app — Helm Cloud deployment ledger.
--
-- One row per managed-deploy customer. The token is stored as AES-256-GCM
-- ciphertext (see src/cloud/crypto.ts); the decryption key lives in the
-- Worker secret CLOUD_MASTER_KEY. Threat model: if our master key leaks AND
-- our D1 leaks, an attacker can deploy to the customer's Worker — they
-- cannot read runtime data, but can push malicious code. Customers can
-- revoke their token at dash.cloudflare.com/profile/api-tokens at any time
-- to neutralize that risk; we should rotate the master key + nag every
-- customer to re-paste tokens after any incident.

CREATE TABLE IF NOT EXISTS cloud_deployments (
  id TEXT PRIMARY KEY,                 -- our deployment id (uuid)
  customer_id TEXT NOT NULL REFERENCES customers(id),
  account_id TEXT NOT NULL,            -- CF account id of the customer's account
  worker_name TEXT NOT NULL,           -- script name; <name>.workers.dev
  encrypted_token_b64 TEXT NOT NULL,   -- AES-GCM(token) under CLOUD_MASTER_KEY, base64
  encryption_iv_b64 TEXT NOT NULL,     -- 12-byte IV used during encryption, base64
  worker_url TEXT,                     -- canonical URL, e.g. https://helm.example.workers.dev
  build_sha TEXT,                      -- last bundle git sha we pushed (null until first push)
  paused INTEGER NOT NULL DEFAULT 0,   -- 1 = subscriber paused updates; cron skips
  created_at TEXT NOT NULL,
  last_pushed_at TEXT,                 -- ISO timestamp of most recent successful push
  last_push_error TEXT                 -- short string describing the most recent push failure
);
CREATE INDEX IF NOT EXISTS idx_cloud_deployments_customer ON cloud_deployments(customer_id);
CREATE INDEX IF NOT EXISTS idx_cloud_deployments_paused ON cloud_deployments(paused);

-- Manage-page access tokens. Each row is a short-lived signed handle the
-- customer can email-link back to without us holding their email session.
-- We set one when a Stripe checkout completes for the helm-cloud price.
CREATE TABLE IF NOT EXISTS cloud_manage_tokens (
  token TEXT PRIMARY KEY,              -- random 32-byte url-safe string
  deployment_id TEXT NOT NULL REFERENCES cloud_deployments(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cloud_manage_tokens_deployment ON cloud_manage_tokens(deployment_id);

-- Audit log: every push attempt + every customer action, for debugging and
-- so subscribers can see what we did.
CREATE TABLE IF NOT EXISTS cloud_push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES cloud_deployments(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,                  -- "push-success" | "push-failure" | "paused" | "resumed" | "token-rotated"
  build_sha TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_cloud_push_log_deployment ON cloud_push_log(deployment_id);
