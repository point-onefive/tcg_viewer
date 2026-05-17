import type { Metadata } from 'next'
import { getCards } from '@/lib/data'
import { buildRails } from '@/lib/pulse-rails'
import { PulseApp } from './pulse-app'

export const metadata: Metadata = {
  title: 'Pulse - Card Wall',
  description: 'Curated market scanner for the One Piece TCG.',
}

/**
 * /pulse - the dedicated market scanner. Server-renders rails so the page
 * lands fully populated and SEO-readable. The detail drawer is a client
 * island handled by PulseApp.
 *
 * Scope: One Piece only for v1. When other collections get watchlists
 * the page can accept a `?c=` query param to switch.
 */
export default function PulsePage() {
  const cards = getCards('one-piece')
  const rails = buildRails(cards, 'one-piece')
  return <PulseApp rails={rails} />
}
