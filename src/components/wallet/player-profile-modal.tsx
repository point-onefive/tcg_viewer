'use client'

// PlayerProfileModal - edit username, X handle, and avatar URL.
// Shown when the user clicks "Edit profile" in the WalletConnectButton menu.

import { useState, useEffect } from 'react'
import { X, User, Check, Loader2, AlertCircle, Clock, ChevronDown } from 'lucide-react'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'
import { XLogo } from '@/components/gallery/x-logo'
import { PlayerAvatar } from './player-avatar'
import { isManagedAvatarUrl } from '@/lib/wallet/avatar'
import { ModalPortal } from '@/components/ui/modal-portal'
import {
  detectTimeZone,
  commonTimeZones,
  shortHourLabel,
  tzCity,
  tzAbbrev,
} from '@/lib/wallet/availability'

/** A compact 24-hour toggle grid (6 x 4). Selected hours fill with accent. */
function HourGrid({ value, onToggle }: { value: number[]; onToggle: (h: number) => void }) {
  const set = new Set(value)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
      {Array.from({ length: 24 }, (_, h) => {
        const on = set.has(h)
        return (
          <button
            key={h}
            type="button"
            onClick={() => onToggle(h)}
            aria-pressed={on}
            style={{
              padding: '7px 0',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 6,
              cursor: 'pointer',
              background: on ? '#E85D2A' : 'var(--bg)',
              color: on ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${on ? '#E85D2A' : 'var(--border-subtle)'}`,
              transition: 'background 100ms ease',
            }}
          >
            {shortHourLabel(h)}
          </button>
        )
      })}
    </div>
  )
}

function shortAddress(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '9px 12px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
}

interface PlayerProfileModalProps {
  onClose: () => void
}

export function PlayerProfileModal({ onClose }: PlayerProfileModalProps) {
  const { profile, saveProfile, refreshProfile } = useWalletAuth()

  const [username, setUsername] = useState(profile?.username ?? '')
  const [xHandle, setXHandle] = useState(profile?.xHandle ?? '')
  // The custom-URL field only ever holds a URL the *user* pasted. Our own R2
  // snapshots (managed avatars) are auto-generated from the X handle on save,
  // so we never echo them back into the input - that would expose an internal
  // CDN URL and make the field look pre-filled.
  const [avatarUrl, setAvatarUrl] = useState(
    profile?.avatarUrl && !isManagedAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : '',
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Availability: timezone + a single set of hour blocks (player's local time)
  // that applies to the whole week. Older profiles may have split weekday/weekend
  // arrays, so we merge them when seeding the form.
  const mergeHours = (a?: { weekday?: number[]; weekend?: number[] } | null): number[] =>
    [...new Set([...(a?.weekday ?? []), ...(a?.weekend ?? [])])].sort((x, y) => x - y)
  const [availTz, setAvailTz] = useState(profile?.availability?.tz || detectTimeZone())
  const [hours, setHours] = useState<number[]>(mergeHours(profile?.availability))

  // Sync form if profile changes while modal is open.
  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? '')
      setXHandle(profile.xHandle ?? '')
      setAvatarUrl(
        profile.avatarUrl && !isManagedAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : '',
      )
      setAvailTz(profile.availability?.tz || detectTimeZone())
      setHours(mergeHours(profile.availability))
    }
  }, [profile])

  const toggleHour = (h: number) =>
    setHours((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h].sort((a, b) => a - b)))

  // Timezone <select> options, with the player's current tz guaranteed present.
  const tzOptions = (() => {
    const zones = commonTimeZones()
    return zones.includes(availTz) ? zones : [availTz, ...zones]
  })()

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldError(null)
    setSaving(true)
    try {
      await saveProfile({
        username: username.trim() || null,
        xHandle: xHandle.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        availability: { tz: availTz, weekday: hours, weekend: hours },
      })
      await refreshProfile()
      setSaved(true)
      // Briefly show the "Saved" confirmation, then close the modal.
      setTimeout(() => onClose(), 650)
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return null

  // Avatar preview. We deliberately do NOT pass the live-typed X handle to the
  // avatar, because that would build an unavatar URL and fire a network request
  // on every keystroke. The real picture is fetched server-side once, on save.
  // Until then we preview a pasted custom URL or the already-saved snapshot.
  const typedHandle = xHandle.trim().replace(/^@/, '').toLowerCase()
  const savedHandle = (profile.xHandle ?? '').toLowerCase()
  const hasSavedSnapshot = isManagedAvatarUrl(profile.avatarUrl)
  const handleUnchanged = typedHandle !== '' && typedHandle === savedHandle
  const previewAvatarUrl =
    avatarUrl.trim() || (hasSavedSnapshot && handleUnchanged ? profile.avatarUrl : null)

  return (
    <ModalPortal onClose={onClose} label="Edit player profile" maxWidth={420}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-2">
          <User size={16} style={{ color: '#E85D2A' }} />
          <span className="font-display font-bold text-base">Player profile</span>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--text-muted)',
                display: 'flex',
              }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Wallet address (read-only) */}
          <div
            style={{
              padding: '10px 16px',
              background: 'var(--bg)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 12,
              color: 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Wallet </span>
            <span style={{ fontFamily: 'monospace' }}>{shortAddress(profile.walletAddress)}</span>
            <span style={{ marginLeft: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              {profile.wins}W / {profile.losses}L
              {profile.draws > 0 ? ` / ${profile.draws}D` : ''}
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} style={{ padding: '16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <div className="flex flex-col gap-4">
              {/* Username */}
              <div>
                <label
                  htmlFor="wp-username"
                  className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Username
                </label>
                <input
                  id="wp-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. CardShark42"
                  maxLength={20}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  style={inputStyle}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  3-20 characters. Letters, numbers, _ or -. Unique across all players.
                </p>
              </div>

              {/* X handle */}
              <div>
                <label
                  htmlFor="wp-xhandle"
                  className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  X (Twitter) handle
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <XLogo size={13} />
                  </span>
                  <input
                    id="wp-xhandle"
                    type="text"
                    value={xHandle}
                    onChange={(e) => setXHandle(e.target.value.replace(/^@/, ''))}
                    placeholder="your_handle"
                    maxLength={15}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ ...inputStyle, paddingLeft: 30 }}
                  />
                </div>
              </div>

              {/* Avatar */}
              <div>
                <label
                  htmlFor="wp-avatar"
                  className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Avatar
                </label>

                {/* Live preview. Shows a pasted custom URL or the already-saved
                    X picture - it never fetches unavatar while you type. The
                    X picture is fetched and stored once when you hit Save. */}
                <div className="flex items-center gap-3 mb-2">
                  <PlayerAvatar
                    username={username}
                    avatarUrl={previewAvatarUrl}
                    walletAddress={profile.walletAddress}
                    size={44}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {avatarUrl.trim()
                      ? 'Using your custom image.'
                      : !xHandle.trim()
                        ? 'Add an X handle above to use your X profile picture.'
                        : handleUnchanged && hasSavedSnapshot
                          ? 'Using your saved X profile picture.'
                          : 'Your X profile picture is fetched when you hit Save.'}
                  </span>
                </div>

                <input
                  id="wp-avatar"
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="Optional: custom image URL (https://...)"
                  style={inputStyle}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Leave blank to use your X avatar. Paste an https:// URL to override it.
                </p>
              </div>

              {/* Availability */}
              <div>
                <label
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Clock size={13} style={{ color: '#7933bc' }} />
                  Availability
                </label>
                <p className="mb-2.5 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  The hours you&rsquo;re usually checking chat and ready to play. Opponents see these
                  in their own timezone, so it&rsquo;s easy to find overlap.
                </p>

                {/* Timezone */}
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <select
                    value={availTz}
                    onChange={(e) => setAvailTz(e.target.value)}
                    aria-label="Your timezone"
                    style={{
                      ...inputStyle,
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                      paddingRight: 38,
                      cursor: 'pointer',
                    }}
                  >
                    {tzOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tzCity(tz)} ({tzAbbrev(tz)})
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    aria-hidden
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                </div>

                <HourGrid value={hours} onToggle={toggleHour} />

                <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Optional. Tap the hours you&rsquo;re typically around (applies to the whole week).
                  Leave blank to skip.
                </p>
              </div>

              {/* Error message */}
              {fieldError && (
                <div
                  className="flex items-center gap-2 text-sm p-3 rounded-md"
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#ef4444',
                  }}
                  role="alert"
                >
                  <AlertCircle size={14} />
                  {fieldError}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={saving}
                className="footer-btn py-2.5 text-sm font-bold transition-opacity"
                style={{
                  background: saved ? '#22c55e' : '#E85D2A',
                  color: '#fff',
                  borderRadius: 6,
                  border: 'none',
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  width: '100%',
                }}
              >
                {saving ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check size={14} />
                    Saved
                  </>
                ) : (
                  'Save profile'
                )}
              </button>
            </div>
          </form>
    </ModalPortal>
  )
}
