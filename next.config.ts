import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root — a stray lockfile in the parent dir otherwise makes
  // Next infer the wrong root.
  turbopack: { root: __dirname },
};

export default nextConfig;
