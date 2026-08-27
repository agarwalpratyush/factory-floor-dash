import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, NeedPlant, PlantTag, Spinner, STAGE_TONE } from '../components/ui'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtMoney, fmtQty, today } from '../lib/format'
import { ORDER_STAGES, STAGE_LABEL } from '../lib/types'
import type { OrderItem, OrderProgress, OrderStage } from '../lib/types'

interface StageLogRow {
  id: number
  from_stage: OrderStage | null
  to_stage: OrderStage
  changed_at: string
  note: string | null
}

async function loadOrders(scope: PlantScope) {
  let q = supabase.from('ff_order_progress').select('*').order('due_date', { nullsFirst: false })
  if (scope !== 'group') q = q.eq('plant_id', scope)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as OrderProgress[]
}

async function loadDetail(orderId: number) {
  const [items, log] = await Promise.all([
    supabase.from('ff_order_items').select('*').eq('order_id', orderId).order('id'),
    supabase.from('ff_order_stage_log').select('*').eq('order_id', orderId).order('changed_at', { ascending: false }),
  ])
  if (items.error) throw new Error(items.error.message)
  if (log.error) throw new Error(log.error.message)
  return { items: (items.data ?? []) as OrderItem[], log: (log.data ?? []) as StageLogRow[] }
}

