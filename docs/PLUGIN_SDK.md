# Plugin SDK Guide (Starter)

This guide helps contributors add new plugins quickly with the runtime contract used in this repo.

## 1) Scaffold a new plugin

```bash
npm run plugin:new -- my-plugin-id
```

This generates:

- `src/plugins/community/my-plugin-id.ts`
- `test/community/my-plugin-id.test.ts`

## 2) Implement actions

Use `invoke(action, input)` as your action router and return `PluginResult`.

- Return `{ ok: true, data }` for success.
- Return `{ ok: false, error }` for handled errors.

## 3) Declare capabilities and secrets

In your plugin class:

- Set `capabilities` to the minimum required.
- Set `requiredSecrets` when needed so runtime bootstrap can fail fast on missing credentials.

## 4) Register plugin

Add your plugin to `src/plugins/registry.ts`.

## 5) Enable plugin

Add plugin ID to `ENABLED_PLUGINS` and required outbound domains to `ALLOWED_HOSTS`.

## 6) Test plugin

Run:

```bash
npm test
```

If running in constrained environments, run syntax and static checks first:

```bash
npm run typecheck
```

## Design guidelines

- Keep plugins focused and single-purpose.
- Do not hardcode credentials.
- Use the runtime's restricted fetch path from plugin context (or the shared `JsonHttpConnector` in `src/core/connectors.ts`).
- Add at least one happy-path and one failure-path test per action.
