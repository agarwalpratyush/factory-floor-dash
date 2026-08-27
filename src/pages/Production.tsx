import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey } from '../lib/plant'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NeedPlant, PlantTag, Spinner, Stat,
} from '../components/ui'
import { daysAgo, fmtDate, fmtQty, today } from '../lib/format'
import { SHIFTS } from '../lib/types'
import type { Order, Production as Prod, StockLevel } from '../lib/types'

interface InputRow { material_id: string; qty: string }

async function loadPage(scope: number | 'group', from: string) {
  let q = supabase
    .from('ff_production')
    .select('*, ff_materials!ff_production_output_material_id_fkey(code,name,unit), ff_orders(order_no), ff_production_inputs(id,material_id,qty,ff_materials(code,name,unit))')
    .gte('prod_date', from)
    .order('prod_date', { ascending: false })
    .order('id', { ascending: false })
  if (scope !== 'group') q = q.eq('plant_id', scope)

  let sq = supabase.from('ff_stock_levels').select('*').eq('active', true)
  if (scope !== 'group') sq = sq.eq('plant_id', scope)

  let oq = supabase.from('ff_orders').select('id,order_no,customer').neq('stage', 'delivered').order('order_no')
  if (scope !== 'group') oq = oq.eq('plant_id', scope)

  const [prod, stock, orders] = await Promise.all([q, sq, oq])
  const failed = [prod, stock, orders].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  return {
    runs: (prod.data ?? []) as Prod[],
    stock: (stock.data ?? []) as StockLevel[],
    orders: (orders.data ?? []) as Pick<Order, 'id' | 'order_no' | 'customer'>[],
  }
}

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

  const outputs = stock.filter((s) => s.category === 'finished' || s.category === 'raw')
  const outMat = stock.find((s) => String(s.material_id) === f.output_material_id)

  function setInput(i: number, patch: Partial<InputRow>) {
    setInputs((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const used = inputs.filter((r) => r.material_id && Number(r.qty) > 0)
    if (used.length === 0) { setErr('Add at least one input material.'); return }

    setBusy(true)
    setErr(null)
    setOk(null)
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
    setOk('Run PRD-' + data + ' posted. Output added to stock, inputs consumed.')
    setF({ ...f, output_qty: '', remarks: '' })
    setInputs([{ material_id: '', qty: '' }])
    onDone()
  }

  /** Warn, don't block — back-dated entries legitimately go below today's balance. */
  function shortfall(row: InputRow) {
    const s = stock.find((x) => String(x.material_id) === row.material_id)
    if (!s || !row.qty) return null
    const short = Number(row.qty) - Number(s.balance)
    return short > 0 ? { short, unit: s.unit, have: Number(s.balance) } : null
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <input type="date" value={f.prod_date} onChange={(e) => setF({ ...f, prod_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Shift">
          <select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} className={inputCls}>
            {SHIFTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Output material *">
          <select required value={f.output_material_id} onChange={(e) => setF({ ...f, output_material_id: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {outputs.map((s) => <option key={s.material_id} value={s.material_id}>{s.code} — {s.name}</option>)}
          </select>
        </Field>
        <Field label={'Output qty *' + (outMat ? ' (' + outMat.unit + ')' : '')}>
          <input required type="number" step="0.001" min="0.001" value={f.output_qty} onChange={(e) => setF({ ...f, output_qty: e.target.value })} className={inputCls} />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Consumed</span>
          <button type="button" onClick={() => setInputs((r) => [...r, { material_id: '', qty: '' }])} className="text-xs font-medium text-blue-600 hover:underline">
            + Add input
          </button>
        </div>
        <div className="space-y-2">
          {inputs.map((row, i) => {
            const warn = shortfall(row)
            return (
              <div key={i}>
                <div className="flex flex-wrap gap-2">
                  <select value={row.material_id} onChange={(e) => setInput(i, { material_id: e.target.value })} className={inputCls + ' flex-1 sm:max-w-sm'}>
                    <option value="">Select material…</option>
                    {stock.map((s) => (
                      <option key={s.material_id} value={s.material_id}>
                        {s.code} — {s.name} ({fmtQty(s.balance)} {s.unit} in stock)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number" step="0.001" min="0" placeholder="Qty"
                    value={row.qty} onChange={(e) => setInput(i, { qty: e.target.value })}
                    className={inputCls + ' w-32'}
                  />
                  {inputs.length > 1 && (
                    <button type="button" onClick={() => setInputs((r) => r.filter((_, n) => n !== i))} className="rounded-lg px-3 text-sm text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">
                      Remove
                    </button>
                  )}
                </div>
                {warn && (
                  <p className="mt-1 text-xs text-amber-700">
                    Only {fmtQty(warn.have)} {warn.unit} on hand — this run puts stock {fmtQty(warn.short)} {warn.unit} negative.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Against order">
          <select value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value })} className={inputCls}>
            <option value="">— none —</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.customer}</option>)}
          </select>
        </Field>
        <Field label="Remarks">
          <input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} className={inputCls} />
        </Field>
      </div>

      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

      <Button type="submit" disabled={busy || !f.output_material_id || !f.output_qty}>
        {busy ? 'Posting…' : 'Post production run'}
      </Button>
    </form>
  )
}

export default function Production() {
  const { scope, plant, byId } = usePlant()
  const [days, setDays] = useState(30)
  const [showNew, setShowNew] = useState(false)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'prod-' + scopeKey(scope) + '-' + days,
  )

  const runs = data?.runs ?? []

  const byOutput = useMemo(() => {
    const m = new Map<string, { qty: number; unit: string; runs: number }>()
    for (const r of runs) {
      const code = r.ff_materials?.code ?? String(r.output_material_id)
      const cur = m.get(code) ?? { qty: 0, unit: r.ff_materials?.unit ?? '', runs: 0 }
      cur.qty += Number(r.output_qty)
      cur.runs += 1
      m.set(code, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].runs - a[1].runs)
  }, [runs])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Production</h1>
          <p className="text-sm text-slate-500">
            {plant?.code === 'SAF'
              ? 'GI wire + PVC granules → PVC coated GI wire.'
              : plant?.code === 'AGI'
                ? 'GI wire → DT mesh rolls → gabion boxes.'
                : 'Runs across both companies.'}
          </p>
        </div>
        {plant && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ Record run'}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'Record a run · ' + plant.short_name}>
          <RunForm plantId={plant.id} stock={data.stock} orders={data.orders} onDone={refresh} />
        </Card>
      )}
      {!plant && <NeedPlant what="record a run" />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Runs in period" value={runs.length} />
        {byOutput.slice(0, 3).map(([code, v]) => (
          <Stat key={code} label={code} value={fmtQty(v.qty) + ' ' + v.unit} sub={v.runs + ' runs'} />
        ))}
      </div>

      <Card
        title="Run log"
        action={
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        }
      >
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : runs.length === 0 ? (
          <Empty>No production recorded in this period.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {runs.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {scope === 'group' && <PlantTag code={byId(r.plant_id)?.code} />}
                      <span className="font-semibold text-slate-900">{r.ff_materials?.code}</span>
                      <span className="text-sm text-slate-600">{r.ff_materials?.name}</span>
                      <Badge tone="green">+{fmtQty(r.output_qty)} {r.ff_materials?.unit}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      from{' '}
                      {(r.ff_production_inputs ?? []).map((i, n) => (
                        <span key={i.id}>
                          {n > 0 && ' + '}
                          <span className="text-slate-700">{fmtQty(i.qty)} {i.ff_materials?.unit} {i.ff_materials?.code}</span>
                        </span>
                      ))}
                      {r.ff_orders?.order_no && <span className="ml-2 text-slate-400">· {r.ff_orders.order_no}</span>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <div>{fmtDate(r.prod_date)}</div>
                    <div>shift {r.shift}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
