/**
 * Supabase clients for Card Wall market intel.
 *
 * Two flavors:
 *
 *  1. `supabaseBrowser` - uses the publishable key, safe to ship to the
 *     browser bundle. RLS policies enforce what anonymous (and later,
 *     authenticated) callers can read. Used by client components.
 *
 *  2. `supabaseService()` - lazily constructs a server-only client with
 *     the secret key. BYPASSES RLS. Use only in API routes, RSC fetches,
 *     migration scripts, and ingestion workers. Calling this from a
 *     client component will throw at import time of the env var.
 *
 * Naming note: we adopted Supabase's new key model (`sb_publishable_*`
 * and `sb_secret_*`), which replaces the legacy `anon` / `service_role`
 * JWTs. The supabase-js client (v2.45+) accepts both formats transparently.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
}
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
}

/** Browser-safe client. RLS-enforced. */
export const supabaseBrowser: SupabaseClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

let _service: SupabaseClient | null = null

/**
 * Server-only client. Bypasses RLS. Lazy so importing from client code
 * does not blow up at module-eval time; instead the throw happens only
 * if a client component actually tries to call it.
 */
export function supabaseService(): SupabaseClient {
  if (_service) return _service
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) {
    throw new Error(
      'supabaseService() called without SUPABASE_SECRET_KEY. ' +
      'This must run server-side only (API routes, RSC, workers).'
    )
  }
  _service = createClient(SUPABASE_URL!, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return _service
}
