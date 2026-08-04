'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, HandCoins, PauseCircle, PlayCircle, ShieldAlert, Trophy } from 'lucide-react'
import { adminApi } from '@/lib/tournament/client'
import { computeStandings } from '@/lib/tournament/pairing'
import type { PaidNeedsAttention, Player, TournamentSnapshot } from '@/lib/tournament/types'

// ─────────────────────────────────────────────────────────────────────────
// Admin escrow controls for the PAID tournament console. Two exports:
//   - PaidEscrowControls: per-selected-lobby levers (cancel/refund/settle).
//   - PaidNeedsAttentionCard: read-only global "what needs a human" surface
//     plus the OPTIONAL owner-key global pause/unpause.
// Everything routes through the admin API (Bearer secret). The service layer
// runs the on-chain write with the operator key and flips the DB mirror; these
// components stay thin (validate + submit + show the resulting tx). See
// docs/paid-tournaments-escrow.md.
// ─────────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
}
const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--text-muted)',
}
const selectStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 14,
  width: '100%',
}
const btn: React.CSSProperties = {
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg)',
  color: 'var(--text-primary)',
}
const dangerBtn: React.CSSProperties = { ...btn, background: '#dc2626', color: '#fff', border: 'none' }
const goldBtn: React.CSSProperties = { ...btn, background: '#f5b301', color: '#1a1a1a', border: 'none' }

function shortHash(h: string): string {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h
}

/** Compact wei (as a string) to a short ETH figure, e.g. "0.0004". */
function formatEther(wei: string): string {
  let n = 0
  try {
    n = Number(BigInt(wei)) / 1e18
  } catch {
    return '0'
  }
  if (n === 0) return '0'
  return n < 0.001 ? n.toExponential(1) : n.toFixed(4)
}

function playerLabel(p: Player): string {
  const handle = p.xHandle ? ` @${p.xHandle}` : ''
  return `${p.displayName}${handle}`
}

// ── Per-lobby escrow controls ──────────────────────────────────────────────

