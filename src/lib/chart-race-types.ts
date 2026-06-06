/**
 * Shared types + pure helpers for the chart race maker
 * (`/chart-race`). Kept framework-free so both the Zustand
 * persist store and the React component can import them without
 * pulling client-only code into the store module.
 *
 * Data model is a simple spreadsheet-shaped grid:
 *
 *   - `series` are the columns (one coloured line each).
 *   - `rows` are the time steps. Each row carries an x-axis
 *     `label` (a date string, a year, a category) and a value
 *     per series, aligned by index to `series`.
 *
 * CSV import and the on-page grid editor both normalise into this
 * shape, so the renderer never has to care where the numbers came
 * from.
 */

export interface ChartSeries {
  /** Stable id used as React key + colour-map key. */
  id: string
  /** Display name shown in the legend and at the line tip. */
  name: string
  /** Any CSS colour. Defaults pulled from `SERIES_PALETTE`. */
  color: string
  /**
   * Optional avatar shown as a circular badge riding the head of the
   * line (instead of just the value dot). Stored as a small, square,
   * downscaled data URL so it survives a refresh via the persisted
   * store and exports cleanly with html-to-image (no CORS/blob).
   */
  image?: string
}

export interface ChartRow {
  /** X-axis tick label for this time step (date, year, label). */
  label: string
  /**
   * One value per series, aligned by index to `ChartRaceState.series`.
   * `null` means "no data at this step" - the line bridges the gap.
   */
  values: (number | null)[]
}

export interface ChartRaceState {
  /** Big title rendered above the chart (and baked into exports). */
  title: string
  /** Optional sub-caption under the title. */
  subtitle: string
  /** Label for the x-axis (e.g. "Date"). Drives the CSV header cell. */
  xAxisLabel: string
  /** Prepended to every value label (e.g. "$"). */
  valuePrefix: string
  /** Appended to every value label (e.g. "%"). */
  valueSuffix: string
  series: ChartSeries[]
  rows: ChartRow[]
}

/**
 * Animation + display knobs kept separate from the data so the
 * persist store can version them independently and a future
 * "reset data but keep my settings" button stays trivial.
 */
export interface ChartRaceSettings {
  /** Seconds for a full play-through from first to last step. */
  durationSec: number
  /** Rebase every series to 100 at its first non-null value. */
  normalize: boolean
  /** Let the y-axis grow with the revealed data for a "climb" feel. */
  dynamicAxis: boolean
  /** Smooth the line with a monotone curve instead of straight joins. */
  smooth: boolean
  /** Show the filled area under each line. */
  area: boolean
  /** Show value labels riding the tip of each line. */
  showValues: boolean
}

/**
 * Brand-leaning palette. Index 0 is the site orange so a single
 * series matches the rest of the chrome; the rest are picked to
 * stay legible on both the light (#f5f3f0) and dark (#0e0e0e)
 * backgrounds.
 */
export const SERIES_PALETTE = [
  '#E85D2A', // brand orange
  '#2A9D8F', // teal
  '#4C7DF0', // blue
  '#E0B43A', // gold
  '#C2569B', // magenta
  '#6BBF59', // green
  '#E0533D', // coral
  '#8A7BE0', // violet
] as const

export function pickColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length]
}

export function defaultSettings(): ChartRaceSettings {
  return {
    durationSec: 8,
    normalize: true,
    dynamicAxis: false,
    smooth: true,
    area: false,
    showValues: false,
  }
}

/** Settings tuned specifically for the built-in sample chart. */
export function sampleSettings(): ChartRaceSettings {
  return { ...defaultSettings(), normalize: false }
}

