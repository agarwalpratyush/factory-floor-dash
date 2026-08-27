import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey } from '../lib/plant'
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Spinner, Stat } from '../components/ui'
import { daysAgo, fmtDate, fmtQty, today } from '../lib/format'
import type { StockLevel, Transfer, TransferStatus } from '../lib/types'

async function loadPage(from: string) {
  // Transfers are inherently two-plant, so this view is never scoped to one unit.
  const [tf, stock] = await Promise.all([
    supabase
      .from('ff_transfers')
      .select('*, ff_materials(code,name,unit)')
      .gte('transfer_date', from)
      .order('transfer_date', { ascending: false })
      .order('id', { ascending: false }),
    supabase.from('ff_stock_levels').select('*').eq('active', true),
  ])
  const failed = [tf, stock].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return { transfers: (tf.data ?? []) as Transfer[], stock: (stock.data ?? []) as StockLevel[] }
}

function NewTransferForm({
  fromPlantId, stock, plants, onDone,
}: {
  fromPlantId: number
  stock: StockLevel[]
  plants: { id: number; short_name: string; city: string | null }[]
  onDone: () => void
}) {
  const others = plants.filter((p) => p.id !== fromPlantId)
  const [f, setF] = useState({
    to_plant_id: others[0] ? String(others[0].id) : '',
    material_id: '', qty: '', transfer_date: today(),
    challan_no: '', vehicle_no: '', transporter: '', remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const available = stock.filter((s) => s.plant_id === fromPlantId && Number(s.balance) > 0)
  const sel = available.find((s) => String(s.material_id) === f.material_id)
  const short = sel && f.qty ? Number(f.qty) - Number(sel.balance) : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setOk(null)
    const { data, error } = await supabase.rpc('ff_record_transfer', {
      p_from_plant_id: fromPlantId,
      p_to_plant_id: Number(f.to_plant_id),
      p_material_id: Number(f.material_id),
      p_qty: Number(f.qty),
      p_transfer_date: f.transfer_date,
      p_challan_no: f.challan_no.trim() || null,
      p_vehicle_no: f.vehicle_no.trim().toUpperCase() || null,
      p_transporter: f.transporter.trim() || null,
      p_remarks: f.remarks.trim() || null,
      p_recorded_by: 'dispatch',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk('Transfer TRF-' + data + ' dispatched. Stock has left this unit and shows as in transit until the other unit confirms receipt.')
    setF({ ...f, material_id: '', qty: '', challan_no: '', vehicle_no: '', remarks: '' })
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Dispatch date">
          <input type="date" value={f.transfer_date} onChange={(e) => setF({ ...f, transfer_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="To unit *">
          <select required value={f.to_plant_id} onChange={(e) => setF({ ...f, to_plant_id: e.target.value })} className={inputCls}>
            {others.map((p) => <option key={p.id} value={p.id}>{p.short_name} — {p.city}</option>)}
          </select>
        </Field>
        <Field label="Material *">
          <select required value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {available.map((s) => (
              <option key={s.material_id} value={s.material_id}>
                {s.code} — {s.name} ({fmtQty(s.balance)} {s.unit})
              </option>
            ))}
          </select>
        </Field>
        <Field label={'Quantity *' + (sel ? ' (' + sel.unit + ')' : '')}>
          <input required type="number" step="0.001" min="0.001" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Challan no">
          <input value={f.challan_no} onChange={(e) => setF({ ...f, challan_no: e.target.value })} className={inputCls} placeholder="STN/26/0092" />
        </Field>
        <Field label="Vehicle no">
          <input value={f.vehicle_no} onChange={(e) => setF({ ...f, vehicle_no: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Transporter">
          <input value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Remarks">
          <input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} className={inputCls} />
        </Field>
      </div>

      {short > 0 && sel && (
        <p className="text-xs text-amber-700">
          Only {fmtQty(sel.balance)} {sel.unit} on hand — this sends stock {fmtQty(short)} {sel.unit} negative.
        </p>
      )}
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

      <Button type="submit" disabled={busy || !f.material_id || !f.qty || !f.to_plant_id}>
        {busy ? 'Dispatching…' : 'Dispatch transfer'}
      </Button>
    </form>
  )
}

function ReceiveBox({ transfer, onDone }: { transfer: Transfer; onDone: () => void }) {
  const [qty, setQty] = useState(String(Number(transfer.qty)))
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function receive() {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('ff_receive_transfer', {
      p_transfer_id: transfer.id,
      p_qty_received: Number(qty),
      p_received_date: date,
      p_recorded_by: 'store',
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  const shortRecv = Number(transfer.qty) - Number(qty)

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-blue-50 p-3 ring-1 ring-blue-200">
      <Field label="Qty received">
        <input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls + ' w-32'} />
      </Field>
      <Field label="Received on">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + ' w-40'} />
      </Field>
      <Button onClick={receive} disabled={busy}>{busy ? 'Booking…' : 'Confirm receipt'}</Button>
      {shortRecv > 0 && (
        <p className="w-full text-xs text-amber-700">
          Short by {fmtQty(shortRecv)} {transfer.ff_materials?.unit} against the challan — the gap stays on record.
        </p>
      )}
      {err && <p className="w-full text-xs text-red-700">{err}</p>}
    </div>
  )
}

export default function Transfers() {
  const { plants, plant, scope } = usePlant()
  const [days, setDays] = useState(60)
  const [showNew, setShowNew] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | TransferStatus>('all')
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(daysAgo(days)),
    'transfers-' + days + '-' + scopeKey(scope),
  )

  const all = data?.transfers ?? []
  const rows = useMemo(
    () => (filter === 'all' ? all : all.filter((t) => t.status === filter)),
    [all, filter],
  )

  const inTransit = all.filter((t) => t.status === 'dispatched')
  const nameOf = (id: number) => plants.find((p) => p.id === id)?.short_name ?? '—'

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Inter-unit Transfers</h1>
          <p className="text-sm text-slate-500">
            Saffron's coated wire moving to Agarwal. Stock leaves on dispatch and only arrives when the receiving unit confirms.
          </p>
        </div>
        {plant && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ Send from ' + plant.short_name}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'Dispatch from ' + plant.short_name}>
          <NewTransferForm fromPlantId={plant.id} stock={data.stock} plants={plants} onDone={refresh} />
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="On the road"
          value={inTransit.length}
          sub={inTransit.length ? 'awaiting receipt' : 'nothing in transit'}
          tone={inTransit.some((t) => (Date.now() - new Date(t.transfer_date).getTime()) / 86400000 > 5) ? 'bad' : inTransit.length ? 'warn' : 'good'}
        />
        <Stat label="Received" value={all.filter((t) => t.status === 'received').length} tone="good" />
        <Stat label="Total movements" value={all.length} />
      </div>

      {inTransit.length > 0 && (
        <Card title="Awaiting receipt">
          <ul className="divide-y divide-slate-100">
            {inTransit.map((t) => {
              const daysOut = Math.floor((Date.now() - new Date(t.transfer_date).getTime()) / 86400000)
              return (
                <li key={t.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900">{t.ff_materials?.code}</span>
                      <span className="ml-2 text-sm text-slate-600">{fmtQty(t.qty)} {t.ff_materials?.unit}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {nameOf(t.from_plant_id)} → {nameOf(t.to_plant_id)} · {t.vehicle_no ?? 'no vehicle'} · {t.challan_no ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={daysOut > 5 ? 'red' : 'amber'}>{daysOut}d out</Badge>
                      <Button variant="ghost" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                        {openId === t.id ? 'Close' : 'Receive'}
                      </Button>
                    </div>
                  </div>
                  {openId === t.id && (
                    <ReceiveBox transfer={t} onDone={() => { setOpenId(null); refresh() }} />
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Card
        title="Transfer register"
        action={
          <div className="flex flex-wrap gap-2">
            <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | TransferStatus)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value="all">All</option>
              <option value="dispatched">In transit</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={180}>Last 6 months</option>
            </select>
          </div>
        }
      >
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : rows.length === 0 ? (
          <Empty>No transfers in this period.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="pb-2 font-medium">Sent</th>
                  <th className="pb-2 font-medium">Route</th>
                  <th className="pb-2 font-medium">Material</th>
                  <th className="pb-2 text-right font-medium">Sent qty</th>
                  <th className="pb-2 text-right font-medium">Received</th>
                  <th className="pb-2 font-medium">Challan / vehicle</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) => {
                  const gap = t.qty_received === null ? 0 : Number(t.qty) - Number(t.qty_received)
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(t.transfer_date)}</td>
                      <td className="py-2 whitespace-nowrap text-slate-700">
                        {nameOf(t.from_plant_id)} <span className="text-slate-400">→</span> {nameOf(t.to_plant_id)}
                      </td>
                      <td className="py-2">
                        <div className="font-medium text-slate-900">{t.ff_materials?.code}</div>
                        <div className="text-xs text-slate-500">{t.ff_materials?.name}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-900">{fmtQty(t.qty)} {t.ff_materials?.unit}</td>
                      <td className="py-2 text-right tabular-nums">
                        {t.qty_received === null ? <span className="text-slate-400">—</span> : (
                          <span className={gap > 0 ? 'font-semibold text-amber-600' : 'text-slate-900'}>
                            {fmtQty(t.qty_received)}
                            {gap > 0 && <span className="block text-xs font-normal">short {fmtQty(gap)}</span>}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        <div>{t.challan_no ?? '—'}</div>
                        <div className="tabular-nums text-slate-400">{t.vehicle_no ?? ''}</div>
                      </td>
                      <td className="py-2">
                        <Badge tone={t.status === 'received' ? 'green' : t.status === 'dispatched' ? 'amber' : 'red'}>
                          {t.status === 'dispatched' ? 'in transit' : t.status}
                        </Badge>
                        {t.received_date && <div className="mt-0.5 text-xs text-slate-500">{fmtDate(t.received_date)}</div>}
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
