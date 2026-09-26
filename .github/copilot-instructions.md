# Copilot repository instructions

## Project overview
Demo static site + small Node module that powers a fully GitHub-native
multi-agent pipeline:

1. **Developer agent** (Copilot coding agent) — implements GitHub issues,
   opens draft PRs that reference the issue (`Closes #N`).
2. **Unit-test agent** (the same Copilot session, engaged via `@copilot`
   PR comments) — adds/extends unit tests under `tests/` inside the same PR.
3. **Review agent** (Copilot code review) — reviews every PR before merge.
4. Merge is squash-only into `main`; a push to `main` deploys to dev.

## Coding standards
- Plain JavaScript (CommonJS in `scripts/`, plain script in `public/`). No
  build step, no TypeScript, no new npm dependencies unless the issue demands it.
- Keep functions small, pure, and documented with JSDoc comments.
- Browser DOM code stays in `public/app.js`; pure logic that needs unit tests
  goes in `scripts/app.js`.
- Every new behavior in `scripts/` must come with `node:test` unit tests in
  `tests/` (use `node:assert/strict`).
- `npm test` must pass before any PR is marked ready.

## Review guidance (for Copilot code review)
- Check that behavior changes ship with corresponding test updates.
- Flag any change to `public/` that introduces logic that belongs in
  `scripts/` (testability).
- Flag new dependencies, global DOM access outside `public/app.js`, and
  unhandled promise rejections.
- Severity should reflect real impact; avoid style-only comments.
