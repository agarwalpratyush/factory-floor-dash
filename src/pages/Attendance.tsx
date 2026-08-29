import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Alert, Badge, Empty, ErrorBox, Field, NeedPlant, PlantTag, Result, Section, Spinner,
} from '../components/ui'
import { daysAgo, fmtNum, today } from '../lib/format'
import { ALL_DEPTS, ATTENDANCE_LABEL, DEPTS_BY_PLANT, DEPT_GROUPING_MIN, DESIGNATIONS, SHIFTS } from '../lib/types'
import type { Attendance as Att, AttendanceStatus, DailyLabour, Worker } from '../lib/types'

const STATUSES: AttendanceStatus[] = ['present', 'half_day', 'absent', 'leave', 'week_off']

/** Present is a pass, absent is a fail, the rest are neither. Colour reports state only. */
const STATUS_STATE: Record<AttendanceStatus, 'ok' | 'warn' | 'fail' | 'idle' | undefined> = {
  present: 'ok', half_day: 'warn', absent: 'fail', leave: 'idle', week_off: 'idle',
}
const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P', half_day: 'H', absent: 'A', leave: 'L', week_off: 'W',
}

async function loadDay(scope: PlantScope, date: string) {
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
    att: ((att.data ?? []) as Att[]).filter((a) => ids.has(a.worker_id)),
    labour: (labour.data ?? []) as DailyLabour[],
  }
}

async function loadMonth(from: string) {
  const { data, error } = await supabase
    .from('ff_attendance').select('worker_id,status,ot_hours,work_date').gte('work_date', from)
  if (error) throw new Error(error.message)
  return (data ?? []) as Pick<Att, 'worker_id' | 'status' | 'ot_hours' | 'work_date'>[]
}

