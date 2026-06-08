import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** iOS Safari favourites / home-screen shortcut icon (matches icon.svg). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          borderRadius: 40,
          color: '#ffffff',
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: -5,
          fontFamily: 'Helvetica Neue, Arial, sans-serif',
        }}
      >
        CW
      </div>
    ),
    { ...size },
  )
}
