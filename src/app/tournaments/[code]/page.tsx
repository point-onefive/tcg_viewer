import type { Metadata } from 'next'
import { TournamentRoom } from '@/components/tournament/tournament-room'

export const metadata: Metadata = {
  title: 'Tournament · The Card Wall',
  description: 'View the bracket, enroll, schedule matches, and report results.',
}

export default async function TournamentRoomPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return <TournamentRoom code={code} />
}
