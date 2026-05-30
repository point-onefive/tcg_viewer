#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# vps-daily-refresh.sh
#
# Full daily pricing refresh for tcg_viewer:
#   1. Pull latest code from main
#   2. Run op_hub  → prices + history for One Piece  (TCGPlayer)
#   3. Run Gundam  → prices + history for Gundam      (eBay Browse API)
#   4. Commit + push any changes → triggers Vercel auto-deploy
#
# Run manually:   bash scripts/market/vps-daily-refresh.sh
# Dry run:        bash scripts/market/vps-daily-refresh.sh --dry-run
#
# Cron (3:00 AM daily):
#   0 3 * * * cd /root/tcg_viewer && bash scripts/market/vps-daily-refresh.sh >> /var/log/tcg-daily.log 2>&1
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TCG Viewer — daily pricing refresh  $TS"
$DRY_RUN && echo "  [DRY RUN — no git push]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
echo "  repo: $REPO_ROOT"

# ─── 1. Pull latest ───────────────────────────────────────────────────────────
echo ""
echo "▶ git pull origin main"
git pull origin main

# ─── 2. One Piece pricing via op_hub ─────────────────────────────────────────
# op_hub is a separate Python project. Adjust OP_HUB_DIR to its location on
# the VPS. The export command writes:
#   src/lib/pricing-one-piece.json
#   src/lib/price-history-one-piece.json
#   src/lib/pricing-meta.json
# to this repo directory.
OP_HUB_DIR="${OP_HUB_DIR:-/root/op_hub}"

echo ""
echo "▶ One Piece pricing (op_hub)"
if [ -d "$OP_HUB_DIR" ]; then
  cd "$OP_HUB_DIR"
  # Activate virtualenv if present
  if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
  elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
  fi
  # Run the export — writes directly into the tcg_viewer repo path
  python -m op_hub pricing export-card-wall --out "$REPO_ROOT/src/lib"
  echo "  ✓ op_hub export complete"
  cd "$REPO_ROOT"
else
  echo "  ⚠ OP_HUB_DIR not found ($OP_HUB_DIR) — skipping One Piece pricing"
  echo "    Set OP_HUB_DIR=/path/to/op_hub or add to cron environment"
fi

# ─── 3. Gundam pricing via eBay Browse API ────────────────────────────────────
# fetch-gundam-pricing.mjs writes:
#   src/lib/pricing-gundam.json
#   src/lib/price-history-gundam.json
#
# Credentials come from .env.local in the repo root:
#   EBAY_APP_ID=...
#   EBAY_CERT_ID=...
#   EBAY_MARKETPLACE=EBAY_US

echo ""
echo "▶ Gundam pricing (eBay Browse API)"
node scripts/market/fetch-gundam-pricing.mjs --force
echo "  ✓ Gundam pricing complete"

# ─── 4. Commit + push any changes ────────────────────────────────────────────
CHANGED=$(git status --porcelain \
  src/lib/pricing-one-piece.json \
  src/lib/price-history-one-piece.json \
  src/lib/pricing-meta.json \
  src/lib/pricing-gundam.json \
  src/lib/price-history-gundam.json \
  2>/dev/null || true)

echo ""
if [ -z "$CHANGED" ]; then
  echo "✓ All pricing files unchanged — nothing to commit."
else
  NOW=$(date -u +"%Y-%m-%d %H:%M")
  git add \
    src/lib/pricing-one-piece.json \
    src/lib/price-history-one-piece.json \
    src/lib/pricing-meta.json \
    src/lib/pricing-gundam.json \
    src/lib/price-history-gundam.json \
    2>/dev/null || true

  git commit -m "chore: daily pricing refresh ${NOW}"

  if $DRY_RUN; then
    echo "  [DRY RUN] Would have pushed now."
  else
    git push origin main
    echo "✓ Pushed → Vercel auto-deploy triggered (~60s)"
  fi
fi

echo ""
echo "━━━ done  $(date -u +"%Y-%m-%dT%H:%M:%SZ") ━━━"
