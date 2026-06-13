import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────
// Server-only Supabase client for the tournament feature.
//
// All tournament reads AND writes funnel through this single service-role
// client inside Next.js route handlers — the browser never talks to Supabase
// directly. That keeps one clean trust boundary: authorization is enforced in
// the route handlers by checking host/player tokens, not by RLS.
//
// The service-role key bypasses RLS, so it must NEVER be imported into a
// client component. The `import 'server-only'` above makes the build fail loud
// if that ever happens by accident.
//
// If the env vars are missing the whole feature degrades gracefully: every
// helper that needs the client throws a typed "not configured" error which the
// route handlers translate into a friendly 503, and the rest of the site is
// completely unaffected.
// ─────────────────────────────────────────────────────────────────────────

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured (missing TOURNAMENT_SUPABASE_URL / TOURNAMENT_SUPABASE_SECRET_KEY).')
    this.name = 'SupabaseNotConfiguredError'
  }
}

let _client: SupabaseClient | null = null

// Tournament-specific env vars so this never collides with any other Supabase
// project the repo might use (e.g. a separate market/alerts project). The
// client is server-only and uses the secret key, so the URL need not be public.
const TOURNAMENT_URL = () => process.env.TOURNAMENT_SUPABASE_URL
const TOURNAMENT_KEY = () => process.env.TOURNAMENT_SUPABASE_SECRET_KEY

/** True when the tournament backend has the env it needs to run. */
export function isTournamentBackendConfigured(): boolean {
  return Boolean(TOURNAMENT_URL() && TOURNAMENT_KEY())
}

/**
 * Lazily build (and cache) the service-role client. Throws
 * SupabaseNotConfiguredError when env is absent so callers can map it to a
 * 503 without crashing the build or other routes.
 */
export function getServiceClient(): SupabaseClient {
  if (_client) return _client
  const url = TOURNAMENT_URL()
  const key = TOURNAMENT_KEY()
  if (!url || !key) throw new SupabaseNotConfiguredError()
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}
