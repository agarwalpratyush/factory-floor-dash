import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NeedPlant, PlantTag, Spinner, Stat,
} from '../components/ui'
import { daysAgo, fmtDate, fmtQty, today } from '../lib/format'
import type { Dispatch as Disp, DispatchStatus, Order, StockLevel, Worker } from '../lib/types'

const STATUSES: DispatchStatus[] = ['loaded', 'in_transit', 'delivered', 'returned']

const STATUS_TONE: Record<DispatchStatus, 'amber' | 'blue' | 'green' | 'red'> = {
  loaded: 'amber', in_transit: 'blue', delivered: 'green', returned: 'red',
}

interface ItemRow { material_id: string; qty: string }

async function loadPage(scope: PlantScope, from: string) {
  const plant = scope === 'group' ? null : scope

  let dispQ = supabase
    .from('ff_dispatches')
    .select('*, ff_orders(order_no,customer), ff_dispatch_items(id,material_id,qty,unit,ff_materials(code,name,unit))')
    .gte('dispatch_date', from)
    .order('dispatch_date', { ascending: false })
    .order('id', { ascending: false })
  if (plant !== null) dispQ = dispQ.eq('plant_id', plant)

  let orderQ = supabase.from('ff_orders').select('id,order_no,customer,site').neq('stage', 'delivered').order('order_no')
  if (plant !== null) orderQ = orderQ.eq('plant_id', plant)

  // Only finished goods leave on a lorry to a customer.
  let stockQ = supabase.from('ff_stock_levels').select('*').eq('active', true).eq('role', 'finished').order('code')
  if (plant !== null) stockQ = stockQ.eq('plant_id', plant)

  let driverQ = supabase
    .from('ff_workers')
    .select('id,name,phone,plant_id,designation')
    .eq('active', true)
    .eq('designation', 'Driver')
    .order('name')
  if (plant !== null) driverQ = driverQ.or('plant_id.eq.' + plant + ',plant_id.is.null')

  const [disp, orders, stock, drivers] = await Promise.all([dispQ, orderQ, stockQ, driverQ])
  const failed = [disp, orders, stock, drivers].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return {
    disp: (disp.data ?? []) as Disp[],
    orders: (orders.data ?? []) as Pick<Order, 'id' | 'order_no' | 'customer' | 'site'>[],
    stock: (stock.data ?? []) as StockLevel[],
    drivers: (drivers.data ?? []) as Pick<Worker, 'id' | 'name' | 'phone'>[],
  }
}

