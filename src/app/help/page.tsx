import type { Metadata } from 'next'
import { HelpPage } from '@/components/help/help-page'

export const metadata: Metadata = {
  title: 'How it works · The Card Wall',
  description:
    'A short reference for filters, the lightbox, pin board, tier-list maker, and theme on The Card Wall.',
}

export default function Help() {
  return <HelpPage />
}
