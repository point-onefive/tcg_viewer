// Tournament page theming.
//
// The public /tournaments surface (TournamentLive) can be reskinned per event:
// a sponsor co-brand (e.g. BONK) or a Card Wall self-hosted event. Everything
// that changes between events lives in ONE TournamentTheme object here - copy,
// image paths, the palette (as CSS custom-property overrides), and structural
// toggles (partner pill on/off, payout step on/off, dark-only, etc).
//
// How the palette works: the tournament CSS in globals.css is scoped to
// `.bonk-theme` and reads a set of `--bonk-*` custom properties (BONK was the
// first theme, so the token names kept that prefix - they're just identifiers,
// the "default theme" values). A theme overrides any of them via `cssVars`,
// which the shell applies as inline custom properties on the themed wrapper.
// A theme that overrides nothing renders exactly like BONK.
//
// This file is plain data (no React) so it can be imported by both the DB
// mapper (server) and the client components.

export type ThemeColorMode = 'both' | 'dark-only'

export type HeroFeature =
  // A character/mascot PNG flush to the bottom-right of the hero (BONK dog).
  | { kind: 'character'; src: string; alt?: string }
  // A trading card featured in the hero: framed, rounded, gently tilted.
  | { kind: 'card'; src: string; alt?: string }

/** Prize-pool "powered by" treatments. Partner themes use a baked lockup image;
 * Card Wall self-hosted events reuse the header wordmark beside the kicker. */
export type PrizePoolLockup =
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'cardwall' }

export interface TournamentTheme {
  /** Stable id stored on the tournament row (`tournaments.theme`). */
  id: string
  /** Human label for the admin dropdown. */
  label: string
  /**
   * 'both'      - authored for light + dark, follows the global toggle (BONK).
   * 'dark-only' - the tournament surface is locked to its dark palette; the
   *               global toggle is a no-op on this page.
   */
  colorMode: ThemeColorMode
  /**
   * CSS custom-property overrides applied to the themed wrapper. Keys are the
   * `--bonk-*` (and derived) tokens the tournament CSS reads. Anything omitted
   * falls back to the BONK default baked into globals.css.
   */
  cssVars: Record<string, string>

  hero: {
    ariaLabel: string
    /** null removes the "official prize partner" pill (Card Wall self-hosted). */
    partnerPill: { text: string; logo: string } | null
    titleLine1: string
    titleLine2?: string
    /** Red "!!!" energy tail after the title (BONK signature). */
    bang: boolean
    subhead: string
    feature: HeroFeature
    /** Background photo behind the hero copy (desktop, dark). null = gradient only. */
    scene: { src: string; position?: string } | null
    /** Floating orange embers - only fits the BONK cosmic hero. */
    embers: boolean
  }

  /** Co-brand mark shown after the Card Wall lockup in the nav. null = none. */
  navLockup: { logo: string; alt: string } | null
  /** "powered by X" lockup in the prize-pool header. Required on every theme. */
  prizePoolLockup: PrizePoolLockup

  playbook: {
    /** Top-right accent image on the playbook card. null = none. */
    mascot: string | null
    /**
     * Sponsor payout step ("Set up Bonkuji"). null omits the step entirely,
     * and the remaining steps renumber automatically.
     */
    payout: { name: string; href: string; logo: string; body: string } | null
  }

  /** Per-section header right-slot accent images. null hides that slot. */
  mascots: {
    leaderboard: string | null
    signup: string | null
    roster: string | null
    poll: string | null
  }

  /** BonkSceneBody backdrops for the event-hero + round-board cards. */
  scenes: {
    eventDark: string | null
    eventLight: string | null
    roundDark: string | null
    roundLight: string | null
    prizeDark: string | null
    /** Optional backdrop behind the Community Poll body. Omit for no photo
     *  (BONK/summer keep their plain poll card). */
    pollDark?: string | null
  }

  /** Image on the "no active tournament" empty state. null = none. */
  errorMascot: string | null

  /** Closing co-brand banner. null removes the whole banner. */
  footer: {
    character: string | null
    headline: string
    bang: boolean
    body: string
    cta: { label: string; href: string; logo: string | null } | null
  } | null
}

