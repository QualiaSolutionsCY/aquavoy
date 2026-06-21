import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root — a stray lockfile in the parent dir otherwise makes
  // Next infer the wrong root.
  turbopack: { root: __dirname },
  // Baseline security headers on every response (defense-in-depth: clickjacking,
  // MIME-sniff, referrer leak, HSTS, feature lockdown). A Content-Security-Policy
  // is intentionally omitted here — a strict CSP needs per-route nonces for Next's
  // inline runtime and must be tuned + tested separately before enabling.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
