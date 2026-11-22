import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import GoogleMark from "@/components/GoogleMark";

const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in was denied for that account. Try a different one.",
  Configuration: "Sign-in isn't configured yet. Check the auth environment variables.",
  CredentialsSignin: "Wrong email or PIN. After 5 tries the PIN locks for 15 minutes.",
  Default: "Something went wrong signing you in. Please try again.",
};

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

          <details className="mt-4 group">
            <summary className="cursor-pointer list-none text-center text-xs font-medium text-primary hover:underline">
              Have a PIN instead?
            </summary>
            <form
              action={async (formData) => {
                "use server";
                try {
                  await signIn("pin", {
                    email: String(formData.get("email") ?? ""),
                    pin: String(formData.get("pin") ?? ""),
                    redirectTo: "/",
                  });
                } catch (err) {
                  // signIn throws on bad credentials; success throws a redirect,
                  // which is not an AuthError and must propagate.
                  if (err instanceof AuthError) redirect("/login?error=CredentialsSignin");
                  throw err;
                }
              }}
              className="mt-3 space-y-3"
            >
              <input name="email" type="email" placeholder="you@example.com" required className="mat-input" />
              <input
                name="pin"
                type="password"
                placeholder="PIN"
                required
                minLength={6}
                autoComplete="current-password"
                className="mat-input"
              />
              <button type="submit" className="mat-btn-filled w-full justify-center">
                Sign in with PIN
              </button>
            </form>
          </details>

          <p className="mt-4 text-center text-xs text-on-surface-variant">
            Trips are private — you only see what you&apos;re invited to.
          </p>
        </div>
      </div>
    </main>
  );
}
