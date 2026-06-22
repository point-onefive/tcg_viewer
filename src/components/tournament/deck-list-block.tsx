'use client'

// Shared deck-list viewer. Renders a stored deck in the OPTCG Sim export format
// (monospace, one card per line) with a one-tap "Copy" button so players can
// paste it straight into OPTCG Sim - or reuse it when signing up for the next
// event. Used everywhere a deck list is shown (live "your deck" modal, admin
// deck modal, and the public post-event deck archive).

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function DeckListBlock({
  deckList,
  maxHeight = 288,
}: {
  deckList: string
  /** Max height of the scroll area in px. */
  maxHeight?: number
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(deckList)
    } catch {
      // Fallback for older/insecure contexts where the async clipboard API is
      // unavailable.
      const ta = document.createElement('textarea')
      ta.value = deckList
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy deck list to clipboard"
        className="absolute right-2 top-2 z-[1] inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          color: copied ? 'var(--tcw-accent)' : 'var(--text-secondary)',
        }}
      >
        {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} strokeWidth={2.5} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        className="overflow-auto whitespace-pre-wrap rounded-md p-3 pr-[84px] text-xs"
        style={{
          maxHeight,
          background: 'var(--bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {deckList}
      </pre>
    </div>
  )
}
