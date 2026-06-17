import { NextRequest, NextResponse } from 'next/server'
import { SiweMessage } from 'siwe'
import { consumeNonceCookie, setSessionCookie, signSession } from '@/lib/wallet/session'
import { upsertProfile } from '@/lib/wallet/db'

// POST /api/auth/verify
// Verifies a SIWE signature, creates a wallet profile on first sign-in,
// and issues a session cookie.
//
// Body: { message: string, signature: string }
//   - message: the EIP-4361 formatted string the wallet signed
//   - signature: the hex signature produced by the wallet
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { message?: string; signature?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { message, signature } = body
  if (!message || !signature) {
    return NextResponse.json({ error: 'message and signature are required' }, { status: 400 })
  }

  // Consume the server-issued nonce. Returns null if the nonce cookie is absent
  // or already expired (5-min TTL), preventing replay attacks.
  const serverNonce = await consumeNonceCookie()
  if (!serverNonce) {
    return NextResponse.json(
      { error: 'Nonce expired or missing - please try again' },
      { status: 422 },
    )
  }

  // Parse and verify the SIWE message.
  let siweMessage: SiweMessage
  try {
    siweMessage = new SiweMessage(message)
  } catch {
    return NextResponse.json({ error: 'Invalid SIWE message format' }, { status: 422 })
  }

  // Verify the signature and nonce match.
  let verifyResult: Awaited<ReturnType<SiweMessage['verify']>>
  try {
    verifyResult = await siweMessage.verify({
      signature,
      nonce: serverNonce,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Verification failed'
    return NextResponse.json({ error: msg }, { status: 422 })
  }

  if (!verifyResult.success) {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
  }

  const walletAddress = siweMessage.address.toLowerCase()

  // Upsert the wallet profile (no-op if it already exists).
  let profile
  try {
    profile = await upsertProfile(walletAddress)
  } catch (err) {
    console.error('wallet verify: upsertProfile failed', err)
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 503 })
  }

  // Issue the session cookie.
  const sessionToken = await signSession({ address: walletAddress })
  await setSessionCookie(sessionToken)

  return NextResponse.json({ ok: true, profile })
}
