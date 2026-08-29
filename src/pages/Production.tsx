import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Alert, Badge, Empty, ErrorBox, Field, NeedPlant, PlantTag, Result, Section, Spinner,
} from '../components/ui'
import { CoilDetail, CoilEntryGrid, type CoilLogSummary } from '../components/CoilLog'
import { daysAgo, fmtDate, fmtNum, fmtQty, today } from '../lib/format'
import { SHIFTS } from '../lib/types'
import type { Order, Production as Prod, StockLevel } from '../lib/types'

interface InputRow { material_id: string; qty: string }

/**
 * Every run at either company is an ff_production row, coating shifts included — the
 * coil register posts one underneath. So the log is one list; only the entry form
 * changes with the company's process.
 */
async function loadPage(scope: PlantScope, from: string) {
  let runQ = supabase
    .from('ff_production')
    .select('*, ff_materials!ff_production_output_material_id_fkey(code,name,unit), ff_orders(order_no), ff_production_inputs(id,material_id,qty,ff_materials(code,name,unit))')
    .gte('prod_date', from)
    .order('prod_date', { ascending: false })
    .order('id', { ascending: false })
  if (scope !== 'group') runQ = runQ.eq('plant_id', scope)

  let stockQ = supabase.from('ff_stock_levels').select('*').eq('active', true)
  if (scope !== 'group') stockQ = stockQ.eq('plant_id', scope)

  let orderQ = supabase.from('ff_orders').select('id,order_no,customer').neq('stage', 'delivered').order('order_no')
  if (scope !== 'group') orderQ = orderQ.eq('plant_id', scope)

  let coilQ = supabase.from('ff_coil_log_summary').select('*')
  if (scope !== 'group') coilQ = coilQ.eq('plant_id', scope)

  const [runs, stock, orders, coils] = await Promise.all([runQ, stockQ, orderQ, coilQ])
  const failed = [runs, stock, orders, coils].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  return {
    runs: (runs.data ?? []) as Prod[],
    stock: (stock.data ?? []) as StockLevel[],
    orders: (orders.data ?? []) as Pick<Order, 'id' | 'order_no' | 'customer'>[],
    coils: (coils.data ?? []) as CoilLogSummary[],
  }
}

