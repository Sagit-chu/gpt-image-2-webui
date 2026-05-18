import type { NextConfig } from "next";

const assetPrefix = process.env.NEXT_ASSET_PREFIX;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.0.42"],
  output: "standalone",
  assetPrefix: assetPrefix || undefined,
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