function NewWorkerForm({
  plantId, plantCode, onDone,
}: { plantId: number; plantCode: string | null; onDone: () => void }) {
  const depts = plantCode ? DEPTS_BY_PLANT[plantCode] ?? ALL_DEPTS : ALL_DEPTS
  const [f, setF] = useState({
    code: '', name: '', phone: '', dept: depts[0],
    designation: DESIGNATIONS[0], shift_default: 'A', daily_wage: '', notes: '', group: false,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
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
    <form onSubmit={submit} className="stack">
      <Field label="Worker code"><input className="input mono" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
      <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Designation">
        <select className="select" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })}>
          {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Department">
        <select className="select" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Default shift">
        <select className="select" value={f.shift_default} onChange={(e) => setF({ ...f, shift_default: e.target.value })}>
          {SHIFTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Phone"><input className="input mono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Daily wage"><input className="input num" type="number" value={f.daily_wage} onChange={(e) => setF({ ...f, daily_wage: e.target.value })} /></Field>
      <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <label className="check">
        <input type="checkbox" checked={f.group} onChange={(e) => setF({ ...f, group: e.target.checked })} />
        Group staff, covers both companies
      </label>
      {err && <Alert state="fail">{err}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add worker'}</button>
    </form>
  )
}

export default function Attendance() {
  const { scope, plant, plants, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const entry = can('ff_entry')
  const [date, setDate] = useState(today())
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [siteFor, setSiteFor] = useState<Record<number, number>>({})

  const day = useQuery(() => loadDay(scope, date), 'att-' + scopeKey(scope) + '-' + date)
  const month = useQuery(() => loadMonth(daysAgo(29)), 'att-month')

  const byWorker = useMemo(() => {
    const m = new Map<number, Att>()
    for (const a of day.data?.att ?? []) m.set(a.worker_id, a)
    return m
  }, [day.data])

  const summary = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of month.data ?? []) {
      const add = a.status === 'present' ? 1 : a.status === 'half_day' ? 0.5 : 0
      m.set(a.worker_id, (m.get(a.worker_id) ?? 0) + add)
    }
    return m
  }, [month.data])

  function siteOf(w: Worker): number | null {
    if (w.plant_id !== null) return null
    return siteFor[w.id] ?? byWorker.get(w.id)?.at_plant_id ?? null
  }

  async function mark(w: Worker, status: AttendanceStatus) {
    setSaving(w.id); setErr(null)
    const existing = byWorker.get(w.id)
    const { error } = await supabase.from('ff_attendance').upsert({
      work_date: date,
      worker_id: w.id,
      at_plant_id: siteOf(w),
      status,
      shift: existing?.shift ?? w.shift_default,
      recorded_by: 'supervisor',
    }, { onConflict: 'work_date,worker_id' })
    setSaving(null)
    if (error) setErr(error.message)
    else { day.refresh(); month.refresh() }
  }

  async function markRest() {
    const unmarked = (day.data?.workers ?? []).filter((w) => !byWorker.has(w.id))
    if (unmarked.length === 0) return
    setErr(null)
    const { error } = await supabase.from('ff_attendance').upsert(
      unmarked.map((w) => ({
        work_date: date, worker_id: w.id, at_plant_id: siteOf(w),
        status: 'present' as AttendanceStatus, shift: w.shift_default, recorded_by: 'supervisor',
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
  const half = workers.filter((w) => byWorker.get(w.id)?.status === 'half_day').length
  const absent = workers.filter((w) => byWorker.get(w.id)?.status === 'absent').length

  const labour = day.data?.labour ?? []
  const casual = labour.reduce((s, l) => s + Number(l.head_count), 0)
  const casualCost = labour.reduce((s, l) => s + Number(l.head_count) * Number(l.rate_per_head ?? 0), 0)
  const rollWage = workers.reduce((sum, w) => {
    const st = byWorker.get(w.id)?.status
    return sum + (st === 'present' ? 1 : st === 'half_day' ? 0.5 : 0) * Number(w.daily_wage ?? 0)
  }, 0)
  const anyCost = casualCost > 0 || workers.some((w) => Number(w.daily_wage ?? 0) > 0)

  // Department headings are noise below DEPT_GROUPING_MIN heads; key on plant too,
  // because both companies run a packing and a dispatch.
  const groups = useMemo(() => {
    const m = new Map<string, { plantId: number; dept: string; list: Worker[] }>()
    const perPlant = new Map<number, number>()
    for (const w of onRolls) perPlant.set(w.plant_id!, (perPlant.get(w.plant_id!) ?? 0) + 1)
    for (const w of onRolls) {
      const dept = (perPlant.get(w.plant_id!) ?? 0) < DEPT_GROUPING_MIN ? '' : w.dept
      const key = w.plant_id + '|' + dept
      const g = m.get(key) ?? { plantId: w.plant_id!, dept, list: [] }
      g.list.push(w)
      m.set(key, g)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [onRolls])

  function WorkerRows({ list, isGroup }: { list: Worker[]; isGroup: boolean }) {
    return (
      <>
        {list.map((w) => {
          const cur = byWorker.get(w.id)
          const days30 = summary.get(w.id)
          return (
            <tr key={w.id}>
              <td className="mono">{w.code}</td>
              <td>
                {w.name}
                {w.designation && <span className="badge is-idle" style={{ marginLeft: 4 }}>{w.designation}</span>}
                {w.notes && <div className="faint" style={{ fontSize: 'var(--text-caption)' }}>{w.notes}</div>}
              </td>
              <td className="mono faint">{cur?.shift ?? w.shift_default}</td>
              {isGroup && (
                <td>
                  <select
                    className="select" style={{ width: 90 }}
                    value={siteOf(w) ?? ''}
                    onChange={(e) => setSiteFor({ ...siteFor, [w.id]: Number(e.target.value) })}
                  >
                    <option value="">Site</option>
                    {plants.map((p) => <option key={p.id} value={p.id}>{p.short_name}</option>)}
                  </select>
                </td>
              )}
              <td className="n faint">{days30 !== undefined ? fmtNum(days30, 1) : '—'}</td>
              <td>
                <div className="btn-group">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      title={ATTENDANCE_LABEL[s]}
                      disabled={!entry || saving === w.id}
                      onClick={() => mark(w, s)}
                      className={'btn btn-sm' + (cur?.status === s ? ' is-active' : '')}
                      style={cur?.status === s && STATUS_STATE[s] && STATUS_STATE[s] !== 'idle'
                        ? { color: 'var(--' + STATUS_STATE[s] + ')', borderColor: 'var(--' + STATUS_STATE[s] + ')' }
                        : undefined}
                    >
                      {STATUS_SHORT[s]}
                    </button>
                  ))}
                </div>
              </td>
              <td>{!cur && <span className="badge is-warn">not marked</span>}</td>
            </tr>
          )
        })}
      </>
    )
  }

  return (
    <>
      <div className="col w-sm">
        <Field label="Date">
          <input className="input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Result
          label="Marked"
          value={marked + ' / ' + workers.length}
          state={marked < workers.length ? 'warn' : 'ok'}
          sub={marked < workers.length ? (workers.length - marked) + ' to go' : 'all done'}
        />
        <Result label="Present" value={present} state="ok" sub={half + ' half day'} />
        <Result label="Absent" value={absent} state={absent ? 'fail' : 'ok'} />
        <Result label="Daily-wage labour" value={casual || '—'} sub={casual ? 'not on the rolls' : 'none today'} />
        {money && (
          <Result
            label="Wage bill"
            value={anyCost ? '₹' + fmtNum(rollWage + casualCost, 0) : '—'}
            sub={anyCost ? 'rolls + casual' : 'no rates recorded'}
          />
        )}
        {plant && can('ff_manage') && (
          <button type="button" className={'btn' + (showNew ? '' : ' btn-primary')} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : 'Add worker'}
          </button>
        )}
        {!plant && <NeedPlant what="add a worker or record labour" />}
        {err && <Alert state="fail">{err}</Alert>}
      </div>

      <div className="col fill flush">
        <div className="row" style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
          <span className="label">Mark attendance · {date}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" disabled={!entry || marked === workers.length} onClick={markRest}>
            Mark rest present
          </button>
        </div>

        {day.loading ? <Spinner /> : day.error ? <div style={{ padding: 8 }}><ErrorBox error={day.error} onRetry={day.refresh} /></div> : workers.length === 0 ? (
          <Empty>No active workers.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Shift</th><th className="n">Days /30</th><th>Mark</th><th />
                </tr>
              </thead>
              {groups.map(([key, g]) => (
                <tbody key={key}>
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--surface-sunk)' }}>
                      <span className="label">
                        {scope === 'group' && <PlantTag code={byId(g.plantId)?.code} />}{' '}
                        {g.dept || byId(g.plantId)?.short_name} ({g.list.length})
                      </span>
                    </td>
                  </tr>
                  <WorkerRows list={g.list} isGroup={false} />
                </tbody>
              ))}
              {groupStaff.length > 0 && (
                <tbody>
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--surface-sunk)' }}>
                      <span className="label">Group staff, both companies ({groupStaff.length})</span>
                    </td>
                  </tr>
                  <WorkerRows list={groupStaff} isGroup />
                </tbody>
              )}
            </table>
          </div>
        )}
      </div>

      <div className="col w-md">
        {showNew && plant ? (
          <Section title={'New worker · ' + plant.short_name}>
            <NewWorkerForm plantId={plant.id} plantCode={plant.code} onDone={() => { setShowNew(false); day.refresh() }} />
          </Section>
        ) : (
          <>
            {plant && <CasualLabour plantId={plant.id} date={date} existing={labour.find((l) => l.plant_id === plant.id)} onDone={day.refresh} canEnter={entry} />}
            <Section title="Marking key" flush>
              <table className="table compact">
                <tbody>
                  {STATUSES.map((s) => (
                    <tr key={s}>
                      <td className="mono">{STATUS_SHORT[s]}</td>
                      <td>{ATTENDANCE_LABEL[s]}</td>
                      <td>
                        {STATUS_STATE[s] && STATUS_STATE[s] !== 'idle' && (
                          <Badge state={STATUS_STATE[s]}>{STATUS_STATE[s] === 'ok' ? 'counts' : STATUS_STATE[s] === 'warn' ? 'half' : 'lost'}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            {groupStaff.length > 0 && (
              <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
                Group staff are marked in the combined view only. One row per person per day;
                the site records where they were.
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

function CasualLabour({
  plantId, date, existing, onDone, canEnter,
}: {
  plantId: number
  date: string
  existing: DailyLabour | undefined
  onDone: () => void
  canEnter: boolean
}) {
  const [count, setCount] = useState(existing ? String(existing.head_count) : '')
  const [rate, setRate] = useState(existing?.rate_per_head ? String(existing.rate_per_head) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    const { error } = await supabase.from('ff_daily_labour').upsert({
      plant_id: plantId, work_date: date,
      head_count: Number(count) || 0,
      rate_per_head: rate ? Number(rate) : null,
      recorded_by: 'supervisor',
    }, { onConflict: 'plant_id,work_date' })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  const total = (Number(count) || 0) * (Number(rate) || 0)

  return (
    <Section title="Daily-wage labour">
      <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
        Casual hands are not on the rolls, so they are counted for the day rather than named.
      </p>
      <Field label="How many today">
        <input className="input num" type="number" min="0" value={count} disabled={!canEnter} onChange={(e) => setCount(e.target.value)} />
      </Field>
      <Field label="Rate per head">
        <input className="input num" type="number" min="0" value={rate} disabled={!canEnter} onChange={(e) => setRate(e.target.value)} />
      </Field>
      <Result label="Day total" value={total > 0 ? '₹' + fmtNum(total, 0) : '—'} flat />
      {err && <Alert state="fail">{err}</Alert>}
      <button type="button" className="btn btn-primary" disabled={!canEnter || busy || count === ''} onClick={save}>
        {busy ? 'Saving…' : existing ? 'Update' : 'Save'}
      </button>
    </Section>
  )
}
