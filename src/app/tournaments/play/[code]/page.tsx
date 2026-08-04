import { redirect } from 'next/navigation'

// Moved: paid game pages now live at /tournaments/paid/[code].
export default async function PlayGameRedirect({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  redirect(`/tournaments/paid/${code}`)
}
