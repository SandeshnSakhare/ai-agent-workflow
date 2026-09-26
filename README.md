# GitHub-native multi-agent workflow

A complete orchestrator that runs **entirely inside GitHub** — no external
orchestrator, no external runners. You open an issue; agents implement, test,
review, merge, and deploy.

```
 Issue ──▶ Orchestrator ──▶ ⏸ Approval gate (dev-approval environment)
                                  │ approve (GitHub sends you a review-pending notification)
                                  ▼
                       👨‍💻 Developer agent (Copilot coding agent)
                                  │ opens DRAFT PR (Closes #N)
                                  ▼
                       🧪 Unit-test agent (@copilot comment on the PR,
                          gated by the unittest-approval environment)
                                  │ pushes tests to the same PR
                                  ▼
                       ✅ CI runs npm test (required check "tests")
                                  ▼
                       🔍 Review agent (Copilot code review via REST API)
                                  ▼
                       🔀 Auto-merge (squash) into main
                                  ▼
                       🚀 Deploy to dev (deploy-dev.yml, placeholder deploy)
```

## Files

| File | Role |
|---|---|
| `.github/workflows/orchestrator.yml` | Issue triage → approval gate → developer-agent assignment |
| `.github/workflows/pr-quality-gate.yml` | Unit-test agent → CI wait → review agent → auto-merge |
| `.github/workflows/deploy-dev.yml` | Deploy to dev on every push to `main` (placeholder) |
| `.github/workflows/copilot-setup-steps.yml` | Prepares the Copilot agents' environment (Node 20, deps) |
| `.github/copilot-instructions.md` | Repo-wide instructions for all Copilot agents |
| `AGENTS.md` | Workflow contract for coding agents |
| `scripts/app.js`, `public/` | The demo app the agents work on |
| `tests/` | `node:test` unit tests (`npm test`) |
| `scripts/setup-github.sh` | One-time repo bootstrap (labels, environments, protection) |

## One-time setup

Prerequisites: a **paid Copilot plan**, repo admin rights, `gh` CLI logged in
as a Copilot-licensed user.

```bash
./scripts/setup-github.sh                    # or: ./scripts/setup-github.sh owner/repo
./scripts/setup-github.sh owner/repo YOUR_USERNAME   # also sets you as required reviewer
```

> ⚠️ **Gates only pause if a reviewer is configured.** An environment with
> no "Required reviewers" runs straight through — that's GitHub's behavior.
> Pass your username as the 2nd argument (or add yourself in the UI) or the
> approval gates will never wait.

Then finish in the Settings UI:

1. **Secrets → Actions** → `COPILOT_AGENT_PAT` — a classic PAT with `repo`
   scope from the Copilot-licensed account (the default `GITHUB_TOKEN` cannot
   assign the Copilot bot to issues).
2. **Actions → General → Workflow permissions** → *Read and write*.
3. **Copilot → Coding agent** → enabled; optionally allow Copilot to approve
   PRs so its review can satisfy the 1-approval requirement.

> **Approval gates are comment-based** (`/approve`, `/approve-tests`, `/deny`
> posted by you on the issue/PR). Environment required-reviewers are NOT used
> by default because GitHub only enforces them on **public** repos for
> Free/Pro/Team plans, and repo admins bypass them otherwise. If your repo is
> public (or you're on Business/Enterprise), you can opt into native
> environment gates: set the repo variable `ENABLE_ENV_GATES=1` and add
> required reviewers to `dev-approval` / `unittest-approval`.

## Run it

1. Open a new issue using the **Agent task** template.
2. Comment **`/approve`** on the issue (this is the approval gate).
3. The Copilot coding agent opens a draft PR; comment **`/approve-tests`**
   on the PR — the test agent then extends the PR.
4. CI runs the tests, Copilot code review runs, the PR becomes ready and
   auto-merges, and `Deploy to dev` runs on `main`.

## Swapping in a different coding agent

The developer/unit-test stages only talk to GitHub (issue assignment +
`@copilot` comments). To use Claude Code or Codex instead, replace the
assignment step in `orchestrator.yml` with that agent's CLI in the workflow
(e.g. `anthropics/claude-code-action`) — the gate, review, merge, and deploy
stages stay identical.
