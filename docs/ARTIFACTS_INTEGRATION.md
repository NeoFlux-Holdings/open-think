# Cloudflare Artifacts Integration

This runtime includes an `artifacts` plugin for Cloudflare Artifacts (Git-for-agents).

## Prerequisite

Bind Artifacts in your Worker environment:

```ts
interface Env {
  ARTIFACTS: Artifacts
}
```

## Plugin actions

- `create-repo` (`input.name` required)
- `import-repo` (`input.sourceUrl`, `input.targetName`, optional `input.branch`)
- `fork-repo` (`input.name`, `input.forkName`, optional `input.readOnly`)

## Skill mappings

- `artifacts-create-repo`
- `artifacts-import-repo`
- `artifacts-fork-repo`

## Example invoke

```bash
curl -X POST "https://<worker-url>/invoke/artifacts" \
  -H "content-type: application/json" \
  -d '{"action":"create-repo","input":{"name":"session-123"}}'
```
