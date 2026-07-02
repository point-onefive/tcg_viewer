'use client'

// React context for the active tournament theme, so deeply-nested tournament
// components (poll card, round boards, brackets) can read mascot/scene config
// without prop-drilling through the whole tree. The shell provides it when an
// event has an explicit theme; nested components treat null as unbranded.

import { createContext, useContext } from 'react'
import type { TournamentTheme } from '@/lib/tournament/theme'

const TournamentThemeContext = createContext<TournamentTheme | null>(null)

export function TournamentThemeProvider({
  theme,
  children,
}: {
  theme: TournamentTheme
  children: React.ReactNode
}) {
  return <TournamentThemeContext.Provider value={theme}>{children}</TournamentThemeContext.Provider>
}

export function useTournamentTheme(): TournamentTheme | null {
  return useContext(TournamentThemeContext)
}
