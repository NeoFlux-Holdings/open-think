# Helm Cloud — operator runbook

The day-2 manual for the SaaS layer that lives in `site/src/cloud/`. Read
[`ARCHITECTURE.md#helm-cloud`](./ARCHITECTURE.md#helm-cloud-architecture-ii--managed-deploy-saas)
first for the design.

This runbook covers turning Helm Cloud on, watching it run, and the small
number of incidents you might handle. Everything assumes you operate the
marketing-site Worker (`site/`).

## Pre-flight: required configuration

Helm Cloud needs five bits of secret/config to work. The marketing site's
`/api/cloud/health` endpoint surfaces presence-only flags so you can verify
without echoing values.

| Setting | Where | What |
|---|---|---|
| `STRIPE_SECRET_KEY` | `wrangler secret put` | Stripe live mode secret key |
| `STRIPE_WEBHOOK_SECRET` | `wrangler secret put` | Stripe webhook signing secret (for `/api/stripe/webhook`) |
| `STRIPE_PRICE_HELM_CLOUD` | `wrangler secret put` | The recurring price id for Helm Cloud (e.g. `price_…`) |
| `CLOUD_MASTER_KEY` | `wrangler secret put` | 32+ byte secret used to encrypt customer CF tokens at rest |
| `HELM_BUNDLE_MANIFEST_URL` | `wrangler.toml [vars]` | Public URL of `manifest.json` (defaults to GH Releases latest) |

### Generating CLOUD_MASTER_KEY

The master key is the secret that decrypts every customer's stored Cloudflare
API token. It must be ≥16 chars (we enforce this) and is hashed with SHA-256
before use, so any high-entropy bytes work. The recommended source:

```bash
openssl rand -hex 32     # 64 hex chars = 32 bytes of entropy
```

Then set it once on the marketing-site Worker:

```bash
cd site
wrangler secret put CLOUD_MASTER_KEY
# paste the 64-char hex string when prompted
```

Verify it landed without echoing:

```bash
curl https://beta.open-think.app/health | jq '.hasCloudMasterKey'
# → true
```

**Do not rotate this key casually.** Rotating means decrypting every
customer's token with the old key and re-encrypting with the new one — a
batch migration. The Architecture doc describes the full re-key procedure.

### Stripe price for Helm Cloud

In Stripe Dashboard → Products, create a product called "Helm Cloud" with
a single recurring price (e.g. $9/mo). Copy the price id (`price_…`) and:

```bash
wrangler secret put STRIPE_PRICE_HELM_CLOUD
```

Make sure the same product / price exists in both test and live mode if
you're going to run end-to-end tests.

### Manifest URL

Default in `site/wrangler.toml` is:
```
HELM_BUNDLE_MANIFEST_URL = "https://github.com/NeoFlux-Holdings/open-think/releases/latest/download/manifest.json"
```

GitHub Releases auto-redirects `/releases/latest/download/<asset>` to the
most recent published release's asset. The bundle pipeline
([`.github/workflows/release-bundle.yml`](../.github/workflows/release-bundle.yml))
publishes both `helm.mjs` and `manifest.json` on each tag push, so the
cron tracks whatever you ship without operator action.

To roll back to a specific version, point at a pinned tag URL instead:
```
HELM_BUNDLE_MANIFEST_URL = ".../releases/download/v0.4.1/manifest.json"
```

## Going live (first time)

Once secrets are set:

1. Apply the migrations:
   ```bash
   cd site
   wrangler d1 execute open-think-site --file=./migrations/0002_cloud.sql --remote
   wrangler d1 execute open-think-site --file=./migrations/0003_cloud_session_claims.sql --remote
   ```
2. Push a tagged release of the runtime so the manifest URL has something to serve:
   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   # → GH Action builds dist/helm.mjs + dist/manifest.json + uploads to release assets
   ```
3. Deploy the marketing site:
   ```bash
   cd site && wrangler deploy
   ```
4. Health check:
   ```bash
   curl https://beta.open-think.app/api/cloud/health
   # ready: true → all four config booleans are true; cron will run hourly
   ```
5. Test end-to-end with Stripe test mode and a throwaway CF account before
   going live.

## Day-2 monitoring

### Three URLs to watch

| URL | What it tells you |
|---|---|
| `/health` | Marketing site itself is up + which configs are present |
| `/api/cloud/health` | Cron run state, deployment counts, last 5 push events |
| GitHub Actions | Whether the bundle pipeline is publishing manifest.json on tags |

### What "good" looks like

```json
{
  "ok": true,
  "ready": true,
  "config": { "hasDb": true, "hasCloudMasterKey": true, "hasManifestUrl": true, "hasStripePrice": true },
  "deployments": { "total": 12, "active": 11, "paused": 1, "errored": 0 },
  "cron": { "lastRunAt": "2026-04-27T12:00:01.000Z", "lastRunStatus": "ok", "recent": [...] }
}
```

A non-zero `errored` count means at least one customer's last push failed
(token expired? account suspended?). The customer's manage page surfaces
the error to them; you don't have to act unless many customers hit the
same error at once.

`lastRunStatus: "errors"` plus a non-empty `recent` containing
`push-failure` is the signal something systemic is wrong. Check the Worker
logs:

```bash
wrangler tail open-think-site
```

## Incidents

### The cron stopped firing

Symptom: `cron.lastRunAt` hasn't moved in ~2 hours and you have active
deployments that should have received pushes.

Diagnose:
```bash
wrangler tail open-think-site
# wait — does anything fire? if not:
wrangler triggers cron list open-think-site
# check that "0 * * * *" is registered
```

If the cron isn't registered, redeploy. If it IS but isn't firing, check
status.cloudflare.com.

### A customer's push keeps failing

Symptom: `errored` count rises by one for the same customer over multiple
hours.

Diagnose: visit their manage page (they'll be surfacing the error to
support). Common causes:

- **token expired** — they pasted a token with an `expires_on` that's now
  past. Their manage page already shows "Rotate Cloudflare token" — they
  can paste a fresh one and the next cron run picks it up.
- **token scope wrong** — they revoked Workers Scripts:Edit. Same fix.
- **CF account suspended** — Cloudflare disabled their account. They have
  to resolve with CF; we can't push until then. Pause their deployment in
  the meantime so the failure log doesn't fill up.

### Master key suspected leaked

Treat as a P1.

1. Generate a NEW key:
   ```bash
   openssl rand -hex 32
   ```
2. Email every active subscriber: "We're rotating our encryption key. Your
   service is uninterrupted; please go to dash → API Tokens and revoke
   the existing token, then visit your manage page and rotate to a fresh
   one within 7 days."
3. Run the rotation migration (TODO: ship this script). It decrypts every
   row with the old key, re-encrypts with the new.
4. Update `CLOUD_MASTER_KEY`:
   ```bash
   wrangler secret put CLOUD_MASTER_KEY
   ```
5. Deploy.
6. Subscribers who don't rotate within the deadline lose their managed
   pushes (their token decrypt fails) but their existing Worker keeps
   running. Re-paste re-enables.

### D1 corrupted / lost

D1 is the source of truth for `cloud_deployments`. If it's wiped:

1. Subscribers' Workers keep running on whatever was last pushed — no
   immediate impact.
2. Re-apply migrations.
3. Email every subscriber a recovery URL: visit `/cloud/recover`, enter
   email, we manually re-issue a deployment record. Or build a Stripe-
   webhook replay tool that reconstructs `cloud_deployments` from
   subscription events.

This is the worst case and we should keep periodic D1 exports (TODO).

## Useful CLI commands

```bash
# Apply a migration
wrangler d1 execute open-think-site --file=./migrations/000N_x.sql --remote

# One-off query (e.g. count active subscribers)
wrangler d1 execute open-think-site --remote --command "SELECT COUNT(*) FROM cloud_deployments WHERE paused = 0"

# Tail logs (live)
wrangler tail open-think-site

# Tail just cron logs
wrangler tail open-think-site | grep '\[cloud-cron\]'
```

## Pre-flight checklist before flipping the public switch

Before you list "Helm Cloud" on /pricing as a click-to-buy product, verify:

- [ ] All five settings present (`/health` shows `hasStripe`, `hasDb`,
      `hasCloudMasterKey`, `hasManifestUrl` all true)
- [ ] `/api/cloud/health` shows `ready: true`
- [ ] **At least one tagged release exists** — without this, `/deploy/cloud`
      will show the orange "Almost there — finish locally" state instead of
      the green "✓ Live" state. To fix:
      ```bash
      git tag v0.4.0
      git push origin v0.4.0
      # GitHub Actions runs release-bundle.yml → publishes
      # helm.mjs + manifest.json to /releases/latest/download/
      ```
      Verify it landed:
      ```bash
      curl -sLI https://github.com/NeoFlux-Holdings/open-think/releases/latest/download/manifest.json | head -1
      # → HTTP/2 200
      ```
- [ ] Stripe webhook endpoint is registered + receiving events
      (`/api/stripe/webhook` should show traffic in `wrangler tail`)
- [ ] Test-mode end-to-end with a throwaway CF account: pay → exchange →
      deploy → push → manage actions → cancel
- [ ] D1 backup strategy decided (cron-driven export to R2 is one option)
- [ ] Email channel decided for "subscription confirmation with manage URL"
      — currently the URL is shown only on the deploy page; users who lose
      the tab have to use `/cloud/recover` (TODO)

When all of those are checked, swap the "coming soon" label off and start
sending the link.

## Deploy outcomes by readiness state

The `/deploy/cloud` page renders one of three panels based on what's set up:

| State | Trigger | What the user sees |
|---|---|---|
| **✓ Live (green)** | All settings present + tagged release exists | "Worker is deployed and running. Visit /app." |
| **⏳ Almost there (orange)** | Settings OK, no tagged release | "CF resources are set up but the bundle hasn't been published yet. Use the Deploy to Cloudflare button or run wrangler deploy locally." |
| **✗ Failed (red)** | Token rejected, D1 quota, etc. | Step-by-step error in the deploy log |

The /pricing tiles also adapt: Stripe checkout buttons are replaced with a
**"Coming soon"** placeholder when their corresponding `STRIPE_PRICE_*`
secret isn't set. Setting the secret + redeploying flips them on.
