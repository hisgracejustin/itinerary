import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { APP_LOCALE, HOME_TIME_ZONE } from "@/lib/locale";
import { INVITE_ERRORS, type InviteErrorCode, inspectInvite } from "@/lib/invites";
import JoinForms from "./JoinForms";

// Where an invite link lands (src/lib/invites.ts). Reachable without an
// account — the proxy lets /join/ through — so it reveals the trip and the
// member's name only to someone holding a valid link, and nothing at all for
// any other token.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join a trip · Itinerary",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const longDate = (d: Date) =>
  d.toLocaleDateString(APP_LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: HOME_TIME_ZONE });

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const [view, session] = await Promise.all([inspectInvite(token), auth()]);
  const errorText = error && error in INVITE_ERRORS ? INVITE_ERRORS[error as InviteErrorCode] : "";
  const inviter = view.inviterName ?? "whoever sent it";

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface-dim p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-3xl shadow-elevation-2">
            ✈️
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-on-surface">Itinerary</h1>
        </div>

        <div className="rounded-2xl border border-outline/40 bg-white p-6 shadow-elevation-1">
          {view.state === "ok" ? (
            <>
              <p className="text-sm text-on-surface-variant">
                {view.inviterName ? `${view.inviterName} invited you to` : "You're invited to"}
              </p>
              <h2 className="mt-0.5 text-xl font-semibold text-on-surface">{view.tripName}</h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                You&apos;ll join as <strong className="text-on-surface">{view.memberName}</strong>, with your costs
                and shares already there.
              </p>
              {session?.user ? (
                <div className="mt-5 space-y-3">
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    You&apos;re signed in as {session.user.name || session.user.email}. This link is for{" "}
                    {view.memberName}: open it on their phone, or sign out first.
                  </p>
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: `/join/${token}` });
                    }}
                  >
                    <button type="submit" className="mat-btn-outlined w-full justify-center">
                      Sign out
                    </button>
                  </form>
                </div>
              ) : (
                <JoinForms
                  token={token}
                  googleEnabled={!!process.env.AUTH_GOOGLE_ID}
                  initialError={errorText}
                />
              )}
              {view.expiresAt && (
                <p className="mt-4 text-center text-xs text-on-surface-variant">
                  This link works once, until {longDate(view.expiresAt)}.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-3 text-center">
              <h2 className="text-lg font-semibold text-on-surface">
                {view.state === "used"
                  ? "This link has already been used"
                  : view.state === "expired"
                    ? "This link has expired"
                    : "This link isn't valid"}
              </h2>
              <p className="text-sm text-on-surface-variant">
                {view.state === "used"
                  ? "If that was you, sign in with Google or your email and PIN."
                  : view.state === "expired"
                    ? `It worked until ${longDate(view.expiresAt!)}. Ask ${inviter} to send you a new one.`
                    : "It may have been replaced by a newer link or cancelled. Ask whoever sent it for a new one."}
              </p>
              {view.state === "used" && (
                <Link href="/login" className="mat-btn-filled w-full justify-center">
                  Sign in
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
