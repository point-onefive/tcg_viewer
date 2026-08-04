'use client'

import { useState } from 'react'
import { Download, HelpCircle } from 'lucide-react'
import { ModalPortal } from '@/components/ui/modal-portal'
import { BonkModuleHeader, BonkModalClose } from '@/components/tournament/bonk-ui'

// Shared "How to get your Combat Log" explainer. The OPTCG Sim game screen has a
// button literally labeled "Download Combat Log" that saves the match log file
// our tools ingest. This helper points players at that exact button and shows a
// screenshot of it, so the instruction is unambiguous across every surface that
// asks for a log (dispute evidence, the deck-integrity checker, the playbook).
//
// Three ergonomic forms are exported so each caller can pick what fits:
//   - CombatLogHelp: an inline explainer block (heading + body + screenshot).
//   - CombatLogHelpModal: the same content in a themed modal (QualifyModal-style
//     role="dialog", Escape + backdrop close, viewport-safe via ModalPortal).
//   - CombatLogHelpLink: a small "How?" text link that opens the modal.

const IMG_SRC = '/tournaments/combat-log-button.webp'
const IMG_ALT = 'The Download Combat Log button in the OPTCG Sim game screen'

export const COMBAT_LOG_HEADING = 'Get your Combat Log'
export const COMBAT_LOG_BODY =
  'After your match ends, press the “Download Combat Log” button in the OPTCG Sim game screen. That downloads a log file of the match. Upload or attach that file here.'

/** Framed screenshot of the button, responsive and mobile-safe. */
function ButtonShot() {
  return (
    <div
      className="mt-3 overflow-hidden rounded-lg"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', padding: 10 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={IMG_SRC}
        alt={IMG_ALT}
        loading="lazy"
        style={{ display: 'block', width: '100%', maxWidth: 256, height: 'auto' }}
      />
    </div>
  )
}

/**
 * Inline explainer block. Drop it directly under an input that wants a Combat
 * Log so the instruction sits next to the field.
 */
export function CombatLogHelp({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        background: 'color-mix(in srgb, var(--tcw-accent) 8%, var(--bg))',
        border: '1px solid color-mix(in srgb, var(--tcw-accent) 24%, transparent)',
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div className="flex items-center gap-2">
        <Download size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} aria-hidden />
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
          {COMBAT_LOG_HEADING}
        </span>
      </div>
      <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {COMBAT_LOG_BODY}
      </p>
      <ButtonShot />
    </div>
  )
}

/** Modal form, mirroring the QualifyModal / DeckHelpModal pattern. */
export function CombatLogHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalPortal onClose={onClose} label={COMBAT_LOG_HEADING} maxWidth={420} className="bonk-theme">
      <BonkModuleHeader
        icon={Download}
        title="Combat Log"
        right={<BonkModalClose onClose={onClose} />}
      />
      <div style={{ padding: '20px 24px 24px', overflowY: 'auto' }}>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {COMBAT_LOG_BODY}
        </p>
        <ButtonShot />
      </div>
    </ModalPortal>
  )
}

/**
 * Small inline "How?" link that opens the modal. Sized as a text button so it
 * can live at the end of a sentence without disrupting the flow.
 */
export function CombatLogHelpLink({
  label = 'How?',
  className,
}: {
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        style={{
          font: 'inherit',
          color: 'var(--tcw-accent)',
          fontWeight: 700,
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
        }}
      >
        <HelpCircle size={13} aria-hidden />
        {label}
      </button>
      {open && <CombatLogHelpModal onClose={() => setOpen(false)} />}
    </>
  )
}
