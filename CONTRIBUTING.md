# Contributing to Open Think

Thanks for helping build a secure, Cloudflare-native agent framework.

## Project values

- **Security first**: least privilege, explicit allow-lists, and audited external calls.
- **Composable architecture**: plugins over hard-coded integrations.
- **Operational clarity**: observable behavior, deterministic error handling, and documented defaults.
- **No AI slop**: contributions must be intentional, reviewed, tested, and maintainable.

## Anti-slop policy (required)

To keep quality high, every PR must satisfy all of the following:

1. **Problem statement**: explain what user/operator problem is solved.
2. **Design rationale**: justify key tradeoffs and alternatives considered.
3. **Tests included or explicitly deferred** with a clear reason.
4. **Minimal scope**: avoid broad refactors unrelated to the target issue.
5. **Human accountability**: the PR author is responsible for correctness.

If AI tools are used, you must include a short **AI Usage Disclosure** in your PR:

- what tool was used,
- what it generated/suggested,
- what manual validation you performed.

PRs that appear auto-generated without clear ownership or verification may be closed.

## Contribution workflow

1. Open an issue (bug / feature / proposal) before significant work.
2. Fork and create a branch with a focused name.
3. Implement changes with docs/tests.
4. Run checks locally (or document environment blockers).
5. Submit a PR using the repository template.

## Code standards

- Keep plugin interfaces backward compatible when possible.
- Prefer explicit configuration and validation over implicit behavior.
- Never weaken host allow-list or secret-handling controls without strong justification.
- Keep public docs in sync with behavior and defaults.

## Security submissions

For sensitive vulnerabilities, do **not** open a public issue. Contact maintainers privately.
