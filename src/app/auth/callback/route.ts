import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

// OAuth callback: exchanges the ?code= param for a session cookie.
// Used by both Microsoft/Azure and any other OAuth provider configured later.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await getSupabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
