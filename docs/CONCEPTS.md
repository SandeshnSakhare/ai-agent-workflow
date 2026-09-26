# Concepts — From Basics to the Advanced Patterns Used in This Pipeline

A step-by-step reference for every concept this workflow is built on.
Each section builds on the previous one; examples are taken from the actual
files in this repo. The end-to-end flow lives in
[`PIPELINE_FLOW.md`](./PIPELINE_FLOW.md).

---

## Level 1 — Git & GitHub basics

### 1.1 Repository, branch, commit
A repository holds your files and their full history. A **branch** is a
movable pointer to a commit (`main` here). Agents never push to `main`
directly — they work on branches like `copilot/fix-issue-1`.

### 1.2 Issues
An **issue** is a unit of work: title + body + comments + metadata. In this
pipeline the issue is the *task input* for the whole system — you describe
*what*, the agents decide *how*.

### 1.3 Labels
A **label** is a tag you can attach to issues/PRs for filtering and
bookkeeping (e.g. `is:issue is:open label:agent-task`).

Key detail that caused our first bug: **labels must exist before they can be
applied.** Referencing a never-created label → API error `'agent-task' not
found`. GitHub also *silently skips* template labels that don't exist yet.
That's why the workflow now creates the label before using it (see §4.1
Self-healing).

### 1.4 Pull requests and draft PRs
A **PR** proposes merging one branch into another, and carries a discussion:
comments, reviews, and **check runs** (CI results). A **draft PR** says
"work in progress, don't merge yet" — the developer agent opens its PR as a
draft on purpose, so nothing downstream can merge it prematurely.

### 1.5 Squash merge
Merging a PR that had 9 messy commits into one clean commit on `main`.
This repo is squash-only — `main` history reads like a changelog:
one issue = one commit.

### 1.6 Branch protection
Settings → Branches → rules for `main`: e.g. "the `tests` check must pass",
"1 approving review required". Rules live on the *target* branch. Note:
protection rules are **optional** in this pipeline — the gate enforces the
same requirements from inside the workflow, with protection as defense in
depth.

### 1.7 Issue & PR templates
`.github/ISSUE_TEMPLATE/agent-task.yml` turns "create issue" into a form
(Task / Acceptance criteria / Constraints) → every agent task arrives in the
same parseable shape. `.github/pull_request_template.md` does the same for
PRs.

---

## Level 2 — GitHub Actions fundamentals

### 2.1 Workflow, event, job, step
```yaml
on:                 # ← EVENT: what starts the workflow
  issues: { types: [opened, reopened] }
jobs:               # ← JOBS: run in parallel unless connected by needs
  triage:
    runs-on: ubuntu-latest     # ← RUNNER: the VM a job executes on
    steps:                     # ← STEPS: sequential shell or action calls
      - run: echo "hello"
```

### 2.2 Events & activity types
`issues: [opened, reopened]` fires when an issue is opened *or reopened* —
that's why closing & reopening issue #1 re-runs the pipeline without
creating a new issue. Every stage in this pipeline is *triggered by an
event*, never by a timer.

### 2.3 `needs` — the job dependency graph
```yaml
approval-gate:
  needs: triage          # runs only after triage succeeds
developer-agent:
  needs: approval-gate   # runs only after the gate is approved
```
`needs` builds a DAG; a failed ancestor skips (or with `if:` logic, halts)
descendants.

### 2.4 Job outputs — passing decisions between jobs
```yaml
triage:
  outputs:
    valid: ${{ steps.validate.outputs.valid }}   # job reads a step's output
approval-gate:
  needs: triage
  if: needs.triage.outputs.valid == 'true'       # conditional on it
```
This is how the pipeline halts on invalid issues *before* requesting human
approval — a gate for a dead run would be noise.

### 2.5 `if:` conditions
Every job can gate itself: `if: github.event.action == 'opened' &&
github.event.pull_request.draft == true`. The unit-test agent only reacts to
the *first* draft-open of a PR — which is what prevents the
comment→push→comment infinite loop (see §4.4).

### 2.6 Runners & `runs-on`
`ubuntu-latest` = a fresh GitHub-hosted VM per job. Nothing persists between
jobs; every job checks out the repo anew. The agents themselves don't run
here — only the *API calls that summon them* do (§3.3).

### 2.7 The `GITHUB_TOKEN` and permissions
Every run gets an ephemeral token scoped to the repo. Default is read-only in
many setups, so workflows declare what they need (least privilege):
```yaml
permissions:
  issues: write
  pull-requests: write
  contents: read
```
Plus repo setting: Actions → General → Workflow permissions → Read and write.

