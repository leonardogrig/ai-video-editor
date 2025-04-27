/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable strict mode to prevent double execution in development
  reactStrictMode: false,
  
  // Set server actions body size limit
  experimental: {
    serverActions: {
      bodySizeLimit: '2gb'
    }
  },
  
  // External packages that should be bundled in the server build
  serverExternalPackages: ['fluent-ffmpeg', 'node-vad', 'wavefile', 'ffmpeg-static']
}

module.exports = nextConfig 