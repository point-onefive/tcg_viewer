#!/usr/bin/env bash
# ==============================================================================
# vps-daily-refresh.sh
#
# Full daily pricing refresh for tcg_viewer:
#   1. Hard-sync repo to origin/main (this node is a data PRODUCER, never a
#      source of code; it must always mirror origin and never diverge)
#   2. Run op_hub  -> prices + history for One Piece  (TCGPlayer)
#   3. Run Gundam  -> prices + history for Gundam      (eBay Browse API)
#   4. Run Pokémon -> prices + history for Pokémon     (pokemontcg.io / TCGplayer)
#   5. Run Lorcana -> prices + history for Lorcana     (Lorcast / TCGplayer)
#   6. Commit + push pricing data + a refresh-status.json heartbeat
#   7. Ping a healthcheck URL on success (optional)
#
# Run manually:   bash scripts/market/vps-daily-refresh.sh
# Dry run:        bash scripts/market/vps-daily-refresh.sh --dry-run
#
# Cron (3:00 AM daily):
#   0 3 * * * OP_HUB_DIR=/home/openclaw/one_piece_current_events \
#     cd /home/openclaw/tcg_viewer && \
#     bash scripts/market/vps-daily-refresh.sh >> /home/openclaw/tcg-daily.log 2>&1
#
# Optional cron env for dead-man alerts (e.g. healthchecks.io):
#   HEALTHCHECK_URL=https://hc-ping.com/your-uuid
# ==============================================================================

# NOTE: we deliberately do NOT use `set -e`. A failure in one pricing source
# (e.g. eBay rate-limit) must not prevent the other source from publishing.
# Errors are tracked explicitly and reported in the status heartbeat.
set -uo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo ""
echo "================================================"
echo "  TCG Viewer - daily pricing refresh  $TS"
$DRY_RUN && echo "  [DRY RUN - no git push]"
echo "================================================"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "  x cannot cd to repo root"; exit 1; }
echo "  repo: $REPO_ROOT"

# Collect non-fatal failures so we can report them at the end without aborting.
FAILURES=()
fail() { echo "  x $1"; FAILURES+=("$1"); }

# --- 1. Hard-sync to origin/main ----------------------------------------------
# A producer node must never carry its own commits. We fetch and hard-reset so
# the tree can never diverge (the bug that silently stalled this cron before).
# `reset --hard` does NOT touch untracked/ignored files such as .env.local.
echo ""
echo "> git fetch origin && reset --hard origin/main"
if git fetch origin --quiet && git reset --hard origin/main; then
  echo "  ok synced to origin/main ($(git rev-parse --short HEAD))"
else
  # If we cannot sync, abort hard: running stale code or pushing into a
  # divergent state is worse than skipping a night.
  echo "  x failed to sync to origin/main - aborting this run"
  exit 1
fi

# --- 2. One Piece pricing via op_hub ------------------------------------------
# op_hub lives at /home/openclaw/one_piece_current_events on the VPS.
# Binary: $OP_HUB_DIR/.venv/bin/op-hub
# ``pricing daily`` runs the full pipeline: TCGTracking sync (cards + boxes)
# followed by JSON export. This replaces the old ``export-card-wall``-only call
# which skipped the box sync and left pricing-boxes-one-piece.json stale.
OP_HUB_DIR="${OP_HUB_DIR:-/home/openclaw/one_piece_current_events}"

echo ""
echo "> One Piece pricing (op_hub)"
if [ -d "$OP_HUB_DIR" ]; then
  OP_HUB_BIN="$OP_HUB_DIR/.venv/bin/op-hub"
  if [ ! -f "$OP_HUB_BIN" ]; then
    OP_HUB_BIN=$(find "$OP_HUB_DIR" -path "*/bin/op-hub" -type f 2>/dev/null | head -1)
  fi
  if [ -z "$OP_HUB_BIN" ]; then
    fail "op-hub binary not found in $OP_HUB_DIR - skipped One Piece pricing"
  else
    if ( cd "$OP_HUB_DIR" && "$OP_HUB_BIN" pricing daily ); then
      echo "  ok op_hub daily (sync + export) complete"
    else
      fail "op_hub export failed (exit $?)"
    fi
  fi
else
  fail "OP_HUB_DIR not found ($OP_HUB_DIR) - skipped One Piece pricing"
fi

