/**
 * Supabase API base URL seen by browser + server clients.
 * For Amplify (HTTPS) → self-hosted Supabase (HTTP), set:
 *   SUPABASE_INTERNAL_URL=http://<ec2-ip>:8000
 *   NEXT_PUBLIC_SUPABASE_URL=https://<amplify-app>/supabase
 * Next.js rewrites proxy /supabase/* → SUPABASE_INTERNAL_URL.
 */
export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  return url.replace(/\/$/, "");
}
