import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { signIn as authSignIn, signInWithPassword as authSignInWithPassword, signOut as authSignOut } from '../lib/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Listen for auth state changes FIRST (catches token restore)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email) => {
    await authSignIn(email)
  }

  const signInWithPassword = async (email, password) => {
    await authSignInWithPassword(email, password)
  }

  const signOut = async () => {
    await authSignOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
