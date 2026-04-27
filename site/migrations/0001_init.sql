-- open-think.app — customer + subscription ledger.
-- Keep schema small and obvious; Stripe remains source of truth.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,               -- Stripe customer id (cus_...)
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,               -- Stripe subscription id (sub_...)
  customer_id TEXT NOT NULL REFERENCES customers(id),
  price_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- active | past_due | canceled | incomplete | trialing
  current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS concierge_orders (
  id TEXT PRIMARY KEY,               -- Stripe payment_intent id (pi_...)
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,              -- paid | refunded | pending
  scheduled_for TEXT,                -- ISO date of the booked session, if any
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,               -- Stripe event id (evt_...)
  type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_ok INTEGER DEFAULT 0,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(type);
