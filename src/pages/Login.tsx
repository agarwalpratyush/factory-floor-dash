import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, Field, inputCls } from '../components/ui'
import { ACCOUNTS_URL } from '../lib/brand'


export default function Login() {
  const { session, me, loading, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    setBusy(false)
    if (error) setErr(error.message)
  }

  // Signed in, but this email is not on the staff list.
  const signedInButUnauthorised = !loading && session && !me

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h1 className="text-lg font-semibold text-slate-900">Factory Floor</h1>
        <p className="mt-0.5 mb-5 text-sm text-slate-500">Saffron &amp; Agarwal</p>

        {signedInButUnauthorised ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              You are signed in as <strong>{session.user.email}</strong>, but that address has no
              access to the factory system.
            </p>
            <Button variant="ghost" onClick={signOut} className="w-full">Sign out</Button>
          </div>
        ) : (
          <form onSubmit={signIn} className="space-y-3">
            <Field label="Email">
              <input
                type="email" required autoFocus autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls}
              />
            </Field>
            <Field label="Password">
              <input
                type="password" required autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls}
              />
            </Field>
            {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        {/* Accounts and passwords are managed in one place, on the main dashboard. */}
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
          Accounts and passwords are handled on the{' '}
          <a href={ACCOUNTS_URL} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
            Agarwal Gabions dashboard
          </a>
          {' '}— change your own under <em>My password</em>, or ask the administrator to set it
          under <em>People</em>. This system never sends email.
        </p>
      </div>
    </div>
  )
}
