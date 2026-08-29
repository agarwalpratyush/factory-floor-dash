import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Alert, Badge, Empty, ErrorBox, Field, NeedPlant, PlantTag, Result, Section, Spinner,
} from '../components/ui'
import { daysAgo, fmtDate, fmtQty, today } from '../lib/format'
import type {
  Dispatch as Load, DispatchStatus, Order, OutwardKind, Plant, StockLevel, Worker,
} from '../lib/types'

/** Statuses a load can be moved to by hand. Arrival is confirmed through Receive. */
const SETTABLE: DispatchStatus[] = ['loaded', 'in_transit', 'delivered', 'returned', 'cancelled']

/** Colour reports state only: closed is a pass, returned or cancelled is a fail. */
const STATUS_STATE: Record<DispatchStatus, 'ok' | 'warn' | 'fail' | 'idle' | undefined> = {
  loaded: 'warn', in_transit: undefined, delivered: 'ok',
  received: 'ok', returned: 'fail', cancelled: 'idle',
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
  const [kind, setKind] = useState<OutwardKind>('customer')
  const [f, setF] = useState({
    to_plant_id: destinations[0] ? String(destinations[0].id) : '',
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

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))

  function chooseKind(k: OutwardKind) {
    setKind(k)
    setItems([{ material_id: '', qty: '' }])
    if (k === 'inter_unit') {
      const dest = destinations.find((p) => String(p.id) === f.to_plant_id) ?? destinations[0]
      setF((prev) => ({ ...prev, order_id: '', destination: dest?.city ?? prev.destination }))
    }
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

    setBusy(true); setErr(null); setOk(null)
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
    setOk(kind === 'inter_unit'
      ? 'Load ' + data + ' sent. It has left ' + plant.short_name + ' and shows in transit until booked in.'
      : 'Dispatch ' + data + ' recorded. ' + fmtQty(total) + ' out of finished stock.')
    setF({ ...f, challan_no: '', vehicle_no: '', lr_no: '', remarks: '' })
    setItems([{ material_id: '', qty: '' }])
    onDone()
  }

  return (
    <form onSubmit={submit} className="stack">
      <Field label="Where is it going">
        <div className="btn-group">
          <button type="button" className={'btn btn-sm' + (kind === 'customer' ? ' is-active' : '')} onClick={() => chooseKind('customer')}>
            To a customer
          </button>
          {destinations.length > 0 && (
            <button type="button" className={'btn btn-sm' + (kind === 'inter_unit' ? ' is-active' : '')} onClick={() => chooseKind('inter_unit')}>
              To {destinations.length === 1 ? destinations[0].short_name : 'our other company'}
            </button>
          )}
        </div>
      </Field>
      <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
        {kind === 'customer'
          ? destinations.length === 0
            ? plant.short_name + ' sends only to customers. It does not supply our other company.'
            : 'Sold and gone. Goods leave finished stock as soon as this is recorded.'
          : 'Leaves ' + plant.short_name + ' now, and lands in the other company only when they confirm it arrived.'}
      </p>

      <div className="grid-2">
        <Field label="Date">
          <input className="input" type="date" value={f.dispatch_date} onChange={(e) => setF({ ...f, dispatch_date: e.target.value })} />
        </Field>
        {kind === 'customer' ? (
          <Field label="Against order">
            <select className="select" value={f.order_id} onChange={(e) => {
              const o = orders.find((x) => String(x.id) === e.target.value)
              setF((prev) => ({ ...prev, order_id: e.target.value, destination: prev.destination || (o?.site ?? '') }))
            }}>
              <option value="">None</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.customer}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Receiving company">
            <select className="select" required value={f.to_plant_id} onChange={(e) => setF({ ...f, to_plant_id: e.target.value })}>
              {destinations.map((p) => <option key={p.id} value={p.id}>{p.short_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Challan no">
          <input className="input mono" value={f.challan_no} onChange={(e) => setF({ ...f, challan_no: e.target.value })} />
        </Field>
        <Field label="LR no">
          <input className="input mono" value={f.lr_no} onChange={(e) => setF({ ...f, lr_no: e.target.value })} />
        </Field>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">On the challan</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setItems((r) => [...r, { material_id: '', qty: '' }])}>
          Add item
        </button>
      </div>
      {items.map((row, i) => {
        const warn = shortfall(row)
        const sel = stock.find((x) => String(x.material_id) === row.material_id)
        return (
          <div key={i} className="stack" style={{ gap: 2 }}>
            <div className="row">
              <select className="select" value={row.material_id} onChange={(e) => setItem(i, { material_id: e.target.value })}>
                <option value="">{kind === 'customer' ? 'Select finished item' : 'Select material'}</option>
                {sendable.map((s) => (
                  <option key={s.material_id} value={s.material_id}>
                    {s.code} — {fmtQty(s.balance)} {s.unit}
                  </option>
                ))}
              </select>
              <input className="input num" style={{ width: 92 }} type="number" step="0.001" min="0" placeholder="Qty"
                value={row.qty} onChange={(e) => setItem(i, { qty: e.target.value })} />
              {sel && <span className="faint">{sel.unit}</span>}
              {items.length > 1 && (
                <button type="button" className="btn btn-sm" onClick={() => setItems((r) => r.filter((_, n) => n !== i))}>
                  Remove
                </button>
              )}
            </div>
            {warn && (
              <span style={{ color: 'var(--warn)', fontSize: 'var(--text-caption)' }}>
                {fmtQty(warn.have)} {warn.unit} on hand. This load takes stock {fmtQty(warn.short)} {warn.unit} below zero.
              </span>
            )}
          </div>
        )
      })}
      {sendable.length === 0 && (
        <Alert state="warn">
          Nothing here to send. {kind === 'customer' ? 'Add finished goods under Stock first.' : 'Stock is empty at this company.'}
        </Alert>
      )}

      <div className="grid-2">
        <Field label="Vehicle no">
          <input className="input mono" value={f.vehicle_no} onChange={(e) => setF({ ...f, vehicle_no: e.target.value })} />
        </Field>
        <Field label="Transporter">
          <input className="input" value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} />
        </Field>
        <Field label="Driver">
          <input className="input" value={f.driver_name} onChange={(e) => setF({ ...f, driver_name: e.target.value })} placeholder="or pick one below" />
        </Field>
        <Field label="Driver phone">
          <input className="input mono" value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} inputMode="tel" />
        </Field>
      </div>
      {drivers.length > 0 && (
        <div className="row wrap">
          {drivers.map((d) => (
            <button
              key={d.id} type="button"
              className={'chip' + (f.driver_name === d.name ? ' is-active' : '')}
              onClick={() => setF((prev) => ({ ...prev, driver_name: d.name, driver_phone: d.phone ?? prev.driver_phone }))}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid-2">
        <Field label="Destination">
          <input className="input" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        </Field>
        <Field label="Remarks">
          <input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>
      </div>

      {err && <Alert state="fail">{err}</Alert>}
      {ok && <Alert state="ok">{ok}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={busy || filled.length === 0}>
        {busy ? 'Recording…' : (kind === 'inter_unit' ? 'Send load' : 'Record dispatch') + (total ? ' · ' + fmtQty(total) : '')}
      </button>
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

  const awaiting = all.filter((d) => d.kind === 'inter_unit' && ['loaded', 'in_transit'].includes(d.status))
  const outOnRoad = all.filter((d) => d.kind === 'customer' && ['loaded', 'in_transit'].includes(d.status))
  const legacy = all.filter((d) => (d.ff_dispatch_items ?? []).length === 0)
  const daysOut = (d: Load) => Math.floor((Date.now() - new Date(d.dispatch_date).getTime()) / 86400000)

  /** Only the receiving company books a load in. */
  function canReceive(d: Load) {
    if (d.kind !== 'inter_unit' || !can('ff_manage')) return false
    if (!['loaded', 'in_transit'].includes(d.status)) return false
    return scope === 'group' || d.to_plant_id === scope
  }

  async function receive(d: Load) {
    setBusyId(d.id); setErr(null)
    const { error } = await supabase.rpc('ff_receive_outward', {
      p_dispatch_id: d.id, p_received: null, p_received_date: null, p_recorded_by: 'store',
    })
    setBusyId(null)
    if (error) setErr(error.message)
    else refresh()
  }

  async function setStatus(d: Load, status: DispatchStatus) {
    setBusyId(d.id); setErr(null)
    const { error } = await supabase.rpc('ff_set_dispatch_status', {
      p_dispatch_id: d.id, p_status: status, p_recorded_by: 'dispatch',
    })
    setBusyId(null)
    if (error) setErr(error.message)
    else refresh()
  }

  return (
    <>
      <div className="col w-sm">
        <span className="label">Dispatch</span>
        <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
          Everything leaving the gate. Each challan line comes out of stock; a load to our other
          company lands there once it is booked in.
        </p>
        <Result
          label="Awaiting receipt"
          value={awaiting.length}
          state={awaiting.some((d) => daysOut(d) > 5) ? 'fail' : awaiting.length ? 'warn' : 'ok'}
          sub={awaiting.length ? 'between our companies' : 'nothing between us'}
        />
        <Result label="Out to customers" value={outOnRoad.length} sub="loaded or in transit" />
        <Result
          label="Closed"
          value={all.filter((d) => ['delivered', 'received'].includes(d.status)).length}
          state="ok"
        />
        <Field label="Kind">
          <select className="select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | OutwardKind)}>
            <option value="all">Everything</option>
            <option value="customer">To customers</option>
            <option value="inter_unit">Between our companies</option>
          </select>
        </Field>
        <Field label="Period">
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={180}>6 months</option>
            <option value={365}>1 year</option>
          </select>
        </Field>
        {plant && can('ff_manage') && (
          <button type="button" className={'btn' + (showNew ? '' : ' btn-primary')} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : 'New load'}
          </button>
        )}
        {!plant && <NeedPlant what="record a load" />}
        {err && <Alert state="fail">{err}</Alert>}
        {legacy.length > 0 && (
          <Alert state="warn">
            {legacy.length} older {legacy.length === 1 ? 'load has' : 'loads have'} no items, so
            {legacy.length === 1 ? ' it' : ' they'} never moved stock. Demo rows, cleared with the
            other placeholder records.
          </Alert>
        )}
      </div>

      <div className="col fill flush">
        {loading ? <Spinner /> : error ? <div style={{ padding: 8 }}><ErrorBox error={error} onRetry={refresh} /></div> : rows.length === 0 ? (
          <Empty>Nothing left the gate in this period.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  {scope === 'group' && <th>Unit</th>}
                  <th className="n">Date</th>
                  <th>Going to</th>
                  <th>Items</th>
                  <th>Challan</th>
                  <th>Vehicle</th>
                  <th>Driver</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const lines = d.ff_dispatch_items ?? []
                  const inter = d.kind === 'inter_unit'
                  return (
                    <tr key={d.id}>
                      {scope === 'group' && <td><PlantTag code={byId(d.plant_id)?.code} /></td>}
                      <td className="n">{fmtDate(d.dispatch_date)}</td>
                      <td>
                        {inter ? (
                          <>
                            <span className="badge is-idle">own</span>{' '}
                            {d.to_plant_id ? byId(d.to_plant_id)?.short_name : '—'}
                          </>
                        ) : (
                          <>
                            <span className="mono">{d.ff_orders?.order_no ?? '—'}</span>
                            <div className="faint" style={{ fontSize: 'var(--text-caption)' }}>
                              {d.ff_orders?.customer ?? d.destination ?? ''}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ fontSize: 'var(--text-caption)' }}>
                        {lines.length === 0
                          ? <span style={{ color: 'var(--warn)' }}>{fmtQty(d.qty)} {d.unit} · no items</span>
                          : lines.map((l) => (
                            <div key={l.id}>
                              <span className="num" style={{ display: 'inline-block', minWidth: 54 }}>{fmtQty(l.qty)}</span>{' '}
                              <span className="mono">{l.ff_materials?.code}</span>
                            </div>
                          ))}
                      </td>
                      <td className="mono faint">{d.challan_no ?? '—'}</td>
                      <td className="mono faint">{d.vehicle_no ?? '—'}</td>
                      <td style={{ fontSize: 'var(--text-caption)' }}>
                        {d.driver_name ?? '—'}
                        {d.driver_phone && <div className="mono faint">{d.driver_phone}</div>}
                      </td>
                      <td>
                        {canReceive(d) ? (
                          <button type="button" className="btn btn-sm btn-primary" disabled={busyId === d.id} onClick={() => receive(d)}>
                            {busyId === d.id ? 'Booking…' : 'Receive'}
                          </button>
                        ) : d.status === 'received' ? (
                          <>
                            <Badge state="ok">received</Badge>
                            {d.received_date && <div className="faint" style={{ fontSize: 'var(--text-caption)' }}>{fmtDate(d.received_date)}</div>}
                          </>
                        ) : can('ff_manage') ? (
                          <select
                            className="select" style={{ width: 110 }}
                            value={d.status} disabled={busyId === d.id}
                            onChange={(e) => setStatus(d, e.target.value as DispatchStatus)}
                          >
                            {SETTABLE.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                        ) : (
                          <Badge state={STATUS_STATE[d.status]}>{d.status.replace('_', ' ')}</Badge>
                        )}
                        {inter && ['loaded', 'in_transit'].includes(d.status) && (
                          <div className="faint" style={{ fontSize: 'var(--text-caption)' }}>{daysOut(d)}d out</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && plant && data && (
        <div className="col w-md">
          <Section title={'New load out of ' + plant.short_name}>
            <OutwardForm
              plant={plant}
              destinations={sendableTo(plant.id)}
              orders={data.orders}
              stock={data.stock}
              drivers={data.drivers}
              onDone={refresh}
            />
          </Section>
        </div>
      )}
    </>
  )
}
