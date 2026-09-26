# Pipeline Flow — GitHub-Native Multi-Agent Workflow

This document describes the **complete end-to-end flow** of the pipeline:
every stage, every trigger, every API call, and what happens when things
fail. For the underlying concepts (labels, environments, self-healing,
gates, etc.), see [`CONCEPTS.md`](./CONCEPTS.md).

---

## 1. The big picture

```
                ┌──────────────────────────────────────────────────────┐
                │                     YOU (human)                      │
                │   opens an issue        approves 2 gates (notified   │
                │   (Agent task template) by GitHub automatically)      │
                └────────┬─────────────────────────┬───────────────────┘
                         │                         │
                         ▼                         │
   ┌────────────────────────────────┐              │
   │ STAGE 1 — TRIAGE               │ orchestrator.yml            │
   │ trigger: issues.opened/reopened│                             │
   │  • validate (title/body)       │                             │
   │  • self-heal: create label     │                             │
   │    `agent-task` if missing     │                             │
   │  • label the issue             │                             │
   │  • post pipeline-plan comment  │                             │
   └────────┬───────────────────────┘                             │
            ▼                                                     │
   ┌────────────────────────────────┐                             │
   │ STAGE 2 — APPROVAL GATE        │  ◀── GitHub sends you a     │
   │ job runs in `dev-approval`     │      "review pending"       │
   │ environment (required reviewer)│      notification HERE      │
   │ ⏸ workflow pauses until you    │                             │
   │   approve in the Actions UI    │                             │
   └────────┬───────────────────────┘                             │
            ▼ (approved)                                          │
   ┌────────────────────────────────┐                             │
   │ STAGE 3 — DEVELOPER AGENT      │ orchestrator.yml            │
   │ REST: assign copilot-swe-agent │                             │
   │ [bot] to the issue with custom │                             │
   │ instructions                   │                             │
   │ 👨‍💻 Copilot coding agent works │                             │
   │    on GitHub's cloud infra and │                             │
   │    opens a DRAFT PR (Closes #N)│                             │
   └────────┬───────────────────────┘                             │
            ▼ (draft PR opened → trigger: pull_request.opened)    │
   ┌────────────────────────────────┐                             │
   │ STAGE 4 — UNIT-TEST AGENT      │ pr-quality-gate.yml         │
   │ job runs in `unittest-approval`│                             │
   │ environment ⏸ (2nd gate) ──────┼─────────────────────────────┘
   │ on approval: posts "@copilot   │
   │ add unit tests..." comment     │
   │ 🧪 the same Copilot session    │
   │    pushes tests to the same PR │
   └────────┬───────────────────────┘
            ▼ (test agent pushes → trigger: pull_request.synchronize)
   ┌────────────────────────────────┐
   │ STAGE 5 — CI GATE              │ pr-quality-gate.yml + ci.yml
   │  • wait for check-run "tests"  │
   │    (created by ci.yml)         │
   │  • fail unless the PR diff     │
   │    actually touches tests/     │
   └────────┬───────────────────────┘
            ▼
   ┌────────────────────────────────┐
   │ STAGE 6 — REVIEW AGENT         │ pr-quality-gate.yml
   │ REST: request                  │
   │ copilot-pull-request-reviewer  │
   │ [bot] as reviewer              │
   │ 🔍 poll until the review lands │
   └────────┬───────────────────────┘
            ▼
   ┌────────────────────────────────┐
   │ STAGE 7 — AUTO-MERGE           │ pr-quality-gate.yml
   │ mark PR ready → gh pr merge    │
   │ --squash --auto (falls back to │
   │ direct merge if no protection) │
   └────────┬───────────────────────┘
            ▼ (push to main)
   ┌────────────────────────────────┐
   │ STAGE 8 — DEPLOY TO DEV        │ deploy-dev.yml
   │ npm test → package public/ →   │
   │ placeholder deploy → artifact  │
   │ upload → comment on merged PR  │
   └────────────────────────────────┘
```

---

## 2. Stage-by-stage reference

### Stage 1 — Triage (`.github/workflows/orchestrator.yml` → job `triage`)

| | |
|---|---|
| **Trigger** | `issues: [opened, reopened]` |
| **Permissions** | `issues: write`, `contents: read` |
| **Auth** | built-in `GITHUB_TOKEN` |

Steps in order:

1. **Validate** — closes the issue if the title is blank; warns if the body
   is shorter than 20 chars. Outputs `valid=true/false`.
2. **Self-heal label** — `gh label create agent-task ... || echo "already exists"`.
   Guarantees the label exists before it is used (this was the first real
   production failure of the pipeline).
3. **Label** — applies `agent-task` to the issue.
4. **Acknowledge** — posts the numbered pipeline-plan comment so anyone
   reading the issue knows exactly what will happen.

Failure behavior: if validation fails, `approval-gate` is skipped via
`needs.triage.outputs.valid == 'true'` — the pipeline halts *before* the
gate instead of requesting approval for a dead run.

### Stage 2 — Approval gate (job `approval-gate`)

| | |
|---|---|
| **Mechanism** | `environment: dev-approval` with required reviewers |
| **Notification** | GitHub emails/notifies every required reviewer |
| **Timeout** | 7 days (GitHub default), then the job fails |

The job body is a single `echo` — the entire logic of this stage *is* the
environment reference. Approve in the web UI → job resumes instantly.
Reject → job fails → downstream agents never run.

### Stage 3 — Developer agent (job `developer-agent`)

The assignment call (the heart of the stage):

