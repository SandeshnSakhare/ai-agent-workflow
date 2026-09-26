#!/usr/bin/env bash
# Provider fallback chain for the AI agents (issue #11 fix).
#
# Subcommands:
#   agent-provider-chain.sh aider  <prompt-file>   run aider until real changes exist
#   agent-provider-chain.sh review <diff-file>     print an LLM code review to stdout
#
# Providers, tried in order (first healthy one wins, next on failure):
#   1. GitHub Models  — always available (built-in GITHUB_TOKEN)
#   2. OpenRouter     — only if OPENROUTER_API_KEY secret is set
#   3. Google Gemini  — only if GEMINI_API_KEY secret is set
#
# Failover triggers: connection errors / empty responses / no real file
# changes after aider runs. A provider without its secret is skipped.
#
# Environment:
#   GH_MODEL      model id for GitHub Models   (e.g. openai/gpt-4.1-mini)
#   OR_MODEL      model id for OpenRouter      (e.g. deepseek/deepseek-chat-v5:free)
#   GEMINI_MODEL  model id for Gemini direct   (e.g. gemini-2.0-flash)
set -euo pipefail

SUBCOMMAND="${1:-}"
ARG_FILE="${2:-}"

# Real-change detector: ignore the agent's own housekeeping files (issue #10).
has_changes() {
  git status --porcelain | grep -v -E '(\.gitignore$|\.aider)' | grep -q .
}

# --------------------------------------------------------------------------
# Provider health probe: cheap 5-token chat call per provider.
# Prints provider name and exits 0 when healthy, 1 when not.
# --------------------------------------------------------------------------
probe() {
  local name="$1" base="$2" key="$3" model="$4"
  local code
  code=$(curl -sS -o /tmp/probe.json -w '%{http_code}' --max-time 20 \
    -H "Authorization: Bearer ${key}" \
    -H "Content-Type: application/json" \
    "${base}/chat/completions" \
    -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":5}" \
    2>/dev/null || echo "000")
  if [ "${code}" = "200" ]; then
    echo "    probe ${name}: HTTP 200 OK"
    return 0
  fi
  echo "    probe ${name}: HTTP ${code} — $(head -c 200 /tmp/probe.json 2>/dev/null || echo 'no body')"
  return 1
}

# --------------------------------------------------------------------------
# aider <prompt-file>: run aider against one provider; returns 0 only when
# real changes exist in the working tree.
# --------------------------------------------------------------------------
run_aider() {
  local name="$1" model_route="$2" base="$3" key="$4" prompt_file="$5"

  OPENAI_API_BASE="${base}" \
  OPENAI_API_KEY="${key}" \
  aider \
    --model "${model_route}" \
    --message "Implement this task.

$(cat "${prompt_file}")

Rules: keep changes minimal and production-quality; unit tests in tests/
must keep passing (npm test); do not add dependencies." \
    --yes-always \
    --no-auto-commits \
    --no-stream \
    --no-show-model-warnings \
    --no-check-update || true

  if has_changes; then
    echo "    ${name}: agent produced real changes ✓"
    return 0
  fi
  echo "    ${name}: no real changes"
  return 1
}

