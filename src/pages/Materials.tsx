import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NeedPlant, PlantTag, Spinner,
} from '../components/ui'
import { daysAgo, fmtDate, fmtNum, fmtQty, today } from '../lib/format'
import { TXN_TYPE_LABEL } from '../lib/types'
import type { Direction, MaterialTxn, Order, StockLevel, TxnType } from '../lib/types'

const TXN_TONE: Record<TxnType, 'green' | 'amber' | 'blue' | 'violet' | 'slate' | 'cyan'> = {
  purchase: 'green', production_in: 'cyan', transfer_in: 'blue', return_in: 'slate',
  issue: 'amber', production_out: 'violet', transfer_out: 'blue', sale_out: 'amber',
  adjustment: 'slate',
}

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
    setBusy(true)
    setErr(null)
    setOk(false)
    const { error } = await supabase.from('ff_material_txns').insert({
      txn_date: f.txn_date,
      direction: dir,
      // Hand entry is a market purchase or a shop-floor issue. Production and
      // transfers post their own rows through their RPCs.
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
    <form onSubmit={submit} className="space-y-3">
      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        <button
          type="button" onClick={() => setDir('in')}
          className={'rounded-md px-4 py-2 text-sm font-medium transition ' + (dir === 'in' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-600')}
        >
          Purchase IN
        </button>
        <button
          type="button" onClick={() => setDir('out')}
          className={'rounded-md px-4 py-2 text-sm font-medium transition ' + (dir === 'out' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-600')}
        >
          Issue OUT
        </button>
      </div>
      <p className="text-xs text-slate-500">
        For a production run use <strong>Production</strong>; to send stock to the other company use <strong>Dispatch</strong>. Both post their movements automatically.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <input type="date" value={f.txn_date} onChange={(e) => setF({ ...f, txn_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Material *">
          <select required value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {stock.map((m) => (
              <option key={m.material_id} value={m.material_id}>
                {m.code} — {m.name} ({fmtQty(m.balance)} {m.unit})
              </option>
            ))}
          </select>
        </Field>
        <Field label={'Quantity *' + (mat ? ' (' + mat.unit + ')' : '')}>
          <input required type="number" step="0.001" min="0.001" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inputCls} />
        </Field>
        <Field label={dir === 'in' ? 'Rate per unit (₹)' : 'Rate (optional)'}>
          <input type="number" step="0.01" value={f.unit_rate} onChange={(e) => setF({ ...f, unit_rate: e.target.value })} className={inputCls} />
        </Field>
        <Field label={dir === 'in' ? 'Supplier' : 'Issued to (dept / line)'}>
          <input
            value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} className={inputCls}
            placeholder={dir === 'in' ? 'Tata Wiron, Supreme Polymers…' : 'extrusion, mesh, assembly…'}
          />
        </Field>
        <Field label={dir === 'in' ? 'Invoice / challan no' : 'Issue slip no'}>
          <input value={f.ref_no} onChange={(e) => setF({ ...f, ref_no: e.target.value })} className={inputCls} />
        </Field>
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

      {short > 0 && mat && (
        <p className="text-xs text-amber-700">
          Only {fmtQty(mat.balance)} {mat.unit} on hand — this issue puts stock {fmtQty(short)} {mat.unit} negative.
        </p>
      )}
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved. Stock updated.</p>}

      <Button type="submit" disabled={busy || !f.material_id || !f.qty}>
        {busy ? 'Saving…' : dir === 'in' ? 'Record receipt' : 'Record issue'}
      </Button>
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
  const [typeFilter, setTypeFilter] = useState<'all' | Direction>('all')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    let r = data?.txns ?? []
    if (typeFilter !== 'all') r = r.filter((t) => t.direction === typeFilter)
    const term = q.trim().toLowerCase()
    if (term) {
      r = r.filter((t) =>
        ((t.ff_materials?.code ?? '') + ' ' + (t.ff_materials?.name ?? '') + ' ' + (t.party ?? '') + ' ' + (t.ref_no ?? ''))
          .toLowerCase().includes(term))
    }
    return r
  }, [data, typeFilter, q])

  const totalIn = rows.filter((t) => t.direction === 'in').length
  const totalOut = rows.filter((t) => t.direction === 'out').length

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Material In / Out</h1>
        <p className="text-sm text-slate-500">
          Every movement in and out of the store{plant ? ' at ' + plant.short_name : ' across both companies'}. Stock balances derive from this ledger.
        </p>
      </header>

      {plant ? (
        <Card title={'Record a movement · ' + plant.short_name}>
          {loading && !data ? <Spinner /> : data && (
            <EntryForm plantId={plant.id} stock={data.stock} orders={data.orders} onDone={refresh} />
          )}
        </Card>
      ) : (
        <NeedPlant what="record a movement" />
      )}

      <Card
        title="Movement ledger"
        action={
          <div className="flex flex-wrap gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | Direction)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value="all">In &amp; Out</option>
              <option value="in">In only</option>
              <option value="out">Out only</option>
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
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search material, party, ref no…"
          className={inputCls + ' mb-3 sm:max-w-sm'}
        />

        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : rows.length === 0 ? (
          <Empty>No movements in this period.</Empty>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500">{totalIn} in · {totalOut} out</p>
            <div className="scroll-x">
              <table className="w-full min-w-[940px] text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                    {scope === 'group' && <th className="pb-2 font-medium">Unit</th>}
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Material</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    {money && <th className="pb-2 text-right font-medium">Rate</th>}
                    {money && <th className="pb-2 text-right font-medium">Value</th>}
                    <th className="pb-2 font-medium">Party</th>
                    <th className="pb-2 font-medium">Ref</th>
                    <th className="pb-2 font-medium">Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      {scope === 'group' && <td className="py-2"><PlantTag code={byId(t.plant_id)?.code} /></td>}
                      <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(t.txn_date)}</td>
                      <td className="py-2">
                        <Badge tone={TXN_TONE[t.txn_type]}>
                          {(t.direction === 'in' ? '↓ ' : '↑ ') + TXN_TYPE_LABEL[t.txn_type]}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="font-medium text-slate-900">{t.ff_materials?.code}</div>
                        <div className="text-xs text-slate-500">{t.ff_materials?.name}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-900">{fmtQty(t.qty)} {t.ff_materials?.unit}</td>
                      {money && (
                        <td className="py-2 text-right tabular-nums text-slate-600">{t.unit_rate ? fmtNum(t.unit_rate, 2) : '—'}</td>
                      )}
                      {money && (
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {t.unit_rate ? fmtNum(Number(t.qty) * Number(t.unit_rate), 0) : '—'}
                        </td>
                      )}
                      <td className="py-2 text-slate-600">{t.party ?? '—'}</td>
                      <td className="py-2 text-xs text-slate-500">{t.ref_no ?? '—'}</td>
                      <td className="py-2 text-slate-600">{t.ff_orders?.order_no ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
