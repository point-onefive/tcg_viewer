'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Lock, ScrollText, ShieldCheck } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { TournamentBreadcrumb } from './tournament-breadcrumb'
import { BonkModuleHeader } from '@/components/tournament/bonk-ui'
import { DeckListBlock } from '@/components/tournament/deck-list-block'
import { PlayerAvatar } from '@/components/wallet/player-avatar'
import { apiPaidDeckAudit } from '@/lib/tournament/client'
import { getTournamentTheme, HOUSE_THEME_ID } from '@/lib/tournament/theme'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import { countryFlag } from '@/lib/wallet/country'
import type { PaidDeckAudit, PaidDeckAuditEntry } from '@/lib/tournament/types'

const POLL_MS = 20_000

// Public, unauthenticated deck-audit surface for a paid game. Anyone can pull up
// each competitor's registered decklist and compare it against a match replay.
// Deck contents only appear once the event is complete (the server gates this);
// before then the page shows a clear "revealed when this event concludes" note.
export function PaidDeckAudit({ code }: { code: string }) {
  const [audit, setAudit] = useState<PaidDeckAudit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await apiPaidDeckAudit(code)
      setAudit(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the deck audit.')
    } finally {
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    load()
    // Poll while the event is still open so the page flips to revealed decks the
    // moment the organizer completes it, without a manual refresh.
    const id = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const theme = getTournamentTheme(audit?.theme ?? HOUSE_THEME_ID)

  if (loading && !audit) {
    return (
      <TournamentShell theme={theme}>
        <div className="mx-auto flex max-w-md items-center justify-center gap-2 py-24" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="animate-spin" /> Loading deck audit...
        </div>
      </TournamentShell>
    )
  }

  if (error || !audit) {
    return (
      <TournamentShell theme={theme}>
        <div className="mx-auto max-w-md py-24 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {error ?? 'This deck audit is not available.'}
          </p>
          <Link
            href={`/tournaments/paid/${encodeURIComponent(code)}`}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold"
            style={{ color: 'var(--tcw-accent)' }}
          >
            <ArrowLeft size={15} /> Back to the game
          </Link>
        </div>
      </TournamentShell>
    )
  }

  return (
    <TournamentShell theme={theme}>
      <div className="mx-auto max-w-3xl">
        <TournamentBreadcrumb
          items={[
            { label: 'Tournaments', href: '/tournaments' },
            { label: 'Paid', href: '/tournaments/paid' },
            { label: audit.name || 'Game', href: `/tournaments/paid/${encodeURIComponent(code)}` },
            { label: 'Deck check' },
          ]}
        />
        <Link
          href={`/tournaments/paid/${encodeURIComponent(code)}`}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={14} /> Back to the game
        </Link>

        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck size={22} style={{ color: 'var(--tcw-accent)' }} />
          <h1 className="font-display text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            Deck audit
          </h1>
        </div>
        <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Registered decklists for <strong style={{ color: 'var(--text-primary)' }}>{audit.name}</strong>.
          Anyone can compare a competitor&rsquo;s committed list against their match replay.
        </p>
        <Link
          href="/tools/deck-check"
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--tcw-accent)' }}
        >
          <ShieldCheck size={13} /> Check a decklist against a battle log
        </Link>

        {!audit.decksPublic && (
          <div
            className="mb-6 flex items-start gap-3 rounded-xl p-4"
            style={{
              background: 'color-mix(in srgb, var(--tcw-accent) 8%, var(--bg))',
              border: '1px solid color-mix(in srgb, var(--tcw-accent) 26%, transparent)',
            }}
          >
            <Lock size={18} style={{ color: 'var(--tcw-accent)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                Decklists are revealed when this event concludes.
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Lists stay sealed during play. Once the organizer completes the event, every
                registered deck opens up here for public review.
              </p>
            </div>
          </div>
        )}

        {audit.entries.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No approved competitors yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {audit.entries.map((entry) => (
              <AuditRow key={entry.playerId} entry={entry} decksPublic={audit.decksPublic} />
            ))}
          </ul>
        )}
      </div>
    </TournamentShell>
  )
}

function AuditRow({ entry, decksPublic }: { entry: PaidDeckAuditEntry; decksPublic: boolean }) {
  const label = entry.username || formatXLabel(entry.xHandle)
  const flag = countryFlag(entry.country)
  const record =
    entry.wins + entry.losses + entry.draws > 0
      ? `${entry.wins}-${entry.losses}${entry.draws ? `-${entry.draws}` : ''}`
      : null

  return (
    <li className="overflow-hidden rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        {entry.rank != null && (
          <span
            className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 text-xs font-black"
            style={{ background: 'var(--tcw-accent)', color: '#fff' }}
            aria-label={`Placed ${entry.rank}`}
          >
            {entry.rank}
          </span>
        )}
        <PlayerAvatar
          username={entry.username}
          xHandle={entry.xHandle}
          avatarUrl={entry.avatarUrl}
          walletAddress={entry.walletAddress ?? undefined}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <a
            href={xProfileUrl(entry.xHandle)}
            target="_blank"
            rel="noreferrer"
            className="truncate font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {flag ? `${flag} ` : ''}
            {label}
          </a>
          {entry.leaderName && (
            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {entry.leaderName}
            </p>
          )}
        </div>
        {entry.dropped && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Dropped
          </span>
        )}
        {record && (
          <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {record}
          </span>
        )}
      </div>

      {decksPublic && entry.deckList ? (
        <div className="px-4 pb-4">
          <DeckListBlock deckList={entry.deckList} maxHeight={220} />
        </div>
      ) : (
        <div
          className="mx-4 mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-xs"
          style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          {decksPublic ? (
            <>
              <ScrollText size={13} /> No decklist on file.
            </>
          ) : (
            <>
              <Lock size={13} /> Deck sealed until the event concludes.
            </>
          )}
        </div>
      )}
    </li>
  )
}
