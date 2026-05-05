#!/usr/bin/env bash
# localnet.sh — Start the local Solana validator and seed it with demo campaigns.
#
# Usage:
#   bash localnet.sh          # start validator + seed (default)
#   bash localnet.sh --reset  # kill any running validator first, then start fresh
#   bash localnet.sh --stop   # kill running validator and exit
#
# After this script completes:
#   • solana-test-validator is running in the background on port 8899
#   • 3 demo campaigns are on-chain (open, settled_success, settled_refund)
#   • Open http://localhost:3000/dashboard, enter RPC http://127.0.0.1:8899,
#     click "Connect & Load" to see live campaigns.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_ID="PoEe1hTQghtjuxrbR628JjpNPfLxEDN5GagwqUvJTGA"
PROGRAM_SO="$ROOT/contracts/target/deploy/proof_of_engagement.so"
RPC="http://127.0.0.1:8899"

# ── ANSI colours ─────────────────────────────────────────────────────────────
BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

header()  { echo -e "\n${BOLD}${CYAN}▶ $*${RESET}"; }
ok()      { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}!${RESET} $*"; }
die()     { echo -e "\n${RED}ERROR:${RESET} $*" >&2; exit 1; }

# ── Handle --stop ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
  pkill -f solana-test-validator 2>/dev/null && echo "Stopped solana-test-validator." || echo "Not running."
  exit 0
fi

# ── Handle --reset ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--reset" ]]; then
  pkill -f solana-test-validator 2>/dev/null && warn "Killed existing validator." || true
  sleep 1
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo -e "\n${BOLD}Proof-of-Engagement — localnet${RESET}"
echo "══════════════════════════════════════════"

command -v solana-test-validator &>/dev/null || die "solana-test-validator not found. Install the Solana CLI."
command -v solana               &>/dev/null || die "solana CLI not found."
command -v spl-token            &>/dev/null || die "spl-token CLI not found."
[[ -f "$PROGRAM_SO" ]]                      || die "Program binary not found: $PROGRAM_SO"
[[ -f "$HOME/.config/solana/id.json" ]]     || die "No Solana keypair at ~/.config/solana/id.json. Run: solana-keygen new"

PAYER=$(solana-keygen pubkey "$HOME/.config/solana/id.json")
ok "payer:   $PAYER"
ok "program: $PROGRAM_ID"

# ── Start validator (skip if already running) ─────────────────────────────────
header "solana-test-validator"

if solana -u "$RPC" cluster-version &>/dev/null; then
  warn "Validator already running on $RPC — skipping start."
else
  solana-test-validator \
    --bpf-program "$PROGRAM_ID" "$PROGRAM_SO" \
    --reset \
    --quiet \
    --ledger "$ROOT/scripts/test-ledger" \
    &

  echo -n "  Waiting for validator"
  for i in $(seq 1 20); do
    sleep 1
    if solana -u "$RPC" cluster-version &>/dev/null; then
      echo ""
      ok "Validator up on $RPC"
      break
    fi
    echo -n "."
    if [[ $i -eq 20 ]]; then
      echo ""
      die "Validator did not start after 20 seconds."
    fi
  done
fi

# ── Airdrop SOL to payer ──────────────────────────────────────────────────────
header "Fund payer"
solana -u "$RPC" airdrop 100 "$PAYER" &>/dev/null || warn "Airdrop failed (already funded?)"
BALANCE=$(solana -u "$RPC" balance "$PAYER" 2>/dev/null || echo "unknown")
ok "balance: $BALANCE"

# ── Create USDC-like token mint ────────────────────────────────────────────────
header "Create token mint"
MINT=$(spl-token -u "$RPC" create-token --decimals 6 2>&1 | grep "Address:" | awk '{print $2}')
[[ -n "$MINT" ]] || die "Failed to create token mint."
ok "mint: $MINT"

spl-token -u "$RPC" create-account "$MINT" &>/dev/null
spl-token -u "$RPC" mint "$MINT" 10000000 &>/dev/null
ok "minted 10,000,000 tokens to payer ATA"

# ── Run the TypeScript seed script ────────────────────────────────────────────
header "Seed campaigns"
cd "$ROOT/scripts"

# Install deps if node_modules is missing
[[ -d node_modules ]] || npm install --silent

MINT="$MINT" npm run seed:local

# ── Start frontend (optional) ─────────────────────────────────────────────────
header "Frontend"
echo -e "  Start the Next.js dev server with:"
echo -e "    ${BOLD}cd $ROOT/frontend-next && npm run dev${RESET}"
echo ""
echo -e "  Then open: ${CYAN}http://localhost:3000/dashboard${RESET}"
echo -e "  RPC field: ${CYAN}http://127.0.0.1:8899${RESET}"
echo -e "  Click ${BOLD}Connect & Load${RESET} to see live campaigns."
echo ""
echo "══════════════════════════════════════════"
echo ""
