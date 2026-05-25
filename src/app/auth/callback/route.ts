import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getRequestOrigin } from "@/lib/request-origin";

// OAuth callback: exchanges the ?code= param for a session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const origin = getRequestOrigin(request);

  if (code) {
    const supabase = await getSupabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const path = next.startsWith("/") ? next : `/${next}`;
  return NextResponse.redirect(`${origin}${path}`, { status: 302 });
}
