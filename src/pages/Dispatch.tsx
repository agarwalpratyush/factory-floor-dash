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
import type {
  Dispatch as Load, DispatchStatus, Order, OutwardKind, Plant, StockLevel, Worker,
} from '../lib/types'

/** Statuses a load can be moved to by hand. Arrival is confirmed through Receive. */
const SETTABLE: DispatchStatus[] = ['loaded', 'in_transit', 'delivered', 'returned', 'cancelled']

const STATUS_TONE: Record<DispatchStatus, 'amber' | 'blue' | 'green' | 'red' | 'slate'> = {
  loaded: 'amber', in_transit: 'blue', delivered: 'green',
  received: 'green', returned: 'red', cancelled: 'slate',
}

interface ItemRow { material_id: string; qty: string }

async function loadPage(scope: PlantScope, from: string) {
  const plant = scope === 'group' ? null : scope

  // A load is visible from either end: the company that sent it and the one receiving.
  let loadQ = supabase
    .from('ff_dispatches')
    .select('*, ff_orders(order_no,customer), ff_dispatch_items(id,material_id,qty,unit,ff_materials(code,name,unit))')
    .gte('dispatch_date', from)
    .order('dispatch_date', { ascending: false })
    .order('id', { ascending: false })
  if (plant !== null) loadQ = loadQ.or('plant_id.eq.' + plant + ',to_plant_id.eq.' + plant)

  let orderQ = supabase.from('ff_orders').select('id,order_no,customer,site').neq('stage', 'delivered').order('order_no')
  if (plant !== null) orderQ = orderQ.eq('plant_id', plant)

  // Anything this company holds can go to our other company; only finished goods
  // go to a customer.
  let stockQ = supabase.from('ff_stock_levels').select('*').eq('active', true).order('code')
  if (plant !== null) stockQ = stockQ.eq('plant_id', plant)

  let driverQ = supabase
    .from('ff_workers').select('id,name,phone,plant_id,designation')
    .eq('active', true).eq('designation', 'Driver').order('name')
  if (plant !== null) driverQ = driverQ.or('plant_id.eq.' + plant + ',plant_id.is.null')

  const [loads, orders, stock, drivers] = await Promise.all([loadQ, orderQ, stockQ, driverQ])
  const failed = [loads, orders, stock, drivers].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return {
    loads: (loads.data ?? []) as Load[],
    orders: (orders.data ?? []) as Pick<Order, 'id' | 'order_no' | 'customer' | 'site'>[],
    stock: (stock.data ?? []) as StockLevel[],
    drivers: (drivers.data ?? []) as Pick<Worker, 'id' | 'name' | 'phone'>[],
  }
}

