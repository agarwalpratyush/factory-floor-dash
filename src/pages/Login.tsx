import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Button, Field } from '../components/ui'
import { ACCOUNTS_URL, BRAND_NAME } from '../lib/brand'

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

  const signedInButUnauthorised = !loading && session && !me

  return (
    <div className="app-frame">
      <div className="app-bar">
        <span className="logo-slot" />
        <span className="app-name" />
      </div>

      <div className="app-body" style={{ alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto' }}>
        <div className="col" style={{ flex: '0 0 320px', borderRight: 0, paddingTop: 32 }}>
          {signedInButUnauthorised ? (
            <>
              <div className="alert is-warn">
                Signed in as {session.user.email}. That address has no access to {BRAND_NAME}.
              </div>
              <Button onClick={signOut}>Sign out</Button>
            </>
          ) : (
            <form onSubmit={signIn} className="stack">
              <Field label="Email">
                <input
                  className="input" type="email" required autoFocus autoComplete="username"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password">
                <input
                  className="input" type="password" required autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {err && <div className="alert is-fail">{err}</div>}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          <hr className="divider" />
          <p className="muted" style={{ fontSize: 'var(--text-caption)' }}>
            Accounts and passwords are handled on the{' '}
            <a href={ACCOUNTS_URL} target="_blank" rel="noreferrer">group dashboard</a>. Change your
            own under My password, or ask the administrator to set it under People. No email is sent.
          </p>
        </div>
      </div>

      <div className="status-bar">
        <span className="path">Sign in required</span>
        <span className="spacer" />
        <span className="faint">Only addresses already on the staff list can sign in</span>
      </div>
    </div>
  )
}
