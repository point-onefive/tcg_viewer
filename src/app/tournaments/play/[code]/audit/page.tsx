import { redirect } from 'next/navigation'

// Moved: paid deck audits now live at /tournaments/paid/[code]/audit.
export default async function PlayAuditRedirect({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  redirect(`/tournaments/paid/${code}/audit`)
}
