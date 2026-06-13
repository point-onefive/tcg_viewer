import 'server-only'
import { NextResponse } from 'next/server'
import { SupabaseNotConfiguredError } from './supabase'
import { TournamentError } from './service'

// Shared helpers for the tournament route handlers: a JSON helper and a
// single error funnel that maps our typed errors to the right HTTP status.

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Wrap a handler body so thrown errors become clean JSON responses. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return fail(
        'The tournament backend is not configured on this deployment yet.',
        503,
      )
    }
    if (err instanceof TournamentError) {
      return fail(err.message, err.status)
    }
    console.error('[tournament] unexpected error', err)
    return fail('Something went wrong.', 500)
  }
}

/** Parse a JSON body defensively. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new TournamentError('Invalid request body.', 400)
  }
}
