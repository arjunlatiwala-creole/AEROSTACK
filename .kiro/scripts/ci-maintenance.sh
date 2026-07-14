#!/usr/bin/env bash
# Agentic CI maintenance sweep.
# Scans .github/workflows/*.yml for pinned GitHub Action major versions, compares
# each against the latest published release, and flags actions whose pinned major
# is behind (the usual cause of "Node.js NN is deprecated" runner warnings).
#
# Read-only: prints a report and sets exit code 1 if drift is found (0 if clean).
# Requires: gh (authenticated) for release lookups. Used by:
#   - .github/workflows/ci-maintenance.yml (weekly cron → Slack)
#   - .kiro hook "CI Maintenance Sweep" (on-demand, agent opens bump PRs)
set -uo pipefail

WF_DIR="${WF_DIR:-.github/workflows}"
drift=0
report=""

# Collect unique "owner/repo@vMAJOR" action pins across all workflow files.
pins=$(grep -rhoE 'uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@v[0-9]+' "$WF_DIR" 2>/dev/null \
  | sed -E 's/.*uses:[[:space:]]*//' | sort -u)

if [ -z "$pins" ]; then
  echo "No pinned actions found under $WF_DIR"
  exit 0
fi

while IFS= read -r pin; do
  pin=$(echo "$pin" | tr -d '[:space:]')   # trim stray whitespace
  [ -z "$pin" ] && continue
  repo="${pin%@*}"
  cur="${pin#*@v}"           # current major (number after @v)
  latest_tag=$(gh release view --repo "$repo" --json tagName --jq '.tagName' 2>/dev/null || true)
  if [ -z "$latest_tag" ]; then
    report+="• ${pin} — could not resolve latest (skipped)\n"
    continue
  fi
  latest_major=$(echo "$latest_tag" | sed -E 's/^v?([0-9]+).*/\1/')
  if [ -n "$latest_major" ] && [ "$cur" -lt "$latest_major" ] 2>/dev/null; then
    report+="• ${repo}: pinned @v${cur} → latest ${latest_tag} (BEHIND)\n"
    drift=1
  else
    report+="• ${repo}: @v${cur} (current)\n"
  fi
done <<< "$pins"

echo -e "Aerostack CI action-version sweep ($(date -u +%Y-%m-%dT%H:%MZ)):"
echo -e "$report"

if [ "$drift" -eq 1 ]; then
  echo "RESULT: drift detected — action majors are behind latest."
  # Export for callers (workflow Slack step reads CI_MAINT_REPORT/CI_MAINT_DRIFT).
  { echo "CI_MAINT_DRIFT=1"; printf 'CI_MAINT_REPORT<<EOF\n%b\nEOF\n' "$report"; } >> "${GITHUB_ENV:-/dev/null}" 2>/dev/null || true
  exit 1
fi
echo "RESULT: all action majors current."
{ echo "CI_MAINT_DRIFT=0"; printf 'CI_MAINT_REPORT<<EOF\n%b\nEOF\n' "$report"; } >> "${GITHUB_ENV:-/dev/null}" 2>/dev/null || true
exit 0
