import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, NeedPlant, PlantTag, Spinner, Stat } from '../components/ui'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { daysAgo, fmtDate, fmtQty, today } from '../lib/format'
import type { Dispatch as Disp, DispatchStatus, Order, Worker } from '../lib/types'

const STATUSES: DispatchStatus[] = ['loaded', 'in_transit', 'delivered', 'returned']

const STATUS_TONE: Record<DispatchStatus, 'amber' | 'blue' | 'green' | 'red'> = {
  loaded: 'amber', in_transit: 'blue', delivered: 'green', returned: 'red',
}

async function loadPage(scope: PlantScope, from: string) {
  const plant = scope === 'group' ? null : scope

  let dispQ = supabase
    .from('ff_dispatches')
    .select('*, ff_orders(order_no,customer)')
    .gte('dispatch_date', from)
    .order('dispatch_date', { ascending: false })
    .order('id', { ascending: false })
  if (plant !== null) dispQ = dispQ.eq('plant_id', plant)

  let orderQ = supabase.from('ff_orders').select('id,order_no,customer,site').neq('stage', 'delivered').order('order_no')
  if (plant !== null) orderQ = orderQ.eq('plant_id', plant)

  // Own drivers, including group ones - they drive for either company.
  let driverQ = supabase
    .from('ff_workers')
    .select('id,name,phone,plant_id,designation')
    .eq('active', true)
    .eq('designation', 'Driver')
    .order('name')
  if (plant !== null) driverQ = driverQ.or('plant_id.eq.' + plant + ',plant_id.is.null')

  const [disp, orders, drivers] = await Promise.all([dispQ, orderQ, driverQ])
  const failed = [disp, orders, drivers].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return {
    disp: (disp.data ?? []) as Disp[],
    orders: (orders.data ?? []) as Pick<Order, 'id' | 'order_no' | 'customer' | 'site'>[],
    drivers: (drivers.data ?? []) as Pick<Worker, 'id' | 'name' | 'phone' | 'plant_id' | 'designation'>[],
  }
}

function NewDispatchForm({
  plantId, orders, drivers, onDone,
}: {
  plantId: number
  orders: Pick<Order, 'id' | 'order_no' | 'customer' | 'site'>[]
  drivers: Pick<Worker, 'id' | 'name' | 'phone'>[]
  onDone: () => void
}) {
  const [f, setF] = useState({
    dispatch_date: today(), order_id: '', challan_no: '', vehicle_no: '',
    driver_name: '', driver_phone: '', transporter: '', lr_no: '',
    qty: '', unit: 'nos', destination: '', remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setOk(false)
    const { error } = await supabase.from('ff_dispatches').insert({
      plant_id: plantId,
      dispatch_date: f.dispatch_date,
      order_id: f.order_id ? Number(f.order_id) : null,
      challan_no: f.challan_no.trim() || null,
      vehicle_no: f.vehicle_no.trim().toUpperCase() || null,
      driver_name: f.driver_name.trim() || null,
      driver_phone: f.driver_phone.trim() || null,
      transporter: f.transporter.trim() || null,
      lr_no: f.lr_no.trim() || null,
      qty: f.qty ? Number(f.qty) : null,
      unit: f.unit,
      destination: f.destination.trim() || null,
      remarks: f.remarks.trim() || null,
      recorded_by: 'dispatch',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk(true)
    setF({ ...f, challan_no: '', vehicle_no: '', driver_name: '', driver_phone: '', lr_no: '', qty: '', remarks: '' })
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
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
        <Field label="Vehicle no">
          <input value={f.vehicle_no} onChange={(e) => setF({ ...f, vehicle_no: e.target.value })} className={inputCls} placeholder="BR01GK4472" />
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
        <Field label="Quantity">
          <input type="number" step="0.001" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Unit">
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={inputCls}>
            {['nos', 'MT', 'kg', 'roll'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Destination">
          <input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Remarks">
          <input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} className={inputCls} />
        </Field>
      </div>

      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Dispatch recorded.</p>}

      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record dispatch'}</Button>
    </form>
  )
}

export default function Dispatch() {
  const { scope, plant, byId } = usePlant()
  const [days, setDays] = useState(30)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'dispatch-' + scopeKey(scope) + '-' + days,
  )
  const [showNew, setShowNew] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | DispatchStatus>('all')
  const [busyId, setBusyId] = useState<number | null>(null)

  const rows = useMemo(() => {
    let r = data?.disp ?? []
    if (statusFilter !== 'all') r = r.filter((d) => d.status === statusFilter)
    return r
  }, [data, statusFilter])

  const all = data?.disp ?? []
  const inTransit = all.filter((d) => d.status === 'in_transit').length
  const loaded = all.filter((d) => d.status === 'loaded').length
  const delivered = all.filter((d) => d.status === 'delivered').length

  async function setStatus(d: Disp, status: DispatchStatus) {
    setBusyId(d.id)
    const { error } = await supabase.from('ff_dispatches').update({ status }).eq('id', d.id)
    setBusyId(null)
    if (!error) refresh()
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dispatch</h1>
          <p className="text-sm text-slate-500">
            Finished goods going out to customers. Stock moving to the other unit belongs under <strong>Transfers</strong>.
          </p>
        </div>
        {plant && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ New dispatch'}
          </Button>
        )}
      </header>

      {showNew && plant && (
        <Card title={'Record a dispatch - ' + plant.short_name}>
          {loading && !data ? <Spinner /> : data && (
            <NewDispatchForm plantId={plant.id} orders={data.orders} drivers={data.drivers} onDone={refresh} />
          )}
        </Card>
      )}
      {!plant && <NeedPlant what="record a dispatch" />}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Loaded, not moved" value={loaded} tone={loaded ? 'warn' : 'neutral'} />
        <Stat label="In transit" value={inTransit} />
        <Stat label="Delivered" value={delivered} tone="good" />
      </div>

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
                  <th className="pb-2 font-medium">Challan / LR</th>
                  <th className="pb-2 font-medium">Vehicle</th>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Destination</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    {scope === 'group' && <td className="py-2"><PlantTag code={byId(d.plant_id)?.code} /></td>}
                    <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(d.dispatch_date)}</td>
                    <td className="py-2">
                      <div className="font-medium text-slate-900">{d.ff_orders?.order_no ?? '—'}</div>
                      <div className="text-xs text-slate-500">{d.ff_orders?.customer ?? ''}</div>
                    </td>
                    <td className="py-2 text-xs text-slate-600">
                      <div>{d.challan_no ?? '—'}</div>
                      <div className="text-slate-400">{d.lr_no ?? ''}</div>
                    </td>
                    <td className="py-2 tabular-nums text-slate-700">
                      <div>{d.vehicle_no ?? '—'}</div>
                      <div className="text-xs text-slate-500">{d.transporter ?? ''}</div>
                    </td>
                    <td className="py-2 text-slate-600">
                      <div>{d.driver_name ?? '—'}</div>
                      {d.driver_phone && (
                        <a href={'tel:' + d.driver_phone} className="text-xs text-blue-600 hover:underline">{d.driver_phone}</a>
                      )}
                    </td>
                    <td className="py-2 text-slate-600">{d.destination ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums text-slate-900">{fmtQty(d.qty)} {d.unit}</td>
                    <td className="py-2">
                      <select
                        value={d.status}
                        disabled={busyId === d.id}
                        onChange={(e) => setStatus(d, e.target.value as DispatchStatus)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                      <div className="mt-1">
                        <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
