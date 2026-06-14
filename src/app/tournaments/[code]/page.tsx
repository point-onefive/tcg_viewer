import { redirect } from 'next/navigation'

// Legacy /tournaments/CODE links → single live tournament page
export default function TournamentCodeRedirect() {
  redirect('/tournaments')
}
