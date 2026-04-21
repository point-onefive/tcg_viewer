/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
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
    ],
  },
}

module.exports = nextConfig
