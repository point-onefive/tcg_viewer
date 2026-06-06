'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  defaultSettings,
  sampleSettings,
  sampleState,
  type ChartRaceSettings,
  type ChartRaceState,
  type ChartRow,
  type ChartSeries,
} from './chart-race-types'

/**
 * Dedicated persist store for the chart race maker. Deliberately
 * kept separate from the big shared `tcg-viewer-prefs` store so a
 * brand-new social tool can't collide with the gallery's persisted
 * slice (the repo has multiple contributors, and a separate
 * localStorage key keeps merge surface + blast radius tiny).
 *
 * Everything the user types is persisted so a half-built chart
 * survives a refresh, exactly like the tier-list board does.
 */
interface ChartRaceStore extends ChartRaceState {
  settings: ChartRaceSettings

  setTitle: (v: string) => void
  setSubtitle: (v: string) => void
  setXAxisLabel: (v: string) => void
  setValuePrefix: (v: string) => void
  setValueSuffix: (v: string) => void

  setSeries: (series: ChartSeries[]) => void
  setRows: (rows: ChartRow[]) => void
  renameSeries: (id: string, name: string) => void
  recolorSeries: (id: string, color: string) => void
  /** Set (or clear, with null) the head-of-line avatar for a series. */
  setSeriesImage: (id: string, image: string | null) => void
  addSeries: (name: string, color: string) => void
  removeSeries: (id: string) => void

  setRowLabel: (rowIndex: number, label: string) => void
  setCellValue: (rowIndex: number, seriesIndex: number, value: number | null) => void
  addRow: () => void
  removeRow: (rowIndex: number) => void

  /** Wholesale replace the grid (used by CSV import). */
  replaceGrid: (
    next: Pick<ChartRaceState, 'xAxisLabel' | 'series' | 'rows'>,
  ) => void

  updateSettings: (patch: Partial<ChartRaceSettings>) => void
  loadSample: () => void
  /** Clear just the data grid (lines + rows), keeping titles/labels. */
  clearData: () => void
  /** Reset just the titles + axis/value labels, keeping the data grid. */
  clearLabels: () => void
  clearAll: () => void
}

export const useChartRace = create<ChartRaceStore>()(
  persist(
    (set) => ({
      ...sampleState(),
      settings: sampleSettings(),

      setTitle: (v) => set({ title: v }),
      setSubtitle: (v) => set({ subtitle: v }),
      setXAxisLabel: (v) => set({ xAxisLabel: v }),
      setValuePrefix: (v) => set({ valuePrefix: v }),
      setValueSuffix: (v) => set({ valueSuffix: v }),

      setSeries: (series) => set({ series }),
      setRows: (rows) => set({ rows }),

      renameSeries: (id, name) =>
        set((s) => ({
          series: s.series.map((x) => (x.id === id ? { ...x, name } : x)),
        })),
      recolorSeries: (id, color) =>
        set((s) => ({
          series: s.series.map((x) => (x.id === id ? { ...x, color } : x)),
        })),
      setSeriesImage: (id, image) =>
        set((s) => ({
          series: s.series.map((x) =>
            x.id === id ? { ...x, image: image ?? undefined } : x,
          ),
        })),
      addSeries: (name, color) =>
        set((s) => ({
          series: [...s.series, { id: freshSeriesId(), name, color }],
          // Backfill the new column with nulls so every row stays
          // aligned to the series array by index.
          rows: s.rows.map((r) => ({ ...r, values: [...r.values, null] })),
        })),
      removeSeries: (id) =>
        set((s) => {
          const idx = s.series.findIndex((x) => x.id === id)
          if (idx === -1) return s
          return {
            series: s.series.filter((x) => x.id !== id),
            rows: s.rows.map((r) => ({
              ...r,
              values: r.values.filter((_, i) => i !== idx),
            })),
          }
        }),

      setRowLabel: (rowIndex, label) =>
        set((s) => ({
          rows: s.rows.map((r, i) => (i === rowIndex ? { ...r, label } : r)),
        })),
      setCellValue: (rowIndex, seriesIndex, value) =>
        set((s) => ({
          rows: s.rows.map((r, i) =>
            i === rowIndex
              ? {
                  ...r,
                  values: r.values.map((v, j) => (j === seriesIndex ? value : v)),
                }
              : r,
          ),
        })),
      addRow: () =>
        set((s) => ({
          rows: [
            ...s.rows,
            { label: '', values: s.series.map(() => null) },
          ],
        })),
      removeRow: (rowIndex) =>
        set((s) => ({ rows: s.rows.filter((_, i) => i !== rowIndex) })),

      replaceGrid: (next) =>
        set({
          xAxisLabel: next.xAxisLabel,
          series: next.series,
          rows: next.rows,
        }),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      loadSample: () => set({ ...sampleState() }),
      clearData: () => set({ series: [], rows: [] }),
      clearLabels: () =>
        set({
          title: '',
          subtitle: '',
          xAxisLabel: 'Date',
          valuePrefix: '',
          valueSuffix: '',
        }),
      clearAll: () =>
        set({
          title: '',
          subtitle: '',
          xAxisLabel: 'Date',
          valuePrefix: '',
          valueSuffix: '',
          series: [],
          rows: [],
        }),
    }),
    {
      name: 'tcw-chart-race',
      version: 7,
      // Refresh the starter dataset for anyone on a prior untouched default.
      // Anyone who built or imported their own chart keeps it.
      migrate: (persisted, fromVersion) => {
        const s = (persisted || {}) as Partial<ChartRaceStore>
        // Helper: is this still the unmodified default OP/SP500/BTC sample?
        const isDefaultSample = () =>
          s.title === 'OP vs SP500 vs BTC' &&
          Array.isArray(s.series) &&
          s.series.length === 3 &&
          s.series.some((x) => x.id === 'opbox') &&
          s.series.some((x) => x.id === 'sp500') &&
          s.series.some((x) => x.id === 'bitcoin')
        if (fromVersion < 4) {
          const isOldSample =
            s.title === 'Coffee vs Tea' ||
            s.title === 'What if you bought a booster box?' ||
            isDefaultSample() ||
            (Array.isArray(s.series) &&
              s.series.length === 2 &&
              s.series.some((x) => x.id === 'coffee'))
          if (isOldSample) {
            return { ...s, ...sampleState(), settings: sampleSettings() } as ChartRaceStore
          }
        }
        // v5: head value label defaults OFF.
        if (fromVersion < 5 && s.settings) {
          s.settings = { ...s.settings, showValues: false }
        }
        // v6 + v7: replace old data with current crash-sim + normalize:false.
        // Covers anyone migrating from any prior default sample version.
        if (fromVersion < 7 && isDefaultSample()) {
          return { ...s, ...sampleState(), settings: sampleSettings() } as ChartRaceStore
        }
        return s as ChartRaceStore
      },
    },
  ),
)

// Local id helper so the store doesn't depend on the module-level
// counter in chart-race-types (which resets on a fresh import). Time
// + random is plenty for in-session uniqueness.
function freshSeriesId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}
