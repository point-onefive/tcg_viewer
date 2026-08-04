import { redirect } from 'next/navigation'

// Moved: the featured admin console now lives at /tournaments/sponsored/admin.
export default function TournamentAdminRedirect() {
  redirect('/tournaments/sponsored/admin')
}
