import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Alert, Badge, Empty, ErrorBox, Field, Meter, NeedPlant, PlantTag,
  Result, Section, Spinner, STAGE_STATE,
} from '../components/ui'
import { fmtDate, fmtMoney, fmtQty, today } from '../lib/format'
import { ORDER_STAGES, STAGE_LABEL } from '../lib/types'
import type { OrderItem, OrderProgress, OrderStage } from '../lib/types'

interface StageLogRow {
  id: number
  from_stage: OrderStage | null
  to_stage: OrderStage
  changed_at: string
  changed_by: string | null
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

function OrderDetail({
  order, canWrite, money, onChanged,
}: { order: OrderProgress; canWrite: boolean; money: boolean; onChanged: () => void }) {
  const { data, loading, error, refresh } = useQuery(() => loadDetail(order.id), 'detail-' + order.id)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const idx = ORDER_STAGES.indexOf(order.stage)
  const next = idx >= 0 && idx < ORDER_STAGES.length - 1 ? ORDER_STAGES[idx + 1] : null

  async function advance(to: OrderStage) {
    setBusy(true); setMsg(null)
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
    <>
      <Section title={'Order ' + order.order_no}>
        <div className="row wrap">
          {ORDER_STAGES.map((s, i) => (
            <span key={s} className={'badge' + (i === idx ? ' is-ok' : i < idx ? '' : ' is-idle')}>
              {STAGE_LABEL[s]}
            </span>
          ))}
        </div>
        {next && order.stage !== 'cancelled' && canWrite && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => advance(next)}>
            Move to {STAGE_LABEL[next]}
          </button>
        )}
        {msg && <Alert state="fail">{msg}</Alert>}
        <div className="grid-2">
          <Result label="Customer" value={<span style={{ fontSize: 'var(--text-body)' }}>{order.customer}</span>} flat />
          <Result label="Due" value={<span style={{ fontSize: 'var(--text-body)' }}>{fmtDate(order.due_date)}</span>} flat />
          {money && <Result label="Value" value={fmtMoney(order.value)} flat />}
          <Result label="Complete" value={Number(order.pct_complete) + '%'} flat />
        </div>
      </Section>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : data && (
        <>
          <Section title="Line items" flush>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="n">Ordered</th>
                  <th className="n">Made</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td className="n">{fmtQty(it.qty)} {it.unit}</td>
                    <td className="n">
                      {canWrite ? (
                        <input
                          className="cell-input num" type="number"
                          defaultValue={Number(it.qty_produced)} min={0} max={Number(it.qty)}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== Number(it.qty_produced)) setProduced(it, v)
                          }}
                        />
                      ) : fmtQty(it.qty_produced)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Stage history" flush>
            {data.log.length === 0 ? <Empty>No history.</Empty> : (
              <table className="table compact">
                <tbody>
                  {data.log.map((l) => (
                    <tr key={l.id}>
                      <td className="n faint">
                        {new Date(l.changed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className="muted">{l.from_stage ? STAGE_LABEL[l.from_stage] : '—'}</td>
                      <td><Badge state={STAGE_STATE[l.to_stage]}>{STAGE_LABEL[l.to_stage]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </>
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
    setBusy(true); setErr(null)
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
    <form onSubmit={submit} className="stack">
      <Field label="Order no"><input className="input mono" required value={f.order_no} onChange={(e) => setF({ ...f, order_no: e.target.value })} /></Field>
      <Field label="Customer"><input className="input" required value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
      <Field label="Customer PO ref"><input className="input mono" value={f.po_ref} onChange={(e) => setF({ ...f, po_ref: e.target.value })} /></Field>
      <Field label="Site or project"><input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} /></Field>
      <Field label="Order date"><input className="input" type="date" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} /></Field>
      <Field label="Due date"><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      <Field label="Priority">
        <select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Order value"><input className="input num" type="number" step="0.01" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
      {err && <Alert state="fail">{err}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Place order'}</button>
    </form>
  )
}

export default function Orders() {
  const { scope, plant, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const writeOrders = can('ff_orders_write')
  const { data, loading, error, refresh } = useQuery(() => loadOrders(scope), 'orders-' + scopeKey(scope))
  const [stage, setStage] = useState('open')
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

  const selected = rows.find((o) => o.id === openId) ?? null
  const open = (data ?? []).filter((o) => o.stage !== 'delivered' && o.stage !== 'cancelled')
  const overdue = open.filter((o) => o.days_to_due !== null && Number(o.days_to_due) < 0)

  return (
    <>
      <div className="col w-sm">
        <span className="label">Orders</span>
        <Result label="Open" value={open.length} sub={money ? fmtMoney(open.reduce((s, o) => s + Number(o.value ?? 0), 0)) : undefined} />
        <Result label="Overdue" value={overdue.length} state={overdue.length ? 'fail' : 'ok'} />
        <Result label="Shown" value={rows.length} sub={(data ?? []).length + ' in total'} flat />

        <hr className="divider" />
        <Field label="Search">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, customer, site" />
        </Field>
        <Field label="Stage">
          <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="open">Open only</option>
            <option value="all">All stages</option>
            {ORDER_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>

        {writeOrders && plant && (
          <button type="button" className={'btn' + (showNew ? '' : ' btn-primary')} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : 'Place order'}
          </button>
        )}
        {writeOrders && !plant && <NeedPlant what="place an order" />}
        {!writeOrders && (
          <Alert state="info">
            Read-only. Placing an order, moving its stage and recording made quantities are done
            by the owner.
          </Alert>
        )}
      </div>

      <div className="col fill flush">
        {loading ? <Spinner /> : error ? <div style={{ padding: 8 }}><ErrorBox error={error} onRetry={refresh} /></div> : rows.length === 0 ? (
          <Empty>No orders match.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {scope === 'group' && <th>Unit</th>}
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Site</th>
                  <th>Stage</th>
                  <th className="n">Made</th>
                  <th style={{ width: 72 }} />
                  {money && <th className="n">Value</th>}
                  <th className="n">Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const late = o.days_to_due !== null && Number(o.days_to_due) < 0 && o.stage !== 'delivered'
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setOpenId(openId === o.id ? null : o.id)}
                      style={{ cursor: 'pointer', background: openId === o.id ? 'var(--accent-bg)' : undefined }}
                    >
                      {scope === 'group' && <td><PlantTag code={byId(o.plant_id)?.code} /></td>}
                      <td className="mono">{o.order_no}</td>
                      <td>{o.customer}</td>
                      <td className="muted">{o.site ?? '—'}</td>
                      <td>
                        <Badge state={STAGE_STATE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
                        {o.priority === 'urgent' && <span className="badge is-fail" style={{ marginLeft: 4 }}>urgent</span>}
                      </td>
                      <td className="n">{Number(o.pct_complete)}%</td>
                      <td><Meter pct={Number(o.pct_complete)} state={Number(o.pct_complete) >= 100 ? 'ok' : undefined} /></td>
                      {money && <td className="n">{fmtMoney(o.value)}</td>}
                      <td className="n">
                        {late
                          ? <span className="badge is-fail">{Math.abs(Number(o.days_to_due))}d late</span>
                          : fmtDate(o.due_date)}
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
        {showNew && plant && writeOrders ? (
          <Section title={'New order · ' + plant.short_name}>
            <NewOrderForm plantId={plant.id} onDone={() => { setShowNew(false); refresh() }} />
          </Section>
        ) : selected ? (
          <OrderDetail order={selected} canWrite={writeOrders} money={money} onChanged={refresh} />
        ) : (
          <Empty>Select an order to see its lines and stage history.</Empty>
        )}
      </div>
    </>
  )
}
