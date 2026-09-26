#!/usr/bin/env bash
# One-time GitHub repository setup for the multi-agent pipeline.
# Usage: ./scripts/setup-github.sh [owner/repo]
# Requires: gh CLI (authenticated as a Copilot licensed user with admin on the repo).
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "==> Configuring ${REPO}"

# 1. Labels
gh label create agent-task --repo "${REPO}" --color 1d76db --description "Task queued for the multi-agent pipeline" 2>/dev/null \
  || echo "   label agent-task already exists"

# 2. dev-approval environment: required reviewers = approval gate
gh api --method PUT "repos/${REPO}/environments/dev-approval" \
  --input - <<'JSON'
{
  "wait_timer": 0,
  "reviewers": [],
  "deployment_branch_policy": null
}
JSON
echo "   created environment dev-approval (add yourself as required reviewer in the UI)"

# 3. unittest-approval environment: gates the unit-test agent
gh api --method PUT "repos/${REPO}/environments/unittest-approval" \
  --input - <<'JSON'
{
  "wait_timer": 0,
  "reviewers": [],
  "deployment_branch_policy": null
}
JSON
echo "   created environment unittest-approval (add yourself as required reviewer in the UI)"

# 4. dev-deploy environment (no reviewers; target for deploys)
gh api --method PUT "repos/${REPO}/environments/dev-deploy" --input '{}' >/dev/null
echo "   created environment dev-deploy"

# 5. Auto-merge must be enabled repo-wide for `gh pr merge --auto`
gh api --method PATCH "repos/${REPO}" -f allow_squash_merge=true -f allow_auto_merge=true >/dev/null
echo "   enabled squash merge + auto-merge"

# 6. Branch protection on main: required 'tests' check + 1 approval so the
#    Copilot review approval (when enabled) or a human approval satisfies it.
gh api --method PUT "repos/${REPO}/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["tests"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "   protected main (requires 'tests' check + 1 approval)"

cat <<EOF

==> Manual steps left (Settings UI):
  1. Settings → Environments → dev-approval      → Required reviewers: add YOU
  2. Settings → Environments → unittest-approval → Required reviewers: add YOU
  3. Settings → Secrets → Actions                → add COPILOT_AGENT_PAT (classic PAT, repo scope)
  4. Settings → Actions → General                → Workflow permissions: Read and write
  5. Settings → Copilot                          → enable coding agent; optionally allow Copilot to approve PRs
Done. Now open an issue with the "Agent task" template to start the pipeline.
EOF
