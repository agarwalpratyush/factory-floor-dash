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
 * A date with its weekday, for a page that is about one particular day.
 * Sunday reading as Sunday is the point.
 */
export const fmtDateLong = (d: string | null | undefined) => {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'short', year: '2-digit',
  })
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