// ─── BONK x The Card Wall (the incumbent theme) ───────────────────────────
// cssVars is intentionally empty: BONK's values are the defaults baked into
// globals.css, so this theme renders byte-for-byte as before.
const BONK_THEME: TournamentTheme = {
  id: 'bonk',
  label: 'BONK (sponsor)',
  colorMode: 'both',
  cssVars: {},
  hero: {
    ariaLabel: 'BONK Championship Series',
    partnerPill: { text: 'Official prize partner', logo: '/bonk/web-img/master_logo.png' },
    titleLine1: 'BONK Championship',
    titleLine2: 'Series',
    bang: true,
    subhead: 'Prizes for winners, participants, and content creators.',
    feature: { kind: 'character', src: '/bonk/web-img/BONK_Pose_One_001_LR.png', alt: 'BONK Dog' },
    scene: { src: '/bonk/scenes/scene-astronaut.jpg', position: 'center 38%' },
    embers: true,
  },
  navLockup: { logo: '/bonk/web-img/master_logo.png', alt: 'BONK' },
  prizePoolLockup: { kind: 'image', src: '/bonk/web-img/powered_by_bonk_linear_white.png', alt: 'powered by BONK' },
  playbook: {
    mascot: '/bonk/web-img/BONK_Pose_Point_001_LR.png',
    payout: {
      name: 'Bonkuji',
      href: 'https://bonkuji.com/',
      logo: '/bonk/web-img/bonkuji_logo.png',
      body: 'Prizes are paid out through Bonkuji, so a free account is required to collect. Sign in with your wallet, X, Google, or email - it takes about two seconds. Every top prize and participation reward lands here.',
    },
  },
  mascots: {
    leaderboard: '/bonk/web-img/BONK_Pose_ThumbsUp_001_LR.png',
    signup: '/bonk/web-img/BONK_Pose_Wave_001_LR.png',
    roster: '/bonk/web-img/BONK_Pose_Peace_001_LR.png',
    poll: '/bonk/web-img/BONK_Pose_Peace_003_LR.png',
  },
  scenes: {
    eventDark: '/bonk/scenes/scene-snowglobe.jpg',
    eventLight: '/bonk/scenes/scene-bonk-day.jpg',
    roundDark: '/bonk/scenes/scene-astronaut.jpg',
    roundLight: '/bonk/scenes/scene-bonk-day.jpg',
    prizeDark: null,
  },
  errorMascot: '/bonk/web-img/BONK_Pose_Head_001_LR.png',
  footer: {
    character: '/bonk/web-img/BONK_Pose_Peace_001_LR.png',
    headline: 'BONK Dog is a winner',
    bang: true,
    body: 'He wins for the community, never gives up, and never surrenders. This event\u2019s prize pool is proudly backed by BONK.',
    cta: { label: 'bonkcoin.com', href: 'https://bonkcoin.com/', logo: '/bonk/web-img/master_logo.png' },
  },
}

