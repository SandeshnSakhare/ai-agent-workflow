# Implementation Log — Issues Hit While Building the Pipeline & How We Fixed Them

A chronological record of every real problem encountered while building and
operating this pipeline, with root causes, fixes, and lessons. Reading this
end-to-end is the fastest way to understand *why* the pipeline looks the way
it does. The current flow is documented in
[`PIPELINE_FLOW.md`](./PIPELINE_FLOW.md); background concepts in
[`CONCEPTS.md`](./CONCEPTS.md).

---

## Issue 1 — `package.json` did not parse (`EJSONPARSE`)

**Where:** local verification, first `npm test` run

**What we saw**
```
npm error JSON.parse Invalid package.json: Expected double-quoted property
name in JSON at position 193 (line 8 column 3)
```

**Root cause** — a trailing comma after the last array element:
```json
"scripts": { "test": "node --test", }   ← comma before }
```
Valid in JS objects, illegal in JSON.

**Fix** — removed the trailing comma.

**Lesson** — always run the tool against generated config immediately; JSON
parsers fail loudly but only at *use* time, not at write time.

---

## Issue 2 — Workflow YAML failed to parse (`mapping values are not allowed here`)

**Where:** local YAML validation of `pr-quality-gate.yml`

**What we saw**
```
line 59, column 13: mapping values are not allowed here
```

**Root cause** — an unquoted YAML scalar containing a colon:
```yaml
name: CI: unit tests must pass     # YAML sees "CI" then a nested mapping
```

**Fix** — quote any value that contains `:` :
```yaml
name: "CI: unit tests must pass"
```

**Found while validating, and fixed in the same pass:**

- **`runs-on: unittest-approval`** — a serious design bug: `runs-on` selects
  a *runner label*. A self-hosted runner with that label doesn't exist, so
  the job would queue forever. The human gate was meant to come from the
  `environment:` key — moved it there, set `runs-on: ubuntu-latest`.
- **`LOGIN` variable typo** in the review-wait script (assigned but the
  `if` checked another name) — renamed consistently (`REVIEW_STATE`).

**Lesson** — three bug classes (YAML colon, runner-label confusion,
dead variable) all invisible to the eye, all caught by two commands:
`yaml.safe_load_all()` and a careful read of the final file. Validate
artifacts, not intentions.

---

## Issue 3 — The gate could merge before the test agent pushed tests

**Where:** design audit, before the first real run

**Root cause** — the merge logic waited for the `tests` check and review,
but a draft PR already passes both: the seed tests exist, and nothing
forced new tests. The pipeline would merge implementation-only PRs —
the unit-test stage would be theater.

**Fix — the diff guard** (in `pr-quality-gate.yml` → `ci-gate`):
```bash
gh api "repos/.../pulls/N/files?per_page=100" --paginate \
  --jq '[.[].filename] | any(startswith("tests/"))'
```
The pipeline fails unless the PR diff actually touches `tests/`.
Instruction ("add tests") is best-effort; **verification of the outcome is
mandatory**.

**Related hardening in the same pass:**

- **Missing check producer** — the gate waits for a check-run named
  `tests`, but *no workflow created one*. Added **`ci.yml`** (job key
  `tests`), otherwise every run would time out after 20 minutes.
- **Missing `--repo` flags** — jobs that call `gh` without checking out the
  repo have no way to infer `owner/repo`; all `gh` calls now pass
  `--repo "${{ github.repository }}"` explicitly.
- **Idempotency** — `gh pr ready ... || echo "already ready"`, merge with
  `--auto` → direct-squash fallback → "already merged" fallback. Workflow
  re-runs must be harmless.
- **Loop safety** — the unit-test job reacts only to
  `action == 'opened' && draft == true`; the test agent's own pushes are
  `synchronize` events that only feed the CI gate, which never summons
  agents. No comment→push→comment ping-pong is possible.

**Lesson** — an orchestrator must not trust its agents. Every "agent, please
do X" needs an independent, structural check that X happened.

---

## Issue 4 — `'agent-task' not found` (first production failure)

**Where:** repo run #1, job "Triage & acknowledge issue"

**What we saw**
```
failed to update .../issues/1: 'agent-task' not found
Error: Process completed with exit code 1.
```

