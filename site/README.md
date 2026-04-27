# open-think.app

The marketing / docs / payments site for the Open Think community. Lives in this repo under `site/` — a separate Cloudflare Worker from the runtime itself. Same stack, different deployment target.

**Aesthetic**: research journal / technical monograph. Instrument Serif + IBM Plex Sans + IBM Plex Mono, warm off-white paper, ink-black hairlines, single Cloudflare-orange accent. Different from the editorial-broadsheet Tom-Tom app on purpose — the two should feel like different publications from the same press.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Landing — hero with animated node-graph, three pillars, pricing CTA |
| `/pricing` | Community (free), Pro ($29/mo), Concierge ($499 one-shot) |
| `/concierge` | Dedicated page for the 90-minute concierge offering |
| `/changelog` | Reader's digest of phases (hand-curated from `docs/EXECUTION_PLAN.md`) |
| `/docs` | Index linking to each repo doc |
| `/success` | Post-checkout thank-you |
| `/health` | JSON health probe |

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/stripe/checkout` | POST | Create Checkout Session for `plan: pro-monthly \| pro-annual \| concierge` |
| `/api/stripe/webhook` | POST | Stripe webhook (signature-verified, idempotent via D1) |
| `/api/stripe/portal` | POST | Create Customer Portal session for a given `customerId` |

## Deploy

```bash
cd site
npm install
npm run db:create           # creates an "open-think-site" D1 database
# paste the returned database_id into wrangler.toml
npm run db:migrate          # applies migrations/0001_init.sql

# Stripe secrets — create price ids in the Stripe dashboard first
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_PRICE_PRO_MONTHLY
wrangler secret put STRIPE_PRICE_PRO_ANNUAL
wrangler secret put STRIPE_PRICE_CONCIERGE_ONESHOT

npm run deploy
```

Then bind the `open-think.app` zone to this Worker from the Cloudflare dashboard (or uncomment the `[[routes]]` blocks in `wrangler.toml` once the zone is attached to the account).

## Stripe setup checklist

1. Create three Prices in Stripe:
   - **Pro monthly** — recurring $29/month
   - **Pro annual** — recurring $290/year
   - **Concierge** — one-time $499
2. In Stripe Webhooks, add an endpoint pointing at `https://open-think.app/api/stripe/webhook` and subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Deploy. Run a test Checkout from `/pricing`; verify the row lands in D1 via `wrangler d1 execute open-think-site --command "SELECT * FROM customers;"`.

## Security

- Webhook signatures are verified server-side with HMAC-SHA256 and a 5-minute replay window.
- Stripe is the source of truth; D1 is a cache for fast gate checks. A failed sync on one event doesn't compromise the billing state — Stripe will retry.
- Customer emails flow only through Stripe; we don't store passwords or personal data beyond what Stripe already holds.

## Why a separate Worker from the runtime?

- Different deploy cadences: marketing changes daily, the runtime is versioned.
- Different dependencies: site needs Stripe + D1, the runtime doesn't.
- Different surface area: public-facing content behind `cache-control: public`, runtime is per-account.
- Same repo so changelog stays in sync with actual shipped phases.

## Roadmap for the site

- Rendered markdown docs (currently links to repo)
- Logged-in account page at `/account` with Customer Portal redirect
- Public roadmap page rendered from `docs/EXECUTION_PLAN.md` roadmap entries
- Newsletter signup (Cloudflare's transactional email via CF Email Routing)
- Turnstile on the concierge form to discourage bots
- Sitemap + RSS feed for the changelog
