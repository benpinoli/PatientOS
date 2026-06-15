import { enabledProviders } from "@/lib/auth-providers";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">
          PatientOS
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sign in to see your patient pipeline.
        </p>

        <LoginFormWrapper searchParams={searchParams} />
      </div>
    </div>
  );
}

async function LoginFormWrapper({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <LoginForm
      next={sp.next ?? "/"}
      error={sp.error}
      providers={enabledProviders()}
    />
  );
}