/** One thing made, from however many things consumed. */
function RunForm({
  plantId, stock, orders, onDone,
}: {
  plantId: number
  stock: StockLevel[]
  orders: Pick<Order, 'id' | 'order_no' | 'customer'>[]
  onDone: () => void
}) {
  const [f, setF] = useState({
    prod_date: today(), shift: 'A', output_material_id: '', output_qty: '', order_id: '', remarks: '',
  })
  const [inputs, setInputs] = useState<InputRow[]>([{ material_id: '', qty: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // Only what this company makes can be the output of a run.
  const outputs = stock.filter((s) => s.role === 'wip' || s.role === 'finished')
  const outMat = stock.find((s) => String(s.material_id) === f.output_material_id)

  const setInput = (i: number, patch: Partial<InputRow>) =>
    setInputs((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))

  /** Warn, do not block: a genuine correction may go below today's balance. */
  function shortfall(row: InputRow) {
    const s = stock.find((x) => String(x.material_id) === row.material_id)
    if (!s || !row.qty) return null
    const short = Number(row.qty) - Number(s.balance)
    return short > 0 ? { short, unit: s.unit, have: Number(s.balance) } : null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const used = inputs.filter((r) => r.material_id && Number(r.qty) > 0)
    if (used.length === 0) { setErr('Add at least one input material.'); return }

    setBusy(true); setErr(null); setOk(null)
    const { data, error } = await supabase.rpc('ff_record_production', {
      p_plant_id: plantId,
      p_output_material_id: Number(f.output_material_id),
      p_output_qty: Number(f.output_qty),
      p_inputs: used.map((r) => ({ material_id: Number(r.material_id), qty: Number(r.qty) })),
      p_prod_date: f.prod_date,
      p_shift: f.shift,
      p_order_id: f.order_id ? Number(f.order_id) : null,
      p_remarks: f.remarks.trim() || null,
      p_recorded_by: 'supervisor',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk('Run ' + data + ' posted. Output into stock, inputs consumed.')
    setF({ ...f, output_qty: '', remarks: '' })
    setInputs([{ material_id: '', qty: '' }])
    onDone()
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="grid-2">
        <Field label="Date">
          <input className="input" type="date" value={f.prod_date} onChange={(e) => setF({ ...f, prod_date: e.target.value })} />
        </Field>
        <Field label="Shift">
          <select className="select" value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}>
            {SHIFTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Made">
        <select className="select" required value={f.output_material_id} onChange={(e) => setF({ ...f, output_material_id: e.target.value })}>
          <option value="">Select</option>
          {outputs.map((s) => <option key={s.material_id} value={s.material_id}>{s.code} — {s.name}</option>)}
        </select>
      </Field>
      <Field label={'Quantity made' + (outMat ? ' (' + outMat.unit + ')' : '')}>
        <input className="input num" required type="number" step="0.001" min="0.001" value={f.output_qty} onChange={(e) => setF({ ...f, output_qty: e.target.value })} />
      </Field>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">Consumed</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInputs((r) => [...r, { material_id: '', qty: '' }])}>
          Add input
        </button>
      </div>
      {inputs.map((row, i) => {
        const warn = shortfall(row)
        return (
          <div key={i} className="stack" style={{ gap: 2 }}>
            <div className="row">
              <select className="select" value={row.material_id} onChange={(e) => setInput(i, { material_id: e.target.value })}>
                <option value="">Select material</option>
                {stock.map((s) => (
                  <option key={s.material_id} value={s.material_id}>
                    {s.code} — {fmtQty(s.balance)} {s.unit}
                  </option>
                ))}
              </select>
              <input className="input num" style={{ width: 92 }} type="number" step="0.001" min="0" placeholder="Qty"
                value={row.qty} onChange={(e) => setInput(i, { qty: e.target.value })} />
              {inputs.length > 1 && (
                <button type="button" className="btn btn-sm" onClick={() => setInputs((r) => r.filter((_, n) => n !== i))}>
                  Remove
                </button>
              )}
            </div>
            {warn && (
              <span style={{ color: 'var(--warn)', fontSize: 'var(--text-caption)' }}>
                {fmtQty(warn.have)} {warn.unit} on hand. This run takes stock {fmtQty(warn.short)} {warn.unit} below zero.
              </span>
            )}
          </div>
        )
      })}

      <Field label="Against order">
        <select className="select" value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value })}>
          <option value="">None</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.customer}</option>)}
        </select>
      </Field>
      <Field label="Remarks">
        <input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
      </Field>

      {err && <Alert state="fail">{err}</Alert>}
      {ok && <Alert state="ok">{ok}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={busy || !f.output_material_id || !f.output_qty}>
        {busy ? 'Posting…' : 'Post run'}
      </button>
    </form>
  )
}

