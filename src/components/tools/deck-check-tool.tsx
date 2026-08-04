'use client'

// Public, always-on deck-integrity checker. Paste an OPTCG Sim battle-log JSON
// and a registered decklist; the tool reconstructs the deck each seat actually
// played and reports whether the registered list matches: match / mismatch /
// inconclusive. It runs entirely client-side (no secrets, no network) and is
// REPORT-ONLY - it never penalizes anyone and is not wired into settlement.
//
// The whole point of the underlying checker is that it never false-positives:
// on any incomplete or ambiguous data it returns `inconclusive`, never
// `mismatch`. This UI leans into that by explaining every verdict in plain
// language and never presenting a mismatch as an automatic accusation.

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, HelpCircle, ScrollText, ShieldCheck, Upload } from 'lucide-react'
import { TournamentShell } from '@/components/tournament/tournament-shell'
import { CombatLogHelpLink } from '@/components/tournament/combat-log-help'
import { getTournamentTheme, HOUSE_THEME_ID } from '@/lib/tournament/theme'
import { verifyFromText, type VerifyResult, type VerifyStatus } from '@/lib/tournament/deck-log-check'

const VERDICT: Record<VerifyStatus, { label: string; color: string; Icon: typeof ShieldCheck }> = {
  match: { label: 'Match', color: '#16a34a', Icon: ShieldCheck },
  mismatch: { label: 'Mismatch', color: '#dc2626', Icon: AlertTriangle },
  inconclusive: { label: 'Inconclusive', color: '#d97706', Icon: HelpCircle },
}

export function DeckCheckTool() {
  const theme = getTournamentTheme(HOUSE_THEME_ID)
  const [logText, setLogText] = useState('')
  const [logName, setLogName] = useState<string | null>(null)
  const [deckText, setDeckText] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return
    setLogName(file.name)
    const reader = new FileReader()
    reader.onload = () => setLogText(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  }, [])

  const run = useCallback(() => {
    setResult(verifyFromText(logText, deckText))
  }, [logText, deckText])

  const canRun = logText.trim().length > 0 && deckText.trim().length > 0

  return (
    <TournamentShell theme={theme}>
      <div className="mx-auto max-w-2xl">
        <Link
          href="/tournaments/paid"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={14} /> Back to the lobby
        </Link>

        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck size={22} style={{ color: 'var(--tcw-accent)' }} />
          <h1 className="font-display text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            Deck-integrity checker
          </h1>
        </div>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Paste an OPTCG Sim battle-log JSON and a registered decklist. The tool rebuilds the
          deck each player actually played from the replay and checks it against the registered
          list, matching by base card (print and art variants are ignored).
        </p>

        <div
          className="mb-6 flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{
            background: 'color-mix(in srgb, var(--tcw-accent) 8%, var(--bg))',
            border: '1px solid color-mix(in srgb, var(--tcw-accent) 24%, transparent)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <ShieldCheck size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0, marginTop: 1 }} />
          <span>
            This is a read-only aid. It never penalizes anyone and is not tied to results or
            disputes. When the replay is incomplete (hidden cards, a partial log) it reports
            <strong style={{ color: 'var(--text-primary)' }}> inconclusive</strong> rather than
            guessing, so it never flags a mismatch that the data cannot actually prove.
          </span>
        </div>

        <div className="flex flex-col gap-5">
          {/* Battle log input */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Battle-log JSON
              </label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <Upload size={12} /> Upload file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json,text/plain"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
            <p className="mb-1.5 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Get this from the “Download Combat Log” button in the OPTCG Sim game screen.{' '}
              <CombatLogHelpLink />
            </p>
            <textarea
              value={logText}
              onChange={(e) => {
                setLogText(e.target.value)
                setLogName(null)
              }}
              placeholder='Paste the full battle-log JSON here (a large array of turn snapshots)...'
              spellCheck={false}
              className="w-full rounded-md p-3 text-xs"
              style={{
                minHeight: 120,
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono, monospace)',
                resize: 'vertical',
              }}
            />
            {logName && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Loaded {logName}
              </p>
            )}
          </div>

          {/* Registered decklist input */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Registered decklist
            </label>
            <textarea
              value={deckText}
              onChange={(e) => setDeckText(e.target.value)}
              placeholder={'1xOP15-058\n4xOP15-061\n4xOP15-067\n...'}
              spellCheck={false}
              className="w-full rounded-md p-3 text-xs"
              style={{
                minHeight: 120,
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono, monospace)',
                resize: 'vertical',
              }}
            />
          </div>

          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-black transition-opacity"
            style={{
              background: 'var(--tcw-accent)',
              color: '#fff',
              opacity: canRun ? 1 : 0.5,
              cursor: canRun ? 'pointer' : 'not-allowed',
            }}
          >
            <ShieldCheck size={16} /> Check deck integrity
          </button>
        </div>

        {result && <ResultCard result={result} />}
      </div>
    </TournamentShell>
  )
}

