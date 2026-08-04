# Paid-tournament demo harness

`demo-tournament.ts` runs a real paid tournament end to end on Base Sepolia +
the live Supabase DB so a non-technical operator can WATCH it happen in the
browser, or be forced to step in through the admin panel. Bots do all the work
(enroll, fund on-chain, report results). The human only observes, or resolves a
dispute.

It is safe to re-run and safe next to production data: it only ever creates,
drives, and deletes games whose name starts with `DEMO `. It never touches the
operator's real games or the featured/free event.

## Prerequisites

- Dev server running: `npm run dev` (so the operator can watch at
  `http://localhost:3000`). The script itself does not call the dev server, it
  drives the service layer + chain directly, but the browser pages read the
  same DB.
- `.env.local` present (Supabase + escrow operator key + escrow address/RPC).
  Nothing wallet-side is needed from the operator: the bots are self-funded
  (they mint the mock USDC that `escrow.usdc()` points at) and their tiny gas
  float comes from the operator wallet and is swept back at the end.
- `tsx` available (it is; `npm install --no-save tsx` if ever missing).

The commands below work as written. The script re-execs itself once with
`--conditions=react-server` so the service layer (which imports `server-only`)
loads cleanly.

## Commands

```bash
# Clean end-to-end run to WATCH (leaves the finished game up to inspect)
npx tsx scripts/tournament/demo-tournament.ts --mode=auto      [--players=4] [--entry=100000] [--pace=15]

# Same, but round 1 forces a DISPUTE you must resolve in the admin panel
npx tsx scripts/tournament/demo-tournament.ts --mode=intervene [--players=4] [--pace=15]

# Tear down every game this harness created (cancel on-chain if needed + delete)
npx tsx scripts/tournament/demo-tournament.ts --cleanup
```

Optional flags: `--rake=1500` (bps), `--payout=wta|top3|top6|top8`,
`--base=http://localhost:3000`.

- `--players` default 4. A 4-player field plays a 3-round Swiss (a perfect
  round-robin), which is why the default auto payout is `top3` and settles with
  three distinct winners.
- `--entry` is in 6-decimal USDC units. Default `100000` = $0.10.
- `--pace` is the seconds slept between each match report so the live page (it
  polls every 12s) visibly updates match by match. Default 15. Use a small
  value like 3 for a quick check.

## What the operator should watch

### auto mode

1. When the script prints `GAME CREATED: PG-XXXX`, open the WATCH URL it prints
   (`http://localhost:3000/tournaments/paid/PG-XXXX`) and the lobby
   (`/tournaments/paid`).
2. On the lobby card you will see the applied count rise, then the funded count
   climb to the full field as each bot deposits.
3. When it starts, round 1 pairings appear on the game page. Then, every
   `--pace` seconds, a match resolves, standings update, and the next round
   generates, until the podium shows and winners have claimable payouts.
4. The script prints final standings, the on-chain settle tx, and which wallets
   can claim. It leaves the finished game UP so you can inspect it. Run
   `--cleanup` when done.

### intervene mode

Same setup and start. In round 1 the script makes two bots BOTH claim the win,
so that match goes `disputed`. Autopilot halts (the round will not advance) and
the match surfaces in the paid admin "needs attention".

The script prints a big `ACTION NEEDED` banner and waits. To resume play:

1. Open `http://localhost:3000/tournaments/paid/admin`.
2. Unlock with the admin password.
3. Select the game (`PG-XXXX` from the banner).
4. Find the disputed match and pick a winner to set its result.

As soon as you resolve it, the script detects the change, prints
`Dispute resolved by operator`, and drives the remaining rounds to completion +
settlement. It leaves the finished game up. Run `--cleanup` when done.

## Cleanup guarantees

`--cleanup` finds every `DEMO ` game in the DB (by name prefix), and for each:

- cancels it on-chain if it is still cancellable (Funding or Locked) so no funds
  are stranded (a settled game is skipped, its money is already paid out);
- sweeps any leftover bot gas back to the operator;
- deletes the tournament row (players / rounds / matches / proposals / poll
  votes cascade) and the throwaway `wallet_profiles` rows for its bots.

Throwaway bot wallet keys are stored in `scripts/tournament/.demo-state.json`
(gitignored) purely so `--cleanup` can sweep their gas. It is emptied as games
are cleaned.

## Notes on correctness

- On-chain operator txs are serialized (each awaits its receipt) so operator
  nonces never collide. Bot txs poll allowance / balance before dependent txs to
  ride out RPC replica lag.
- Results are driven by a strict seed order so the champion is always the unique
  undefeated finisher. That keeps the autopilot settlement unambiguous: `wta`
  always settles, and the default `top3` for a 4-player round-robin settles with
  a clean 1st/2nd/3rd. Deeper payout presets on non-round-robin fields can, by
  design, hand a genuine placement tie to a manual settle in the admin panel.
- Operator ETH usage per run is tiny (well under 0.001 ETH): the bot gas float
  is swept back and the operator's own L2 txs are cheap. Each run prints the net
  operator ETH spent.
