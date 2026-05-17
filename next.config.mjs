/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow R2 + Pinata for images
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pub-1246173d524b49ceb6f07c3a9c98284e.r2.dev' },
      { protocol: 'https', hostname: 'salmon-top-bass-2.mypinata.cloud' },
    ],
  },
};

export default nextConfig;
