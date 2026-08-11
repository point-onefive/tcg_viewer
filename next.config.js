/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow a build-time override of the output dir so an ad-hoc production
  // build (`NEXT_DIST_DIR=.next-perf npm run build`) can coexist with a
  // running dev server. Default unchanged — only set when explicitly
  // overriding for performance measurements.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  // Webpack customizations.
  webpack(config) {
    // wagmi v3's tempoWallet/porto connectors use a dynamic import('accounts')
    // with a .catch() fallback - it's optional at runtime but webpack's static
    // analysis trips over the unresolvable specifier. Tell webpack to treat
    // 'accounts' as an empty/null module so the bundle doesn't fail at compile
    // time. The connector handles the missing dep gracefully at runtime.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      accounts: false,
    }
    return config
  },
  images: {
    // Serve WebP from the optimizer. Source PNGs (especially One Piece) are
    // large; WebP cuts payload ~30-60% and the optimizer caches results.
    formats: ['image/webp'],
    // Card tiles render at ~110-260 CSS px wide depending on zoom level. The
    // Next defaults serve large desktop-sized variants; constrain to the
    // sizes we actually request via `<Image sizes=...>` so the optimizer
    // doesn't generate (and the CDN doesn't cache) 1080/1200/1920+ widths
    // for thumbnails.
    deviceSizes: [320, 640, 750, 1080, 1200, 1920],
    imageSizes: [128, 200, 256, 384],
    // Cache optimized variants for a day on the edge before re-verifying.
    minimumCacheTTL: 60 * 60 * 24,
    // Whitelisted `quality` values usable from `<Image quality={N}>`.
    // Next.js 16 requires this allow-list and emits a per-image console
    // error if a code-site passes a quality not declared here. We use
    // q=60 for thumbnails in the wall (card-tile.tsx) — visually
    // indistinguishable from q=75 at 200-384px wide but shaves a quick
    // 25-35% off the WebP payload — and q=75 (the Next default) for
    // the full-art lightbox. Without this list, every tile dumped a
    // red "quality '60' is not configured" stack-trace into devtools
    // which is both spammy and an actual perf hit during dev. (Hard
    // requirement in Next 16, advisory in Next 15.)
    qualities: [60, 75],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
      {
        protocol: 'https',
        hostname: 'fastly.picsum.photos',
      },
      {
        protocol: 'https',
        hostname: 'pub-6d5072ccd26a467db70791436c203abb.r2.dev',
      },
      {
        protocol: 'https',
        hostname: 'en.onepiece-cardgame.com',
      },
      {
        // Master Japan cardlist. Hot-linked from imagesByLanguage.jp
        // until we mirror JP images onto R2 (see generator's URL
        // policy comment for the swap-over plan).
        protocol: 'https',
        hostname: 'www.onepiece-cardgame.com',
      },
      {
        // Asia-English cardlist (separate Bandai catalogue from en.).
        protocol: 'https',
        hostname: 'asia-en.onepiece-cardgame.com',
      },
      {
        // Traditional Chinese (Hong Kong / Macau) cardlist.
        protocol: 'https',
        hostname: 'asia-tc.onepiece-cardgame.com',
      },
      {
        // Traditional Chinese (Taiwan) cardlist.
        protocol: 'https',
        hostname: 'asia-tw.onepiece-cardgame.com',
      },
      {
        // Simplified Chinese (Mainland) image CDN backing
        // onepiece-cardgame.cn. Hosts every SC card image plus the
        // promotional banners we scrape from the .cn product pages
        // (1st / 2nd / 3rd / 4th Anniversary, Premium Card Collection
        // SC editions, etc.). Added in Phase 8.
        protocol: 'https',
        hostname: 'source.windoent.com',
      },
      {
        // Limitless TCG image CDN. Used for off-catalog supplement
        // prints (Phase 6 alt arts + tournament prize stamps).
        protocol: 'https',
        hostname: 'limitlesstcg.nyc3.cdn.digitaloceanspaces.com',
      },
      {
        protocol: 'https',
        hostname: 'www.gundam-gcg.com',
      },
      {
        protocol: 'https',
        hostname: 'www.dbs-cardgame.com',
      },
      {
        protocol: 'https',
        hostname: 'world.digimoncard.com',
      },
      {
        protocol: 'https',
        hostname: 'images.pokemontcg.io',
      },
      {
        protocol: 'https',
        hostname: 'images.scrydex.com',
      },
      {
        protocol: 'https',
        hostname: 'assets.tcgdex.net',
      },
      {
        // TCGPlayer product images. Hosts booster-box and sealed-product
        // thumbnails used on the /sealed dashboard. Populated by the
        // op_hub pricing pipeline.
        protocol: 'https',
        hostname: 'tcgplayer-cdn.tcgplayer.com',
      },
      {
        // TCGTracking mirror of TCGPlayer product images. Since July
        // 2026 the op_hub pipeline emits this host in
        // pricing-boxes-one-piece.json. The UI rewrites known product
        // URLs back to tcgplayer-cdn (see hiResBoxImage in
        // sealed-dashboard.tsx); this entry is the safety net so any
        // URL shape the rewrite doesn't recognize still renders
        // instead of 400ing at the optimizer.
        protocol: 'https',
        hostname: 'cdn.tcgtracking.com',
      },
    ],
  },
}

module.exports = nextConfig
