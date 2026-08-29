import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NeedPlant, PlantTag, Spinner, Stat,
} from '../components/ui'
import { daysAgo, fmtNum, today } from '../lib/format'
import {
  ALL_DEPTS, ATTENDANCE_LABEL, DEPTS_BY_PLANT, DEPT_GROUPING_MIN, DESIGNATIONS, SHIFTS,
} from '../lib/types'
import type { Attendance as Att, AttendanceStatus, DailyLabour, Worker } from '../lib/types'

/** Present or absent is the whole question on a floor this size, and five buttons
 *  on every row made it look harder than it is. Half day, leave and week off remain
 *  in the enum and still read back correctly where they were already recorded. */
const STATUSES: AttendanceStatus[] = ['present', 'absent']

/** Both sites run twelve hour shifts, so a daily wage buys twelve hours and the
 *  ordinary hourly rate is a twelfth of it. Overtime pays twice that. The database
 *  holds both per company on ff_plants; these mirror the defaults. */
const STANDARD_DAY_HOURS = 12
const OT_MULTIPLIER = 2

const STATUS_BTN: Record<AttendanceStatus, string> = {
  present: 'bg-green-600 text-white ring-green-600',
  half_day: 'bg-amber-500 text-white ring-amber-500',
  absent: 'bg-red-600 text-white ring-red-600',
  leave: 'bg-violet-600 text-white ring-violet-600',
  week_off: 'bg-slate-500 text-white ring-slate-500',
}

const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P', half_day: '½', absent: 'A', leave: 'L', week_off: 'W',
}

async function loadDay(scope: PlantScope, date: string) {
  // Group staff (plant_id null) are marked in Combined View only - they are not
  // any one company's headcount, and marking them under a company would imply they are.
  let wq = supabase.from('ff_workers').select('*').eq('active', true).order('code')
  if (scope !== 'group') wq = wq.eq('plant_id', scope)

  let lq = supabase.from('ff_daily_labour').select('*').eq('work_date', date)
  if (scope !== 'group') lq = lq.eq('plant_id', scope)

  const [workers, att, labour] = await Promise.all([
    wq,
    supabase.from('ff_attendance').select('*').eq('work_date', date),
    lq,
  ])
  const failed = [workers, att, labour].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  const wk = (workers.data ?? []) as Worker[]
  const ids = new Set(wk.map((w) => w.id))
  return {
    workers: wk,
    // ff_attendance carries no plant_id - it inherits the plant of its worker
    att: ((att.data ?? []) as Att[]).filter((a) => ids.has(a.worker_id)),
    labour: (labour.data ?? []) as DailyLabour[],
  }
}

async function loadMonth(from: string) {
  const { data, error } = await supabase
    .from('ff_attendance')
    .select('worker_id,status,ot_hours,work_date')
    .gte('work_date', from)
  if (error) throw new Error(error.message)
  return (data ?? []) as Pick<Att, 'worker_id' | 'status' | 'ot_hours' | 'work_date'>[]
}

function NewWorkerForm({
  plantId, plantCode, onDone,
}: { plantId: number | null; plantCode: string | null; onDone: () => void }) {
  const depts = plantCode ? DEPTS_BY_PLANT[plantCode] ?? ALL_DEPTS : ALL_DEPTS
  const [f, setF] = useState({
    code: '', name: '', phone: '', dept: depts[0],
    designation: DESIGNATIONS[0], shift_default: 'G', daily_wage: '', notes: '',
    group: false,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('ff_workers').insert({
      plant_id: f.group ? null : plantId,
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      phone: f.phone.trim() || null,
      dept: f.dept,
      designation: f.designation,
      shift_default: f.shift_default,
      daily_wage: f.daily_wage ? Number(f.daily_wage) : null,
      notes: f.notes.trim() || null,
      date_joined: today(),
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Worker code *">
        <input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inputCls} placeholder="A-04" />
      </Field>
      <Field label="Name *">
        <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Designation">
        <select value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} className={inputCls}>
          {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Phone">
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Department">
        <select value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })} className={inputCls}>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Default shift">
        <select value={f.shift_default} onChange={(e) => setF({ ...f, shift_default: e.target.value })} className={inputCls}>
          {SHIFTS.map((sh) => <option key={sh.value} value={sh.value}>{sh.label}</option>)}
        </select>
      </Field>
      <Field label="Daily wage (₹)">
        <input type="number" step="1" value={f.daily_wage} onChange={(e) => setF({ ...f, daily_wage: e.target.value })} className={inputCls} placeholder="leave blank if not fixed" />
      </Field>
      <Field label="Notes">
        <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} placeholder="name to be confirmed…" />
      </Field>
      <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.group} onChange={(e) => setF({ ...f, group: e.target.checked })} className="h-4 w-4 rounded" />
        Group staff (oversees both companies)
      </label>
      {err && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">{err}</p>}
      <div className="sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add worker'}</Button>
      </div>
    </form>
  )
}

