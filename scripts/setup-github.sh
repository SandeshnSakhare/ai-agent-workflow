#!/usr/bin/env bash
# One-time GitHub repository setup for the multi-agent pipeline.
# Usage: ./scripts/setup-github.sh [owner/repo] [github-username]
#   - arg 2 sets that user as REQUIRED REVIEWER on the gate environments.
#     Without it, the approval gates DO NOT PAUSE (environments with no
#     reviewers run straight through).
# Requires: gh CLI (authenticated as a Copilot licensed user with admin on the repo).
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
USER_LOGIN="${2:-}"
echo "==> Configuring ${REPO}"

# 1. Labels
gh label create agent-task --repo "${REPO}" --color 1d76db --description "Task queued for the multi-agent pipeline" 2>/dev/null \
  || echo "   label agent-task already exists"

# 2-4. Environments. Passing arg 2 sets that user as required reviewer on the
#      two gate environments — this is what makes the gates actually pause.
if [ -n "${USER_LOGIN}" ]; then
  USER_ID="$(gh api "users/${USER_LOGIN}" --jq .id)"
fi

for ENTRY in "dev-approval:gate" "unittest-approval:gate" "dev-deploy:nogate"; do
  ENV_NAME="${ENTRY%%:*}"
  KIND="${ENTRY##*:}"
  if [ "${KIND}" = "gate" ] && [ -n "${USER_ID:-}" ]; then
    BODY="{\"wait_timer\":0,\"reviewers\":[{\"type\":\"User\",\"id\":${USER_ID}}],\"deployment_branch_policy\":null}"
  else
    BODY='{"wait_timer":0,"reviewers":[],"deployment_branch_policy":null}'
  fi
  gh api --method PUT "repos/${REPO}/environments/${ENV_NAME}" --input - <<< "${BODY}" >/dev/null
  if [ "${KIND}" = "gate" ] && [ -n "${USER_ID:-}" ]; then
    echo "   environment ${ENV_NAME}: required reviewer = ${USER_LOGIN} ✓"
  elif [ "${KIND}" = "gate" ]; then
    echo "   environment ${ENV_NAME}: NO reviewers — gate will NOT pause. Re-run with your username as arg 2."
  else
    echo "   environment ${ENV_NAME}: created (deploy target, no reviewers needed)"
  fi
done

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

==> Remaining manual steps (Settings UI):
  1. Settings → Environments → dev-approval      → Required reviewers: add YOU   (skip if setup ran with arg 2)
  2. Settings → Environments → unittest-approval → Required reviewers: add YOU   (skip if setup ran with arg 2)
  3. Settings → Secrets → Actions                → add COPILOT_AGENT_PAT (classic PAT, repo scope)
  4. Settings → Actions → General                → Workflow permissions: Read and write
  5. Settings → Copilot                          → enable coding agent; optionally allow Copilot to approve PRs
Done. Now open an issue with the "Agent task" template to start the pipeline.
EOF
