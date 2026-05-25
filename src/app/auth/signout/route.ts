import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getRequestOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  const origin = getRequestOrigin(request);
  return NextResponse.redirect(`${origin}/login`, { status: 302 });
}

export async function GET(request: Request) {
  return POST(request);
}