function CasualLabourCard({
  plantId, date, existing, onDone,
}: { plantId: number; date: string; existing: DailyLabour | undefined; onDone: () => void }) {
  const [count, setCount] = useState(existing ? String(existing.head_count) : '')
  const [rate, setRate] = useState(existing?.rate_per_head ? String(existing.rate_per_head) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('ff_daily_labour').upsert(
      {
        plant_id: plantId,
        work_date: date,
        head_count: Number(count) || 0,
        rate_per_head: rate ? Number(rate) : null,
        recorded_by: 'supervisor',
      },
      { onConflict: 'plant_id,work_date' },
    )
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  const total = (Number(count) || 0) * (Number(rate) || 0)

  return (
    <Card title="Daily-wage labour">
      <p className="-mt-1 mb-3 text-xs text-slate-500">
        Casual hands are not on the rolls, so they are counted for the day rather than named.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="How many today">
          <input type="number" min="0" value={count} onChange={(e) => setCount(e.target.value)} className={inputCls + ' w-28'} />
        </Field>
        <Field label="Rate per head (₹)">
          <input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls + ' w-32'} />
        </Field>
        <div className="pb-1">
          <div className="text-xs text-slate-500 uppercase">Day total</div>
          <div className="text-lg font-semibold tabular-nums">{total > 0 ? '₹' + fmtNum(total, 0) : '—'}</div>
        </div>
        <Button onClick={save} disabled={busy || count === ''} className="mb-0.5">
          {busy ? 'Saving…' : existing ? 'Update' : 'Save'}
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </Card>
  )
}