// ─── Summer 2026 - The Card Wall self-hosted (dark-only) ──────────────────
// Palette eyedropped from the NatsuComi 2026 Summer promo card: sky blue
// (#4FA0D4), watermelon red (#e8455a), watermelon green, ocean night. No
// sponsor: no partner pill, no co-brand lockup, no external payout step. The
// promo card is featured in the hero instead of a mascot.
const SUMMER_ASSETS = '/tournaments/themes/summer2026'
const SUMMER_2026_THEME: TournamentTheme = {
  id: 'summer2026',
  label: 'Summer 2026 (Card Wall)',
  colorMode: 'dark-only',
  cssVars: {
    // Accent ramp - sky blue primary, watermelon-red pop.
    '--bonk-ui-orange': '#3fa3dd',
    '--bonk-ui-yellow': '#7fd0ef',
    '--bonk-orange': '#3fa3dd',
    '--bonk-yellow': '#7fd0ef',
    '--bonk-red': '#e8455a',
    '--bonk-purple': '#2f7fb8',
    '--bonk-midnight': '#06182a',
    '--tcw-accent': '#3fa3dd',
    '--tcw-accent-2': '#7fd0ef',
    // Signature gradients - cool aqua + a warm summer-sun radial for energy.
    '--bonk-grad-sun': 'linear-gradient(135deg, #7fd0ef 0%, #3a86c8 100%)',
    '--bonk-grad-ui': 'linear-gradient(135deg, #4fb0e6 0%, #2f7fb8 100%)',
    '--bonk-grad-fire': 'radial-gradient(125% 150% at 50% 0%, #ffd36b 0%, #ff7a45 100%)',
    '--bonk-grad-night': 'linear-gradient(160deg, #0f3a56 0%, #06131f 100%)',
    // Section band icon/kicker to a bright sky blue on the ocean band.
    '--bonk-band-icon': '#7fd0ef',
    '--bonk-band-kicker': '#7fd0ef',
    // Hero: deep ocean night with a sky glow, blue mascot glow, no embers/scene.
    '--bonk-hero-bg-dark':
      'radial-gradient(115% 130% at 92% 6%, rgba(79,176,230,0.28) 0%, transparent 52%), radial-gradient(95% 120% at 3% 100%, rgba(47,127,184,0.5) 0%, transparent 60%), linear-gradient(157deg, #0f3a56 0%, #06182a 52%, #0a2436 100%)',
    '--bonk-hero-glow-dark': 'radial-gradient(46% 46% at 64% 50%, rgba(79,176,230,0.42) 0%, transparent 72%)',
    // Playbook + footer: beach scenes with a deep ocean wash overlay.
    '--bonk-how-scene-dark': `url(${SUMMER_ASSETS}/scenes/scene-sunset.webp)`,
    '--bonk-how-wash-dark':
      'linear-gradient(108deg, rgba(6,19,31,0.86) 30%, rgba(10,40,60,0.60) 72%, rgba(15,58,86,0.38) 100%)',
    '--bonk-foot-scene-dark': `url(${SUMMER_ASSETS}/scenes/scene-umbrellas.webp)`,
    '--bonk-foot-wash-dark':
      'linear-gradient(100deg, rgba(6,19,31,0.84) 38%, rgba(10,40,60,0.56) 78%, rgba(15,58,86,0.38) 100%)',
  },
  hero: {
    ariaLabel: 'One Piece TCG Summer Popup',
    partnerPill: null,
    titleLine1: 'One Piece TCG',
    titleLine2: 'Summer Popup',
    bang: false,
    subhead: 'Battle for NatsuComi 2026 Metakira Monkey D. Luffy Promos - Eiichiro Oda Signature.',
    feature: { kind: 'card', src: `${SUMMER_ASSETS}/hero-card.webp`, alt: 'NatsuComi 2026 Summer promo - Monkey D. Luffy' },
    scene: { src: `${SUMMER_ASSETS}/scene-hero.webp`, position: 'center 30%' },
    embers: false,
  },
  navLockup: null,
  prizePoolLockup: { kind: 'cardwall' },
  playbook: {
    mascot: null,
    payout: null,
  },
  mascots: {
    leaderboard: null,
    signup: null,
    roster: null,
    poll: null,
  },
  scenes: {
    eventDark: `${SUMMER_ASSETS}/scenes/scene-beach.webp`,
    eventLight: null,
    roundDark: `${SUMMER_ASSETS}/scenes/scene-palms.webp`,
    roundLight: null,
    prizeDark: `${SUMMER_ASSETS}/scenes/scene-prize.webp`,
  },
  errorMascot: null,
  footer: {
    character: null,
    headline: 'Play. Win. Repeat.',
    bang: false,
    body: 'This event is hosted by The Card Wall. Great cards and good games. Bring your best deck and battle for the summer promo.',
    cta: { label: 'thecardwall.com', href: 'https://thecardwall.com', logo: null },
  },
}

