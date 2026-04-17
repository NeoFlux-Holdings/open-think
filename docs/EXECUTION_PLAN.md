# Execution Plan: Community-Ready, Security-First Runtime

This plan prioritizes contributor experience and quality controls while expanding Cloudflare-native integrations.

## Phase 1 — Governance and contribution quality (Week 1)

1. Publish contribution standards and anti-slop rules.
2. Add issue and PR templates requiring scope, tests, and security impact.
3. Define maintainer review checklist and ownership model.

**Exit criteria**
- New PRs are structured and auditable.
- AI-assisted contributions include disclosures and manual validation notes.

## Phase 2 — Runtime hardening (Weeks 1-2)

1. Enforce outbound host allow-list in plugin HTTP helpers.
2. Add startup validation that each enabled plugin has required secrets.
3. Add request schema validation for `/invoke/{pluginId}` payloads.
4. Add structured error IDs for easier debugging/support.

**Exit criteria**
- Misconfigured deployments fail fast with actionable messages.
- Invocation errors are deterministic and traceable.

## Phase 3 — Plugin SDK and examples (Weeks 2-3)

1. ✅ Add a plugin authoring guide with a minimal template plugin.
2. ✅ Add test utilities/mocks for plugin integration tests.
3. ✅ Publish compatibility contract for capabilities and metadata.

**Current progress update**
- Added `docs/PLUGIN_SDK.md` and `npm run plugin:new -- <plugin-id>` generator for community plugin scaffolding.
- Added reusable `test/helpers/runtimeStub.ts` and capability compatibility contract docs.

**Exit criteria**
- A new community plugin can be added in <30 minutes.
- Plugin behavior can be tested without production credentials.

## Phase 4 — Integrations and MCP expansion (Weeks 3-4)

1. ⏳ Expand Cloudflare API MCP plugin to cover common ops workflows.
2. ⏳ Deepen `mpp.dev` plugin (model listing, health checks, robust error mapping).
3. ✅ Add connector architecture for additional CF-native services.

**Current progress update**
- Added `cloudflare-api-mcp:list-dns-records` (zone-scoped DNS listing).
- Added `mpp:list-models` action with error mapping and tests.
- Added shared `JsonHttpConnector` and migrated first-party plugins onto connector abstraction.
- Added `artifacts` plugin integration for Cloudflare Artifacts create/import/fork flows.

**Exit criteria**
- At least 2 production-grade plugin actions per first-party plugin.
- Clear extension points for third-party connectors/MCP servers.

## Phase 5 — Release and operations readiness (Week 4)

1. ✅ Add CI for typecheck/tests and required PR checks.
2. ✅ Add versioning and changelog policy.
3. ✅ Add deployment runbook for Cloudflare Workers.

**Current progress update**
- Added GitHub Actions CI workflow for `npm run typecheck` and `npm test`.
- Added release/versioning policy in `docs/RELEASE_POLICY.md`.
- Added production deployment runbook in `docs/DEPLOYMENT_RUNBOOK.md`.

**Exit criteria**
- Main branch has gated quality checks.
- Contributors can safely ship changes with predictable release process.


## Phase 6 — Observability and reliability (Week 5)

1. ✅ Add structured audit logs for plugin/skill invocations and request failures.
2. ⏳ Add error-rate and latency dashboards/alerts (metrics + alert-check endpoint added; dashboards pending).
3. ✅ Add incident response playbook templates.

**Current progress update**
- Added `GET /metrics` counters (requests, errors, avg latency, plugin/skill invoke totals).
- Added `POST /alerts/check` with optional webhook notification on threshold breach.
- Added incident response template at `docs/INCIDENT_PLAYBOOK.md`.

**Exit criteria**
- Operators can trace failed requests by `requestId`.
- On-call can detect and respond to regressions with actionable telemetry.
