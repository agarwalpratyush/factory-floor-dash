import type { ReactNode } from 'react'

export function Card({
  title, action, children, className = '',
}: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Stat({
  label, value, sub, tone = 'neutral',
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const toneCls = {
    neutral: 'text-slate-900',
    good: 'text-green-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  }[tone]
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

const BADGE_TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone] ?? BADGE_TONES.slate}`}>
      {children}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

export function Button({
  children, variant = 'primary', className = '', ...rest
}: { variant?: 'primary' | 'ghost' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300',
    ghost: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant]
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${v} ${className}`}
    >
      {children}
    </button>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-slate-500">{children}</div>
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
      <p className="font-medium">Could not load data</p>
      <p className="mt-0.5 text-red-700">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">
          Retry
        </button>
      )}
    </div>
  )
}

/** Shown where a form would be: a new record has to belong to exactly one unit. */
export function NeedPlant({ what }: { what: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
      You are in Combined View. Pick <strong>Saffron</strong> or <strong>Agarwal</strong> in the sidebar to {what}.
    </div>
  )
}

/** Small plant tag for rows in Combined View, where a bare row is ambiguous. */
export function PlantTag({ code }: { code: string | undefined }) {
  if (!code) return null
  return (
    <span className={
      'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ' +
      (code === 'SAF' ? 'bg-cyan-50 text-cyan-700 ring-cyan-200' : 'bg-violet-50 text-violet-700 ring-violet-200')
    }>
      {code}
    </span>
  )
}

export const STAGE_TONE: Record<string, keyof typeof BADGE_TONES> = {
  pending: 'slate',
  material_ready: 'cyan',
  in_production: 'blue',
  qc: 'violet',
  packed: 'amber',
  dispatched: 'green',
  delivered: 'green',
  cancelled: 'red',
}
