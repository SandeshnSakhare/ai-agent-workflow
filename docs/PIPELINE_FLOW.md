# Pipeline Flow — GitHub-Native Multi-Agent Workflow (v2, comment gates)

This document describes the **complete end-to-end flow** of the pipeline:
every stage, every trigger, every command, and what happens when things
fail. For the underlying concepts, see [`CONCEPTS.md`](./CONCEPTS.md); for
the issues we hit while building it, see
[`IMPLEMENTATION_LOG.md`](./IMPLEMENTATION_LOG.md).

> **v2 note:** approval gates were redesigned from environment
> required-reviewers to comment commands (`/approve`, `/approve-tests`,
> `/deny`) because GitHub only enforces environment reviewers on **public**
> repos for Free/Pro/Team plans, and repo admins bypass them by default.
> See `IMPLEMENTATION_LOG.md` issue #8.

---

## 1. The big picture

```
        ┌───────────────────────────────────────────────────────────┐
        │                        YOU (human)                        │
        │  1. opens an issue (Agent task template)                  │
        │  3. comments /approve on the issue                        │
        │  6. comments /approve-tests on the draft PR               │
        └───────┬───────────────────────┬───────────────────────────┘
                │                       │
                ▼                       │
┌───────────────────────────────────┐   │
│ STAGE 1 — TRIAGE                  │   orchestrator.yml
│ trigger: issues.opened/reopened   │
│  • validate title/body            │
│  • self-heal: create `agent-task` │
│    label if missing               │
│  • label the issue                │
│  • post pipeline-plan comment     │
│    ending with "comment /approve" │
└────────┬──────────────────────────┘
         ▼
┌───────────────────────────────────┐
│ STAGE 2 — APPROVAL GATE           │   ← the pipeline PARKS here.
│ (no job runs; no timer)           │
│ the issue thread IS the queue:    │
│ a maintainer comments /approve    │
└────────┬──────────────────────────┘
         ▼ (issue_comment.created: "/approve")
┌───────────────────────────────────┐
│ STAGE 3 — DEVELOPER AGENT         │   approval-handler.yml →
│  • authorize: comment author must │   agent-runtime.yml (implement)
│    be OWNER / MEMBER / COLLABOR.  │
│  • aider + GitHub Models (free,   │
│    GITHUB_TOKEN, models: read)    │
│    runs INSIDE the Actions runner │
│  👨‍💻 edits code on a branch,      │
│     opens a DRAFT PR ("Closes #N")│
└────────┬──────────────────────────┘
         ▼ (pull_request.opened, draft)
┌───────────────────────────────────┐
│ STAGE 4 — UNIT-TEST AGENT GATE    │   ← 2nd human gate
│ a maintainer comments             │
│ /approve-tests ON THE PR          │
│ → agent-runtime.yml (test mode):  │
│ 🧪 aider adds tests under tests/, │
│    commits & pushes to the PR     │
└────────┬──────────────────────────┘
         ▼ (pull_request.synchronize / ready_for_review / reopened)
┌───────────────────────────────────┐
│ STAGE 5 — CI GATE                 │   pr-quality-gate.yml + ci.yml
│  • wait for check-run "tests"     │
│    (produced by ci.yml)           │
│  • diff guard: PR must actually   │
│    modify tests/                  │
└────────┬──────────────────────────┘
         ▼
┌───────────────────────────────────┐
│ STAGE 6 — REVIEW AGENT            │   pr-quality-gate.yml →
│  agent-runtime.yml (review mode): │
│  • LLM reviews the PR diff        │
│  • posts a comment review with    │
│    severity-tagged findings       │
└────────┬──────────────────────────┘
         ▼
┌───────────────────────────────────┐
│ STAGE 7 — AUTO-MERGE              │   pr-quality-gate.yml
│  • mark PR ready (idempotent)     │
│  • gh pr merge --squash --auto    │
│    → fallback: direct squash      │
│    → fallback: "already merged"   │
└────────┬──────────────────────────┘
         ▼ (push to main)
┌───────────────────────────────────┐
│ STAGE 8 — DEPLOY TO DEV           │   deploy-dev.yml
│  npm test → package public/ →     │
│  placeholder deploy → artifact →  │
│  comment "🚀 Deployed" on the PR  │
└───────────────────────────────────┘
```

---

## 2. The command set (the human interface)

| Command | Posted on | Effect | Who |
|---|---|---|---|
| `/approve` | the **issue** | assigns the developer agent (stage 3) | OWNER / MEMBER / COLLABORATOR |
| `/approve-tests` | the **PR** | engages the unit-test agent (stage 4) | OWNER / MEMBER / COLLABORATOR |
| `/deny` | issue or PR | records pipeline cancellation | OWNER / MEMBER / COLLABORATOR |
| *(close the issue)* | — | also cancels the run | — |