# --- 3. Gundam pricing via eBay Browse API ------------------------------------
# fetch-gundam-pricing.mjs writes pricing-gundam.json + price-history-gundam.json.
# Credentials come from .env.local (EBAY_APP_ID / EBAY_CERT_ID / EBAY_MARKETPLACE).
echo ""
echo "> Gundam pricing (eBay Browse API)"
if node scripts/market/fetch-gundam-pricing.mjs --force; then
  echo "  ok Gundam pricing complete"
else
  fail "Gundam pricing failed (exit $?)"
fi

# --- 3b. Pokémon pricing via pokemontcg.io -------------------------------------
# TCGplayer market prices embedded in the catalog API. POKEMONTCG_API_KEY in
# .env.local lifts the rate limit but is optional (script self-throttles).
echo ""
echo "> Pokémon pricing (pokemontcg.io / TCGplayer)"
if node scripts/market/fetch-pokemon-pricing.mjs; then
  echo "  ok Pokémon pricing complete"
else
  fail "Pokémon pricing failed (exit $?)"
fi

# --- 3c. Lorcana pricing via Lorcast -------------------------------------------
# TCGplayer USD prices from the Lorcast community API. No credentials needed.
echo ""
echo "> Lorcana pricing (Lorcast / TCGplayer)"
if node scripts/market/fetch-lorcana-pricing.mjs; then
  echo "  ok Lorcana pricing complete"
else
  fail "Lorcana pricing failed (exit $?)"
fi

# --- 4. Write status heartbeat ------------------------------------------------
# A committed heartbeat means a missed/failed night is visible immediately in
# git history (and on the deployed site) instead of going unnoticed for days.
FINISHED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ ${#FAILURES[@]} -eq 0 ]; then
  STATUS="ok"
  FAIL_JSON="[]"
else
  STATUS="partial"
  FAIL_JSON=$(printf '%s\n' "${FAILURES[@]}" \
    | sed 's/\\/\\\\/g; s/"/\\"/g' \
    | awk 'BEGIN{printf "["} {printf "%s\"%s\"", (NR>1?",":""), $0} END{printf "]"}')
fi
STATUS_FILE="src/lib/refresh-status.json"
printf '{\n  "status": "%s",\n  "startedAt": "%s",\n  "finishedAt": "%s",\n  "failures": %s\n}\n' \
  "$STATUS" "$TS" "$FINISHED" "$FAIL_JSON" > "$STATUS_FILE"
echo ""
echo "> status: $STATUS  (failures: ${#FAILURES[@]})"

# --- 5. Commit + push any changes ---------------------------------------------
TRACKED_FILES=(
  src/lib/pricing-one-piece.json
  src/lib/price-history-one-piece.json
  src/lib/pricing-boxes-one-piece.json
  src/lib/pricing-meta.json
  src/lib/pricing-gundam.json
  src/lib/price-history-gundam.json
  src/lib/pricing-pokemon.json
  src/lib/price-history-pokemon.json
  src/lib/pricing-lorcana.json
  src/lib/price-history-lorcana.json
  "$STATUS_FILE"
)

CHANGED=$(git status --porcelain "${TRACKED_FILES[@]}" 2>/dev/null || true)

echo ""
if [ -z "$CHANGED" ]; then
  echo "ok All pricing files unchanged - nothing to commit."
else
  NOW=$(date -u +"%Y-%m-%d %H:%M")
  git add "${TRACKED_FILES[@]}" 2>/dev/null || true
  git commit -m "chore: daily pricing refresh ${NOW} (${STATUS})" || true

  if $DRY_RUN; then
    echo "  [DRY RUN] Would have pushed now."
  else
    if git push origin main; then
      echo "ok Pushed -> Vercel auto-deploy triggered (~60s)"
    else
      fail "git push failed"
    fi
  fi
fi

# --- 6. Healthcheck ping (optional) -------------------------------------------
# Only ping success when there were zero failures, so a dead-man monitor alerts
# you on a fully-failed OR partial night.
if [ -n "${HEALTHCHECK_URL:-}" ] && ! $DRY_RUN; then
  if [ ${#FAILURES[@]} -eq 0 ]; then
    curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null 2>&1 \
      && echo "ok healthcheck pinged" || echo "  ! healthcheck ping failed"
  else
    curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL}/fail" >/dev/null 2>&1 \
      && echo "  ! healthcheck fail-pinged" || true
  fi
fi

echo ""
echo "=== done  $(date -u +"%Y-%m-%dT%H:%M:%SZ")  status=$STATUS ==="

# Non-zero exit on failure so the cron MTA / log shows it clearly.
[ ${#FAILURES[@]} -eq 0 ] || exit 2