let idCounter = 0
/** Collision-resistant id for a fresh series/row created in-session. */
export function freshId(prefix = 's'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/**
 * Optional head-of-line avatars for the default sample series, keyed
 * by series id. Drop real artwork into `public/images/chart-race/`
 * and point these at it (e.g. `/images/chart-race/op.png`) to make
 * the starter chart ship with branded line heads. Leaving a value
 * `undefined` simply renders that line's head as the plain coloured
 * dot - so an empty map (the current state) is perfectly valid and
 * produces zero broken-image requests. See the folder README for the
 * naming convention and recommended image specs.
 */
const DEFAULT_HEAD_IMAGES: { opbox?: string; sp500?: string; bitcoin?: string } = {
  opbox: '/images/chart-race/op.png',
  sp500: '/images/chart-race/sp500.png',
  bitcoin: '/images/chart-race/bitcoin.png',
}

/**
 * Starter dataset for the chart race maker. Simulated crash scenario:
 * raw dollar values with normalize=false so each line starts at its
 * actual dollar amount:
 *   - OPTCG booster box: starts at $500 (bottom of chart), compounds
 *     ~5%/month to ~$4,939 by mid-2026.
 *   - S&P 500: starts at $2,500 (visual midpoint), tight +-3% oscillation,
 *     crashes to $1 on Jun 8, 2026.
 *   - Bitcoin: starts at $2,500 (visual midpoint), wider +-10% oscillation,
 *     crashes to $1 on Jun 8, 2026.
 * This is a simulation, not real market data.
 */
export function sampleState(): ChartRaceState {
  const labels = [
    'Jul 2022', 'Aug 2022', 'Sep 2022', 'Oct 2022', 'Nov 2022', 'Dec 2022',
    'Jan 2023', 'Feb 2023', 'Mar 2023', 'Apr 2023', 'May 2023', 'Jun 2023',
    'Jul 2023', 'Aug 2023', 'Sep 2023', 'Oct 2023', 'Nov 2023', 'Dec 2023',
    'Jan 2024', 'Feb 2024', 'Mar 2024', 'Apr 2024', 'May 2024', 'Jun 2024',
    'Jul 2024', 'Aug 2024', 'Sep 2024', 'Oct 2024', 'Nov 2024', 'Dec 2024',
    'Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025',
    'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025',
    'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 8, 2026',
  ]
  // OPTCG booster box: starts at $500, ~5%/month compound growth to ~$4,939
  const opBox = [
     500,  525,  551,  578,  607,  637,
     669,  702,  737,  774,  813,  853,
     896,  941,  988, 1037, 1089, 1143,
    1200, 1260, 1323, 1389, 1459, 1531,
    1608, 1688, 1773, 1862, 1954, 2052,
    2154, 2262, 2375, 2494, 2619, 2750,
    2888, 3032, 3184, 3343, 3510, 3686,
    3870, 4064, 4267, 4480, 4704, 4939,
  ]
  // S&P 500: starts at $2,500 (visual midpoint), tight +-3% sideways chop;
  // crashes to $1 on Jun 8
  const sp500 = [
    2500, 2535, 2470, 2515, 2490, 2540,
    2505, 2475, 2530, 2495, 2545, 2510,
    2480, 2525, 2500, 2460, 2515, 2545,
    2490, 2535, 2505, 2470, 2525, 2495,
    2545, 2510, 2480, 2535, 2500, 2465,
    2520, 2490, 2545, 2510, 2475, 2530,
    2500, 2470, 2530, 2495, 2545, 2505,
    2475, 2530, 2500, 2540, 2510,    1,
  ]
  // Bitcoin: starts at $2,500 (visual midpoint), wider +-10% chop;
  // crashes to $1 on Jun 8 (falls from same height, different slope)
  const bitcoin = [
    2500, 2720, 2310, 2650, 2380, 2630,
    2290, 2700, 2420, 2600, 2310, 2680,
    2450, 2750, 2340, 2620, 2400, 2700,
    2320, 2650, 2450, 2730, 2380, 2620,
    2310, 2690, 2410, 2590, 2350, 2710,
    2430, 2280, 2680, 2390, 2630, 2460,
    2290, 2680, 2390, 2610, 2340, 2660,
    2410, 2730, 2360, 2590, 2450,    1,
  ]
  const series: ChartSeries[] = [
    { id: 'opbox', name: 'OPTCG (Romance Dawn Booster Box)', color: pickColor(0), image: DEFAULT_HEAD_IMAGES.opbox },
    { id: 'sp500', name: 'S&P 500', color: pickColor(1), image: DEFAULT_HEAD_IMAGES.sp500 },
    { id: 'bitcoin', name: 'Bitcoin', color: pickColor(3), image: DEFAULT_HEAD_IMAGES.bitcoin },
  ]
  const rows: ChartRow[] = labels.map((label, i) => ({
    label,
    values: [opBox[i], sp500[i], bitcoin[i]],
  }))
  return {
    title: 'OP vs SP500 vs BTC',
    subtitle: 'Return since the One Piece TCG launched (Jul 2022)',
    xAxisLabel: 'Month',
    valuePrefix: '$',
    valueSuffix: '',
    series,
    rows,
  }
}

export function emptyState(): ChartRaceState {
  return {
    title: '',
    subtitle: '',
    xAxisLabel: 'Date',
    valuePrefix: '',
    valueSuffix: '',
    series: [],
    rows: [],
  }
}

/**
 * Split a single CSV line into cells. Handles double-quoted fields
 * (so "1,234.5" survives), escaped quotes (""), and trims stray
 * whitespace on unquoted cells. Tabs are treated as delimiters too
/**
 * Split a single line into cells using a known delimiter. Handles
 * double-quoted fields (so "1,234.5" survives), escaped quotes (""),
 * and trims stray whitespace on unquoted cells. The delimiter is
 * detected once per document (see `detectDelimiter`) so a straight
 * copy/paste out of Google Sheets / Excel / a semicolon-locale CSV
 * all just work.
 */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/**
 * Pick the delimiter from the header line by counting candidates
 * that sit outside quoted fields. Tabs win ties (a tab almost never
 * appears by accident), then commas, semicolons, pipes. Falls back
 * to comma so a single-column paste still parses predictably.
 */
function detectDelimiter(headerLine: string): string {
  const candidates = ['\t', ',', ';', '|']
  const counts: Record<string, number> = { '\t': 0, ',': 0, ';': 0, '|': 0 }
  let inQuotes = false
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i]
    if (ch === '"') {
      if (inQuotes && headerLine[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch in counts) counts[ch]++
  }
  let best = ','
  let bestCount = 0
  for (const c of candidates) {
    if (counts[c] > bestCount) {
      best = c
      bestCount = counts[c]
    }
  }
  return best
}

/**
 * Strip grouping commas / currency symbols / percent before Number().
 * Also accepts accounting-style negatives `(1,234)` and a leading `+`.
 */
function parseNumber(raw: string): number | null {
  if (raw == null) return null
  let s = raw.trim()
  if (s === '') return null
  let negative = false
  // Accounting negatives: (1,234.5) -> -1234.5
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$£€¥%\s]/g, '').replace(/,/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

export interface CsvParseResult {
  ok: boolean
  error?: string
  xAxisLabel?: string
  series?: ChartSeries[]
  rows?: ChartRow[]
}

/**
 * Parse pasted / uploaded CSV (or TSV) into the chart grid.
 *
 * Expected shape (header row required):
 *
 *   Date,   Coffee, Tea
 *   2021,   100,    100
 *   2022,   112,    106
 *
 * First column is the x-axis. Every other column becomes a series.
 * Empty cells become `null` (the line bridges them). Existing
 * series colours are reused by name where possible so re-importing
 * a tweaked CSV doesn't shuffle the palette.
 *
 * Tolerant of messy real-world input: a UTF-8 BOM, mixed line
 * endings, comma / tab / semicolon / pipe delimiters, blank lines,
 * a trailing empty column (Excel's stray comma), duplicate column
 * names, and currency / percent / accounting-negative number
 * formats.
 */
export function parseCsv(text: string, existing: ChartSeries[] = []): CsvParseResult {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Nothing to import.' }
  }
  // Drop a UTF-8 BOM (Excel adds one) so it can't corrupt the first
  // header name or the delimiter sniff.
  const clean = text.replace(/^\uFEFF/, '')
  const lines = clean
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { ok: false, error: 'That file looks empty. Paste or upload a CSV with a header row and data.' }
  }
  if (lines.length < 2) {
    return { ok: false, error: 'Need a header row plus at least one data row.' }
  }
  const delim = detectDelimiter(lines[0])
  let header = splitLine(lines[0], delim)
  // Drop a single trailing empty header cell (Excel's stray comma).
  while (header.length > 2 && header[header.length - 1] === '') header.pop()
  if (header.length < 2) {
    return {
      ok: false,
      error: 'Couldn\'t find columns. Separate values with commas, tabs, or semicolons (first column is the x-axis).',
    }
  }
  const xAxisLabel = header[0] || 'Date'
  const colorByName = new Map(existing.map((s) => [s.name.toLowerCase(), s.color]))
  // De-duplicate series names so two "Price" columns stay distinct.
  const usedNames = new Map<string, number>()
  const seriesNames = header.slice(1).map((raw, i) => {
    const base = raw || `Series ${i + 1}`
    const key = base.toLowerCase()
    const seen = usedNames.get(key) ?? 0
    usedNames.set(key, seen + 1)
    return seen === 0 ? base : `${base} (${seen + 1})`
  })
  const series: ChartSeries[] = seriesNames.map((name, i) => ({
    id: freshId(),
    name,
    color: colorByName.get(name.toLowerCase()) ?? pickColor(i),
  }))
  const rows: ChartRow[] = []
  let numericCells = 0
  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r], delim)
    const label = cells[0] ?? ''
    const values = series.map((_, i) => {
      const v = parseNumber(cells[i + 1])
      if (v != null) numericCells++
      return v
    })
    rows.push({ label, values })
  }
  if (rows.length === 0) {
    return { ok: false, error: 'No data rows found.' }
  }
  if (numericCells === 0) {
    return {
      ok: false,
      error: 'No numbers found in the data rows. Check the header is on the first line and values are numeric.',
    }
  }
  return { ok: true, xAxisLabel, series, rows }
}

