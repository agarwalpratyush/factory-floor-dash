import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { usePlant } from '../lib/plant'
import { useAuth, type Perm } from '../lib/auth'
import { ACCOUNTS_URL } from '../lib/brand'

/**
 * `need` is the permission that makes a page worth showing.
 * Production is one tab everywhere: the log reads the same at both companies, and
 * only the entry form changes with the company's process.
 */
const NAV: { to: string; label: string; end?: boolean; need: Perm }[] = [
  { to: '/', label: 'Dashboard', end: true, need: 'ff_view' },
  { to: '/orders', label: 'Orders', need: 'ff_view' },
  { to: '/production', label: 'Production', need: 'ff_view' },
  { to: '/materials', label: 'Materials', need: 'ff_view' },
  { to: '/stock', label: 'Stock', need: 'ff_view' },
  { to: '/attendance', label: 'Attendance', need: 'ff_view' },
  { to: '/dispatch', label: 'Dispatch', need: 'ff_manage' },
]

function PlantSwitcher() {
  const { plants, scope, setScope, pinned } = usePlant()

  // A login pinned to one company has nothing to switch between.
  if (pinned !== null) {
    const p = plants.find((x) => x.id === pinned)
    return (
      <div className="rounded-lg bg-slate-800 px-3 py-2 text-center">
        <div className="text-sm font-medium text-white">{p?.name ?? 'Your company'}</div>
      </div>
    )
  }

  const companyBtn = (p: (typeof plants)[number]) => (
    <button
      key={p.id}
      onClick={() => setScope(p.id)}
      className={
        'w-full rounded-lg px-3 py-2 text-center text-sm leading-snug font-medium transition ' +
        (scope === p.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white')
      }
    >
      {p.name}
    </button>
  )

  // Combined sits between the companies it joins, with a rule running through it,
  // so the grouping is visible rather than described.
  const combined = (
    <div key="combined" className="relative flex justify-center py-1">
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700" />
      <button
        onClick={() => setScope('group')}
        aria-pressed={scope === 'group'}
        className={
          'relative rounded-md px-2 py-0.5 text-xs font-medium tracking-wide transition ' +
          (scope === 'group'
            ? 'bg-slate-700 text-white ring-1 ring-slate-500'
            : 'bg-slate-900 text-slate-400 ring-1 ring-slate-700 hover:text-white')
        }
      >
        Combined
      </button>
    </div>
  )

  // With two companies this lands exactly in the middle of them.
  const mid = Math.floor(plants.length / 2)

  return (
    <div className="space-y-1">
      {plants.slice(0, mid).map(companyBtn)}
      {combined}
      {plants.slice(mid).map(companyBtn)}
    </div>
  )
}

function ProfileMenu() {
  const { me, can, signOut } = useAuth()
  const { plants, pinned } = usePlant()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Most logins have no full name recorded. Rather than invent one from the
  // address, the menu falls back to the email itself and drops the second line;
  // only the header button shortens it, where space is tight.
  const fullName = me?.full_name?.trim() || ''
  const headline = fullName || me?.email || 'Account'
  const buttonLabel = fullName || me?.email?.split('@')[0] || 'Account'

  const scope = pinned !== null
    ? plants.find((p) => p.id === pinned)?.name ?? 'One company'
    : 'Both companies'

  // What you cannot do is the useful half: it answers "why is this greyed out".
  const limits = [
    !can('ff_orders_write') && 'Cannot place or change orders',
    !can('ff_manage') && 'Cannot record dispatches or edit masters',
    !can('ff_entry') && 'Cannot record production or attendance',
    !can('ff_money') && 'Costs, rates and wages are hidden',
    !can('ff_backdate') && 'Entries must be dated today',
  ].filter(Boolean) as string[]

  // Close on a click anywhere else, and on Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="max-w-[180px] truncate rounded-lg px-3 py-1.5 text-sm text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-800 hover:text-white"
      >
        {buttonLabel}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-72 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium text-slate-900">{headline}</div>
            {fullName && <div className="truncate text-xs text-slate-500">{me?.email}</div>}
          </div>

          <hr className="border-slate-200" />

          <dl className="px-3 py-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Role</dt>
              <dd className="font-medium text-slate-900">{me?.role_label ?? me?.role}</dd>
            </div>
            <div className="mt-1 flex justify-between gap-3">
              <dt className="text-slate-500">Sees</dt>
              <dd className="truncate font-medium text-slate-900">{scope}</dd>
            </div>
          </dl>

          <hr className="border-slate-200" />

          <div className="px-3 py-2">
            {limits.length === 0 ? (
              <p className="text-xs text-slate-500">Full access. Nothing here is hidden or read-only.</p>
            ) : (
              <>
                <p className="mb-1 text-xs text-slate-500">On this account</p>
                <ul className="space-y-0.5">
                  {limits.map((l) => (
                    <li key={l} className="text-xs text-slate-700">{l}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <hr className="border-slate-200" />

          <a
            role="menuitem"
            href={ACCOUNTS_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            Change password
            <span className="block text-xs text-slate-400">on the group dashboard</span>
          </a>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); signOut() }}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { can } = useAuth()

  // Refresh remounts the page below, so whichever screen is showing re-runs its
  // own queries. One control rather than a Refresh button on every page.
  const [tick, setTick] = useState(0)

  const nav = NAV.filter((n) => can(n.need))

  const link = ({ isActive }: { isActive: boolean }) =>
    'block rounded-lg px-3 py-2 text-sm font-medium transition ' +
    (isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white')

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded-lg px-2 py-1.5 text-sm text-slate-300 ring-1 ring-slate-700 lg:hidden"
        >
          {open ? 'Close' : 'Menu'}
        </button>

        <span className="text-base font-semibold text-white">Factory Floor</span>

        <span className="flex-1" />

        <button
          onClick={() => setTick((t) => t + 1)}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-800 hover:text-white"
        >
          Refresh
        </button>

        <ProfileMenu />
      </header>

      <div className="flex min-h-0 flex-1 lg:flex-row">
        <aside className={(open ? 'block ' : 'hidden ') + 'bg-slate-900 px-3 pb-4 lg:block lg:w-60 lg:shrink-0 lg:py-5'}>
          <PlantSwitcher />
          <hr className="my-4 border-slate-700" />
          <nav className="space-y-1" onClick={() => setOpen(false)}>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          {/* Changing the key remounts the page, which re-runs its queries. */}
          <div key={tick}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