function ResultCard({ result }: { result: VerifyResult }) {
  const v = VERDICT[result.status]
  const { Icon } = v

  return (
    <div className="mt-6 overflow-hidden rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ background: `color-mix(in srgb, ${v.color} 12%, var(--bg-surface))`, borderBottom: `1px solid color-mix(in srgb, ${v.color} 30%, transparent)` }}
      >
        <Icon size={20} style={{ color: v.color, flexShrink: 0 }} />
        <span className="text-lg font-black" style={{ color: v.color }}>
          {v.label}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
          {result.reason}
        </p>

        {/* Leaders seen in the log + who we compared against. */}
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <Fact label="Registered leader" value={result.registeredLeader ?? 'unresolved'} />
          <Fact
            label="Log player 1"
            value={result.logLeaders.player1 ?? 'unresolved'}
            highlight={result.target === 'player1'}
          />
          <Fact
            label="Log player 2"
            value={result.logLeaders.player2 ?? 'unresolved'}
            highlight={result.target === 'player2'}
          />
        </div>

        {result.diff && (result.diff.missing.length > 0 || result.diff.extra.length > 0 || result.diff.leaderMismatch) && (
          <div className="flex flex-col gap-3">
            {result.diff.leaderMismatch && (
              <div
                className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"
                style={{ background: 'color-mix(in srgb, #dc2626 10%, var(--bg))', border: '1px solid color-mix(in srgb, #dc2626 28%, transparent)', color: 'var(--text-primary)' }}
              >
                <AlertTriangle size={13} style={{ color: '#dc2626', flexShrink: 0 }} />
                Leader differs: registered {result.diff.registeredLeader ?? 'unknown'}, played {result.diff.playedLeader ?? 'unknown'}.
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DiffList title="Registered but not played" entries={result.diff.missing} color="#dc2626" />
              <DiffList title="Played but not registered" entries={result.diff.extra} color="#d97706" />
            </div>
          </div>
        )}

        {result.status === 'match' && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <ScrollText size={13} /> Every one of the 51 cards (leader + 50) lines up.
          </div>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{
        background: highlight ? 'color-mix(in srgb, var(--tcw-accent) 12%, var(--bg))' : 'var(--bg)',
        border: highlight ? '1px solid color-mix(in srgb, var(--tcw-accent) 34%, transparent)' : '1px solid var(--border-subtle)',
      }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
        {highlight ? ' (compared)' : ''}
      </p>
      <p className="mt-0.5 font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}

function DiffList({ title, entries, color }: { title: string; entries: { id: string; count: number }[]; color: string }) {
  return (
    <div className="rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
        {title} ({entries.reduce((a, e) => a + e.count, 0)})
      </p>
      {entries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          None.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((e) => (
            <li key={e.id} className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
              {e.count}x{e.id}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
