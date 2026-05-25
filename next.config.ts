import type { NextConfig } from "next";

/**
 * When Amplify (HTTPS) talks to self-hosted Supabase on EC2 (HTTP), proxy API
 * traffic through Next.js to avoid browser mixed-content blocks.
 *
 *   SUPABASE_INTERNAL_URL=http://44.253.198.43:8000
 *   NEXT_PUBLIC_SUPABASE_URL=https://<your-amplify-app>/supabase
 */
const supabaseInternal = process.env.SUPABASE_INTERNAL_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!supabaseInternal) return [];
    return [
      {
        source: "/supabase/:path*",
        destination: `${supabaseInternal}/:path*`,
      },
    ];
  },
};

export default nextConfig;
