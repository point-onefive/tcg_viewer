import type { Metadata } from 'next'
import { ChartRaceMaker } from '@/components/chart-race/chart-race-maker'

export const metadata: Metadata = {
  title: 'Chart race maker · The Card Wall',
  description: 'Paste or upload data and play a smooth animated line chart race. Runs locally in your browser.',
}

export default function ChartRacePage() {
  return <ChartRaceMaker />
}
