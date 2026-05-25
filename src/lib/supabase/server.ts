import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseUrl } from "@/lib/supabase/config";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    getSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        maxAge: AUTH_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — Next won't let us mutate
            // cookies here, but middleware handles refresh, so this is fine.
          }
        },
      },
    },
  );
}
