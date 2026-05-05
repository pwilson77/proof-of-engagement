#!/usr/bin/env bash
# reset.sh — Tear down all build artifacts and rebuild every package from source.
# Usage:
#   bash scripts/reset.sh          # clean + rebuild
#   bash scripts/reset.sh --clean  # clean only (no rebuild)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLEAN_ONLY=false
[[ "${1:-}" == "--clean" ]] && CLEAN_ONLY=true

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Proof-of-Engagement — reset"
echo "═══════════════════════════════════════════════════"

# ── Kill any running dev processes ──────────────────────────────────────────
echo ""
echo "▶ Stopping background processes…"
pkill -f "solana-test-validator" 2>/dev/null && echo "  stopped solana-test-validator" || true
pkill -f "anchor localnet"       2>/dev/null && echo "  stopped anchor localnet"       || true
pkill -f "vite"                  2>/dev/null && echo "  stopped vite dev server"        || true

# ── Clean build artifacts ────────────────────────────────────────────────────
echo ""
echo "▶ Removing build artifacts…"

# TypeScript dist/ outputs
find "$ROOT" -maxdepth 4 -name "dist" -type d \
  -not -path "*/node_modules/*" \
  -exec rm -rf {} + 2>/dev/null || true

# tsbuildinfo incremental caches
find "$ROOT" -maxdepth 4 -name "*.tsbuildinfo" \
  -not -path "*/node_modules/*" \
  -delete 2>/dev/null || true

# Vite / vitest cache
find "$ROOT" -maxdepth 4 -name ".vite" -type d \
  -not -path "*/node_modules/*" \
  -exec rm -rf {} + 2>/dev/null || true

# Anchor build target (Rust artifacts — slow to rebuild; skip unless --clean)
if [[ "$CLEAN_ONLY" == "true" ]]; then
  echo "  (skipping contracts/target — pass --clean to also clean Rust artifacts)"
fi

echo "  ✓ clean complete"

if [[ "$CLEAN_ONLY" == "true" ]]; then
  echo ""
  echo "Clean-only mode — done."
  exit 0
fi

# ── Rebuild TypeScript packages (dependency order) ───────────────────────────
echo ""
echo "▶ Building @poe/validator-agent…"
(cd "$ROOT/agents/validator" && npm run build)
echo "  ✓ @poe/validator-agent"

echo ""
echo "▶ Building @poe/executor-agent…"
(cd "$ROOT/agents/executor" && npm run build)
echo "  ✓ @poe/executor-agent"

echo ""
echo "▶ Building @poe/consensus-orchestrator…"
(cd "$ROOT/agents/consensus" && npm run build)
echo "  ✓ @poe/consensus-orchestrator"

echo ""
echo "▶ Building @poe/sdk…"
(cd "$ROOT/packages/sdk" && npm run build)
echo "  ✓ @poe/sdk"

# ── Install scripts deps ─────────────────────────────────────────────────────
echo ""
echo "▶ Installing scripts dependencies…"
(cd "$ROOT/scripts" && npm install --silent)
echo "  ✓ scripts"

# ── Run off-chain test suites ────────────────────────────────────────────────
echo ""
echo "▶ Running off-chain test suites…"
(cd "$ROOT/agents/validator"  && npm run test:all -- --reporter=verbose 2>&1 | tail -5)
(cd "$ROOT/agents/executor"   && npm run test:all -- --reporter=verbose 2>&1 | tail -5)
(cd "$ROOT/agents/consensus"  && npm run test:all -- --reporter=verbose 2>&1 | tail -5)
(cd "$ROOT/packages/sdk"      && npm run test:all -- --reporter=verbose 2>&1 | tail -5)
echo "  ✓ all tests passed"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Reset complete. Next steps:"
echo ""
echo "  # Run the local demo (stub clients, no Solana needed)"
echo "  cd scripts && npm run demo"
echo ""
echo "  # Or start the frontend dev server"
echo "  cd frontend && npm run dev -- --host 0.0.0.0"
echo ""
echo "  # Or run against a live local validator"
echo "  cd contracts && anchor localnet"
echo "═══════════════════════════════════════════════════"
echo ""
