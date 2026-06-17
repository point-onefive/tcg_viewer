'use client'

// PlayerAvatar - renders a player's avatar image, falling back to initials
// on a branded circle when no image is available or the image fails to load.

import { useState } from 'react'
import { resolveAvatarUrl, avatarInitials } from '@/lib/wallet/avatar'

interface PlayerAvatarProps {
  username?: string | null
  xHandle?: string | null
  avatarUrl?: string | null
  walletAddress?: string
  size?: number
  /** Optional ring color (e.g. brand orange for the signed-in user). */
  ring?: string
}

export function PlayerAvatar({
  username,
  xHandle,
  avatarUrl,
  walletAddress,
  size = 40,
  ring,
}: PlayerAvatarProps) {
  const src = resolveAvatarUrl({ avatarUrl, xHandle })
  const [failed, setFailed] = useState(false)
  const initials = avatarInitials({ username, walletAddress })

  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    objectFit: 'cover',
    border: ring ? `2px solid ${ring}` : '1px solid var(--border-subtle)',
    background: 'var(--bg)',
  }

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={username ? `${username} avatar` : 'Player avatar'}
        width={size}
        height={size}
        style={base}
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
      />
    )
  }

  return (
    <span
      aria-hidden
      style={{
        ...base,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, #E85D2A 18%, var(--bg))',
        color: '#E85D2A',
        fontWeight: 800,
        fontSize: Math.round(size * 0.38),
        fontFamily: 'var(--font-display, inherit)',
        letterSpacing: '0.02em',
      }}
    >
      {initials}
    </span>
  )
}
