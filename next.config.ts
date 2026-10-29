import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  images: {
    minimumCacheTTL: 86400,
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL ? [{
      protocol: "https",
      hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
      pathname: "/storage/v1/object/public/product-images/**",
      search: "",
    }] : [],
  },
  serverExternalPackages: ["pg", "tronweb"],
  outputFileTracingIncludes: { "/*": ["./certs/supabase-prod-ca-2021.crt"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default config;