export default function Attendance() {
  const { scope, plant, plants, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const manage = can('ff_manage')
  const [date, setDate] = useState(today())
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [siteFor, setSiteFor] = useState<Record<number, number>>({})
  // Which rows have their detail strip open. Held here rather than in WorkerRow,
  // which is declared inside this component and so remounts on every render.
  const [openRow, setOpenRow] = useState<Record<number, boolean>>({})

  const day = useQuery(() => loadDay(scope, date), 'att-' + scopeKey(scope) + '-' + date)
  const month = useQuery(() => loadMonth(daysAgo(29)), 'att-month')

  const byWorker = useMemo(() => {
    const m = new Map<number, Att>()
    for (const a of day.data?.att ?? []) m.set(a.worker_id, a)
    return m
  }, [day.data])

  const summary = useMemo(() => {
    const m = new Map<number, { present: number; absent: number; ot: number }>()
    for (const a of month.data ?? []) {
      const cur = m.get(a.worker_id) ?? { present: 0, absent: 0, ot: 0 }
      if (a.status === 'present') cur.present += 1
      else if (a.status === 'half_day') cur.present += 0.5
      else if (a.status === 'absent') cur.absent += 1
      cur.ot += Number(a.ot_hours ?? 0)
      m.set(a.worker_id, cur)
    }
    return m
  }, [month.data])

  /** Which site a roving person worked at. Group staff only appear in Combined View,
   *  so the site always comes from the picker on their row. */
  function siteOf(worker: Worker): number | null {
    if (worker.plant_id !== null) return null
    return siteFor[worker.id] ?? byWorker.get(worker.id)?.at_plant_id ?? null
  }

  async function mark(worker: Worker, status: AttendanceStatus) {
    setSaving(worker.id)
    setErr(null)
    const existing = byWorker.get(worker.id)
    const { error } = await supabase.from('ff_attendance').upsert(
      {
        work_date: date,
        worker_id: worker.id,
        at_plant_id: siteOf(worker),
        status,
        shift: existing?.shift ?? worker.shift_default,
        recorded_by: 'supervisor',
      },
      { onConflict: 'work_date,worker_id' },
    )
    setSaving(null)
    if (error) setErr(error.message)
    else { day.refresh(); month.refresh() }
  }

  /** Amends a day that is already marked. Everything in the details strip goes
   *  through here, so a change is saved where it is made rather than only in
   *  local state - which is how the site picker used to lose its value. */
  async function patch(worker: Worker, fields: Partial<Att>) {
    setSaving(worker.id)
    setErr(null)
    const { error } = await supabase
      .from('ff_attendance')
      .update(fields)
      .eq('work_date', date)
      .eq('worker_id', worker.id)
    setSaving(null)
    if (error) setErr(error.message)
    else { day.refresh(); month.refresh() }
  }

  async function markAllPresent() {
    const unmarked = (day.data?.workers ?? []).filter((w) => !byWorker.has(w.id))
    if (unmarked.length === 0) return
    setErr(null)
    const { error } = await supabase.from('ff_attendance').upsert(
      unmarked.map((w) => ({
        work_date: date,
        worker_id: w.id,
        at_plant_id: siteOf(w),
        status: 'present' as AttendanceStatus,
        shift: w.shift_default,
        recorded_by: 'supervisor',
      })),
      { onConflict: 'work_date,worker_id' },
    )
    if (error) setErr(error.message)
    else { day.refresh(); month.refresh() }
  }

  const workers = day.data?.workers ?? []
  const onRolls = workers.filter((w) => w.plant_id !== null)
  const groupStaff = workers.filter((w) => w.plant_id === null)

  const marked = workers.filter((w) => byWorker.has(w.id)).length
  const present = workers.filter((w) => byWorker.get(w.id)?.status === 'present').length
  const absent = workers.filter((w) => byWorker.get(w.id)?.status === 'absent').length

  const labour = day.data?.labour ?? []
  const casual = labour.reduce((s, l) => s + Number(l.head_count), 0)
  const casualCost = labour.reduce((s, l) => s + Number(l.head_count) * Number(l.rate_per_head ?? 0), 0)

  const anyWage = workers.some((w) => w.daily_wage !== null && Number(w.daily_wage) > 0)
  const rollWage = workers.reduce((sum, w) => {
    const s = byWorker.get(w.id)?.status
    const mult = s === 'present' ? 1 : s === 'half_day' ? 0.5 : 0
    return sum + mult * Number(w.daily_wage ?? 0)
  }, 0)

  // Overtime at twice the ordinary hourly rate, on a twelve hour day.
  const otHours = workers.reduce((sum, w) => sum + Number(byWorker.get(w.id)?.ot_hours ?? 0), 0)
  const otPay = workers.reduce((sum, w) => {
    const h = Number(byWorker.get(w.id)?.ot_hours ?? 0)
    if (!h || !w.daily_wage) return sum
    return sum + h * (Number(w.daily_wage) / STANDARD_DAY_HOURS) * OT_MULTIPLIER
  }, 0)

  const wageBill = rollWage + otPay + casualCost
  const anyCost = anyWage || casualCost > 0

  // Department headings are noise below DEPT_GROUPING_MIN heads, and both companies
  // run a department called maintenance, so the key carries the plant too.
  const byDept = useMemo(() => {
    const groups = new Map<string, { plantId: number; dept: string; list: Worker[] }>()
    const perPlant = new Map<number, number>()
    for (const w of onRolls) perPlant.set(w.plant_id!, (perPlant.get(w.plant_id!) ?? 0) + 1)

    for (const w of onRolls) {
      const small = (perPlant.get(w.plant_id!) ?? 0) < DEPT_GROUPING_MIN
      const dept = small ? '' : w.dept
      const key = w.plant_id + '|' + dept
      const g = groups.get(key) ?? { plantId: w.plant_id!, dept, list: [] }
      g.list.push(w)
      groups.set(key, g)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [onRolls])

  function WorkerRow({ w }: { w: Worker }) {
    const cur = byWorker.get(w.id)
    const stat = summary.get(w.id)
    const isGroup = w.plant_id === null
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <div className="min-w-[150px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{w.name}</span>
            {w.designation && <Badge tone={isGroup ? 'violet' : 'slate'}>{w.designation}</Badge>}
          </div>
          <div className="text-xs text-slate-500">
            {w.code}
            {stat && ' · ' + fmtNum(stat.present, 1) + 'd present /30'}
          </div>
          {w.notes && <div className="text-xs text-amber-700">{w.notes}</div>}
          {cur?.remarks && <div className="text-xs text-slate-600">“{cur.remarks}”</div>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => {
            const active = cur?.status === s
            return (
              <button
                key={s}
                onClick={() => mark(w, s)}
                disabled={saving === w.id}
                title={ATTENDANCE_LABEL[s]}
                className={
                  'h-10 w-10 rounded-lg text-sm font-semibold ring-1 transition disabled:opacity-50 ' +
                  (active ? STATUS_BTN[s] : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-100')
                }
              >
                {STATUS_SHORT[s]}
              </button>
            )
          })}
        </div>
        {cur && !STATUSES.includes(cur.status) && (
          <span
            className="text-xs text-slate-500"
            title={'Recorded as ' + ATTENDANCE_LABEL[cur.status] + ' before this was simplified. Mark P or A to replace it.'}
          >
            {ATTENDANCE_LABEL[cur.status]}
          </span>
        )}
        {!cur && <Badge tone="amber">not marked</Badge>}

        {cur && (() => {
          const needsSite = isGroup && cur.status === 'present' && cur.at_plant_id === null
          return (
            <button
              onClick={() => setOpenRow({ ...openRow, [w.id]: !openRow[w.id] })}
              aria-expanded={!!openRow[w.id]}
              title={needsSite ? 'No site picked - this day is credited to neither company' : 'Shift, overtime and site'}
              className={
                'rounded-md px-2 py-1 text-xs ring-1 transition ' +
                (needsSite
                  ? 'bg-amber-50 text-amber-800 ring-amber-300'
                  : 'text-slate-500 ring-slate-300 hover:bg-slate-100')
              }
            >
              Details{needsSite && ' ·'}
            </button>
          )
        })()}

        {cur && openRow[w.id] && (
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
            {cur.status === 'present' && <>
            <label className="flex items-center gap-1.5">
              Shift
              <select
                value={cur.shift}
                disabled={saving === w.id}
                onChange={(e) => patch(w, { shift: e.target.value })}
                className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
              >
                {SHIFTS.map((sh) => <option key={sh.value} value={sh.value}>{sh.label}</option>)}
              </select>
            </label>

            {w.ot_eligible ? (
              <label className="flex items-center gap-1.5">
                Overtime
                <input
                  type="number" min={0} max={12} step={0.5}
                  defaultValue={Number(cur.ot_hours) || ''}
                  disabled={saving === w.id}
                  onBlur={(e) => {
                    const v = Number(e.target.value || 0)
                    if (v !== Number(cur.ot_hours)) patch(w, { ot_hours: v })
                  }}
                  placeholder="0"
                  className="w-14 rounded-md border border-slate-300 px-1.5 py-1 text-right tabular-nums"
                />
                h
              </label>
            ) : (
              <span className="text-slate-400" title="Managers are salaried for the job, not the hour">
                No overtime
              </span>
            )}

            {isGroup && (
              <label className="flex items-center gap-1.5">
                Site
                <select
                  value={cur.at_plant_id ?? ''}
                  disabled={saving === w.id}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSiteFor({ ...siteFor, [w.id]: v })
                    patch(w, { at_plant_id: v })
                  }}
                  className={
                    'rounded-md border px-1.5 py-1 text-xs ' +
                    (cur.at_plant_id === null ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300')
                  }
                  title="Which site were they at? The day is credited to that company."
                >
                  <option value="">pick a site</option>
                  {plants.map((p) => <option key={p.id} value={p.id}>{p.short_name}</option>)}
                </select>
              </label>
            )}
            </>}

            <label className="flex min-w-[220px] flex-1 items-center gap-1.5">
              Remarks
              <input
                type="text"
                maxLength={200}
                defaultValue={cur.remarks ?? ''}
                disabled={saving === w.id}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v !== (cur.remarks ?? '')) patch(w, { remarks: v || null })
                }}
                placeholder={cur.status === 'absent' ? 'why they are away' : 'anything worth noting'}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-1.5 py-1"
              />
            </label>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Attendance</h1>
          <p className="text-sm text-slate-500">
            Staff on the rolls are marked individually. Daily-wage labour is counted, not named.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={inputCls + ' w-auto'} />
          {plant && manage && (
            <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
              {showNew ? 'Cancel' : '+ Worker'}
            </Button>
          )}
        </div>
      </header>

      {showNew && plant && (
        <Card title={'New worker · ' + plant.short_name}>
          <NewWorkerForm plantId={plant.id} plantCode={plant.code} onDone={() => { setShowNew(false); day.refresh() }} />
        </Card>
      )}
      {!plant && <NeedPlant what="add a worker or record daily labour" />}

      {err && <ErrorBox error={err} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Marked"
          value={marked + ' / ' + workers.length}
          sub={marked < workers.length ? (workers.length - marked) + ' still to mark' : 'all done'}
          tone={marked < workers.length ? 'warn' : 'good'}
        />
        <Stat label="Present" value={present} sub={absent + ' absent'} tone="good" />
        <Stat
          label="Daily-wage labour"
          value={casual || '—'}
          sub={casual ? 'not on the rolls' : 'none recorded today'}
        />
        {money ? (
          <Stat
            label="Wage bill today"
            value={anyCost ? '₹' + fmtNum(wageBill, 0) : '—'}
            sub={anyCost
              ? 'rolls + casual' + (otHours > 0
                  ? ' + ' + fmtNum(otHours, 1) + 'h overtime ₹' + fmtNum(otPay, 0)
                  : '')
              : 'no rates recorded'}
          />
        ) : (
          <Stat label="Absent" value={absent} tone={absent ? 'bad' : 'good'} />
        )}
      </div>

      {plant && (
        <CasualLabourCard
          key={plant.id + date}
          plantId={plant.id}
          date={date}
          existing={labour.find((l) => l.plant_id === plant.id)}
          onDone={day.refresh}
        />
      )}

      <Card
        title={'Mark attendance · ' + date}
        action={
          <Button variant="ghost" onClick={markAllPresent} disabled={marked === workers.length}>
            Mark rest present
          </Button>
        }
      >
        {day.loading ? <Spinner /> : day.error ? <ErrorBox error={day.error} onRetry={day.refresh} /> : workers.length === 0 ? (
          <Empty>No active workers.</Empty>
        ) : (
          <div className="space-y-5">
            {byDept.map(([key, g]) => (
              <div key={key}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {scope === 'group' && <PlantTag code={byId(g.plantId)?.code} />}
                  {g.dept || byId(g.plantId)?.short_name || 'Team'}
                  <span className="font-normal text-slate-400">({g.list.length})</span>
                </h3>
                <ul className="space-y-2">
                  {g.list.map((w) => <WorkerRow key={w.id} w={w} />)}
                </ul>
              </div>
            ))}

            {groupStaff.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-violet-700 uppercase">
                  Group staff — overseeing both companies
                  <span className="ml-1 font-normal text-slate-400">({groupStaff.length})</span>
                </h3>
                <ul className="space-y-2">
                  {groupStaff.map((w) => <WorkerRow key={w.id} w={w} />)}
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  Marked here only — they belong to neither company on its own. One row per
                  person per day; pick the site so the day is credited to the right company.
                </p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
