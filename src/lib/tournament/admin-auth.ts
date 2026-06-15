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
  // Trim both sides: a trailing newline/space pasted into the Vercel env value
  // (or the saved browser key) is a classic cause of silent 401s.
  const secret = process.env.TOURNAMENT_ADMIN_SECRET?.trim()
  if (!secret) throw new AdminAuthError()
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (token !== secret) throw new AdminAuthError()
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.TOURNAMENT_ADMIN_SECRET)
}