/** Serialize the current grid back to CSV (for the copy button). */
export function toCsv(state: ChartRaceState): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = [state.xAxisLabel || 'Date', ...state.series.map((s) => s.name)]
  const lines = [header.map(esc).join(',')]
  for (const row of state.rows) {
    const cells = [row.label, ...row.values.map((v) => (v == null ? '' : String(v)))]
    lines.push(cells.map((c) => esc(String(c))).join(','))
  }
  return lines.join('\n')
}

/**
 * Apply the "% growth from start" transform. Each series is
 * expressed as its percentage change from its own first non-null
 * value, so every line starts together at 0 and the chart reads as
 * relative performance (the recommended framing for comparing
 * assets of different absolute scale, e.g. a $400 stock vs a
 * $5,000 index).
 */
export function normalizeRows(rows: ChartRow[], seriesCount: number): ChartRow[] {
  const bases: (number | null)[] = Array.from({ length: seriesCount }, () => null)
  for (const row of rows) {
    for (let i = 0; i < seriesCount; i++) {
      if (bases[i] == null && row.values[i] != null && row.values[i] !== 0) {
        bases[i] = row.values[i]
      }
    }
  }
  return rows.map((row) => ({
    label: row.label,
    values: row.values.map((v, i) => {
      const base = bases[i]
      if (v == null || base == null) return v
      return (v / base - 1) * 100
    }),
  }))
}
