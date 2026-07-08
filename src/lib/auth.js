import { supabase } from './supabase'

/**
 * Send a magic link to the given email address.
 */
export async function signIn(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) throw error
}

/**
 * Sign in with email + password.
 */
export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
