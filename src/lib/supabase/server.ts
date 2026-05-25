import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseUrl } from "@/lib/supabase/config";

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    getSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
