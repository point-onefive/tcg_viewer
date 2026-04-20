import { NextResponse } from 'next/server'

export const runtime = 'edge'

interface TrackPinPayload {
  action: 'pin' | 'unpin'
  cardId: string
  variantId?: string
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as TrackPinPayload

    // Validate minimal shape - no PII ever stored
    const { action, cardId, variantId } = body
    if (typeof action !== 'string' || typeof cardId !== 'string') {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    // Log for now - upgrade to Vercel KV / Analytics once pivot data flows
    console.log('[track-pin]', { action, cardId, variantId: variantId ?? null })
  } catch {
    // Malformed body - swallow silently; telemetry must never break the client
  }

  return NextResponse.json({ ok: true })
}
