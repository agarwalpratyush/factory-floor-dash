import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Alert, Empty, ErrorBox, Field, NeedPlant, PlantTag, Result, Section, Spinner,
} from '../components/ui'
import { daysAgo, fmtDate, fmtNum, fmtQty, today } from '../lib/format'
import { TXN_TYPE_LABEL } from '../lib/types'
import type { Direction, MaterialTxn, Order, StockLevel } from '../lib/types'

async function loadPage(scope: PlantScope, from: string) {
  const plant = scope === 'group' ? null : scope

  let txnQ = supabase
    .from('ff_material_txns')
    .select('*, ff_materials(code,name,unit), ff_orders(order_no)')
    .gte('txn_date', from)
    .order('txn_date', { ascending: false })
    .order('id', { ascending: false })
  if (plant !== null) txnQ = txnQ.eq('plant_id', plant)

  let stockQ = supabase.from('ff_stock_levels').select('*').eq('active', true).order('code')
  if (plant !== null) stockQ = stockQ.eq('plant_id', plant)

  let orderQ = supabase.from('ff_orders').select('id,order_no,customer').neq('stage', 'delivered').order('order_no')
  if (plant !== null) orderQ = orderQ.eq('plant_id', plant)

  const [txns, stock, orders] = await Promise.all([txnQ, stockQ, orderQ])
  const failed = [txns, stock, orders].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  return {
    txns: (txns.data ?? []) as MaterialTxn[],
    stock: (stock.data ?? []) as StockLevel[],
    orders: (orders.data ?? []) as Pick<Order, 'id' | 'order_no' | 'customer'>[],
  }
}

function EntryForm({
  plantId, stock, orders, onDone,
}: {
  plantId: number
  stock: StockLevel[]
  orders: Pick<Order, 'id' | 'order_no' | 'customer'>[]
  onDone: () => void
}) {
  const [dir, setDir] = useState<Direction>('in')
  const [f, setF] = useState({
    txn_date: today(), material_id: '', qty: '', unit_rate: '',
    party: '', ref_no: '', order_id: '', remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const mat = stock.find((m) => String(m.material_id) === f.material_id)
  const short = dir === 'out' && mat && f.qty ? Number(f.qty) - Number(mat.balance) : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setOk(false)
    const { error } = await supabase.from('ff_material_txns').insert({
      txn_date: f.txn_date,
      direction: dir,
      txn_type: dir === 'in' ? 'purchase' : 'issue',
      material_id: Number(f.material_id),
      plant_id: plantId,
      qty: Number(f.qty),
      unit_rate: f.unit_rate ? Number(f.unit_rate) : null,
      party: f.party.trim() || null,
      ref_no: f.ref_no.trim() || null,
      order_id: f.order_id ? Number(f.order_id) : null,
      remarks: f.remarks.trim() || null,
      recorded_by: 'store',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk(true)
    setF({ ...f, qty: '', unit_rate: '', ref_no: '', remarks: '' })
    onDone()
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="btn-group">
        <button type="button" className={'btn btn-sm' + (dir === 'in' ? ' is-active' : '')} onClick={() => setDir('in')}>
          Purchase in
        </button>
        <button type="button" className={'btn btn-sm' + (dir === 'out' ? ' is-active' : '')} onClick={() => setDir('out')}>
          Issue out
        </button>
      </div>
      <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
        A production run goes under Production; stock going to the other company goes under
        Dispatch. Both post their own movements.
      </p>

      <Field label="Date">
        <input className="input" type="date" value={f.txn_date} onChange={(e) => setF({ ...f, txn_date: e.target.value })} />
      </Field>
      <Field label="Material">
        <select className="select" required value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })}>
          <option value="">Select</option>
          {stock.map((m) => (
            <option key={m.material_id} value={m.material_id}>
              {m.code} — {fmtQty(m.balance)} {m.unit} on hand
            </option>
          ))}
        </select>
      </Field>
      <Field label={'Quantity' + (mat ? ' (' + mat.unit + ')' : '')}>
        <input className="input num" required type="number" step="0.001" min="0.001" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
      </Field>
      <Field label="Rate per unit">
        <input className="input num" type="number" step="0.01" value={f.unit_rate} onChange={(e) => setF({ ...f, unit_rate: e.target.value })} />
      </Field>
      <Field label={dir === 'in' ? 'Supplier' : 'Issued to'}>
        <input className="input" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })}
          placeholder={dir === 'in' ? 'Tata Wiron' : 'extrusion'} />
      </Field>
      <Field label={dir === 'in' ? 'Invoice or challan no' : 'Issue slip no'}>
        <input className="input mono" value={f.ref_no} onChange={(e) => setF({ ...f, ref_no: e.target.value })} />
      </Field>
      <Field label="Against order">
        <select className="select" value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value })}>
          <option value="">None</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no} — {o.customer}</option>)}
        </select>
      </Field>
      <Field label="Remarks">
        <input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
      </Field>

      {short > 0 && mat && (
        <Alert state="warn">
          {fmtQty(mat.balance)} {mat.unit} on hand. This issue takes stock {fmtQty(short)} {mat.unit} below zero.
        </Alert>
      )}
      {err && <Alert state="fail">{err}</Alert>}
      {ok && <Alert state="ok">Saved. Stock updated.</Alert>}

      <button type="submit" className="btn btn-primary" disabled={busy || !f.material_id || !f.qty}>
        {busy ? 'Saving…' : dir === 'in' ? 'Record receipt' : 'Record issue'}
      </button>
    </form>
  )
}

