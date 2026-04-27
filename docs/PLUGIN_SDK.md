# Plugin SDK Guide

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

- Set `capabilities` to the minimum required (see [`CAPABILITIES.md`](./CAPABILITIES.md)).
- Set `requiredSecrets` when needed so runtime bootstrap can fail fast on missing credentials.

## 4) Register plugin

Add your plugin to `src/plugins/registry.ts`.

## 5) Enable plugin

Add plugin ID to `ENABLED_PLUGINS` and required outbound domains to `ALLOWED_HOSTS`.

## 6) Test plugin

```bash
npm test
```

For constrained environments, run static checks first:

```bash
npm run typecheck
```

## 7) Expose via skill catalog (optional)

If your plugin has an opinionated default action, add an entry to `SKILL_CATALOG` in `src/core/skills.ts`. Skills are the human-facing equivalent of plugin actions — they are what `/playground` lists and what `/skills/invoke/{skillId}` routes through.

## 8) Durable state (optional)

Need per-agent state? Use the existing `AgentSessionDO` via `env.AGENT_SESSIONS`:

```ts
const id = this.ctx.env.AGENT_SESSIONS!.idFromName("my-session");
const stub = this.ctx.env.AGENT_SESSIONS!.get(id);
const response = await stub.fetch("https://do/messages", {
  method: "POST",
  body: JSON.stringify({ role: "tool", content: JSON.stringify(result) })
});
```

## Design guidelines

- Keep plugins focused and single-purpose.
- Do not hardcode credentials; use `ctx.env` and `ctx.config`.
- Use the runtime's restricted fetch (`ctx.fetch`) or the shared `JsonHttpConnector`.
- Add at least one happy-path and one failure-path test per action.
- Emit structured logs via `console.log(JSON.stringify(...))` so they show up in `wrangler tail`.
- Treat every `input: unknown` as untrusted — parse + validate before use.