### 2.8 Personal Access Tokens (PAT) — why both tokens exist
| Token | Lives | Scope | Used for |
|---|---|---|---|
| `GITHUB_TOKEN` | minted per run | this repo only | labels, comments, merge |
| `COPILOT_AGENT_PAT` | you create it, stored in Secrets | your *user* identity | assigning the Copilot bot to issues |

The Copilot agent-assignment API only accepts **user-to-server** tokens —
a PAT. The `GITHUB_TOKEN` is machine-to-server and gets HTTP 422.
That's the single most common failure of this whole pattern.

### 2.9 Secrets
Repo secrets inject values as masked env vars: `secrets.COPILOT_AGENT_PAT`.
Never echo them; never put tokens in YAML.

### 2.10 Concurrency groups — preventing races
```yaml
concurrency:
  group: pr-gate-${{ github.event.pull_request.number }}
  cancel-in-progress: false
```
Two rapid pushes → two gate runs → both try to merge. The group
serializes them per PR (or per issue). Queued, not cancelled, because the
gate *is* the work.

### 2.11 The `gh` CLI
GitHub's CLI is preinstalled on runners; `GH_TOKEN` env authenticates it.
It turns 10-line REST `curl` blocks into one-liners:
`gh pr merge 7 --squash --auto`. Both are used in this repo; `curl` where
the API shape is exotic (agent assignment), `gh` everywhere else.

### 2.12 Check runs vs commit statuses
Two parallel CI reporting systems. Modern = **check runs** (produced by any
Actions job; its name is the check name). The CI gate polls check-runs
filtered by `name == "tests"` — which is why `ci.yml` exists at all:
a wait has no meaning unless something *creates* the thing being waited on.

### 2.13 Artifacts
`actions/upload-artifact` stores files produced by a run (the `dist/` deploy
bundle here, retained 7 days) — the placeholder deploy's "proof".

---

## Level 3 — Orchestration patterns

### 3.1 Event-driven orchestration (no central controller)
Classic orchestrators hold state ("step 4 of 8") in a DB. This pipeline
doesn't: **each stage re-enters through a GitHub event**, and the issue/PR
*is* the state store.

| Event | Stage |
|---|---|
| issue opened/reopened | triage → gate → developer agent |
| PR opened (draft) | unit-test agent |
| PR synchronize | CI gate → review → merge |
| push to main | deploy |

Benefits: restartable (re-open the issue to re-run), observable (the whole
story is in issue/PR comments), stateless (nothing to crash mid-run).

### 3.2 The pipeline-as-comments audit log
Every stage posts a marker comment: 🤖 Orchestrator → 👨‍💻 Developer →
🧪 Unit-test → 🔍 Review → 🚀 Deployed. The comment thread *is* the run log —
no external dashboard, and it's visible to anyone who opens the issue.

### 3.3 Summoning remote agents (Actions as a dispatcher)
The crucial mental model:

```
Actions job  =  the finger that presses the button
Copilot cloud agent  =  the machine (GitHub's infra, its own sandbox,
                        its own auth, opens PRs as copilot-swe-agent[bot])
```

Three summoning mechanisms, one per agent role:

