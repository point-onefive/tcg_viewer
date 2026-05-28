import type { Metadata } from 'next'
import { SealedDashboard } from '@/components/gallery/sealed-dashboard'

export const metadata: Metadata = {
  title: 'Booster box prices · The Card Wall',
  description:
    'Daily-tracked TCGPlayer market prices for every One Piece booster box.',
}

export default function SealedPage() {
  return <SealedDashboard />
}