export default function Production() {
  const { scope, plant, byId, runs: runsProcess } = usePlant()
  const { can } = useAuth()
  const [days, setDays] = useState(90)
  const [showNew, setShowNew] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'prod-' + scopeKey(scope) + '-' + days,
  )

  const runs = data?.runs ?? []

  const coilByRun = useMemo(() => {
    const m = new Map<number, CoilLogSummary>()
    for (const c of data?.coils ?? []) if (c.production_id != null) m.set(c.production_id, c)
    return m
  }, [data])

  const byOutput = useMemo(() => {
    const m = new Map<string, { qty: number; unit: string; runs: number }>()
    for (const r of runs) {
      const code = r.ff_materials?.code ?? String(r.output_material_id)
      const cur = m.get(code) ?? { qty: 0, unit: r.ff_materials?.unit ?? '', runs: 0 }
      cur.qty += Number(r.output_qty); cur.runs += 1
      m.set(code, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].runs - a[1].runs)
  }, [runs])

  // The company's process decides which form opens, not which tab you are on.
  const coating = runsProcess('coating') && !runsProcess('fabrication')
  const canEnter = can('ff_entry') && !!plant
  const selected = openId !== null ? coilByRun.get(openId) : undefined
  const granules = [...coilByRun.values()].reduce((s, c) => s + Number(c.granules_used), 0)

  return (
    <>
      <div className="col w-sm">
        <span className="label">Production</span>
        <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
          {!plant
            ? 'Every run at both companies, coating shifts and fabrication alike.'
            : coating
              ? 'GI wire and PVC granules to coated wire, recorded coil by coil.'
              : 'GI wire to DT mesh rolls to gabion boxes.'}
        </p>
        <Result label="Runs in period" value={runs.length} />
        {byOutput.slice(0, 4).map(([code, v]) => (
          <Result key={code} label={code} value={fmtQty(v.qty) + ' ' + v.unit} sub={v.runs + ' runs'} flat />
        ))}
        {coilByRun.size > 0 && (
          <Result label="Granules derived" value={fmtNum(granules, 1) + ' kg'} sub="from the coil weights" flat />
        )}
        <Field label="Period">
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </Field>
        {canEnter && (
          <button type="button" className={'btn' + (showNew ? '' : ' btn-primary')} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : coating ? 'Record shift' : 'Record run'}
          </button>
        )}
        {!plant && <NeedPlant what="record production" />}
      </div>

      <div className="col fill flush">
        {loading ? <Spinner /> : error ? <div style={{ padding: 8 }}><ErrorBox error={error} onRetry={refresh} /></div> : runs.length === 0 ? (
          <Empty>No production recorded in this period.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  {scope === 'group' && <th>Unit</th>}
                  <th className="n">Date</th>
                  <th>Shift</th>
                  <th>Made</th>
                  <th className="n">Qty</th>
                  <th>From</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const coil = coilByRun.get(r.id)
                  return (
                    <tr
                      key={r.id}
                      onClick={() => coil && setOpenId(openId === r.id ? null : r.id)}
                      style={{
                        cursor: coil ? 'pointer' : undefined,
                        background: openId === r.id ? 'var(--accent-bg)' : undefined,
                      }}
                    >
                      {scope === 'group' && <td><PlantTag code={byId(r.plant_id)?.code} /></td>}
                      <td className="n">{fmtDate(r.prod_date)}</td>
                      <td className="mono faint">{coil?.shift_label ?? r.shift}</td>
                      <td className="mono">{r.ff_materials?.code}</td>
                      <td className="n">{fmtQty(r.output_qty)} {r.ff_materials?.unit}</td>
                      <td className="muted" style={{ fontSize: 'var(--text-caption)' }}>
                        {(r.ff_production_inputs ?? [])
                          .map((i) => fmtQty(i.qty) + ' ' + i.ff_materials?.unit + ' ' + i.ff_materials?.code)
                          .join(' + ')}
                      </td>
                      <td>
                        {coil && <Badge>{coil.coils} coils · {Number(coil.pickup_pct).toFixed(2)}%</Badge>}
                        {coil && Number(coil.power_cuts) > 0 && (
                          <span className="badge is-warn" style={{ marginLeft: 4 }}>{coil.power_cuts} cuts</span>
                        )}
                        {coil && (Number(coil.gi_out_of_tol) + Number(coil.pvc_out_of_tol)) > 0 && (
                          <span className="badge is-fail" style={{ marginLeft: 4 }}>
                            {Number(coil.gi_out_of_tol) + Number(coil.pvc_out_of_tol)} out of tol
                          </span>
                        )}
                        {r.ff_orders?.order_no && <span className="mono faint" style={{ marginLeft: 4 }}>{r.ff_orders.order_no}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="col w-md">
        {showNew && plant && data ? (
          <Section title={(coating ? 'Coating shift · ' : 'Production run · ') + plant.short_name}>
            {coating
              ? <CoilEntryGrid plantId={plant.id} stock={data.stock} onDone={refresh} />
              : <RunForm plantId={plant.id} stock={data.stock} orders={data.orders} onDone={refresh} />}
          </Section>
        ) : selected ? (
          <Section title={'Coils · ' + fmtDate(selected.log_date) + ' · ' + (selected.shift_label ?? selected.shift)} flush>
            <CoilDetail log={selected} />
          </Section>
        ) : (
          <Empty>Select a coating shift to see every coil.</Empty>
        )}
      </div>
    </>
  )
}