function OrderDetail({ order, onChanged }: { order: OrderProgress; onChanged: () => void }) {
  const { data, loading, error, refresh } = useQuery(() => loadDetail(order.id), 'detail-' + order.id)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const idx = ORDER_STAGES.indexOf(order.stage)
  const nextStage = idx >= 0 && idx < ORDER_STAGES.length - 1 ? ORDER_STAGES[idx + 1] : null

  async function advance(to: OrderStage) {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.from('ff_orders').update({ stage: to }).eq('id', order.id)
    setBusy(false)
    if (error) setMsg(error.message)
    else { onChanged(); refresh() }
  }

  async function setProduced(item: OrderItem, value: number) {
    const { error } = await supabase.from('ff_order_items').update({ qty_produced: value }).eq('id', item.id)
    if (error) setMsg(error.message)
    else { onChanged(); refresh() }
  }

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      {msg && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">Stage</span>
        {ORDER_STAGES.map((s, i) => (
          <span
            key={s}
            className={
              'rounded-full px-2.5 py-1 text-xs font-medium ' +
              (i < idx ? 'bg-green-100 text-green-700'
                : i === idx ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-400 ring-1 ring-slate-200')
            }
          >
            {STAGE_LABEL[s]}
          </span>
        ))}
        {nextStage && order.stage !== 'cancelled' && (
          <Button onClick={() => advance(nextStage)} disabled={busy} className="ml-auto">
            Move to {STAGE_LABEL[nextStage]}
          </Button>
        )}
      </div>

      {loading ? <Spinner label="Loading items…" /> : error ? <ErrorBox error={error} onRetry={refresh} /> : data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Line items</h3>
            <div className="scroll-x">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-1.5 font-medium">Description</th>
                    <th className="pb-1.5 text-right font-medium">Ordered</th>
                    <th className="pb-1.5 text-right font-medium">Produced</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 pr-2 text-slate-800">{it.description}</td>
                      <td className="py-2 text-right tabular-nums text-slate-600">{fmtQty(it.qty)} {it.unit}</td>
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          defaultValue={Number(it.qty_produced)}
                          min={0}
                          max={Number(it.qty)}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== Number(it.qty_produced)) setProduced(it, v)
                          }}
                          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Edit a produced figure and click away to save.</p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Stage history</h3>
            {data.log.length === 0 ? <Empty>No history.</Empty> : (
              <ol className="space-y-2">
                {data.log.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 text-xs tabular-nums text-slate-500">
                      {new Date(l.changed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-slate-400">{l.from_stage ? STAGE_LABEL[l.from_stage] : '—'}</span>
                    <span className="text-slate-400">→</span>
                    <Badge tone={STAGE_TONE[l.to_stage]}>{STAGE_LABEL[l.to_stage]}</Badge>
                    {l.note && <span className="text-xs text-slate-500">{l.note}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NewOrderForm({ plantId, onDone }: { plantId: number; onDone: () => void }) {
  const [f, setF] = useState({
    order_no: '', customer: '', po_ref: '', order_date: today(),
    due_date: '', priority: 'normal', value: '', site: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('ff_orders').insert({
      plant_id: plantId,
      order_no: f.order_no.trim(),
      customer: f.customer.trim(),
      po_ref: f.po_ref.trim() || null,
      order_date: f.order_date,
      due_date: f.due_date || null,
      priority: f.priority,
      value: f.value ? Number(f.value) : null,
      site: f.site.trim() || null,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Order no *">
        <input required value={f.order_no} onChange={(e) => setF({ ...f, order_no: e.target.value })} className={inputCls} placeholder="SO-2609" />
      </Field>
      <Field label="Customer *">
        <input required value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Customer PO ref">
        <input value={f.po_ref} onChange={(e) => setF({ ...f, po_ref: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Site / project">
        <input value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Order date">
        <input type="date" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Due date">
        <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Priority">
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={inputCls}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </Field>
      <Field label="Order value (₹)">
        <input type="number" step="0.01" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} className={inputCls} />
      </Field>
      {err && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{err}</p>}
      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create order'}</Button>
      </div>
    </form>
  )
}

export default function Orders() {
  const { scope, plant, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const manage = can('ff_manage')
  const { data, loading, error, refresh } = useQuery(() => loadOrders(scope), 'orders-' + scopeKey(scope))
  const [stage, setStage] = useState<string>('open')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)

  const rows = useMemo(() => {
    let r = data ?? []
    if (stage === 'open') r = r.filter((o) => o.stage !== 'delivered' && o.stage !== 'cancelled')
    else if (stage !== 'all') r = r.filter((o) => o.stage === stage)
    const term = q.trim().toLowerCase()
    if (term) r = r.filter((o) => (o.order_no + ' ' + o.customer + ' ' + (o.site ?? '')).toLowerCase().includes(term))
    return r
  }, [data, stage, q])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500">{rows.length} shown · {(data ?? []).length} total</p>
        </div>
        {plant && manage && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ New order'}
          </Button>
        )}
      </header>

      {showNew && plant && (
        <Card title={'New order · ' + plant.short_name}>
          <NewOrderForm plantId={plant.id} onDone={() => { setShowNew(false); refresh() }} />
        </Card>
      )}
      {!plant && <NeedPlant what="add an order" />}

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search order no, customer, site…"
          className={inputCls + ' sm:max-w-xs'}
        />
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls + ' sm:max-w-[200px]'}>
          <option value="open">Open only</option>
          <option value="all">All stages</option>
          {ORDER_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : rows.length === 0 ? (
        <Card><Empty>No orders match.</Empty></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => {
            const late = o.days_to_due !== null && Number(o.days_to_due) < 0 && o.stage !== 'delivered'
            return (
              <Card key={o.id} className={late ? 'ring-red-200' : ''}>
                <div
                  className="flex cursor-pointer flex-wrap items-start justify-between gap-3"
                  onClick={() => setOpenId(openId === o.id ? null : o.id)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {scope === 'group' && <PlantTag code={byId(o.plant_id)?.code} />}
                      <span className="font-semibold text-slate-900">{o.order_no}</span>
                      <Badge tone={STAGE_TONE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
                      {o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}
                      {o.priority === 'high' && <Badge tone="amber">High</Badge>}
                      {late && <Badge tone="red">{Math.abs(Number(o.days_to_due))}d overdue</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700">{o.customer}</p>
                    {o.site && <p className="text-xs text-slate-500">{o.site}</p>}
                  </div>
                  <div className="flex shrink-0 gap-6 text-right text-sm">
                    <div>
                      <div className="text-xs text-slate-500">Due</div>
                      <div className={'tabular-nums ' + (late ? 'font-semibold text-red-600' : 'text-slate-800')}>{fmtDate(o.due_date)}</div>
                    </div>
                    {money && (
                      <div>
                        <div className="text-xs text-slate-500">Value</div>
                        <div className="tabular-nums text-slate-800">{fmtMoney(o.value)}</div>
                      </div>
                    )}
                    <div className="w-24">
                      <div className="text-xs text-slate-500">Produced</div>
                      <div className="tabular-nums text-slate-800">{Number(o.pct_complete)}%</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: Math.min(100, Number(o.pct_complete)) + '%' }} />
                      </div>
                    </div>
                  </div>
                </div>
                {openId === o.id && <OrderDetail order={o} onChanged={refresh} />}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