// ─── Card Treasure - The Card Wall self-hosted (dark-only) ────────────────
// Palette eyedropped from the Card Treasure emblem: rich gold (#e0a92e /
// #f4d03f), Swiss-cross red (#d62828), and a warm near-black vault. No
// sponsor: no partner pill, no external payout step. The badge is featured
// in the hero and reused as the nav + prize + footer lockup. Playbook and
// footer panels render as clean dark gradients (no scene photos) so the
// look stays consistent without event-specific imagery.
const CARDTREASURE_ASSETS = '/tournaments/themes/cardtreasure'
const CARD_TREASURE_LOGO = `${CARDTREASURE_ASSETS}/logo.webp`
const CARD_TREASURE_THEME: TournamentTheme = {
  id: 'cardtreasure',
  label: 'Card Treasure (Card Wall)',
  colorMode: 'dark-only',
  cssVars: {
    // Accent ramp - gold primary, Swiss-cross red pop.
    '--bonk-ui-orange': '#e0a92e',
    '--bonk-ui-yellow': '#f4d03f',
    '--bonk-orange': '#e0a92e',
    '--bonk-yellow': '#f4d03f',
    '--bonk-red': '#d62828',
    '--bonk-purple': '#7a1420',
    '--bonk-midnight': '#0b0906',
    '--tcw-accent': '#e0a92e',
    '--tcw-accent-2': '#f4d03f',
    // Signature gradients - molten gold + a gold->red energy radial.
    '--bonk-grad-sun': 'linear-gradient(135deg, #f4d03f 0%, #d99a1c 100%)',
    '--bonk-grad-ui': 'linear-gradient(135deg, #edc33a 0%, #c8901a 100%)',
    '--bonk-grad-fire': 'radial-gradient(125% 150% at 50% 0%, #f0b53a 0%, #c81e2e 100%)',
    '--bonk-grad-night': 'linear-gradient(160deg, #1c120a 0%, #0a0706 100%)',
    // Section band icon/kicker to bright gold on the dark band.
    '--bonk-band-icon': '#f4d03f',
    '--bonk-band-kicker': '#f4d03f',
    // The store photos behind section cards are crisp and a bit busy, so lift
    // them above the faint 0.16 default to read as clear (if dim) photos
    // rather than grain. Text stays legible over the warm-dark cards.
    '--bonk-scene-opacity': '0.26',
    // The emblem is a self-contained badge (not a bleed-to-edge mascot), so
    // inset it from the hero's right edge instead of sitting flush.
    '--bonk-mascot-right': 'clamp(16px, 4vw, 64px)',
    // Desktop: the badge is a self-contained emblem, so center it vertically
    // instead of sitting flush to the bottom edge (BONK's peeking dog keeps
    // bottom:0 via the CSS defaults).
    '--bonk-mascot-top': '50%',
    '--bonk-mascot-bottom': 'auto',
    '--bonk-mascot-transform': 'translateY(-50%)',
    // On small/mobile viewports the emblem becomes a large watermark behind
    // the title (not a bottom-corner peek). Desktop keeps the full-size badge
    // inset from the right edge.
    '--bonk-mascot-sm-width': 'clamp(280px, 82vw, 420px)',
    '--bonk-mascot-sm-opacity': '0.2',
    '--bonk-mascot-sm-bottom': 'auto',
    '--bonk-mascot-sm-top': '50%',
    '--bonk-mascot-sm-right': 'clamp(10px, 5vw, 44px)',
    '--bonk-mascot-sm-z-index': '0',
    '--bonk-mascot-sm-transform': 'translateY(-48%)',
    '--bonk-mascot-sm-filter': 'none',
    // Hero: warm black vault with a gold glow top-right, wine-red glow
    // bottom-left, gold mascot glow. No embers/scene.
    '--bonk-hero-bg-dark':
      'radial-gradient(115% 130% at 92% 6%, rgba(224,169,46,0.24) 0%, transparent 52%), radial-gradient(95% 120% at 3% 100%, rgba(160,20,32,0.5) 0%, transparent 60%), linear-gradient(157deg, #1a1109 0%, #0a0706 52%, #140b06 100%)',
    '--bonk-hero-glow-dark': 'radial-gradient(46% 46% at 64% 50%, rgba(224,169,46,0.4) 0%, transparent 72%)',
    // Desktop hero shows a clear-but-dim store photo (left-fade masked so the
    // headline keeps contrast). Mobile keeps the clean gradient + faded-logo
    // watermark, so the hero photo is suppressed there.
    '--bonk-hero-scene-opacity': '0.2',
    '--bonk-hero-scene-opacity-sm': '0',
    // Playbook + footer: real Card Treasure storefront photos under a warm
    // gold/red wash so the white copy + glass step cards stay legible.
    '--bonk-how-scene-dark': `url(${CARDTREASURE_ASSETS}/scenes/scene-aisle.webp)`,
    '--bonk-how-wash-dark':
      'linear-gradient(108deg, rgba(11,9,6,0.9) 30%, rgba(40,16,8,0.72) 72%, rgba(60,20,10,0.5) 100%)',
    '--bonk-foot-scene-dark': `url(${CARDTREASURE_ASSETS}/scenes/scene-lounge.webp)`,
    '--bonk-foot-wash-dark':
      'linear-gradient(100deg, rgba(11,9,6,0.9) 38%, rgba(46,12,14,0.68) 78%, rgba(60,20,10,0.5) 100%)',
  },
  hero: {
    ariaLabel: 'Card Treasure Adventure',
    partnerPill: null,
    titleLine1: 'Card Treasure',
    titleLine2: 'Adventure',
    bang: false,
    subhead: 'Battle for the vault. Part of our small business highlight campaign - prizes for winners, participants, and creators.',
    feature: { kind: 'character', src: CARD_TREASURE_LOGO, alt: 'Card Treasure' },
    scene: { src: `${CARDTREASURE_ASSETS}/scene-hero.webp`, position: 'center 42%' },
    embers: false,
  },
  navLockup: { logo: CARD_TREASURE_LOGO, alt: 'Card Treasure' },
  prizePoolLockup: { kind: 'image', src: CARD_TREASURE_LOGO, alt: 'Card Treasure' },
  playbook: {
    mascot: null,
    payout: null,
  },
  mascots: {
    leaderboard: null,
    signup: null,
    roster: null,
    poll: null,
  },
  scenes: {
    // Real Card Treasure store photos behind the section cards (each unique,
    // no repeats). They render as a faint ~16% texture behind the content.
    eventDark: `${CARDTREASURE_ASSETS}/scenes/scene-overview.webp`,
    eventLight: null,
    roundDark: `${CARDTREASURE_ASSETS}/scenes/scene-tables.webp`,
    roundLight: null,
    prizeDark: `${CARDTREASURE_ASSETS}/scenes/scene-cases.webp`,
    // The poll sits on the enrolling page where the round board (tables) isn't
    // shown yet, so reusing it here reads as its own backdrop, not a repeat.
    pollDark: `${CARDTREASURE_ASSETS}/scenes/scene-tables.webp`,
  },
  errorMascot: CARD_TREASURE_LOGO,
  footer: {
    character: CARD_TREASURE_LOGO,
    headline: 'Unlock the vault',
    bang: false,
    body: 'This event is part of The Card Wall small business highlight campaign, in partnership with Card Treasure. Bring your best deck and battle for the treasure.',
    cta: { label: 'cardtreasure.ch', href: 'https://cardtreasure.ch/', logo: null },
  },
}

