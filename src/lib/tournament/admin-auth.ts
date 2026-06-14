import 'server-only'

export class AdminAuthError extends Error {
  status = 401
  constructor() {
    super('Not authorized.')
    this.name = 'AdminAuthError'
  }
}

/** Shared secret for tournament admin actions (you only). Set in Vercel + .env.local. */
export function assertAdmin(request: Request): void {
  const secret = process.env.TOURNAMENT_ADMIN_SECRET
  if (!secret) throw new AdminAuthError()
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) throw new AdminAuthError()
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.TOURNAMENT_ADMIN_SECRET)
}
