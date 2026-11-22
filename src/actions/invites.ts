"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { z } from "zod";
import { auth, signIn } from "@/auth";
import { runAction } from "@/lib/action-utils";
import { AppError } from "@/lib/errors";
import { hashPin } from "@/lib/pin";
import { INVITE_COOKIE, cancelInvite, createInvite, inspectInvite, redeemInvite } from "@/lib/invites";

// Invite links (see src/lib/invites.ts for the rules). Creating and cancelling
// one is a trip owner's call; the two redeem actions are reached from the
// public /join page by someone who isn't signed in yet, so they take nothing
// on trust but the link's secret.

const memberSchema = z.object({ trip_id: z.string().uuid(), user_id: z.string().min(1) });

/** A fresh link for a member. The token comes back once; only its hash is kept. */
export async function createMemberInviteAction(input: unknown) {
  return runAction(async (user) => {
    const data = memberSchema.parse(input);
    const { token, expiresAt } = await createInvite(user, data.trip_id, data.user_id);
    revalidatePath("/", "layout");
    return { token, expires_at: expiresAt.toISOString() };
  });
}

export async function cancelMemberInviteAction(input: unknown) {
  return runAction(async (user) => {
    const data = memberSchema.parse(input);
    await cancelInvite(user, data.trip_id, data.user_id);
    revalidatePath("/", "layout");
    return { user_id: data.user_id };
  });
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This link isn't valid");

const pinRedeemSchema = z.object({
  token: tokenSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  pin: z.string().min(6, "Choose a PIN of at least 6 characters").max(64),
});

/**
 * Redeem a link with an email and a new PIN, then sign straight in. Returns an
 * error to show, or doesn't return at all (a successful sign-in redirects).
 */
export async function redeemInviteWithPinAction(input: unknown): Promise<{ error: string }> {
  const parsed = pinRedeemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { token, email, pin } = parsed.data;
  // Someone already signed in would be swapped into this account by accident
  // (often the owner checking their own link).
  if ((await auth())?.user) return { error: "You're signed in already. Sign out first, or open the link on their phone." };
  try {
    await redeemInvite(token, { email, verified: false, pinHash: await hashPin(pin) });
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  try {
    await signIn("pin", { email, pin, redirectTo: "/" });
  } catch (err) {
    // Success throws Next's redirect, which must propagate; a failed sign-in
    // right after setting the PIN would be odd, so send them to the login page.
    if (err instanceof AuthError) return { error: "You're all set, but signing in failed. Sign in with your email and PIN." };
    throw err;
  }
  return { error: "" };
}

/**
 * Redeem a link with Google: remember the link for the round trip, then hand
 * over to Google. The callback in src/auth.ts finishes the job with the email
 * Google vouches for.
 */
export async function startInviteWithGoogleAction(input: unknown): Promise<{ error: string }> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return { error: "This link isn't valid" };
  if ((await auth())?.user) return { error: "You're signed in already. Sign out first, or open the link on their phone." };
  const view = await inspectInvite(parsed.data);
  if (view.state !== "ok") return { error: "This link has expired or was already used" };
  (await cookies()).set(INVITE_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 15 * 60,
  });
  await signIn("google", { redirectTo: "/" });
  return { error: "" };
}