export const TOURNAMENT_THEMES: Record<string, TournamentTheme> = {
  [BONK_THEME.id]: BONK_THEME,
  [SUMMER_2026_THEME.id]: SUMMER_2026_THEME,
  [CARD_TREASURE_THEME.id]: CARD_TREASURE_THEME,
}

/** The theme used when a tournament has no explicit theme set (backward compat:
 * existing/legacy events keep the BONK look until a theme is chosen in admin). */
export const DEFAULT_THEME_ID = 'bonk'

const ADMIN_LAST_THEME_KEY = 'tcw-tournament-admin-theme'

/** Last theme picked in the admin panel (survives reloads / new events). */
export function getLastAdminTheme(): string | null {
  if (typeof window === 'undefined') return null
  const id = localStorage.getItem(ADMIN_LAST_THEME_KEY)
  return id && TOURNAMENT_THEMES[id] ? id : null
}

export function setLastAdminTheme(id: string): void {
  if (typeof window === 'undefined') return
  if (TOURNAMENT_THEMES[id]) localStorage.setItem(ADMIN_LAST_THEME_KEY, id)
}

/** Options for the admin theme dropdown. */
export function themeOptions(): { id: string; label: string }[] {
  return Object.values(TOURNAMENT_THEMES).map((t) => ({ id: t.id, label: t.label }))
}

/**
 * Resolve a theme id (from a loaded tournament row) to a TournamentTheme.
 * Unknown/unset ids fall back to BONK so existing events are byte-for-byte
 * unchanged. The "no BONK flash before a themed event loads" case is handled
 * upstream: TournamentLive renders an unbranded shell while fetching and only
 * calls this once the row (and its theme id) is known.
 */
export function getTournamentTheme(themeId: string | null | undefined): TournamentTheme {
  if (themeId && TOURNAMENT_THEMES[themeId]) return TOURNAMENT_THEMES[themeId]
  return TOURNAMENT_THEMES[DEFAULT_THEME_ID]
}