case "${SUBCOMMAND}" in

  aider)
    PROMPT_FILE="${ARG_FILE:?prompt file required}"
    echo "==> Trying provider chain (implement/test)..."

    # 1. GitHub Models -----------------------------------------------------
    echo "  [1/3] GitHub Models (${GH_MODEL})"
    if probe "github-models" "https://models.github.ai/inference" "${GITHUB_TOKEN:?}" "${GH_MODEL}" \
       && run_aider "github-models" "github/${GH_MODEL}" "https://models.github.ai/inference" "${GITHUB_TOKEN}" "${PROMPT_FILE}"; then
      exit 0
    fi
    git checkout -- . 2>/dev/null || true; git clean -fd --exclude=.aider* 2>/dev/null || true

    # 2. OpenRouter --------------------------------------------------------
    if [ -n "${OPENROUTER_API_KEY:-}" ]; then
      echo "  [2/3] OpenRouter (${OR_MODEL})"
      if probe "openrouter" "https://openrouter.ai/api/v1" "${OPENROUTER_API_KEY}" "${OR_MODEL}" \
         && run_aider "openrouter" "openrouter/${OR_MODEL}" "https://openrouter.ai/api/v1" "${OPENROUTER_API_KEY}" "${PROMPT_FILE}"; then
        exit 0
      fi
      git checkout -- . 2>/dev/null || true; git clean -fd --exclude=.aider* 2>/dev/null || true
    else
      echo "  [2/3] OpenRouter: skipped (OPENROUTER_API_KEY not set)"
    fi

    # 3. Google Gemini -----------------------------------------------------
    if [ -n "${GEMINI_API_KEY:-}" ]; then
      echo "  [3/3] Google Gemini (${GEMINI_MODEL})"
      # Gemini's OpenAI-compatible endpoint
      if probe "gemini" "https://generativelanguage.googleapis.com/v1beta/openai" "${GEMINI_API_KEY}" "${GEMINI_MODEL}" \
         && run_aider "gemini" "gemini/${GEMINI_MODEL}" "https://generativelanguage.googleapis.com/v1beta/openai" "${GEMINI_API_KEY}" "${PROMPT_FILE}"; then
        exit 0
      fi
      git checkout -- . 2>/dev/null || true; git clean -fd --exclude=.aider* 2>/dev/null || true
    else
      echo "  [3/3] Google Gemini: skipped (GEMINI_API_KEY not set)"
    fi

    echo "::error::All providers failed or produced no changes. Add OPENROUTER_API_KEY / GEMINI_API_KEY repo secrets for fallback capacity, or re-run later."
    exit 1
    ;;

  review)
    DIFF_FILE="${ARG_FILE:?diff file required}"
    try_review() {
      local name="$1" base="$2" key="$3" model="$4" system="$5"
      [ -n "${key}" ] || { echo "    ${name}: skipped (no key)"; return 1; }
      echo "    trying ${name} (${model})..."
      local body
      body=$(python3 - "$DIFF_FILE" "${model}" "${system}" <<'PYEOF'
import json, sys
diff, model, system = open(sys.argv[1], encoding="utf-8", errors="replace").read(), sys.argv[2], sys.argv[3]
print(json.dumps({
    "model": model,
    "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": "Review this diff:\n\n" + diff},
    ],
    "max_tokens": 1200,
}))
PYEOF
)
      local resp
      resp=$(curl -sS --max-time 120 \
        -H "Authorization: Bearer ${key}" \
        -H "Content-Type: application/json" \
        "${base}/chat/completions" \
        -d "${body}" 2>/dev/null) || return 1
      echo "${resp}" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d['choices'][0]['message']['content'].strip())
except Exception:
    sys.exit(1)
" || return 1
      echo "    ${name}: review generated ✓"
      return 0
    }

    SYSTEM_PROMPT="You are a rigorous code reviewer. Review the diff for correctness, security, missing tests, and error handling. Be concise. Format: one-paragraph summary, then bullet findings with severity (High/Medium/Low). If it looks good, say so explicitly."

    if try_review "github-models" "https://models.github.ai/inference" "${GITHUB_TOKEN:-}" "${GH_MODEL}" "${SYSTEM_PROMPT}"; then exit 0; fi
    if try_review "openrouter"    "https://openrouter.ai/api/v1"     "${OPENROUTER_API_KEY:-}" "${OR_MODEL}" "${SYSTEM_PROMPT}"; then exit 0; fi
    if try_review "gemini"        "https://generativelanguage.googleapis.com/v1beta/openai" "${GEMINI_API_KEY:-}" "${GEMINI_MODEL}" "${SYSTEM_PROMPT}"; then exit 0; fi

    echo "::warning::All providers failed for review — continuing without a review."
    echo "Review unavailable (all providers failed or rate-limited). Check the Actions logs."
    exit 0   # review is non-blocking by design
    ;;

  *)
    echo "usage: agent-provider-chain.sh {aider <prompt-file> | review <diff-file>}" >&2
    exit 2
    ;;
esac
