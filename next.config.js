/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ],
  },
}

module.exports = nextConfig
