import type { Metadata } from 'next'
import { TierListMaker } from '@/components/tier-list/tier-list-maker'

export const metadata: Metadata = {
  title: 'Tier list maker · The Card Wall',
  description: 'Upload images and drag them into custom tiers. Runs locally in your browser.',
}

export default function TierListPage() {
  return <TierListMaker />
}