**Root cause** — the workflow applied a label that was never created in the
repo. Labels must **exist** before they can be attached; the issue template
had also referenced it, and GitHub *silently skips* template labels that
don't exist — so nothing ever created it.

**Fix — self-healing at the point of use** (`orchestrator.yml`):
```yaml
- name: Ensure 'agent-task' label exists
  run: gh label create agent-task ... || echo "Label already exists."
```
The label is now created right before it is used, idempotently. No manual
provisioning required, on any repo, ever again.

**Lesson** — don't ship preconditions that depend on a manual setup script
having been run. Repair missing preconditions where they are consumed.

---

## Issue 5 — `curl: (22) The requested URL returned error: 401`

**Where:** repo run, job "Agent: developer (Copilot coding agent)"

**What we saw** — the run log showed:
```
env:
  GH_TOKEN:                    ← empty!
curl: (22) The requested URL returned error: 401
```

**Root cause** — the `COPILOT_AGENT_PAT` secret was missing/empty in repo
settings. GitHub Actions doesn't error on missing secrets; it substitutes an
empty string. The request therefore went out as
`Authorization: Bearer ` — unauthenticated → HTTP 401 ("no valid identity"),
not 403 ("identity known, not allowed").

**Fix, two layers:**

1. **User action:** create a classic PAT (`repo` scope) with the
   Copilot-licensed account → add as **repository** secret
   `COPILOT_AGENT_PAT` (not an environment secret — those are invisible to
   jobs without that environment).
2. **Workflow hardening (fail fast):** a pre-flight step:
   ```yaml
   - name: Verify agent token is configured
     run: |
       if [ -z "${GH_TOKEN}" ]; then
         echo "::error::The COPILOT_AGENT_PAT secret is missing or empty. ..."
         exit 1
       fi
   ```
   Now the run fails in seconds with instructions, not with a cryptic
   curl exit code.

**Lesson** — missing secrets degrade silently. Any workflow step that
depends on a secret should assert its presence first, with an error message
that names the exact fix.

---

## Issue 6 — The approval gate never asked for approval

**Where:** repo run, job "Gate: human approval (dev-approval)"

**What we saw**
```
Run echo "Environment 'dev-approval' approved."
Environment 'dev-approval' approved.
Continuing to developer-agent assignment.
```
No prompt anywhere; the job blew straight through its own gate.

**Root cause — two documented GitHub behaviors, stacked:**

1. **Plan restriction:** *"If you are on a GitHub Free, GitHub Pro, or
   GitHub Team plan, required reviewers are only available for **public**
   repositories."* (GitHub Docs — Deployments and environments). This repo
   is private on the Free plan → the reviewers configured on the
   environment are simply **not enforced**. No error, no warning.
2. **Admin bypass:** by default, repository administrators bypass
   environment protection rules — and in a personal repo you are the admin.

The `environment:` line in the workflow was correct; the *mechanism* was
unavailable for this plan/visibility combination.

**Fix — v2 redesign: comment-command gates.** New workflow
`approval-handler.yml` listens for `issue_comment.created` and dispatches on
slash commands:

| Command | Works on | Authored by |
|---|---|---|
| `/approve` | issue | OWNER/MEMBER/COLLABORATOR only |
| `/approve-tests` | pull request | OWNER/MEMBER/COLLABORATOR only |
| `/deny` | either | OWNER/MEMBER/COLLABORATOR only |

- Authorization via `github.event.comment.author_association` — drive-by
  users on a public repo cannot trigger agents.
- The pipeline *parks* after triage; the issue thread is the approval
  queue; the comment is the auditable approval record.
- Works on **every plan and repo visibility**, event-driven, no polling.
- The old environment gates remain **opt-in** for public/Business repos:
  set repo variable `ENABLE_ENV_GATES=1` + configure required reviewers.

**Lesson** — verify that a native mechanism actually applies to *your plan
and repo visibility* before building an architecture on it. "It works on
GitHub.com" is not evidence; the docs' plan-availability notes are.

---

## Issue 7 — `/approve-tests` on the issue → run "Skipped"

**Where:** repo run, Approval Handler (after v2)

**What we saw** — user posted `/approve-tests` on **issue #2**; the run
shows all three gate jobs (and the whole run) as **Skipped**, 7s, nothing
happens. Additionally, `/approve` had not been posted yet, so no PR even
existed for tests to be approved on.

