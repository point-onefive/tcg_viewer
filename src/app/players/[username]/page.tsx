import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getStandingByUsername } from '@/lib/wallet/db'
import { PlayerProfileCard } from '@/components/wallet/player-profile-card'

// Public, shareable player profile page: /players/<username>
// No password gate so profiles can be linked from X and elsewhere.

export const dynamic = 'force-dynamic'

type Params = { username: string }

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { username } = await params
  let standing = null
  try {
    standing = await getStandingByUsername(decodeURIComponent(username))
  } catch {
    // fall through to default metadata
  }
  if (!standing) {
    return { title: 'Player not found · The Card Wall' }
  }
  const record = `${standing.wins}W / ${standing.losses}L`
  return {
    title: `${standing.username} · The Card Wall`,
    description: `${standing.username} - ${record} across ${standing.tournamentsPlayed} Card Wall tournament${standing.tournamentsPlayed === 1 ? '' : 's'}.`,
  }
}

export default async function PlayerProfilePage(
  { params }: { params: Promise<Params> },
) {
  const { username } = await params

  let standing = null
  try {
    standing = await getStandingByUsername(decodeURIComponent(username))
  } catch (err) {
    console.error('player profile page: lookup failed', err)
  }

  if (!standing) notFound()

  return <PlayerProfileCard standing={standing} />
}