| Agent role | Mechanism | API |
|---|---|---|
| Developer | issue assignment + `agent_assignment` payload | `POST /issues/N/assignees` |
| Unit-test | `@copilot` PR comment (joins the agent's existing session) | `POST /issues/N/comments` |
| Reviewer | add `copilot-pull-request-reviewer[bot]` as reviewer | `POST /pulls/N/requested_reviewers` |

`custom_instructions` in the assignment payload is the developer agent's
briefing: implement fully, keep `npm test` green, open a draft PR with
`Closes #N`.

### 3.4 Human-in-the-loop gates: environments + required reviewers
A job that references an `environment:` with required reviewers **pauses
before executing**. GitHub shows "Review pending", notifies the reviewers,
and resumes (or fails) on their verdict. This single primitive is both
approval gates in the pipeline:

```yaml
approval-gate:
  environment: dev-approval      # ← the entire gate is this line
steps:
  - run: echo "approved, continuing"
```

No custom approval bot, no external ticketing — the notification, the UI,
the audit trail are all native GitHub. Timeout after 7 days = run fails.

### 3.5 Locks and idempotency (re-run safety)
Every merge-side step tolerates being executed twice:
`gh pr ready ... || echo "already ready"`. Workflows *will* re-run (retry
button, duplicate events); steps that assume "only once" are how pipelines
break at 2am. See §4.2.

---

## Level 4 — Hardening patterns (learned from real failures)

### 4.1 Self-healing: repair missing preconditions at point of use
The pipeline's first production bug: the issue template referenced the
`agent-task` label, which only `setup-github.sh` created. Without the script,
every issue died at triage.

Fix — create the precondition right before using it, idempotently:
```yaml
- name: Ensure 'agent-task' label exists
  run: gh label create agent-task ... || echo "Label already exists."
```
Rule: **each stage assumes nothing was provisioned by hand**. The cost of
re-creating a label is zero; the cost of a dead run is a human wondering why.

### 4.2 Idempotent steps
Design every step so running it N times = running it once:
- label create → `|| echo "exists"`
- mark ready → `|| echo "already ready"`
- merge → `--auto`, fall back to `--squash`, fall back to "already merged"

### 4.3 The diff guard — enforce outcomes, not obedience
You instruct the test agent to add tests. It might not. The CI gate
therefore verifies the *outcome* directly:
```bash
# fails the pipeline unless ≥1 changed file starts with tests/
gh api repos/.../pulls/N/files --jq '[.[].filename] | any(startswith("tests/"))'
```
Instruction = best effort; **verification = mandatory**. This pattern
(agent instructions + independent outcome check) is the core trust model of
every agent pipeline.

### 4.4 Loop safety: why the pipeline can't ping-pong itself
Agent pushes → `synchronize` event → gate runs → ...if the gate triggered
agents, they'd push again, forever. The guard: **each reacting job filters
on the exact event it should respond to** (`action == 'opened' &&
draft == true`), so agent-produced `synchronize` events only feed the CI
gate, which never summons agents. Every comment-driven agent loop needs one
event that closes the cycle without re-triggering it.

### 4.5 The polling wait (and its budget)
External agents work asynchronously; Actions jobs can't "await" them, so:
```bash
for i in $(seq 1 60); do
  STATE=$(gh api ...check-runs --jq ...)
  [ "$STATE" = "success" ] && exit 0
  sleep 20
done
echo "::error::Timed out" && exit 1
```
Always: bounded attempts + explicit timeout + `::error::` annotation
(surfaces in the UI). Budget here: 20 min for CI, 10 min for review.

### 4.6 Retry-friendly triggers
Recovery is always the same move: close & reopen the issue (fires
`reopened`), push again (fires `synchronize`), or hit "Re-run jobs". Because
stages are event-driven and idempotent, a re-trigger *is* a repair.

### 4.7 Concurrency + gating on the target, not the clock
Deploy uses `concurrency: group: deploy-dev` so two merges to main can't
deploy simultaneously. Note what the pipeline *doesn't* use: cron/sleeps as
logic. Everything is gated on events and explicit conditions.

### 4.8 Everything is declarative files
The whole pipeline ships as reviewable YAML/markdown in-repo:
workflows, templates, `copilot-instructions.md` (review standards the
review agent reads), `AGENTS.md` (behavioral contract for any coding agent),
and `copilot-setup-steps.yml` (the agent's dev environment: Node 20, deps,
`node --test` smoke run). Change the pipeline by opening a PR — the pipeline
improves itself under the same rules it enforces.

---

## Quick glossary

| Term | One-liner |
|---|---|
| Label | Tag for filtering; must exist before use |
| Check run | A CI result attached to a commit; its name is the check name |
| Draft PR | Work-in-progress PR that cannot be merged |
| Environment (with reviewers) | A native human-approval pause for jobs |
| `needs` | Job dependency edge in the workflow DAG |
| Job outputs | Values passed from one job to dependents |
| `GITHUB_TOKEN` | Ephemeral per-run, repo-scoped, machine identity |
| PAT | Personal token, user identity; required for Copilot assignment |
| Concurrency group | Serialization key that prevents parallel runs racing |
| Self-healing | Step repairs its own missing precondition at point of use |
| Idempotent | Re-running a step produces the same end state |
| Diff guard | Fails the pipeline unless the PR diff meets a structural rule |
| Event-driven orchestration | Stages re-enter via events; issue/PR is the state |
| `agent_assignment` | REST payload that summons the Copilot coding agent onto an issue |
| `@copilot` comment | Steers the *existing* Copilot session on a PR |