export default function Materials() {
  const { scope, plant, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const [days, setDays] = useState(30)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'materials-' + scopeKey(scope) + '-' + days,
  )
  const [dirFilter, setDirFilter] = useState<'all' | Direction>('all')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    let r = data?.txns ?? []
    if (dirFilter !== 'all') r = r.filter((t) => t.direction === dirFilter)
    const term = q.trim().toLowerCase()
    if (term) {
      r = r.filter((t) => ((t.ff_materials?.code ?? '') + ' ' + (t.ff_materials?.name ?? '')
        + ' ' + (t.party ?? '') + ' ' + (t.ref_no ?? '')).toLowerCase().includes(term))
    }
    return r
  }, [data, dirFilter, q])

  const ins = rows.filter((t) => t.direction === 'in').length
  const outs = rows.filter((t) => t.direction === 'out').length

  return (
    <>
      <div className="col w-sm">
        <span className="label">Record a movement</span>
        {plant && can('ff_entry') && data ? (
          <EntryForm plantId={plant.id} stock={data.stock} orders={data.orders} onDone={refresh} />
        ) : !plant ? (
          <NeedPlant what="record a movement" />
        ) : (
          <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>Read-only for your account.</p>
        )}
      </div>

      <div className="col fill flush">
        <div className="row wrap" style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
          <input
            className="input" style={{ width: 200 }} value={q}
            onChange={(e) => setQ(e.target.value)} placeholder="Search material, party, ref"
          />
          <div className="btn-group">
            {(['all', 'in', 'out'] as const).map((d) => (
              <button key={d} type="button" className={'btn btn-sm' + (dirFilter === d ? ' is-active' : '')} onClick={() => setDirFilter(d)}>
                {d === 'all' ? 'All' : d === 'in' ? 'In' : 'Out'}
              </button>
            ))}
          </div>
          <select className="select" style={{ width: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="faint">{ins} in · {outs} out</span>
        </div>

        {loading ? <Spinner /> : error ? <div style={{ padding: 8 }}><ErrorBox error={error} onRetry={refresh} /></div> : rows.length === 0 ? (
          <Empty>No movements in this period.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  {scope === 'group' && <th>Unit</th>}
                  <th className="n">Date</th>
                  <th>Type</th>
                  <th>Code</th>
                  <th>Material</th>
                  <th className="n">Qty</th>
                  {money && <th className="n">Rate</th>}
                  {money && <th className="n">Value</th>}
                  <th>Party</th>
                  <th>Ref</th>
                  <th>Order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    {scope === 'group' && <td><PlantTag code={byId(t.plant_id)?.code} /></td>}
                    <td className="n">{fmtDate(t.txn_date)}</td>
                    <td className="muted">
                      {(t.direction === 'in' ? '↓ ' : '↑ ') + TXN_TYPE_LABEL[t.txn_type]}
                    </td>
                    <td className="mono">{t.ff_materials?.code}</td>
                    <td className="muted">{t.ff_materials?.name}</td>
                    <td className="n">{fmtQty(t.qty)} {t.ff_materials?.unit}</td>
                    {money && <td className="n">{t.unit_rate ? fmtNum(t.unit_rate, 2) : '—'}</td>}
                    {money && <td className="n">{t.unit_rate ? fmtNum(Number(t.qty) * Number(t.unit_rate), 0) : '—'}</td>}
                    <td className="muted">{t.party ?? '—'}</td>
                    <td className="mono faint">{t.ref_no ?? '—'}</td>
                    <td className="mono">{t.ff_orders?.order_no ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="col w-md">
        <Section title="On hand" flush>
          {!data ? <Spinner /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    {scope === 'group' && <th>Unit</th>}
                    <th>Code</th>
                    <th className="n">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.map((s) => {
                    const low = s.role === 'raw' && Number(s.balance) < Number(s.reorder_level)
                    return (
                      <tr key={s.plant_id + '-' + s.material_id}>
                        {scope === 'group' && <td><PlantTag code={s.plant_code} /></td>}
                        <td className="mono">{s.code}</td>
                        <td className="n" style={low ? { color: 'var(--warn)' } : undefined}>
                          {fmtQty(s.balance)} <span className="faint">{s.unit}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <Result label="Movements shown" value={rows.length} flat />
      </div>
    </>
  )
}