Notes:
- Authorization comes from `github.event.comment.author_association` — a
  drive-by user commenting on a public repo **cannot** trigger agents.
- Posting a command in the wrong place does not fail anything: a
  `guidance` job replies with a hint (e.g. "`/approve-tests` is a PR
  command — post it on the PR the developer agent creates").
- The `unit-test-agent` job in `pr-quality-gate.yml` still exists as an
  **opt-in native environment gate** (repo variable `ENABLE_ENV_GATES=1`
  + required reviewers on `unittest-approval`). Use it only if your repo
  is public or you're on Business/Enterprise.

---

## 3. Stage-by-stage reference

### Stage 1 — Triage (`.github/workflows/orchestrator.yml` → job `triage`)

| | |
|---|---|
| **Trigger** | `issues: [opened, reopened]` |
| **Permissions** | `issues: write`, `contents: read` |
| **Auth** | built-in `GITHUB_TOKEN` |

1. **Validate** — closes title-less issues; warns on bodies < 20 chars.
   Outputs `valid=true/false`; downstream jobs condition on it.
2. **Self-heal label** — `gh label create agent-task ... || echo "already exists"`.
3. **Label** the issue `agent-task`.
4. **Post the plan comment** — the numbered pipeline plan + command list.
   This comment ends the run; the pipeline is now parked.

### Stage 2 — Approval gate (comment-based, via `approval-handler.yml`)

| | |
|---|---|
| **Mechanism** | maintainer comments `/approve` on the issue |
| **Authorization** | `author_association ∈ {OWNER, MEMBER, COLLABORATOR}` |
| **Trigger** | `issue_comment.created` |
| **Cancel** | `/deny` or close the issue |

There is no waiting job and no timer. The parked state is just "no events
pending" — the most robust pause GitHub offers. See
`CONCEPTS.md` §3.4 for why environment reviewers were rejected.

### Stage 3 — Developer agent (`agent-runtime.yml`, mode `implement`)

Called from `approval-handler.yml` on `/approve`. Runs entirely inside the
Actions runner:

1. Check out the repo; read the issue title/body via `gh`
2. Install `aider-chat` (open-source CLI agent)
3. Point aider at GitHub Models (`OPENAI_API_BASE=models.github.ai/inference`,
   `OPENAI_API_KEY=$GITHUB_TOKEN`, workflow permission `models: read`)
4. Single-shot prompt: implement the issue, keep `npm test` green, no new deps
5. Commit on `agent/implement-issue-N`, push, open a **draft PR**
   (`Implements #N`) — which arms stage 4's gate

No PAT, no paid Copilot, nothing external. Model default:
`openai/gpt-4.1-mini`; free-plan budget ≈ 10–30 requests per run.

### Stage 4 — Unit-test agent (`agent-runtime.yml`, mode `test`)

Called from `approval-handler.yml` on `/approve-tests` posted **on the PR**.
The job checks out the PR head branch and runs aider with instructions to
add/extend `node:test` files under `tests/` for every behavior in
`git diff origin/main...HEAD`, run `npm test`, and commit — without
touching application behavior. The commit is pushed to the same PR.

Loop safety: test mode is triggered only by a maintainer comment — the
agent's own `synchronize` pushes feed the CI gate, which never summons
agents. A run that produces no test changes fails hard (the diff guard in
stage 5 would reject it anyway).

### Stage 5 — CI gate (jobs `ci-gate` + `.github/workflows/ci.yml`)

Two independent verifications on every PR push:

1. **Check-run wait** — polls `GET /commits/SHA/check-runs` for a run named
   `tests` (produced by `ci.yml`) until success; 60 × 20 s budget.
2. **Diff guard** — `GET /pulls/N/files` (paginated) must contain at least
   one `tests/` path, otherwise the pipeline fails with
   "the unit-test agent's contribution is required".

### Stage 6 — Review agent (`agent-runtime.yml`, mode `review`)

Called from `pr-quality-gate.yml` after the CI gate passes. Fetches the PR
diff (truncated to 60 KB), asks a GitHub Models inference for a structured
review (summary + severity-tagged findings), and posts it as a **comment
review** on the PR via `gh pr review --comment`. Non-blocking by design;
the merge gate is the CI check + diff guard.

### Stage 7 — Auto-merge (job `auto-merge`)

Idempotent chain: `gh pr ready || echo` → `gh pr merge --squash --auto`
(waits for branch protection if any) → fallback direct `--squash` (safe:
the gate already enforced tests + diff + review) → final fallback
"already merged" (re-run safety).

### Stage 8 — Deploy to dev (`.github/workflows/deploy-dev.yml`)

Trigger: `push` to `main` (the squash merge). Re-runs `npm test`, packages
`public/`, runs the **placeholder** deploy (echo + artifact upload,
retained 7 days), and comments "🚀 Deployed to **dev**" on the merged PR.
Replace the placeholder step with real commands; the trigger stays.

---

## 4. Event-driven wiring (how stages find each other)

No central controller holds state; every stage re-enters via a GitHub
event, and the issue/PR **is** the state store:

| Event | Workflow | Stage |
|---|---|---|
| `issues.opened` / `reopened` | orchestrator.yml | 1–2 |
| `issue_comment.created` (`/approve`) | approval-handler.yml | 3 |
| `pull_request.opened` (draft) | pr-quality-gate.yml (opt-in env gate only) | 4 (alt) |
| `issue_comment.created` (`/approve-tests`) | approval-handler.yml | 4 |
| `pull_request.synchronize` / `ready_for_review` / `reopened` | pr-quality-gate.yml | 5–7 |
| `push` to `main` | deploy-dev.yml | 8 |

Consequences: the system is **restartable** (close & reopen the issue, or
re-comment `/approve`, re-runs everything after that point) and
**observable** (the whole story lives in issue/PR comments). Concurrency
groups (`orchestrator-issue-N`, `approval-N`, `pr-gate-N`) serialize runs
so duplicate events never race.

---

## 5. Failure modes & recovery

| Symptom | Cause | Recovery |
|---|---|---|
| `'agent-task' not found` | label missing (self-heal should prevent) | re-open the issue |
| Run sits parked after triage | that's the gate — working as intended | comment `/approve` on the issue |
| All Approval-Handler jobs "Skipped" | command in the wrong place (e.g. `/approve-tests` on an issue) | follow the hint comment; command table §2 |
| `GraphQL: GitHub Actions is not permitted to create or approve pull requests` | repo setting off (default): Settings → Actions → General → Workflow permissions | tick "Allow GitHub Actions to create and approve pull requests" → Save → re-run; or create the PR manually from the pushed `agent/*` branch (body: `Implements #N`) |
| `Empty response received from LLM (0 received)` in aider output | model id not resolvable via the OpenAI route, or free-tier/provider hiccup | fixed by the litellm `github/` route; if it recurs the retry loop fails loudly after 3 attempts → re-run, or change the default `model:` (e.g. `openai/gpt-4.1`, `anthropic/claude-sonnet-4.5`) |
| PR diff contains `.aider.chat.history.md` / `.aider.tags.cache...` but no code | aider housekeeping files swept into the commit (old `--no-gitignore` bug) | fixed; branches from old runs still carry them — delete the branch and re-`/approve` |
| `! [rejected] ... (non-fast-forward)` on agent push | re-running with stale YAML (fixes not yet on `main`), or old branch present | **push workflow changes to `main` BEFORE re-running**; force-push in the job makes it idempotent once current |
| Agent job fails 403/429 against models endpoint | free-tier rate limit (~150 req/day) or model unavailable | wait for quota reset; or point `OPENAI_API_BASE`/`OPENAI_API_KEY` at another provider in agent-runtime.yml |
| `litellm ... Connection error. The API provider's servers are down or overloaded` | provider-side outage/overload — not a pipeline bug (smoke-test step shows the provider's HTTP body in seconds) | re-run later; or change the `model` input (e.g. `openai/gpt-4.1`, `anthropic/claude-sonnet-4.5`) |
| CI gate times out (~20 min) | `ci.yml` missing or check not named `tests` | confirm ci.yml exists on the PR branch |
| `does not modify tests/` | test stage skipped | approve the unit-test gate; diff guard doing its job |
| Merge skipped "not mergeable" | already merged, or conflicts | none needed / resolve conflicts |
| Environment gate never asks | private repo on Free/Pro/Team, or admin bypass | expected; use comment gates (or go public/Business + `ENABLE_ENV_GATES=1`) |

---

## 6. One-time setup checklist

```bash
./scripts/setup-github.sh OWNER/REPO YOUR_USERNAME
```

Then in the Settings UI:

- [ ] **Actions → General → Workflow permissions** → *Read and write*
- [ ] **No secrets required** — the agents run aider + GitHub Models inside
      your runners using the built-in `GITHUB_TOKEN` (`models: read`).
      Optional: add `OPENROUTER_API_KEY` etc. only if you switch providers
      in `agent-runtime.yml`.
- [ ] Approval gates: comment commands — nothing to configure (default)
- [ ] Optional native gates (public repo or Business/Enterprise only):
      repo variable `ENABLE_ENV_GATES=1` + required reviewers on
      `dev-approval` / `unittest-approval`

---

## 7. Running the demo end-to-end

```bash
npm start          # dev server with live reload at http://localhost:8080
npm test           # unit tests (Node >= 20)
```

1. Open an issue with the **Agent task** template
2. Comment **`/approve`** on the issue
3. The developer agent (aider + GitHub Models) opens a draft PR
4. Comment **`/approve-tests`** on that PR
5. Tests pushed → CI green → review-agent comment → ready → auto-merge →
   "🚀 Deployed to dev" comment on the PR
