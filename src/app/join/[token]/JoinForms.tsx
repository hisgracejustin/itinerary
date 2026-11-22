"use client";

import { useState, useTransition } from "react";
import GoogleMark from "@/components/GoogleMark";
import { redeemInviteWithPinAction, startInviteWithGoogleAction } from "@/actions/invites";

/**
 * The two ways to take up an invite: Google (the address is proven theirs), or
 * an email and a PIN they choose. Either one signs them straight in; a
 * successful action redirects, so it only ever returns an error to show.
 */
export default function JoinForms({
  token,
  googleEnabled,
  initialError,
}: {
  token: string;
  googleEnabled: boolean;
  initialError: string;
}) {
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
  const [withPin, setWithPin] = useState(!googleEnabled);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");

  const google = () => {
    setError("");
    startTransition(async () => {
      const result = await startInviteWithGoogleAction(token);
      if (result?.error) setError(result.error);
    });
  };

  const submitPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin !== pin2) {
      setError("The two PINs don't match.");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await redeemInviteWithPinAction({ token, email, pin });
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="mt-5 space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {googleEnabled && (
        <button
          type="button"
          onClick={google}
          disabled={pending}
          className="mat-btn-outlined w-full justify-center gap-2 disabled:opacity-50"
        >
          <GoogleMark />
          Continue with Google
        </button>
      )}

      {googleEnabled && !withPin ? (
        <button
          type="button"
          onClick={() => setWithPin(true)}
          className="block w-full text-center text-xs font-medium text-primary hover:underline"
        >
          No Google account? Use your email and a PIN
        </button>
      ) : (
        <form onSubmit={submitPin} className="space-y-3">
          {googleEnabled && (
            <p className="text-center text-xs text-on-surface-variant" aria-hidden>
              — or use your email and a PIN —
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-on-surface-variant">Your email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mat-input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-on-surface-variant">Choose a PIN (6 or more digits)</span>
            <input
              type="password"
              required
              minLength={6}
              maxLength={64}
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="mat-input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-on-surface-variant">Type the PIN again</span>
            <input
              type="password"
              required
              minLength={6}
              maxLength={64}
              inputMode="numeric"
              autoComplete="new-password"
              value={pin2}
              onChange={(e) => setPin2(e.target.value)}
              className="mat-input"
            />
          </label>
          <button type="submit" disabled={pending} className="mat-btn-filled w-full justify-center disabled:opacity-50">
            {pending ? "Joining…" : "Join the trip"}
          </button>
          <p className="text-center text-xs text-on-surface-variant">
            From now on you sign in with this email and PIN.
          </p>
        </form>
      )}
    </div>
  );
}
