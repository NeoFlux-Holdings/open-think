# Deployment Runbook (Cloudflare Workers)

This runbook is the production path for deploying and validating this agent runtime.

## 0) Prerequisites

- Cloudflare account + least-privilege API token (or Agent token).
- Wrangler authenticated (`npx wrangler login`).
- Secrets configured with `npm run cf:bootstrap`.

## 1) Pre-deploy checks

Run locally:

```bash
npm run typecheck
npm test
```

If dependencies are unavailable in your environment, run these checks in CI before merge.

## 2) Deploy

```bash
npm run deploy
```

## 3) Post-deploy smoke checks

```bash
npm run cf:smoke -- https://<your-worker-url>
```

Optional deeper verification:

```bash
npm run cf:smoke -- https://<your-worker-url> --list-zones
```

## 4) Skill-level checks

```bash
curl -X POST "https://<your-worker-url>/skills/invoke/cf-introspect" \
  -H "content-type: application/json" \
  -d '{"input":{"check":"runbook"}}'
```

If `mpp` is enabled:

```bash
curl -X POST "https://<your-worker-url>/skills/invoke/mpp-list-models" \
  -H "content-type: application/json" \
  -d '{"input":{}}'
```

## 5) Rollback procedure

1. Re-deploy last known-good commit/tag.
2. Verify `/health`, `/plugins`, `/skills`.
3. Rotate any exposed credentials if incident-related.
4. Open an incident issue with timeline + root cause.

## 6) Production change checklist

- [ ] CI green (`typecheck`, `test`).
- [ ] Security-sensitive changes reviewed.
- [ ] Docs updated for config/endpoint changes.
- [ ] Smoke checks successful on deployed URL.