**Root cause** — the commands are context-sensitive by design:
`/approve-tests` requires the comment to be on a **pull request**
(`github.event.issue.pull_request != null` — comments on PRs are stored as
issues, which is how the workflow discriminates). On an issue, no job's
`if:` matches → GitHub marks the run Skipped. Correct behavior, but
**silent** — the user had no idea why nothing happened.

**Fix — the `guidance` job:** when a maintainer posts a command in the
wrong place, the workflow now replies with a hint instead of silence:
> *ℹ️ `/approve-tests` is a **pull request** command — post it on the PR
> that the developer agent creates. To start work on this issue, comment
> `/approve`.*

(vice-versa hint for `/approve` posted on a PR.)

**Lesson** — "silently ignored" is the worst possible UX for a command
interface. Every rejected input deserves a human-readable explanation,
even when the rejection is correct.

---

## Issue 8 — `GitHub Actions is not permitted to create or approve pull requests`

**Where:** repo run, agent-runtime (implement), step `Open draft pull request`

**What we saw** — the agent itself worked end-to-end (aider installed,
implemented the issue, pushed `agent/implement-issue-5`), but the final
step failed:
```
pull request create failed: GraphQL: GitHub Actions is not permitted to
create or approve pull requests (createPullRequest)
```

**Root cause** — a repository setting, **off by default**: Settings →
Actions → General → Workflow permissions → "Allow GitHub Actions to create
and approve pull requests". GitHub disables it to prevent CI from
self-approving PRs; any bot that creates PRs via the built-in `GITHUB_TOKEN`
hits this GraphQL error.

**Fix** — enable the checkbox (Settings → Actions → General → Workflow
permissions). The runtime was also hardened for the resulting re-run case:
the implement job now force-pushes its branch, so a second attempt after a
partial failure replaces the stale branch instead of diverging.

**Lesson** — token *permissions* have two layers: what the workflow
`permissions:` block requests, and what the repo settings allow the Actions
token to do at all. The second layer is invisible until the first API call
that crosses it.

---

## Issue 9 — `Empty response received from LLM` + non-fast-forward push

**Where:** repo re-run, agent-runtime (implement)

**What we saw**
```
Empty response received from LLM. Check your provider account?
Tokens: 3.4k sent, 0 received.
[agent/implement-issue-5 6fd304f] feat: ... 1 file changed, 1 insertion(+)
 → .gitignore only
 ! [rejected] agent/implement-issue-5 -> agent/implement-issue-5 (non-fast-forward)
```

**Root causes — two, stacked:**

1. **Model-ID mismatch (aider ↔ GitHub Models).** Aider's `openai/` prefix
   selects its OpenAI-compatible *client*; GitHub Models additionally uses
   `vendor/model` ids like `openai/gpt-4.1-mini`. Passing aider just
   `openai/gpt-4.1-mini` (our input) hit the endpoint with an identifier it
   could not resolve → the model returned **0 tokens**. Aider exited 0
   anyway (it treats an empty response as non-fatal), so the job continued
   and committed only its own `.gitignore` churn.
