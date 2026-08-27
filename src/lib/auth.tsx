import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface Me {
  email: string
  full_name: string | null
  role: string
  role_label: string | null
  /** null = this login may see both companies */
  plant_id: number | null
  is_admin: boolean
  permissions: Record<string, boolean>
}

export type Perm = 'ff_view' | 'ff_entry' | 'ff_manage' | 'ff_money'

interface Ctx {
  session: Session | null
  me: Me | null
  loading: boolean
  /** Layout only. Every rule is enforced again by row-level security in the database. */
  can: (p: Perm) => boolean
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const AuthContext = createContext<Ctx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadMe() {
    const { data, error } = await supabase.rpc('ff_me')
    const row = Array.isArray(data) ? data[0] : data
    setMe(error || !row ? null : (row as Me))
  }

  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (data.session) await loadMe()
      if (alive) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!alive) return
      setSession(s)
      if (s) await loadMe()
      else setMe(null)
    })

    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const can = (p: Perm) => !!me && (me.is_admin || me.permissions?.[p] === true)

  return (
    <AuthContext.Provider
      value={{
        session,
        me,
        loading,
        can,
        signOut: async () => { await supabase.auth.signOut() },
        reload: loadMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