function OutwardForm({
  plant, destinations, orders, stock, drivers, onDone,
}: {
  plant: Plant
  /** Only companies this one actually supplies. Supply runs one way. */
  destinations: Plant[]
  orders: Pick<Order, 'id' | 'order_no' | 'customer' | 'site'>[]
  stock: StockLevel[]
  drivers: Pick<Worker, 'id' | 'name' | 'phone'>[]
  onDone: () => void
}) {
  const others = destinations
  const [kind, setKind] = useState<OutwardKind>('customer')
  const [f, setF] = useState({
    to_plant_id: others[0] ? String(others[0].id) : '',
    dispatch_date: today(), order_id: '', challan_no: '', vehicle_no: '',
    driver_name: '', driver_phone: '', transporter: '', lr_no: '',
    destination: '', remarks: '',
  })
  const [items, setItems] = useState<ItemRow[]>([{ material_id: '', qty: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // A customer only ever receives finished goods; our other company can take anything.
  const sendable = kind === 'customer'
    ? stock.filter((s) => s.role === 'finished')
    : stock.filter((s) => Number(s.balance) > 0)

  function pickOrder(id: string) {
    const o = orders.find((x) => String(x.id) === id)
    setF((prev) => ({ ...prev, order_id: id, destination: prev.destination || (o?.site ?? '') }))
  }

  function pickDriver(id: string) {
    const d = drivers.find((x) => String(x.id) === id)
    if (!d) return
    setF((prev) => ({ ...prev, driver_name: d.name, driver_phone: d.phone ?? prev.driver_phone }))
  }

  function chooseKind(k: OutwardKind) {
    setKind(k)
    setItems([{ material_id: '', qty: '' }])
    if (k === 'inter_unit') {
      const dest = others.find((p) => String(p.id) === f.to_plant_id) ?? others[0]
      setF((prev) => ({ ...prev, order_id: '', destination: dest?.city ?? prev.destination }))
    }
  }

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }

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
    const { data, error } = await supabase.rpc('ff_record_outward', {
      p_plant_id: plant.id,
      p_items: filled.map((r) => {
        const s = stock.find((x) => String(x.material_id) === r.material_id)
        return { material_id: Number(r.material_id), qty: Number(r.qty), unit: s?.unit ?? 'nos' }
      }),
      p_kind: kind,
      p_to_plant_id: kind === 'inter_unit' ? Number(f.to_plant_id) : null,
      p_order_id: kind === 'customer' && f.order_id ? Number(f.order_id) : null,
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
    setOk(
      kind === 'inter_unit'
        ? 'Load OUT-' + data + ' sent. It has left ' + plant.short_name +
          ' and shows as in transit until the other company books it in.'
        : 'Dispatch OUT-' + data + ' recorded. ' + fmtQty(total) + ' taken out of finished stock.',
    )
    setF({ ...f, challan_no: '', vehicle_no: '', lr_no: '', remarks: '' })
    setItems([{ material_id: '', qty: '' }])
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-slate-600">Where is it going?</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          <button type="button" onClick={() => chooseKind('customer')}
            className={'rounded-md px-4 py-2 text-sm font-medium transition ' + (kind === 'customer' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>
            To a customer
          </button>
          {others.length > 0 && (
            <button type="button" onClick={() => chooseKind('inter_unit')}
              className={'rounded-md px-4 py-2 text-sm font-medium transition ' + (kind === 'inter_unit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>
              To {others.length === 1 ? others[0].short_name : 'our other company'}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {kind === 'customer'
            ? others.length === 0
              ? plant.short_name + ' sends only to customers — it does not supply our other company.'
              : 'Sold and gone. The goods come out of finished stock as soon as you record it.'
            : 'Leaves ' + plant.short_name + ' now, and only lands in the other company’s stock once they confirm it arrived.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <input type="date" value={f.dispatch_date} onChange={(e) => setF({ ...f, dispatch_date: e.target.value })} className={inputCls} />
        </Field>
        {kind === 'customer' ? (
          <Field label="Against order">
            <select value={f.order_id} onChange={(e) => pickOrder(e.target.value)} className={inputCls}>
              <option value="">— none —</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.customer}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Receiving company *">
            <select required value={f.to_plant_id} onChange={(e) => setF({ ...f, to_plant_id: e.target.value })} className={inputCls}>
              {others.map((p) => <option key={p.id} value={p.id}>{p.short_name} — {p.city}</option>)}
            </select>
          </Field>
        )}
        <Field label="Challan no">
          <input value={f.challan_no} onChange={(e) => setF({ ...f, challan_no: e.target.value })} className={inputCls} placeholder={kind === 'customer' ? 'CH/26/0472' : 'STN/26/0092'} />
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
                    <option value="">{kind === 'customer' ? 'Select finished item…' : 'Select material…'}</option>
                    {sendable.map((s) => (
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
                    Only {fmtQty(warn.have)} {warn.unit} on hand — this load puts stock {fmtQty(warn.short)} {warn.unit} negative.
                  </p>
                )}
              </div>
            )
          })}
        </div>
        {sendable.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            Nothing here to send. {kind === 'customer' ? 'Add finished goods under Stock first.' : 'Stock is empty at this company.'}
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
          <input value={f.driver_name} onChange={(e) => setF({ ...f, driver_name: e.target.value })} className={inputCls} placeholder="or pick one of ours" />
          {drivers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {drivers.map((d) => (
                <button key={d.id} type="button" onClick={() => pickDriver(String(d.id))}
                  className={
                    'rounded-full px-2 py-0.5 text-xs ring-1 transition ' +
                    (f.driver_name === d.name
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')
                  }>
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
        {busy ? 'Recording…' : (kind === 'inter_unit' ? 'Send load' : 'Record dispatch') + (total ? ' · ' + fmtQty(total) : '')}
      </Button>
    </form>
  )
}

export default function Dispatch() {
  const { scope, plant, byId, sendableTo } = usePlant()
  const { can } = useAuth()
  const [days, setDays] = useState(60)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'dispatch-' + scopeKey(scope) + '-' + days,
  )
  const [showNew, setShowNew] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | OutwardKind>('all')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const all = data?.loads ?? []
  const rows = useMemo(
    () => (kindFilter === 'all' ? all : all.filter((d) => d.kind === kindFilter)),
    [all, kindFilter],
  )

  // Waiting for someone at the receiving end to say it arrived.
  const awaiting = all.filter((d) => d.kind === 'inter_unit' && ['loaded', 'in_transit'].includes(d.status))
  const outOnRoad = all.filter((d) => d.kind === 'customer' && ['loaded', 'in_transit'].includes(d.status))
  const legacy = all.filter((d) => (d.ff_dispatch_items ?? []).length === 0)

  /** Only the receiving company books a load in. */
  function canReceive(d: Load) {
    if (d.kind !== 'inter_unit' || !can('ff_manage')) return false
    return scope === 'group' || d.to_plant_id === scope
  }

  async function receive(d: Load) {
    setBusyId(d.id)
    setErr(null)
    const { error } = await supabase.rpc('ff_receive_outward', {
      p_dispatch_id: d.id, p_received: null, p_received_date: null, p_recorded_by: 'store',
    })
    setBusyId(null)
    if (error) setErr(error.message)
    else refresh()
  }

  async function setStatus(d: Load, status: DispatchStatus) {
    setBusyId(d.id)
    setErr(null)
    const { error } = await supabase.rpc('ff_set_dispatch_status', {
      p_dispatch_id: d.id, p_status: status, p_recorded_by: 'dispatch',
    })
    setBusyId(null)
    if (error) setErr(error.message)
    else refresh()
  }

  const daysOut = (d: Load) => Math.floor((Date.now() - new Date(d.dispatch_date).getTime()) / 86400000)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dispatch</h1>
          <p className="text-sm text-slate-500">
            Everything leaving the gate, to a customer or to our other company. Each item on the
            challan comes out of stock; a load to our other company lands there once it is booked in.
          </p>
        </div>
        {plant && can('ff_manage') && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ New load'}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'New load out of ' + plant.short_name}>
          <OutwardForm
            plant={plant}
            destinations={sendableTo(plant.id)}
            orders={data.orders}
            stock={data.stock}
            drivers={data.drivers}
            onDone={refresh}
          />
        </Card>
      )}
      {!plant && <NeedPlant what="record a load" />}

      {err && <ErrorBox error={err} />}

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Awaiting receipt"
          value={awaiting.length}
          sub={awaiting.length ? 'between our companies' : 'nothing between us'}
          tone={awaiting.some((d) => daysOut(d) > 5) ? 'bad' : awaiting.length ? 'warn' : 'good'}
        />
        <Stat label="Out to customers" value={outOnRoad.length} sub="loaded or in transit" />
        <Stat
          label="Closed"
          value={all.filter((d) => ['delivered', 'received'].includes(d.status)).length}
          tone="good"
        />
      </div>

      {awaiting.length > 0 && (
        <Card title="Between our companies — awaiting receipt">
          <ul className="divide-y divide-slate-100">
            {awaiting.map((d) => {
              const lines = d.ff_dispatch_items ?? []
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">
                        {byId(d.plant_id)?.short_name} → {d.to_plant_id ? byId(d.to_plant_id)?.short_name : '—'}
                      </span>
                      <Badge tone={daysOut(d) > 5 ? 'red' : 'amber'}>{daysOut(d)}d out</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {lines.map((l) => fmtQty(l.qty) + ' ' + l.unit + ' ' + (l.ff_materials?.code ?? '')).join(' · ') || 'no items'}
                      {' · '}{d.challan_no ?? 'no challan'}{' · '}{d.vehicle_no ?? 'no vehicle'}
                    </p>
                  </div>
                  {canReceive(d) ? (
                    <Button onClick={() => receive(d)} disabled={busyId === d.id}>
                      {busyId === d.id ? 'Booking in…' : 'Receive'}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {d.to_plant_id ? byId(d.to_plant_id)?.short_name + ' books this in' : ''}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {legacy.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          {legacy.length} older {legacy.length === 1 ? 'load has' : 'loads have'} no items recorded,
          so {legacy.length === 1 ? 'it' : 'they'} never moved stock. Those rows are demo data and
          will go when the placeholder records are cleared.
        </p>
      )}

      <Card
        title="Gate register"
        action={
          <div className="flex flex-wrap gap-2">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | OutwardKind)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value="all">Everything</option>
              <option value="customer">To customers</option>
              <option value="inter_unit">Between our companies</option>
            </select>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last year</option>
            </select>
          </div>
        }
      >
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : rows.length === 0 ? (
          <Empty>Nothing left the gate in this period.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Going to</th>
                  <th className="pb-2 font-medium">Items</th>
                  <th className="pb-2 font-medium">Challan / vehicle</th>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => {
                  const lines = d.ff_dispatch_items ?? []
                  const inter = d.kind === 'inter_unit'
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="py-2 whitespace-nowrap text-slate-600">
                        {fmtDate(d.dispatch_date)}
                        {scope === 'group' && (
                          <div className="mt-0.5"><PlantTag code={byId(d.plant_id)?.code} /></div>
                        )}
                      </td>
                      <td className="py-2">
                        {inter ? (
                          <>
                            <Badge tone="violet">our company</Badge>
                            <div className="mt-0.5 text-xs text-slate-700">
                              {d.to_plant_id ? byId(d.to_plant_id)?.short_name : '—'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-slate-900">{d.ff_orders?.order_no ?? 'no order'}</div>
                            <div className="text-xs text-slate-500">{d.ff_orders?.customer ?? d.destination ?? ''}</div>
                          </>
                        )}
                      </td>
                      <td className="py-2">
                        {lines.length === 0 ? (
                          <span className="text-xs text-amber-700">{fmtQty(d.qty)} {d.unit} · no items recorded</span>
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
                        <div className="text-xs">{d.driver_name ?? '—'}</div>
                        {d.driver_phone && (
                          <a href={'tel:' + d.driver_phone} className="text-xs text-blue-600 hover:underline">{d.driver_phone}</a>
                        )}
                      </td>
                      <td className="py-2">
                        {d.status === 'received' ? (
                          <>
                            <Badge tone="green">received</Badge>
                            {d.received_date && <div className="mt-0.5 text-xs text-slate-500">{fmtDate(d.received_date)}</div>}
                          </>
                        ) : canReceive(d) ? (
                          <Button onClick={() => receive(d)} disabled={busyId === d.id}>
                            {busyId === d.id ? 'Booking in…' : 'Receive'}
                          </Button>
                        ) : can('ff_manage') ? (
                          <select
                            value={d.status}
                            disabled={busyId === d.id}
                            onChange={(e) => setStatus(d, e.target.value as DispatchStatus)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            {SETTABLE.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                        ) : (
                          <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
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
