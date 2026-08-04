import { redirect } from 'next/navigation'

// Moved: the paid lobby now lives at /tournaments/paid.
export default function PlayLobbyRedirect() {
  redirect('/tournaments/paid')
}
