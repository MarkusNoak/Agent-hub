/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agent-hub/core", "@agent-hub/connectors", "@agent-hub/agents"],
  experimental: {
    serverComponentsExternalPackages: ["@anthropic-ai/sdk"],
  },
};
export default nextConfig;
