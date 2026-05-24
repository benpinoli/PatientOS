// Config-driven list of auth providers the login screen will render.
//
// Spec §4: Microsoft/Outlook is the default; this is intentionally a config
// file (not hardcoded in the UI) so enabling Google or email magic-link later
// is a config change, not a rewrite.
//
// `provider` values are Supabase Auth provider IDs.
// `enabled` can be flipped at build time via NEXT_PUBLIC_* env vars below.

import type { Provider } from "@supabase/supabase-js";

export type AuthProviderConfig = {
  provider: Provider | "email";
  label: string;
  enabled: boolean;
  primary?: boolean;
};

const envFlag = (key: string, fallback: boolean) => {
  const v = process.env[key];
  if (v == null) return fallback;
  return v === "1" || v.toLowerCase() === "true";
};

export const authProviders: AuthProviderConfig[] = [
  {
    provider: "azure",
    label: "Sign in with Microsoft (Outlook)",
    enabled: envFlag("NEXT_PUBLIC_AUTH_AZURE_ENABLED", false),
    primary: true,
  },
  {
    provider: "google",
    label: "Sign in with Google",
    enabled: envFlag("NEXT_PUBLIC_AUTH_GOOGLE_ENABLED", false),
  },
  {
    provider: "email",
    label: "Sign in with email + password (dev only)",
    enabled: envFlag("NEXT_PUBLIC_AUTH_EMAIL_ENABLED", true),
  },
];

export const enabledProviders = () => authProviders.filter((p) => p.enabled);
