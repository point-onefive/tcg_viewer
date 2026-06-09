import type { Metadata } from 'next'
import { HelpPage } from '@/components/help/help-page'

export const metadata: Metadata = {
  title: 'How it works · The Card Wall',
  description:
    'A short reference for filters, sorting, pricing, the lightbox, tier-list maker, and more on The Card Wall.',
}

export default function Help() {
  return <HelpPage />
}
