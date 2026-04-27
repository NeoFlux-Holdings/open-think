-- open-think.app — Helm Cloud session-claim ledger.
--
-- Replay-safe one-time mapping from a Stripe Checkout session_id to the
-- customer that actually claimed it (i.e. opened /deploy/cloud after paying).
--
-- WHY: a Stripe session_id is NOT a secret. It's emitted in URLs, referrer
-- headers, and analytics pixels. Without a claim ledger, anyone who knows
-- the session_id can:
--   1. POST /api/cloud/exchange-session and read the customer's customer_id
--   2. POST /api/cloud/deploy with that customer_id + an attacker token
-- and the resulting cloud_deployments row would be "owned" by the legit
-- customer in our records, but pushing to the attacker's Worker.
--
-- The fix:
--   - Mark the session_id as claimed on first successful exchange.
--   - Bind the claim to a signed HTTP-only cookie the exchange endpoint
--     issues (see src/cloud/sessions.ts). The deploy endpoint reads the
--     cookie, NOT a client-provided customer_id.
--   - Refuse to exchange the same session_id twice — the legit customer's
--     cookie persists; an attacker arriving second is told "already claimed".

CREATE TABLE IF NOT EXISTS cloud_session_claims (
  session_id TEXT PRIMARY KEY,            -- Stripe Checkout session_id (cs_…)
  customer_id TEXT NOT NULL,              -- Stripe customer_id (cus_…)
  email TEXT,                             -- For display on the deploy page banner
  claimed_at TEXT NOT NULL,               -- ISO timestamp of first exchange
  cookie_expires_at TEXT NOT NULL,        -- When the issued signed cookie expires
  deployment_id TEXT,                     -- Filled in after deploy succeeds; null until then
  FOREIGN KEY (deployment_id) REFERENCES cloud_deployments(id)
);
CREATE INDEX IF NOT EXISTS idx_cloud_session_claims_customer ON cloud_session_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_cloud_session_claims_deployment ON cloud_session_claims(deployment_id);
