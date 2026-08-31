export const fmtNum = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const fmtQty = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  return Number.isInteger(v) ? v.toLocaleString('en-IN') : fmtNum(v, 3)
}

/** Indian short form: 12.4 L, 1.25 Cr — how the office actually reads order values. */
export const fmtMoney = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

/**
 * Weight is one quantity shown two ways. MT is the standard everywhere; under a
 * tonne it reads in kg, because 0.048 MT is a number nobody pictures and 48 kg is.
 *
 * The stored unit is deliberately left alone - polymer is kept in kg because the
 * coating register works to the gram and `qty` holds three decimals, so storing it
 * in MT would round 267.810 kg to 268. Which unit a row is stored in is an
 * implementation detail; this is the only place that decides how it reads.
 */
const KG_PER: Record<string, number> = { kg: 1, MT: 1000 }

export const isWeight = (unit: string | null | undefined) =>
  unit !== null && unit !== undefined && unit in KG_PER

export const toKg = (qty: number, unit: string) => Number(qty) * (KG_PER[unit] ?? 1)

/** Turns a weight typed in one unit into the unit the article is stored in. */
export const toStored = (qty: number, typedIn: string, storedIn: string) =>
  toKg(qty, typedIn) / (KG_PER[storedIn] ?? 1)

/**
 * A weight with its unit, chosen by size. Anything that is not a weight is passed
 * through with its own unit, so callers do not have to ask first.
 */
export const fmtWeight = (qty: number | null | undefined, unit: string) => {
  if (qty === null || qty === undefined || Number.isNaN(Number(qty))) return '—'
  if (!isWeight(unit)) return fmtQty(qty) + ' ' + unit
  const kg = toKg(Number(qty), unit)
  // Negative balances happen and must still read as weights, hence the abs().
  return Math.abs(kg) >= 1000
    ? fmtNum(kg / 1000, 3) + ' MT'
    : fmtQty(kg) + ' kg'
}

/**
 * Where a day sits relative to now, which is the one thing a date picker cannot
 * say. The weekday comes with it because an attendance page is often really
 * asking whether the day was a Sunday.
 *
 * Returns e.g. 'Sunday · today', 'Saturday · yesterday', 'Friday · 2 days ago'.
 */
export const relativeDay = (d: string | null | undefined) => {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return ''

  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Whole days apart, taken from local midnights so a clock time cannot round it.
  const days = Math.round((dt.getTime() - midnight.getTime()) / 86400000)

  const weekday = dt.toLocaleDateString('en-IN', { weekday: 'long' })

  const when =
    days === 0 ? 'today'
    : days === -1 ? 'yesterday'
    : days === 1 ? 'tomorrow'
    : days < 0 ? Math.abs(days) + ' days ago'
    : 'in ' + days + ' days'

  return weekday + ' · ' + when
}

/**
 * Always a 12 hour clock. The floor says half past eight, never twenty thirty,
 * and a night shift written 20:00 is read wrong more often than it is read.
 * Accepts the HH:MM:SS Postgres returns for a `time` column.
 */
export const fmtTime = (t: string | null | undefined) => {
  if (!t) return '—'
  const h = Number(t.slice(0, 2))
  const m = t.slice(3, 5)
  if (Number.isNaN(h)) return '—'
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return hour + ':' + m + ' ' + suffix
}

/**
 * Local calendar date, not UTC. toISOString() would roll IST back a day for
 * anything entered after 5:30 AM local, putting a night shift on the wrong date.
 */
const ymd = (d: Date) =>
  d.getFullYear() +
  '-' + String(d.getMonth() + 1).padStart(2, '0') +
  '-' + String(d.getDate()).padStart(2, '0')

export const today = () => ymd(new Date())

export const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return ymd(d)
}
