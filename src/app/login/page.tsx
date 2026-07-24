import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in was denied for that account. Try a different one.",
  Configuration: "Sign-in isn't configured yet. Check the auth environment variables.",
  Default: "Something went wrong signing you in. Please try again.",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.86-3c-1.08.72-2.45 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.42-3.42A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;
  const devMode = process.env.NODE_ENV !== "production" && !process.env.AUTH_GOOGLE_ID;

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface-dim p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-3xl shadow-elevation-2">
            ✈️
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-on-surface">Itinerary</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Your trips, all in one place.</p>
        </div>

        <div className="rounded-2xl border border-outline/40 bg-white p-6 shadow-elevation-1">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {ERRORS[error] ?? ERRORS.Default}
            </div>
          )}

          {devMode ? (
            <form
              action={async (formData) => {
                "use server";
                await signIn("dev", {
                  email: String(formData.get("email") ?? ""),
                  redirectTo: "/",
                });
              }}
              className="space-y-3"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
                Dev sign-in (no Google configured)
              </p>
              <input
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                className="mat-input"
              />
              <button type="submit" className="mat-btn-filled w-full justify-center">
                Continue
              </button>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button type="submit" className="mat-btn-outlined w-full justify-center gap-2">
                <GoogleMark />
                Continue with Google
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-xs text-on-surface-variant">
            Trips are private — you only see what you&apos;re invited to.
          </p>
        </div>
      </div>
    </main>
  );
}
