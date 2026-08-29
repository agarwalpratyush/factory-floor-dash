import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { usePlant } from '../lib/plant'
import { useAuth, type Perm } from '../lib/auth'

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
      <div className="rounded-lg bg-slate-800 px-3 py-2">
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

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { plant, scope, pinned } = usePlant()
  const { me, can, signOut } = useAuth()

  const nav = NAV.filter((n) => can(n.need))

  const link = ({ isActive }: { isActive: boolean }) =>
    'block rounded-lg px-3 py-2 text-sm font-medium transition ' +
    (isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white')

  const scopeLabel = pinned !== null
    ? plant?.short_name
    : scope === 'group' ? 'Combined View' : plant?.short_name

  return (
    <div className="min-h-full lg:flex">
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 lg:hidden">
        <div>
          <span className="font-semibold text-white">Factory Floor</span>
          <span className="ml-2 text-xs text-slate-400">{scopeLabel}</span>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg px-3 py-2 text-sm text-slate-200 ring-1 ring-slate-700"
          aria-expanded={open}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      <aside className={(open ? 'block ' : 'hidden ') + 'bg-slate-900 px-3 pb-4 lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:px-3 lg:py-5'}>
        <div className="mb-4 hidden px-2 lg:block">
          <div className="text-base font-semibold text-white">Factory Floor</div>
        </div>

        <PlantSwitcher />

        <hr className="my-4 border-slate-700" />

        <nav className="space-y-1" onClick={() => setOpen(false)}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 border-t border-slate-700 pt-3 lg:mt-auto">
          <div className="truncate px-2 text-xs text-slate-300">{me?.full_name || me?.email}</div>
          <div className="px-2 text-xs text-slate-500">
            {me?.role_label ?? me?.role}
            {!can('ff_money') && ' · no cost access'}
          </div>
          <button
            onClick={signOut}
            className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  )
}