export function PaidEscrowControls({
  snapshot,
  adminKey,
  busy,
  onDone,
  operatorConfigured = true,
}: {
  snapshot: TournamentSnapshot
  adminKey: string
  busy: boolean
  onDone: () => void
  /** When false, the backend has no operator key so every on-chain lever 503s. */
  operatorConfigured?: boolean
}) {
  const { tournament, players, matches } = snapshot
  const code = tournament.code
  const status = tournament.status
  const depth = tournament.payoutBps?.length ?? 0

  const [localBusy, setLocalBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmRefund, setConfirmRefund] = useState(false)
  const [refundId, setRefundId] = useState('')
  const [settleOpen, setSettleOpen] = useState(false)

  // Funded, unrefunded players with a linked wallet: the only valid refund /
  // settle targets on-chain.
  const funded = useMemo(
    () => players.filter((p) => p.funded && !p.refunded && p.walletAddress),
    [players],
  )

  // Computed standings (seeded, non-rejected) drive the default settle order.
  const standings = useMemo(() => {
    const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
    if (inBracket.length === 0) return []
    return computeStandings(inBracket, matches)
  }, [players, matches])
  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  const defaultOrder = useMemo(
    () => standings.slice(0, depth).map((s) => s.playerId),
    [standings, depth],
  )
  const [order, setOrder] = useState<string[]>(defaultOrder)

  const busyAny = busy || localBusy

  async function call(body: Record<string, unknown>, okMsg: string) {
    setLocalBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await adminApi(adminKey, body)
      setMsg(r.txHash ? `${okMsg} (tx ${shortHash(r.txHash)})` : okMsg)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setLocalBusy(false)
    }
  }

  const cancelled = status === 'cancelled'
  // Pre-lock = still enrolling (on-chain Funding). Refund/kick only makes sense
  // then; once running the game is Locked, so cancel-the-game is the lever.
  const preLock = status === 'enrolling'
  // Settle escape hatch is relevant once the bracket is Locked on-chain
  // (running) or the bracket has finished but the settle never landed.
  const canSettle = (status === 'running' || status === 'complete') && depth > 0

  function submitSettle() {
    if (order.length !== depth || order.some((id) => !id)) {
      setErr(`Choose exactly ${depth} winners in placement order.`)
      return
    }
    if (new Set(order).size !== order.length) {
      setErr('Each placement must be a distinct player.')
      return
    }
    call({ action: 'manual-settle', code, orderedPlayerIds: order }, 'Settled on-chain')
    setSettleOpen(false)
  }

  return (
    <div className="p-5 flex flex-col gap-4" style={card}>
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} style={{ color: 'var(--tcw-accent)' }} />
        <h3 className="font-display font-bold">Escrow controls</h3>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Direct on-chain levers for <strong>{code}</strong>. The bracket runs itself. Reach for these
        only to stop, refund, or force a settle when something needs a human.
      </p>

      {/* No operator key: every on-chain lever below would 503, so hide them and
          explain why (mirrors how global pause hides without the owner key). */}
      {!operatorConfigured && (
        <p
          className="text-sm flex items-start gap-1.5 rounded-md px-3 py-2"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}
          role="alert"
        >
          <AlertTriangle size={14} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
          On-chain levers disabled: no operator key. Cancel, refund, and settle are unavailable on
          this deployment.
        </p>
      )}

      {/* Cancel game / refund status */}
      {operatorConfigured && (
      <div className="flex flex-col gap-2">
        <span style={label}>Stop the game</span>
        {cancelled ? (
          <p
            className="text-sm flex items-start gap-1.5 rounded-md px-3 py-2"
            style={{ background: 'rgba(245,179,1,0.12)', border: '1px solid rgba(245,179,1,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            <AlertTriangle size={14} style={{ color: '#f5b301', flexShrink: 0, marginTop: 1 }} />
            This game is cancelled. Funded players can withdraw their entry from the game page.
          </p>
        ) : status === 'complete' ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Game is complete. Cancellation is unavailable once a game is settled.
          </p>
        ) : !confirmCancel ? (
          <div>
            <button type="button" style={dangerBtn} disabled={busyAny} onClick={() => setConfirmCancel(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Ban size={14} /> Cancel game &amp; open refunds
              </span>
            </button>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Stops the game on-chain and lets every funded player withdraw their entry. Works while
              enrolling or running. This cannot be undone.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Cancel {code} and open refunds?
            </span>
            <button type="button" style={dangerBtn} disabled={busyAny} onClick={() => call({ action: 'cancel-paid-game', code }, 'Game cancelled - refunds open')}>
              {busyAny ? 'Working…' : 'Yes, cancel'}
            </button>
            <button type="button" style={btn} disabled={busyAny} onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
          </div>
        )}
      </div>
      )}

      {/* Refund / kick one player (pre-lock only) */}
      {operatorConfigured && preLock && (
        <div className="flex flex-col gap-2">
          <span style={label}>Refund &amp; remove a player</span>
          {funded.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
              No funded players to refund yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                aria-label="Player to refund"
                style={selectStyle}
                value={refundId}
                onChange={(e) => {
                  setRefundId(e.target.value)
                  setConfirmRefund(false)
                }}
              >
                <option value="">Select a funded player…</option>
                {funded.map((p) => (
                  <option key={p.id} value={p.id}>
                    {playerLabel(p)}
                  </option>
                ))}
              </select>
              {!confirmRefund ? (
                <button
                  type="button"
                  style={{ ...btn, whiteSpace: 'nowrap' }}
                  disabled={busyAny || !refundId}
                  onClick={() => setConfirmRefund(true)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <HandCoins size={14} /> Refund &amp; remove
                  </span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Refund and remove {nameById.get(refundId) ? playerLabel(nameById.get(refundId)!) : 'this player'}?
                  </span>
                  <button
                    type="button"
                    style={{ ...dangerBtn, whiteSpace: 'nowrap' }}
                    disabled={busyAny || !refundId}
                    onClick={() => {
                      const p = nameById.get(refundId)
                      call({ action: 'refund-player', code, playerId: refundId }, `Refunded ${p ? playerLabel(p) : 'player'}`)
                      setRefundId('')
                      setConfirmRefund(false)
                    }}
                  >
                    {busyAny ? 'Working…' : 'Yes, refund'}
                  </button>
                  <button type="button" style={btn} disabled={busyAny} onClick={() => setConfirmRefund(false)}>
                    Keep them
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
            Credits their entry back on-chain (they withdraw it) and drops them from the field. Only
            available before the bracket starts.
          </p>
        </div>
      )}

      {/* Manual settle escape hatch */}
      {operatorConfigured && canSettle && (
        <div className="flex flex-col gap-2">
          <span style={label}>Manual settle</span>
          {funded.length < depth ? (
            // The fixed payout split needs exactly `depth` distinct funded winners.
            // With fewer funded players on-chain the settle can't be assembled and
            // would revert, so guide the operator to cancel + refund instead of
            // silently offering an invalid settle.
            <p
              className="text-sm flex items-start gap-1.5 rounded-md px-3 py-2"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}
              role="alert"
            >
              <AlertTriangle size={14} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
              Only {funded.length} funded {funded.length === 1 ? 'player' : 'players'}, but this payout
              needs {depth} winners. This game cannot be settled. Cancel it above and let players
              withdraw their entries instead.
            </p>
          ) : !settleOpen ? (
            <div>
              <button
                type="button"
                style={goldBtn}
                disabled={busyAny}
                onClick={() => {
                  setOrder(defaultOrder)
                  setSettleOpen(true)
                  setErr(null)
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Trophy size={14} /> Review &amp; settle winners
                </span>
              </button>
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Escape hatch for when the autopilot payout defers (a genuine tie across a pay line) or
                a winner linked a wallet late. Submits the final placement on-chain; the contract pays
                winners + rake.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
                Prefilled from the computed standings. Adjust any placement, then settle. Each row must
                be a distinct funded wallet.
              </p>
              {Array.from({ length: depth }).map((_, i) => {
                const preset = tournament.payoutBps?.[i]
                const share = preset != null ? ` · ${(preset / 100).toFixed(preset % 100 === 0 ? 0 : 1)}% of pot` : ''
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="tabular-nums shrink-0 text-xs font-bold"
                      style={{ width: 78, color: 'var(--text-muted)' }}
                    >
                      #{i + 1}
                      {share}
                    </span>
                    <select
                      aria-label={`Placement ${i + 1}`}
                      style={selectStyle}
                      value={order[i] ?? ''}
                      onChange={(e) => {
                        const next = [...order]
                        next[i] = e.target.value
                        setOrder(next)
                      }}
                    >
                      <option value="">Select player…</option>
                      {funded.map((p) => (
                        <option key={p.id} value={p.id}>
                          {playerLabel(p)}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" style={goldBtn} disabled={busyAny} onClick={submitSettle}>
                  {busyAny ? 'Settling…' : 'Settle on-chain'}
                </button>
                <button type="button" style={btn} disabled={busyAny} onClick={() => setSettleOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-sm" style={{ color: '#22c55e', margin: 0 }}>{msg}</p>}
      {err && <p className="text-sm" style={{ color: '#ef4444', margin: 0 }} role="alert">{err}</p>}
    </div>
  )
}

// ── Global "needs attention" surface ───────────────────────────────────────

export function PaidNeedsAttentionCard({
  attention,
  adminKey,
  busy,
  onSelect,
  onDone,
}: {
  attention: PaidNeedsAttention
  adminKey: string
  busy: boolean
  onSelect: (code: string) => void
  onDone: () => void
}) {
  const [localBusy, setLocalBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmPause, setConfirmPause] = useState(false)
  const busyAny = busy || localBusy

  const {
    disputes,
    settleStuck,
    cancelled,
    ownerKeyConfigured,
    operatorConfigured,
    approverConfigured,
    approverSameAsOperator,
    lowGas,
  } = attention
  const clear = disputes.length === 0 && settleStuck.length === 0 && cancelled.length === 0

  async function call(body: Record<string, unknown>, okMsg: string) {
    setLocalBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await adminApi(adminKey, body)
      setMsg(r.txHash ? `${okMsg} (tx ${shortHash(r.txHash)})` : okMsg)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setLocalBusy(false)
    }
  }

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--bg)',
    border: '1px solid var(--border-subtle)',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
  }
  const badge = (bg: string, color: string): React.CSSProperties => ({
    background: bg,
    color,
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  })

  return (
    <div className="p-4 flex flex-col gap-3" style={card}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5" style={label}>
          <AlertTriangle size={12} style={{ color: clear ? 'var(--text-muted)' : '#f5b301' }} /> Needs attention
        </span>
        {ownerKeyConfigured && (
          <div className="flex items-center gap-1.5">
            {!confirmPause ? (
              <button
                type="button"
                style={{ ...btn, padding: '5px 10px', fontSize: 12 }}
                disabled={busyAny}
                onClick={() => setConfirmPause(true)}
                title="Global halt: blocks deposits/settles across every game (owner key)."
              >
                <span className="inline-flex items-center gap-1">
                  <PauseCircle size={13} /> Pause all
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Pause every game?
                </span>
                <button
                  type="button"
                  style={{ ...dangerBtn, padding: '5px 10px', fontSize: 12 }}
                  disabled={busyAny}
                  onClick={() => {
                    call({ action: 'pause-escrow' }, 'Escrow paused (all games)')
                    setConfirmPause(false)
                  }}
                >
                  {busyAny ? 'Working…' : 'Yes, pause all'}
                </button>
                <button
                  type="button"
                  style={{ ...btn, padding: '5px 10px', fontSize: 12 }}
                  disabled={busyAny}
                  onClick={() => setConfirmPause(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              type="button"
              style={{ ...btn, padding: '5px 10px', fontSize: 12 }}
              disabled={busyAny}
              onClick={() => call({ action: 'unpause-escrow' }, 'Escrow unpaused')}
            >
              <span className="inline-flex items-center gap-1">
                <PlayCircle size={13} /> Unpause
              </span>
            </button>
          </div>
        )}
      </div>

      {!operatorConfigured && (
        <p
          className="text-xs flex items-start gap-1.5 rounded-md px-3 py-2"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}
          role="alert"
        >
          <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
          On-chain levers disabled: no operator key. Settle, refund, and cancel are unavailable until
          the operator key is set.
        </p>
      )}

      {!approverConfigured ? (
        <p
          className="text-xs flex items-start gap-1.5 rounded-md px-3 py-2"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}
          role="alert"
        >
          <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
          Winner-approval key is NOT configured. Player approvals will not reach the chain, and
          settlement will revert. Set TOURNAMENT_ESCROW_APPROVER_KEY (a wallet distinct from the
          operator) before approving anyone.
        </p>
      ) : approverSameAsOperator ? (
        <p
          className="text-xs flex items-start gap-1.5 rounded-md px-3 py-2"
          style={{ background: 'rgba(245,179,1,0.12)', border: '1px solid rgba(245,179,1,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}
          role="alert"
        >
          <AlertTriangle size={13} style={{ color: '#f5b301', flexShrink: 0, marginTop: 1 }} />
          Approver key equals the operator key. The anti-self-pay protection is disabled. Use a
          distinct approver wallet.
        </p>
      ) : null}

      {lowGas.length > 0 && (
        <div className="flex flex-col gap-1">
          {lowGas.map((g) => (
            <p
              key={g.role}
              className="text-xs flex items-start gap-1.5 rounded-md px-3 py-2"
              style={{ background: 'rgba(245,179,1,0.12)', border: '1px solid rgba(245,179,1,0.4)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}
            >
              <AlertTriangle size={13} style={{ color: '#f5b301', flexShrink: 0, marginTop: 1 }} />
              Low gas: the <strong>{g.role}</strong> wallet ({shortHash(g.address)}) holds{' '}
              {formatEther(g.balanceWei)} ETH. Top it up so on-chain writes keep working.
            </p>
          ))}
        </div>
      )}

      {clear ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
          All clear. No disputes, stuck settles, or refundable games right now.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {disputes.map((d) => (
            <button key={`d-${d.code}`} type="button" style={row} onClick={() => onSelect(d.code)}>
              <span className="min-w-0 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                <strong>{d.code}</strong> · {d.name}
              </span>
              <span style={badge('rgba(239,68,68,0.16)', '#f87171')}>
                {d.count} disputed
              </span>
            </button>
          ))}
          {settleStuck.map((s) => (
            <button key={`s-${s.code}`} type="button" style={row} onClick={() => onSelect(s.code)}>
              <span className="min-w-0 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                <strong>{s.code}</strong> · {s.name}
              </span>
              <span style={badge('rgba(245,179,1,0.16)', '#f5b301')}>settle stuck</span>
            </button>
          ))}
          {cancelled.map((c) => (
            <button key={`c-${c.code}`} type="button" style={row} onClick={() => onSelect(c.code)}>
              <span className="min-w-0 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                <strong>{c.code}</strong> · {c.name}
              </span>
              <span style={badge('rgba(148,163,184,0.18)', 'var(--text-secondary)')}>refundable</span>
            </button>
          ))}
        </div>
      )}

      {!ownerKeyConfigured && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
          Global pause is off (no owner key). Per-game <strong>Cancel</strong> is the stop lever.
        </p>
      )}
      {msg && <p className="text-sm" style={{ color: '#22c55e', margin: 0 }}>{msg}</p>}
      {err && <p className="text-sm" style={{ color: '#ef4444', margin: 0 }} role="alert">{err}</p>}
    </div>
  )
}
