import { redirect } from 'next/navigation'

// Moved: the paid admin console now lives at /tournaments/paid/admin.
export default function PlayAdminRedirect() {
  redirect('/tournaments/paid/admin')
}
