# Incident Playbook Template

Use this template for production incidents affecting this agent runtime.

## 1) Incident metadata

- **Incident ID:**
- **Start time (UTC):**
- **Detected by:**
- **Severity:** Sev1 / Sev2 / Sev3
- **Status page update posted:** yes/no

## 2) Impact summary

- Affected endpoints/plugins/skills:
- User impact:
- Estimated blast radius:

## 3) Triage checklist

- [ ] Confirm `/health`, `/plugins`, `/skills`, `/metrics`.
- [ ] Locate failing `requestId` from logs.
- [ ] Identify related recent deploy/PR.
- [ ] Assess if credential rotation is required.

## 4) Mitigation actions

- [ ] Roll back to last known-good release.
- [ ] Disable affected plugin via config if required.
- [ ] Apply temporary rate limiting/traffic controls.

## 5) Communication log

- Timestamp + update
- Timestamp + update

## 6) Recovery criteria

- Error rate returned to baseline.
- Key skill/plugin invoke checks succeeding.
- Stakeholder update posted.

## 7) Postmortem requirements

- Root cause analysis.
- Contributing factors.
- Corrective actions with owners/due dates.
