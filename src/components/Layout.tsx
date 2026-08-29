import { NavLink, Outlet } from 'react-router-dom'
import { usePlant } from '../lib/plant'
import { useAuth, type Perm } from '../lib/auth'

/** `need` is the permission that makes a page worth showing. */
const NAV: { to: string; label: string; end?: boolean; need: Perm }[] = [
  { to: '/', label: 'Dashboard', end: true, need: 'ff_view' },
  { to: '/orders', label: 'Orders', need: 'ff_view' },
  { to: '/production', label: 'Production', need: 'ff_view' },
  { to: '/materials', label: 'Materials', need: 'ff_view' },
  { to: '/stock', label: 'Stock', need: 'ff_view' },
  { to: '/attendance', label: 'Attendance', need: 'ff_view' },
  { to: '/dispatch', label: 'Dispatch', need: 'ff_manage' },
]

export default function Layout() {
  const { plants, plant, scope, setScope, pinned } = usePlant()
  const { me, can, signOut } = useAuth()

  const nav = NAV.filter((n) => can(n.need))
  const scopeLabel = scope === 'group' ? 'Combined view' : plant?.short_name ?? ''

  return (
    <div className="app-frame">
      <div className="app-bar">
        {/* Empty slot keeps its box, so nothing shifts when a logo is supplied. */}
        <span className="logo-slot" />
        <span className="app-name" />

        <span className="spacer" />

        <div className="meta">
          {pinned !== null ? (
            <span className="badge is-idle">{plant?.short_name}</span>
          ) : (
            <div className="btn-group">
              <button
                type="button"
                className={'btn btn-sm' + (scope === 'group' ? ' is-active' : '')}
                onClick={() => setScope('group')}
              >
                Combined
              </button>
              {plants.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={'btn btn-sm' + (scope === p.id ? ' is-active' : '')}
                  onClick={() => setScope(p.id)}
                >
                  {p.short_name}
                </button>
              ))}
            </div>
          )}
          <span>{me?.full_name || me?.email}</span>
          <button type="button" className="btn btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <nav className="tabs">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => 'tab' + (isActive ? ' is-active' : '')}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="app-body">
        <Outlet />
      </div>

      <div className="status-bar">
        <span className="path">{scopeLabel}</span>
        <span>{me?.role_label ?? me?.role}</span>
        {!can('ff_money') && <span className="faint">no cost access</span>}
        {!can('ff_orders_write') && <span className="faint">orders read-only</span>}
        <span className="spacer" />
        <span className="faint">Entries dated today unless you may back-date</span>
      </div>
    </div>
  )
}
