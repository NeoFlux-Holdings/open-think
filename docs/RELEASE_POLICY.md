# Release Policy

## Versioning

This project follows SemVer:

- **MAJOR**: breaking changes to runtime API, plugin contract, or behavior.
- **MINOR**: backwards-compatible feature additions.
- **PATCH**: backwards-compatible fixes/docs/chore updates.

## Changelog

- Keep a human-written changelog section in PR descriptions.
- Group changes by: runtime, plugins, docs/tooling, tests.
- Note migration steps explicitly for breaking changes.

## Release checklist

1. CI green (`typecheck`, `test`).
2. Security-sensitive changes reviewed by at least one maintainer.
3. Docs updated for any endpoint/config/behavior change.
4. Smoke check completed against deployed Worker (`npm run cf:smoke -- <url>`).

## Tagging

- Tag release commits as `vX.Y.Z`.
- Include short release notes summarizing key changes and any migration actions.
