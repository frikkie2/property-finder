import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The proxy (middleware) buffers request bodies; the default 10MB cap
    // truncates multi-photo uploads. Photos are also downscaled client-side,
    // but keep generous headroom here.
    proxyClientMaxBodySize: "64mb",
  },
};

export default nextConfig;
