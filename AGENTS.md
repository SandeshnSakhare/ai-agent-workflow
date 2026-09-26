# Agent guidance for this repository

This repo runs a GitHub-native multi-agent workflow. Agents that work here
(Copilot coding agent or others) should follow these rules.

## Workflow contract
- Work is assigned through GitHub issues. When you implement an issue, open a
  **draft pull request** back to `main` whose body contains `Closes #<issue>`.
- Implementation PRs contain **code only**; a separate unit-test stage will
  extend the PR with tests when instructed via a `@copilot` comment.
- When asked (via `@copilot` PR comment) to add unit tests, add tests under
  `tests/` using `node:test` + `node:assert/strict`, then commit to the same
  PR. Do not change application behavior while doing so.
- Never merge PRs yourself and never force-push; merge is automated once the
  review agent approves and CI is green.

## Project layout
- `public/` — static site (index.html, styles.css, browser wiring in app.js)
- `scripts/` — CommonJS logic modules (unit-test target)
- `tests/` — `node:test` unit tests, run with `npm test` (Node >= 20)
- `.github/workflows/` — the orchestrator pipeline; see `orchestrator.yml`
