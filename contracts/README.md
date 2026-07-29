# TournamentEscrow (paid tournaments, Base USDC)

Solidity escrow that custodies entry fees, computes payouts, and takes the
platform rake for paid TCG tournaments. This is **Phase 1** of the build in
`../docs/paid-tournaments-escrow.md` (contract + tests, deployed to Base
Sepolia first). The off-chain integration (DB migration, deposit-verify,
lobby, admin wiring) is Phases 2 to 3 and lives in the main Next.js app.

## What it does

- A single **UUPS-upgradeable** contract holds many games at once, keyed by a
  `bytes32` id that mirrors the Supabase tournament id.
- Lifecycle: `createGame -> deposit -> lock -> settle -> claim`, with
  `cancelGame`, global `pause`, and a 14-day per-game **dead-man switch** as
  refund escape hatches (`withdraw`).
- **Approve-then-pay**: players deposit via one-tx EIP-2612 `depositWithPermit`
  (or `deposit` after a normal approve). The operator only lets approved
  players in off-chain, so rejected players never need refunds.
- **Settle** takes only the ordered winner addresses; the contract computes
  each amount from the locked payout split and the pot, caps the rake in code
  (`MAX_RAKE_BPS`), credits winners + platform, and everyone **pulls** via
  `claim` (pull-over-push so one blacklisted address can't brick settlement).

See the design doc for the trust model, invariants, and rationale.

## Layout

```
src/TournamentEscrow.sol      the escrow (UUPS, Ownable, Pausable, ReentrancyGuard)
test/TournamentEscrow.t.sol   54 tests: isolation, refunds, dead-man, pause, settle math, permit, upgrade
test/mocks/MockUSDC.sol       6-decimal ERC20 + EIP-2612 permit test double
script/Deploy.s.sol           deploys the impl behind an ERC1967 proxy and initializes
```

## Setup

Dependencies (`lib/`) are gitignored. Install them once:

```bash
make setup      # or: forge install --no-git --shallow foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 OpenZeppelin/openzeppelin-contracts-upgradeable@v5.1.0
```

## Build + test

```bash
make build
make test          # forge test -vv
make coverage      # ~96% lines on the escrow
```

## Deploy (Base Sepolia first)

1. `cp .env.example .env` and fill in `PRIVATE_KEY`, `OWNER`, `PLATFORM`,
   `USDC`, the RPC URLs, and `BASESCAN_API_KEY`.
2. Fund the deployer with Base Sepolia ETH.
3. `make deploy-sepolia` (verifies on Basescan).
4. After the pilot, `make deploy-base`.

The proxy address is what the app talks to; record it as `contract_address`
(and `chain_id`) for the off-chain integration.

## Shipping enhancements / bug fixes (UUPS upgrade)

The contract is UUPS-upgradeable, so fixes and features go out without changing
the proxy address or losing state:

1. Edit `src/TournamentEscrow.sol`. **Only append** new storage vars and shrink
   `__gap` accordingly - never reorder or remove existing vars (layout must stay
   compatible).
2. `make test`.
3. `PROXY=0x<proxy> make upgrade-sepolia` (then `upgrade-base` after validation).

The broadcaster key must be the proxy `owner` (upgrade authority). Once real
funds flow, move that authority behind a Safe multisig (no contract change
needed). If a version needs a one-time migration, add a `reinitializer`-guarded
function and pass its calldata to `upgradeToAndCall`.

## Locked parameters (v1)

| Parameter | Value |
| --- | --- |
| Chain | Base |
| Asset | native Circle USDC (6 decimals) |
| Entry tier | $10 (`10_000000`), stored per game |
| Rake | 15% (`1500` bps), capped at `MAX_RAKE_BPS = 2000` |
| Payout presets | winner-take-all / top-3 / top-6 / top-8 |
| Dead-man timeout | 14 days from `lock` |
| Payouts | pull-based `claim` |
| Upgradeability | UUPS, `owner`-gated |

## Not audited

Do not put meaningful real money through this before a professional audit
(design doc, section 10). The Base Sepolia deploy and a tiny mainnet pilot
($1 with friends) are the intended next steps.