function NewDispatchForm({
  plantId, orders, stock, drivers, onDone,
}: {
  plantId: number
  orders: Pick<Order, 'id' | 'order_no' | 'customer' | 'site'>[]
  stock: StockLevel[]
  drivers: Pick<Worker, 'id' | 'name' | 'phone'>[]
  onDone: () => void
}) {
  const [f, setF] = useState({
    dispatch_date: today(), order_id: '', challan_no: '', vehicle_no: '',
    driver_name: '', driver_phone: '', transporter: '', lr_no: '',
    destination: '', remarks: '',
  })
  const [items, setItems] = useState<ItemRow[]>([{ material_id: '', qty: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function pickOrder(id: string) {
    const o = orders.find((x) => String(x.id) === id)
    setF((prev) => ({ ...prev, order_id: id, destination: prev.destination || (o?.site ?? '') }))
  }

  /** Our own driver: fill name and phone rather than retyping them every trip. */
  function pickDriver(id: string) {
    const d = drivers.find((x) => String(x.id) === id)
    if (!d) return
    setF((prev) => ({ ...prev, driver_name: d.name, driver_phone: d.phone ?? prev.driver_phone }))
  }

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }

  /** Warn if the lorry is carrying more than the floor is holding. */
  function shortfall(row: ItemRow) {
    const s = stock.find((x) => String(x.material_id) === row.material_id)
    if (!s || !row.qty) return null
    const short = Number(row.qty) - Number(s.balance)
    return short > 0 ? { short, unit: s.unit, have: Number(s.balance) } : null
  }

  const filled = items.filter((r) => r.material_id && Number(r.qty) > 0)
  const total = filled.reduce((s, r) => s + Number(r.qty), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (filled.length === 0) { setErr('Add at least one item to the challan.'); return }

    setBusy(true)
    setErr(null)
    setOk(null)
    const { data, error } = await supabase.rpc('ff_record_dispatch', {
      p_plant_id: plantId,
      p_items: filled.map((r) => {
        const s = stock.find((x) => String(x.material_id) === r.material_id)
        return { material_id: Number(r.material_id), qty: Number(r.qty), unit: s?.unit ?? 'nos' }
      }),
      p_order_id: f.order_id ? Number(f.order_id) : null,
      p_dispatch_date: f.dispatch_date,
      p_challan_no: f.challan_no.trim() || null,
      p_vehicle_no: f.vehicle_no.trim().toUpperCase() || null,
      p_driver_name: f.driver_name.trim() || null,
      p_driver_phone: f.driver_phone.trim() || null,
      p_transporter: f.transporter.trim() || null,
      p_lr_no: f.lr_no.trim() || null,
      p_destination: f.destination.trim() || null,
      p_remarks: f.remarks.trim() || null,
      p_recorded_by: 'dispatch',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk('Dispatch DIS-' + data + ' recorded. ' + fmtQty(total) + ' taken out of finished stock.')
    setF({ ...f, challan_no: '', vehicle_no: '', lr_no: '', remarks: '' })
    setItems([{ material_id: '', qty: '' }])
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Dispatch date">
          <input type="date" value={f.dispatch_date} onChange={(e) => setF({ ...f, dispatch_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Against order">
          <select value={f.order_id} onChange={(e) => pickOrder(e.target.value)} className={inputCls}>
            <option value="">— none —</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.customer}</option>)}
          </select>
        </Field>
        <Field label="Challan no">
          <input value={f.challan_no} onChange={(e) => setF({ ...f, challan_no: e.target.value })} className={inputCls} placeholder="CH/26/0472" />
        </Field>
        <Field label="LR no">
          <input value={f.lr_no} onChange={(e) => setF({ ...f, lr_no: e.target.value })} className={inputCls} />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">On the challan</span>
          <button type="button" onClick={() => setItems((r) => [...r, { material_id: '', qty: '' }])} className="text-xs font-medium text-blue-600 hover:underline">
            + Add item
          </button>
        </div>
        <div className="space-y-2">
          {items.map((row, i) => {
            const warn = shortfall(row)
            const sel = stock.find((x) => String(x.material_id) === row.material_id)
            return (
              <div key={i}>
                <div className="flex flex-wrap gap-2">
                  <select value={row.material_id} onChange={(e) => setItem(i, { material_id: e.target.value })} className={inputCls + ' flex-1 sm:max-w-sm'}>
                    <option value="">Select finished item…</option>
                    {stock.map((s) => (
                      <option key={s.material_id} value={s.material_id}>
                        {s.code} — {s.name} ({fmtQty(s.balance)} {s.unit} on hand)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number" step="0.001" min="0" placeholder="Qty"
                    value={row.qty} onChange={(e) => setItem(i, { qty: e.target.value })}
                    className={inputCls + ' w-32'}
                  />
                  {sel && <span className="self-center text-sm text-slate-500">{sel.unit}</span>}
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((r) => r.filter((_, n) => n !== i))} className="rounded-lg px-3 text-sm text-slate-500 ring-1 ring-slate-300 hover:bg-slate-50">
                      Remove
                    </button>
                  )}
                </div>
                {warn && (
                  <p className="mt-1 text-xs text-amber-700">
                    Only {fmtQty(warn.have)} {warn.unit} on hand — this dispatch puts stock {fmtQty(warn.short)} {warn.unit} negative.
                  </p>
                )}
              </div>
            )
          })}
        </div>
        {stock.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            This company has no finished goods on its stock list yet. Add them under Stock first.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Vehicle no">
          <input value={f.vehicle_no} onChange={(e) => setF({ ...f, vehicle_no: e.target.value })} className={inputCls} placeholder="WB11C4412" />
        </Field>
        <Field label="Transporter">
          <input value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Driver name">
          <input
            value={f.driver_name}
            onChange={(e) => setF({ ...f, driver_name: e.target.value })}
            className={inputCls}
            placeholder="or pick one of ours"
          />
          {drivers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {drivers.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => pickDriver(String(d.id))}
                  className={
                    'rounded-full px-2 py-0.5 text-xs ring-1 transition ' +
                    (f.driver_name === d.name
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')
                  }
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Driver phone">
          <input value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} className={inputCls} inputMode="tel" />
        </Field>
        <Field label="Destination">
          <input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Remarks">
          <input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} className={inputCls} />
        </Field>
      </div>

      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

      <Button type="submit" disabled={busy || filled.length === 0}>
        {busy ? 'Recording…' : 'Record dispatch' + (total ? ' · ' + fmtQty(total) : '')}
      </Button>
    </form>
  )
}

export default function Dispatch() {
  const { scope, plant, byId } = usePlant()
  const { can } = useAuth()
  const [days, setDays] = useState(30)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'dispatch-' + scopeKey(scope) + '-' + days,
  )
  const [showNew, setShowNew] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | DispatchStatus>('all')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const rows = useMemo(() => {
    let r = data?.disp ?? []
    if (statusFilter !== 'all') r = r.filter((d) => d.status === statusFilter)
    return r
  }, [data, statusFilter])

  const all = data?.disp ?? []
  const inTransit = all.filter((d) => d.status === 'in_transit').length
  const loaded = all.filter((d) => d.status === 'loaded').length
  const delivered = all.filter((d) => d.status === 'delivered').length

  // Rows written before dispatches carried line items never posted a movement.
  const legacy = all.filter((d) => (d.ff_dispatch_items ?? []).length === 0)

  async function setStatus(d: Disp, status: DispatchStatus) {
    setBusyId(d.id)
    setErr(null)
    const { error } = await supabase.rpc('ff_set_dispatch_status', {
      p_dispatch_id: d.id,
      p_status: status,
      p_recorded_by: 'dispatch',
    })
    setBusyId(null)
    if (error) setErr(error.message)
    else refresh()
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dispatch</h1>
          <p className="text-sm text-slate-500">
            Finished goods going out to customers. Each item on the challan comes out of stock;
            a returned load goes back in.
          </p>
        </div>
        {plant && can('ff_manage') && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ New dispatch'}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'Record a dispatch · ' + plant.short_name}>
          <NewDispatchForm
            plantId={plant.id}
            orders={data.orders}
            stock={data.stock}
            drivers={data.drivers}
            onDone={refresh}
          />
        </Card>
      )}
      {!plant && <NeedPlant what="record a dispatch" />}

      {err && <ErrorBox error={err} />}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Loaded, not moved" value={loaded} tone={loaded ? 'warn' : 'neutral'} />
        <Stat label="In transit" value={inTransit} />
        <Stat label="Delivered" value={delivered} tone="good" />
      </div>

      {legacy.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          {legacy.length} older {legacy.length === 1 ? 'dispatch has' : 'dispatches have'} no items
          against {legacy.length === 1 ? 'it' : 'them'}, so {legacy.length === 1 ? 'it' : 'they'} never
          reduced stock. New dispatches do. Those rows are demo data and will go when the
          placeholder records are cleared.
        </p>
      )}

      <Card
        title="Dispatch register"
        action={
          <div className="flex flex-wrap gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | DispatchStatus)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value="all">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>
        }
      >
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : rows.length === 0 ? (
          <Empty>No dispatches in this period.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  {scope === 'group' && <th className="pb-2 font-medium">Unit</th>}
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Order</th>
                  <th className="pb-2 font-medium">Items</th>
                  <th className="pb-2 font-medium">Challan / vehicle</th>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Destination</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => {
                  const lines = d.ff_dispatch_items ?? []
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      {scope === 'group' && <td className="py-2"><PlantTag code={byId(d.plant_id)?.code} /></td>}
                      <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(d.dispatch_date)}</td>
                      <td className="py-2">
                        <div className="font-medium text-slate-900">{d.ff_orders?.order_no ?? '—'}</div>
                        <div className="text-xs text-slate-500">{d.ff_orders?.customer ?? ''}</div>
                      </td>
                      <td className="py-2">
                        {lines.length === 0 ? (
                          <span className="text-xs text-amber-700">
                            {fmtQty(d.qty)} {d.unit} · no items recorded
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            {lines.map((l) => (
                              <div key={l.id} className="text-xs">
                                <span className="font-medium text-slate-800">{fmtQty(l.qty)} {l.unit}</span>
                                <span className="ml-1 text-slate-500">{l.ff_materials?.code}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        <div>{d.challan_no ?? '—'}</div>
                        <div className="tabular-nums text-slate-400">{d.vehicle_no ?? ''}</div>
                      </td>
                      <td className="py-2 text-slate-600">
                        <div>{d.driver_name ?? '—'}</div>
                        {d.driver_phone && (
                          <a href={'tel:' + d.driver_phone} className="text-xs text-blue-600 hover:underline">{d.driver_phone}</a>
                        )}
                      </td>
                      <td className="py-2 text-slate-600">{d.destination ?? '—'}</td>
                      <td className="py-2">
                        {can('ff_manage') ? (
                          <select
                            value={d.status}
                            disabled={busyId === d.id}
                            onChange={(e) => setStatus(d, e.target.value as DispatchStatus)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                        ) : (
                          <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
                        )}
                        {d.status === 'returned' && lines.length > 0 && (
                          <div className="mt-0.5 text-xs text-slate-500">back in stock</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
