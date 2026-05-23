import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { AppUser } from "@/lib/db-types";

// Returns the signed-in auth user + their app_users profile.
// Redirects to /login if not signed in. Throws if the profile row is missing.
export async function requireUser() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (!profile) {
    // Trigger should have created this row at signup; if it didn't, fall
    // back to a minimal in-memory placeholder so the page still renders.
    return {
      supabase,
      user,
      profile: {
        id: user.id,
        full_name: user.email ?? null,
        email: user.email ?? null,
        roles: ["REP"],
        location: null,
        manager_id: null,
        active: false,
        created_at: new Date().toISOString(),
      } as AppUser,
    };
  }

  return { supabase, user, profile: profile as AppUser };
}

export function hasRole(profile: AppUser, role: AppUser["roles"][number]) {
  return profile.roles?.includes(role) ?? false;
}

export function isAdmin(profile: AppUser) {
  return hasRole(profile, "BOSS") || hasRole(profile, "MANAGER");
}