```bash
curl -X POST -H "Authorization: Bearer ${COPILOT_AGENT_PAT}" \
  https://api.github.com/repos/OWNER/REPO/issues/N/assignees \
  -d '{
    "assignees": ["copilot-swe-agent[bot]"],
    "agent_assignment": {
      "target_repo": "OWNER/REPO",
      "base_branch": "main",
      "custom_instructions": "Implement this issue fully. ... open a DRAFT PR ... Closes #N"
    }
  }'
```

Notes:
- Requires a **user token** (`COPILOT_AGENT_PAT`) — the default
  `GITHUB_TOKEN` cannot assign the Copilot bot (HTTP 422).
- The agent runs on **GitHub's infrastructure**, not in Actions. Actions
  only fires the request.
- When the agent finishes it opens a **draft PR** whose body links the
  issue — which triggers stage 4.

On failure, a fallback comment explains the three usual causes: missing
secret, PAT owner without a paid Copilot plan, agent disabled in repo.

### Stage 4 — Unit-test agent (`.github/workflows/pr-quality-gate.yml` → job `unit-test-agent`)

| | |
|---|---|
| **Trigger** | `pull_request.opened` **and** `draft == true` |
| **Gate** | `unittest-approval` environment (2nd human gate) |

On approval it posts a single `@copilot` comment instructing the agent to
add tests under `tests/` for every behavior changed, run `npm test`, and
commit to the same PR without touching behavior.

Loop safety: the comment→agent→push cycle produces a `synchronize` event,
which the `unit-test-agent` job deliberately ignores (`if` filters on
`action == 'opened'`), so the pipeline cannot ping-pong forever.

### Stage 5 — CI gate (jobs `ci-gate` + `.github/workflows/ci.yml`)

Two independent verifications:

1. **Check-run wait** — polls `GET /commits/SHA/check-runs` for a run named
   `tests` (produced by `ci.yml`) until `conclusion == "success"`, 60 × 20s.
2. **Diff guard** — `GET /pulls/N/files?per_page=100` (paginated) and fails
   the pipeline unless at least one filename starts with `tests/`.
   This enforces the *spirit* of stage 4, not just the letter.

### Stage 6 — Review agent (job `review-agent`)

```bash
gh api --method POST repos/OWNER/REPO/pulls/N/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

Then polls `GET /pulls/N/reviews` for a review by that login, 30 × 20s.
Copilot's review is a **comment review** — informative, non-blocking by
design; the blocking power sits in the CI gate + diff guard.

### Stage 7 — Auto-merge (job `auto-merge`)

Idempotent chain:

1. `gh pr ready` (no-op if already ready)
2. `gh pr merge --squash --auto` — arms auto-merge if branch protection
   exists (waits for its requirements)
3. fallback: direct `--squash` merge (safe: our gate already enforced
   tests + diff guard + review)
4. final fallback: echo "already merged" (re-run safety)

### Stage 8 — Deploy to dev (`.github/workflows/deploy-dev.yml`)

Trigger: `push` to `main` (i.e., the squash merge). Runs `npm test` again on
main, packages `public/`, executes the **placeholder** deploy (echo +
artifact upload). Replace the placeholder step with real commands; the
trigger needs no change. Runs in the `dev-deploy` environment.

---

## 3. Event-driven wiring (how stages find each other)

There is no central controller holding state. Every stage re-enters the
system through a GitHub event:

| Event | Workflow | Stage |
|---|---|---|
| `issues.opened` / `issues.reopened` | orchestrator.yml | 1–3 |
| `pull_request.opened` (draft) | pr-quality-gate.yml | 4 |
| `pull_request.synchronize` / `ready_for_review` / `reopened` | pr-quality-gate.yml | 5–7 |
| `push` to `main` | deploy-dev.yml | 8 |

Consequence: the system is **restartable**. If any workflow run dies, the
next matching event re-triggers the pipeline for that issue/PR. The
`concurrency` groups (`orchestrator-issue-N`, `pr-gate-N`) serialize runs
per issue/PR so two pushes never race each other.

---

## 4. Failure modes & recovery

| Symptom | Cause | Recovery |
|---|---|---|
| `'agent-task' not found` | label missing (fixed by self-heal) | re-open the issue |
| Run stuck "Waiting for review" | that's the gate — it's working | approve in Actions UI |
| `422` on agent assignment | missing PAT / no paid Copilot / agent disabled | fix per fallback comment on the issue |
| CI gate times out after 20 min | `ci.yml` missing or check not named `tests` | confirm ci.yml exists on the PR branch |
| `does not modify tests/` | developer agent skipped test stage | the diff guard is doing its job — check the unit-test agent's gate was approved |
| Review wait times out | Copilot code review not enabled in repo settings | Settings → Copilot |
| Merge skipped "not mergeable" | PR already merged, or conflicts | none needed / resolve conflicts |

Cancel anything by **closing the issue** or closing the PR — all later
stages check `if:` conditions that stop on closed items.

---

## 5. One-time setup checklist

```bash
./scripts/setup-github.sh OWNER/REPO    # labels + environments + protection
```

Then in the Settings UI:

- [ ] Environments → `dev-approval` → Required reviewers: add yourself
- [ ] Environments → `unittest-approval` → Required reviewers: add yourself
- [ ] Secrets → Actions → `COPILOT_AGENT_PAT` (classic PAT, `repo` scope, paid Copilot account)
- [ ] Actions → General → Workflow permissions: **Read and write**
- [ ] Copilot → coding agent enabled (+ optionally allow Copilot to approve PRs)

---

## 6. Running the demo end-to-end

```bash
npm start          # dev server with live reload at http://localhost:8080
npm test           # unit tests (Node >= 20)
```

1. Open an issue with the **Agent task** template
2. Approve the `dev-approval` gate when notified
3. Watch the Copilot agent open the draft PR
4. Approve the `unittest-approval` gate
5. Tests get added → CI green → Copilot review → auto-merge → deploy comment
