import type { ReactNode } from 'react'

/** Semantic state. Colour reports one of these or the element is grey. */
export type State = 'ok' | 'warn' | 'fail' | 'idle'

const stateCls = (s?: State) => (s && s !== 'idle' ? ' is-' + s : s === 'idle' ? ' is-idle' : '')

export function Section({
  title, action, children, flush = false,
}: { title?: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="section">
      {(title || action) && (
        <header>
          {title ? <span className="label">{title}</span> : <span />}
          {action}
        </header>
      )}
      <div className={'body' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  )
}

/** A derived figure. Numbers are monospace, tabular and right-aligned by the skin. */
export function Result({
  label, value, sub, state, flat = false,
}: { label: string; value: ReactNode; sub?: ReactNode; state?: State; flat?: boolean }) {
  return (
    <div className={'result' + (flat ? ' flat' : '')}>
      <span className="label">{label}</span>
      <span className="value" style={state && state !== 'idle' ? { color: 'var(--' + state + ')' } : undefined}>
        {value}
      </span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

export function Badge({ children, state }: { children: ReactNode; state?: State }) {
  return <span className={'badge' + stateCls(state)}>{children}</span>
}

export function Alert({
  children, state = 'info',
}: { children: ReactNode; state?: State | 'info' }) {
  return <div className={'alert is-' + state}>{children}</div>
}

export function Meter({ pct, state }: { pct: number; state?: State }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div className={'meter' + stateCls(state)}>
      <span style={{ width: w + '%' }} />
    </div>
  )
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export function Button({
  children, variant, size, active, className = '', ...rest
}: {
  variant?: 'primary' | 'danger' | 'ghost'
  size?: 'sm'
  active?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    'btn',
    variant ? 'btn-' + variant : '',
    size === 'sm' ? 'btn-sm' : '',
    active ? 'is-active' : '',
    className,
  ].filter(Boolean).join(' ')
  return <button type="button" {...rest} className={cls}>{children}</button>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="empty">{label}…</div>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="alert is-fail">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span>{error}</span>
        {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
      </div>
    </div>
  )
}

/** Shown where a form would be: a new record has to belong to exactly one company. */
export function NeedPlant({ what }: { what: string }) {
  return (
    <div className="alert is-info">
      Combined view is read-only. Choose a company in the bar above to {what}.
    </div>
  )
}

/** Shown when a page belongs to a process this company does not run. */
export function NotHere({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <header><span className="label">{title}</span></header>
      <div className="body"><p className="muted">{children}</p></div>
    </div>
  )
}

/**
 * Company marker for rows in the combined view. Grey by design: which company a row
 * belongs to is not a state, so it does not take a state colour.
 */
export function PlantTag({ code }: { code: string | undefined }) {
  if (!code) return null
  return <span className="badge is-idle">{code}</span>
}

/** Order stage is progress, not pass/fail, so only the terminal states take colour. */
export const STAGE_STATE: Record<string, State | undefined> = {
  pending: 'idle',
  material_ready: undefined,
  in_production: undefined,
  qc: undefined,
  packed: undefined,
  dispatched: 'ok',
  delivered: 'ok',
  cancelled: 'fail',
}