2. **Old YAML on re-run.** The re-run executed the pre-`--force` workflow
   (the fix wasn't pushed to `main` first), so the plain push was rejected
   non-fast-forward against the previous run's real implementation branch.

**Fixes**
- Correct model string: `AIDER_MODEL = openai/` + `vendor/model`
  (e.g. `openai/openai/gpt-4.1-mini` for the default input).
- 3-attempt retry loop that only accepts a run when the working tree has
  real changes (ignoring `.gitignore`), then fails loudly after 3.
- `--no-gitignore` so aider stops polluting the commit with .gitignore edits.
- Force-push retained for idempotent re-runs — and the ordering rule is now
  explicit: **push workflow changes to `main` BEFORE re-running.**

**Lesson** — when an integration has two layers of namespacing
(aider's client prefix + the provider's model id), compose both explicitly
and verify with the cheapest possible call before burning an agent run.
Also: an agent exiting 0 without doing the work is worse than crashing —
always verify *outcomes*, not exit codes.

---

## Issue 10 — Aider committed its own `.aider*` logs instead of code (and the retry check was fooled)

**Where:** repo run, agent-runtime (implement), PR Files-changed review

**What we saw** — the PR diff contained `.aider.chat.history.md`,
`.aider.input.history`, `.aider.tags.cache.v4/cache.db` — and **zero code
changes**. The chat history showed `Empty response received from LLM`.

**Root causes — three, all mine:**

1. **`--no-gitignore` backfired.** Added in issue #9's fix to stop
   `.gitignore` churn, it actually disabled aider's *built-in* protection
   that gitignores its own `.aider*` files. Untracked caches then got swept
   into `git add -A`.
2. **The retry check counted junk as success.** `has_changes()` excluded
   only `.gitignore`, so the `.aider*` files looked like "agent produced
   changes" — the loop never retried the empty response.
3. **The double-prefix model id was still wrong.**
   `openai/openai/gpt-4.1-mini` (my issue-9 guess) still returned empty —
   see the chat history in the PR diff.

**Fixes**
- Removed `--no-gitignore`; added `--no-stream` (another known cause of
  empty responses through proxies).
- `has_changes()` now excludes `.gitignore` AND `.aider*`; a defensive
  `git rm --cached .aider*` runs before commit.
- Switched the model route to litellm's **native** GitHub Models provider:
  `AIDER_MODEL = github/<vendor>/<model>` (e.g.
  `github/openai/gpt-4.1-mini`), with `GITHUB_TOKEN` exported for litellm —
  documented path instead of the OpenAI-prefix guesswork.

**Lesson** — read the artifacts your agent leaves behind (chat history,
 caches) before trusting a green run: this failure was fully diagnosed from
 the committed `.aider.chat.history.md`. And a retry-guard must exclude the
 *tool's own* byproducts, or it will mistake noise for work.

---

## Timeline summary

| # | Symptom | Class of bug | Permanent fix |
|---|---|---|---|
| 1 | `EJSONPARSE` on package.json | config authoring | removed trailing comma; validate immediately |
| 2 | YAML parse error; runner-label bug; dead variable | config authoring + design | quoted scalars; `environment:` for gates; validate all YAML |
| 3 | Pipeline could merge without new tests | trust model | diff guard; ci.yml check producer; idempotent merge; loop-proof event filters |
| 4 | `'agent-task' not found` | missing precondition | self-healing label creation |
| 5 | `401` on agent assignment | missing secret | repo secret + pre-flight `::error::` |
| 6 | Approval gate never paused | platform plan limitation | comment-command gates (v2); env gates opt-in |
| 7 | Command run "Skipped", no feedback | silent rejection | `guidance` hint job |
| 8 | Actions can't create the PR (GraphQL error) | repo settings layer | enable "Allow GitHub Actions to create and approve pull requests"; force-push for re-run safety |
| 9 | Empty LLM response (0 tokens) + non-fast-forward push | double-namespaced model id; stale YAML on re-run | `AIDER_MODEL=openai/<vendor>/<model>`; 3-attempt retry + outcome check; push fixes before re-running |
| 10 | PR contained aider's own logs, no code; retries fooled | `--no-gitignore` disabled aider's self-ignore; retry check counted junk; prefix guess wrong | drop flag, exclude `.aider*` in check + scrub before commit; litellm `github/` provider route |

---

## Key takeaways (the meta-lessons)

1. **Preconditions fail silently.** Missing labels, missing secrets, and
   unavailable features all manifest as confusing downstream errors (422,
   401, Skipped, or nothing). Assert every precondition at the point of use
   with an error message that names the fix.
2. **Trust is structural, not verbal.** Agent instructions are wishes; the
   diff guard, check-run waits, and required checks are the actual contract.
3. **Platform features have plan/visibility/permission fine print.**
   Environment reviewers (public-only on Free), user-to-server tokens (PAT
   for Copilot assignment), author_association (authorization) — each was a
   hard boundary discovered only by testing or doc-diving.
4. **Design for re-runs.** Every step is idempotent, every state is
   re-enterable via a new event, and closing/reopening or re-commenting
   repairs a stuck pipeline without touching code.
5. **Silence is a bug.** Skipped jobs, empty secrets, skipped template
   labels — all did nothing while appearing to work. The fixes lean toward
   *visible* behavior: hint comments, `::error::` annotations, audit
   comments at every stage.
