import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant } from '../lib/plant'
import { Button, Empty, ErrorBox, Field, inputCls, Spinner } from './ui'
import { daysAgo, fmtDate, fmtMoney, fmtNum, fmtTime, spanHours, today } from '../lib/format'
import { ATTENDANCE_LABEL, SHIFTS } from '../lib/types'
import type { Attendance as Att, Worker } from '../lib/types'

/** Pay, per day, as the wages view computes it. Kept apart from the attendance
 *  row because that view is `security_invoker` - somebody without `ff_money`
 *  reads nothing from it, and the sheet simply has no money columns. */
type Pay = { work_date: string; daily_wage: number | null; day_pay: number | null; ot_pay: number | null }

/** One day of the period. `att` is null when nobody answered for that day, which
 *  is the distinction this whole sheet exists to preserve: an unanswered day is
 *  not an absent one, and totalling it as absent would invent a fact. */
type Day = { date: string; att: Att | null; pay: Pay | null }

const SHIFT_LABEL: Record<string, string> = Object.fromEntries(SHIFTS.map((s) => [s.value, s.label]))
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const weekdayOf = (d: string) => WEEKDAY[new Date(d + 'T00:00:00').getDay()]
const isSunday = (d: string) => new Date(d + 'T00:00:00').getDay() === 0

/** Every date from `from` to `to`, both ends included. Built by walking rather
 *  than by counting, so a month boundary or a leap day needs no special case. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const end = new Date(to + 'T00:00:00')
  for (const d = new Date(from + 'T00:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
    )
  }
  return out
}

async function loadRecord(workerId: number, from: string, to: string, money: boolean) {
  const att = await supabase
    .from('ff_attendance')
    .select('*')
    .eq('worker_id', workerId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
  if (att.error) throw new Error(att.error.message)

  // A day's pay is what the wage stamped on that row bought, which is why it is
  // read back from the view rather than recomputed from today's wage here.
  let pay: Pay[] = []
  if (money) {
    const p = await supabase
      .from('ff_attendance_pay')
      .select('work_date,daily_wage,day_pay,ot_pay')
      .eq('worker_id', workerId)
      .gte('work_date', from)
      .lte('work_date', to)
    if (p.error) throw new Error(p.error.message)
    pay = (p.data ?? []) as Pay[]
  }
  return { att: (att.data ?? []) as Att[], pay }
}

/**
 * One person's whole attendance over a chosen period, day by day, ready to print
 * or open in a spreadsheet.
 *
 * The register is written a day at a time, so it holds a row only for days that
 * were answered. A record read straight off it would silently skip the days
 * nobody marked, and the reader would take the remaining rows for the whole
 * story. Every date in the period is listed instead, and a day with no row says
 * *not marked* - separate from absent, and counted separately.
 *
 * The period is trimmed to the person's own dates - days before they joined or
 * after they left are not blanks in their record, they are not their days at all -
 * but never so far as to hide a day actually marked. See `span` below.
 */
