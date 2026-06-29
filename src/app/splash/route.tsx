import { ImageResponse } from 'next/og'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Custom iOS PWA launch image (apple-touch-startup-image). iOS would otherwise
// auto-generate a splash from the manifest icon + name in the system font; this
// route bakes a controlled, static splash instead: pure-black background, the
// Card Wall mark centered, and the nav wordmark ("the CARD WALL", BonkPoppins
// ExtraBold) underneath. Sized via ?w=&h= so one route serves every device.
export const runtime = 'nodejs'

const ROOT = process.cwd()
const FONT_XB = readFileSync(join(ROOT, 'public/bonk/fonts/web/Poppins-ExtraBold.ttf'))
const FONT_MED = readFileSync(join(ROOT, 'public/bonk/fonts/web/Poppins-Medium.ttf'))

const BG = '#0a0a0a'

export function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const w = clamp(Number(searchParams.get('w')) || 1170, 320, 2800)
  const h = clamp(Number(searchParams.get('h')) || 2532, 480, 3200)

  // Mark + wordmark scale off the shorter edge so portrait/landscape both look
  // balanced and centered.
  const base = Math.min(w, h)
  const u = Math.round(base * 0.064) // card unit width in the grid
  const cw = u
  const ch = Math.round(u * 1.42)
  const gap = Math.round(u * 0.2)
  const radius = Math.round(u * 0.16)
  const wordSize = Math.round(base * 0.066)

  const row = (n: number) => (
    <div style={{ display: 'flex', gap }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ width: cw, height: ch, background: '#fff', borderRadius: radius }} />
      ))}
    </div>
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: BG,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* The "wall of cards" mark: a 3 / 4 / 3 staggered brick, centered. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap }}>
          {row(3)}
          {row(4)}
          {row(3)}
        </div>

        {/* Nav wordmark: italic-feel lowercase "the" + ExtraBold "CARD WALL". */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            marginTop: Math.round(wordSize * 1.5),
            color: '#fff',
          }}
        >
          <span
            style={{
              fontFamily: 'PoppinsMed',
              fontSize: Math.round(wordSize * 0.62),
              opacity: 0.6,
              marginRight: Math.round(wordSize * 0.22),
            }}
          >
            the
          </span>
          <span
            style={{
              fontFamily: 'PoppinsXB',
              fontSize: wordSize,
              letterSpacing: -Math.round(wordSize * 0.015),
            }}
          >
            CARD WALL
          </span>
        </div>
      </div>
    ),
    {
      width: w,
      height: h,
      fonts: [
        { name: 'PoppinsXB', data: FONT_XB, weight: 800, style: 'normal' },
        { name: 'PoppinsMed', data: FONT_MED, weight: 500, style: 'normal' },
      ],
      headers: {
        // The splash for a given size never changes; let the CDN keep it.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    },
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