export function AttendanceRecord({
  roster, workerId, onPick, money,
}: {
  /** Everyone who can be looked up, including people who have left. */
  roster: Worker[]
  workerId: number | null
  onPick: (id: number | null) => void
  money: boolean
}) {
  const { byId } = usePlant()
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(today())

  const worker = roster.find((w) => w.id === workerId) ?? null

  // The whole period as asked for. What is *shown* is narrowed below, but the
  // fetch cannot be, or a day recorded outside their dates would never be seen.
  const rec = useQuery(
    () => (worker
      ? loadRecord(worker.id, from, to, money)
      : Promise.resolve({ att: [] as Att[], pay: [] as Pay[] })),
    'att-rec-' + (worker?.id ?? 0) + '-' + from + '-' + to + '-' + money,
  )

  /**
   * The stretch of the period to lay out. It starts as the part of it this person
   * was on the rolls - days before they joined are not blanks in their record,
   * they are not their days at all - and is then widened back out to cover any
   * day actually recorded against them.
   *
   * That second step is the one that matters. A joining date typed later than a
   * day already marked would otherwise drop a real, recorded day from the sheet,
   * and a record that quietly omits days is worse than one carrying a few too
   * many. Where the two disagree the register wins, and the disagreement is said
   * out loud rather than resolved silently.
   */
  const span = useMemo(() => {
    if (!worker) return { start: from, end: to, clamped: false, outside: 0 }
    let start = worker.date_joined && worker.date_joined > from ? worker.date_joined : from
    let end = worker.left_on && worker.left_on < to ? worker.left_on : to
    const clamped = start !== from || end !== to

    let outside = 0
    for (const a of rec.data?.att ?? []) {
      if (a.work_date < start) { start = a.work_date; outside += 1 }
      if (a.work_date > end) { end = a.work_date; outside += 1 }
    }
    return { start, end, clamped, outside }
  }, [worker, from, to, rec.data])

  const { start, end, clamped, outside } = span

  const days: Day[] = useMemo(() => {
    if (!worker || start > end) return []
    const byDate = new Map((rec.data?.att ?? []).map((a) => [a.work_date, a]))
    const payBy = new Map((rec.data?.pay ?? []).map((p) => [p.work_date, p]))
    return eachDay(start, end).map((date) => ({
      date, att: byDate.get(date) ?? null, pay: payBy.get(date) ?? null,
    }))
  }, [rec.data, worker, start, end])

  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, blank: 0, ot: 0, hours: 0, pay: 0 }
    for (const d of days) {
      if (!d.att) { t.blank += 1; continue }
      if (d.att.status === 'present') t.present += 1
      else if (d.att.status === 'half_day') t.present += 0.5
      else if (d.att.status === 'absent') t.absent += 1
      t.ot += Number(d.att.ot_hours ?? 0)
      t.hours += spanHours(d.att.in_time, d.att.out_time) ?? 0
      t.pay += Number(d.pay?.day_pay ?? 0) + Number(d.pay?.ot_pay ?? 0)
    }
    return t
  }, [days])

  const siteOf = (a: Att | null) =>
    (a?.at_plant_id ? byId(a.at_plant_id)?.short_name : null) ?? ''

  /** The same table, as a spreadsheet opens it. Written from `days` rather than
   *  from the rows, so a not-marked day is carried across instead of dropped. */
  function csv() {
    if (!worker) return
    const head = ['Date', 'Day', 'Status', 'Shift', 'In', 'Out', 'Hours', 'OT hours', 'Site', 'Remarks']
    if (money) head.push('Wage', 'Day pay', 'OT pay')

    const rows = days.map((d) => {
      const a = d.att
      const hrs = a ? spanHours(a.in_time, a.out_time) : null
      const r = [
        d.date,
        weekdayOf(d.date),
        a ? ATTENDANCE_LABEL[a.status] : 'Not marked',
        a?.shift ? SHIFT_LABEL[a.shift] ?? a.shift : '',
        a?.in_time ? fmtTime(a.in_time) : '',
        a?.out_time ? fmtTime(a.out_time) : '',
        hrs === null ? '' : String(hrs),
        a && Number(a.ot_hours) ? String(a.ot_hours) : '',
        siteOf(a),
        a?.remarks ?? '',
      ]
      if (money) r.push(String(d.pay?.daily_wage ?? ''), String(d.pay?.day_pay ?? ''), String(d.pay?.ot_pay ?? ''))
      return r
    })

    // A cell opening with =, +, - or @ is read as a formula by Excel and Sheets.
    // Remarks are free text typed on the floor, so they are quoted out of it.
    const cell = (v: string) => {
      const s = /^[=+\-@]/.test(v) ? "'" + v : v
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const body = [
      ['Attendance record'],
      [worker.name + ' (' + worker.code + ')'],
      ['Period', start, 'to', end],
      [],
      head,
      ...rows,
      [],
      ['Days in period', String(days.length)],
      ['Present', String(totals.present)],
      ['Absent', String(totals.absent)],
      ['Not marked', String(totals.blank)],
      ['OT hours', String(totals.ot)],
      ...(money ? [['Total pay', String(totals.pay)]] : []),
    ].map((r) => r.map(cell).join(',')).join('\r\n')

    // A BOM, so Excel opens a name with an accent in it as written.
    const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = worker.code + ' ' + start + ' to ' + end + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const cell = 'px-2 py-1 whitespace-nowrap'
  const th = cell + ' font-medium'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[190px] flex-1">
          <Field label="Whose record">
            <select
              value={workerId ?? ''}
              onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}
              className={inputCls}
            >
              <option value="">Pick a person…</option>
              {roster.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.code}{w.left_on ? ' (left ' + fmtDate(w.left_on) + ')' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="From">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </Field>
        <Field label="To">
          <input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </Field>
        {worker && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => window.print()}>Print</Button>
            <Button variant="ghost" onClick={csv}>Download CSV</Button>
          </div>
        )}
      </div>

      {!worker ? (
        <Empty>Pick a person to see every day of the period, marked or not.</Empty>
      ) : rec.loading ? <Spinner /> : rec.error ? <ErrorBox error={rec.error} onRetry={rec.refresh} /> : start > end ? (
        <Empty>
          {worker.name} was not on the rolls in this period, and no day was recorded
          {worker.date_joined ? ' — joined ' + fmtDate(worker.date_joined) : ''}
          {worker.left_on ? ', left ' + fmtDate(worker.left_on) : ''}.
        </Empty>
      ) : (
        <div id="ff-print" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{worker.name}</h3>
              <p className="text-xs text-slate-500">
                {worker.code}
                {worker.designation ? ' · ' + worker.designation : ''}
                {worker.dept ? ' · ' + worker.dept : ''}
                {' · '}
                {worker.plant_id === null ? 'Group' : byId(worker.plant_id)?.short_name ?? 'Group'}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              {fmtDate(start)} — {fmtDate(end)} · {days.length} day{days.length === 1 ? '' : 's'}
              {clamped ? ' (trimmed to their own dates)' : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><strong className="tabular-nums">{fmtNum(totals.present, 1)}</strong> present</span>
            <span><strong className="tabular-nums">{totals.absent}</strong> absent</span>
            <span className={totals.blank ? 'text-amber-700' : 'text-slate-500'}>
              <strong className="tabular-nums">{totals.blank}</strong> not marked
            </span>
            <span><strong className="tabular-nums">{fmtNum(totals.ot, 1)}</strong> OT hours</span>
            {money && <span><strong className="tabular-nums">{fmtMoney(totals.pay)}</strong> total pay</span>}
          </div>

          <div className="scroll-x">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Day</th>
                  <th className={th}>Status</th>
                  <th className={th}>Shift</th>
                  <th className={th}>In</th>
                  <th className={th}>Out</th>
                  <th className={th + ' text-right'}>Hours</th>
                  <th className={th + ' text-right'}>OT</th>
                  <th className={th}>Site</th>
                  {money && <th className={th + ' text-right'}>Pay</th>}
                  <th className={th}>Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {days.map((d) => {
                  const a = d.att
                  const hrs = a ? spanHours(a.in_time, a.out_time) : null
                  const dayPay = Number(d.pay?.day_pay ?? 0) + Number(d.pay?.ot_pay ?? 0)
                  return (
                    <tr key={d.date} className={isSunday(d.date) ? 'bg-slate-50' : ''}>
                      <td className={cell + ' tabular-nums'}>{fmtDate(d.date)}</td>
                      <td className={cell + ' text-slate-500'}>{weekdayOf(d.date)}</td>
                      <td className={cell}>
                        {!a ? <span className="text-amber-700">not marked</span>
                          : a.status === 'absent' ? <span className="text-red-700">Absent</span>
                          : a.status === 'present' ? <span className="text-green-700">Present</span>
                          : <span className="text-slate-600">{ATTENDANCE_LABEL[a.status]}</span>}
                      </td>
                      <td className={cell + ' text-slate-600'}>{a?.shift ? SHIFT_LABEL[a.shift] ?? a.shift : ''}</td>
                      <td className={cell + ' tabular-nums text-slate-600'}>{a?.in_time ? fmtTime(a.in_time) : ''}</td>
                      <td className={cell + ' tabular-nums text-slate-600'}>{a?.out_time ? fmtTime(a.out_time) : ''}</td>
                      <td className={cell + ' text-right tabular-nums text-slate-600'}>{hrs === null ? '' : fmtNum(hrs, 1)}</td>
                      <td className={cell + ' text-right tabular-nums'}>{a && Number(a.ot_hours) ? fmtNum(a.ot_hours, 1) : ''}</td>
                      <td className={cell + ' text-slate-600'}>{siteOf(a)}</td>
                      {money && <td className={cell + ' text-right tabular-nums'}>{a ? fmtMoney(dayPay) : ''}</td>}
                      <td className={cell + ' max-w-[220px] truncate text-slate-600'} title={a?.remarks ?? ''}>{a?.remarks ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 font-medium">
                <tr>
                  <td className={cell} colSpan={2}>Total</td>
                  <td className={cell + ' tabular-nums'}>{fmtNum(totals.present, 1)}P · {totals.absent}A</td>
                  <td className={cell} colSpan={3} />
                  <td className={cell + ' text-right tabular-nums'}>{fmtNum(totals.hours, 1)}</td>
                  <td className={cell + ' text-right tabular-nums'}>{fmtNum(totals.ot, 1)}</td>
                  <td className={cell} />
                  {money && <td className={cell + ' text-right tabular-nums'}>{fmtMoney(totals.pay)}</td>}
                  <td className={cell} />
                </tr>
              </tfoot>
            </table>
          </div>

          {outside > 0 && (
            <p className="text-xs text-amber-700">
              {outside} day{outside === 1 ? '' : 's'} here {outside === 1 ? 'is' : 'are'} recorded outside
              this person&rsquo;s own dates
              {worker.date_joined ? ' (joined ' + fmtDate(worker.date_joined) : ''}
              {worker.date_joined && worker.left_on ? ', left ' + fmtDate(worker.left_on) + ')'
                : worker.date_joined ? ')' : ''}
              . They are shown, because the day was marked and marking it is the record. Either the
              date on the profile or the day itself is wrong, and it is worth settling which.
            </p>
          )}

          {totals.blank > 0 && (
            <p className="text-xs text-amber-700">
              {totals.blank} day{totals.blank === 1 ? '' : 's'} in this period {totals.blank === 1 ? 'was' : 'were'} never
              marked. They are listed but counted as neither present nor absent — nobody answered for them.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
