import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NeedPlant, PlantTag, Spinner, Stat,
} from '../components/ui'
import { AddMaterialForm, ROLE_HINT, RoleTable } from '../components/stock'
import { daysAgo, fmtDate, fmtNum, fmtQty, today } from '../lib/format'
import { MATERIAL_CATEGORIES, STOCK_ROLE_LABEL, TXN_TYPE_LABEL } from '../lib/types'
import type { Direction, Material, MaterialTxn, Order, StockLevel, StockRole, TxnType } from '../lib/types'

/**
 * What is bought in and consumed here: raw material, and the work in progress made
 * out of it. Purchases are the only thing entered by hand - a production run posts
 * its own consumption, so buying is the one event nothing else records.
 *
 * These articles are deliberately absent from Stock, which carries finished goods.
 * An article belongs to one page, so nobody has to ask which balance is the real one.
 */
const HELD_HERE: StockRole[] = ['raw', 'wip']

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

  const matQ = supabase.from('ff_materials').select('*').order('code')

  let orderQ = supabase.from('ff_orders').select('id,order_no,customer').neq('stage', 'delivered').order('order_no')
  if (plant !== null) orderQ = orderQ.eq('plant_id', plant)

  const [txns, stock, orders, mats] = await Promise.all([txnQ, stockQ, orderQ, matQ])

  const failed = [txns, stock, orders, mats].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  return {
    txns: (txns.data ?? []) as MaterialTxn[],
    stock: (stock.data ?? []) as StockLevel[],
    materials: (mats.data ?? []) as Material[],
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
  const [f, setF] = useState({
    txn_date: today(), material_id: '', qty: '', unit_rate: '',
    party: '', ref_no: '', order_id: '', remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const mat = stock.find((m) => String(m.material_id) === f.material_id)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setOk(false)
    const { error } = await supabase.from('ff_material_txns').insert({
      txn_date: f.txn_date,
      direction: 'in',
      // Buying is the only movement nothing else records. Production posts its own
      // consumption and Dispatch its own outward, both through their RPCs.
      txn_type: 'purchase',
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
      <p className="text-xs text-slate-500">
        Buying is the only thing entered here. A production run takes what it consumed
        out by itself, and <strong>Dispatch</strong> handles anything leaving the gate —
        entering either by hand would count it twice.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <input type="date" value={f.txn_date} onChange={(e) => setF({ ...f, txn_date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Material *">
          <select required value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {stock.map((m) => (
              <option key={m.plant_id + '-' + m.material_id} value={m.material_id}>
                {m.code} — {m.name} ({fmtQty(m.balance)} {m.unit})
              </option>
            ))}
          </select>
        </Field>
        <Field label={'Quantity *' + (mat ? ' (' + mat.unit + ')' : '')}>
          <input required type="number" step="0.001" min="0.001" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Rate per unit (₹)">
          <input type="number" step="0.01" value={f.unit_rate} onChange={(e) => setF({ ...f, unit_rate: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Supplier">
          <input
            value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} className={inputCls}
            placeholder="Tata Wiron, Supreme Polymers…"
          />
        </Field>
        <Field label="Invoice / challan no">
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

      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved. Stock updated.</p>}

      <Button type="submit" disabled={busy || !f.material_id || !f.qty}>
        {busy ? 'Saving…' : 'Record purchase'}
      </Button>
    </form>
  )
}

export default function Materials() {
  const { scope, plant, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const manage = can('ff_manage')
  const [days, setDays] = useState(30)
  const { data, loading, error, refresh } = useQuery(
    () => loadPage(scope, daysAgo(days)),
    'materials-' + scopeKey(scope) + '-' + days,
  )
  const [typeFilter, setTypeFilter] = useState<'all' | Direction>('all')
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
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

  const held = useMemo(
    () => (data?.stock ?? []).filter((x) => HELD_HERE.includes(x.role)),
    [data],
  )

  /** A material's role is per company, so the key has to carry the plant: coated
   *  wire is finished at Saffron and raw at Agarwal. */
  const heldKeys = useMemo(
    () => new Set(held.map((x) => x.plant_id + '-' + x.material_id)),
    [held],
  )

  const ledger = rows.filter((t) => heldKeys.has(t.plant_id + '-' + t.material_id))
  const totalIn = ledger.filter((t) => t.direction === 'in').length
  const totalOut = ledger.filter((t) => t.direction === 'out').length

  const low = held.filter((x) => x.role === 'raw' && Number(x.balance) < Number(x.reorder_level))
  const negative = held.filter((x) => Number(x.balance) < 0)
  const consumed = held.reduce((n, x) => n + Number(x.consumed ?? 0), 0)

  async function saveReorder(x: StockLevel, value: number) {
    const { error } = await supabase
      .from('ff_material_plants')
      .update({ reorder_level: value })
      .eq('material_id', x.material_id)
      .eq('plant_id', x.plant_id)
    if (!error) { setEditing(null); refresh() }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Raw Material</h1>
          <p className="text-sm text-slate-500">
            What is bought in and consumed{plant ? ' at ' + plant.short_name : ' across both companies'}.
            Buying is entered here; a production run takes out what it used by itself.
          </p>
        </div>
        {plant && manage && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Cancel' : '+ Add article'}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'Add an article to ' + plant.short_name}>
          <AddMaterialForm
            plantId={plant.id}
            existing={data.stock}
            allMaterials={data.materials}
            allowedRoles={HELD_HERE}
            onDone={() => { setShowNew(false); refresh() }}
          />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Articles held" value={held.length} sub="raw and work in progress" />
        <Stat
          label="Below reorder level"
          value={low.length}
          sub={low.length ? low.map((l) => l.code).join(', ') : 'nothing to raise'}
          tone={low.length ? 'warn' : 'good'}
        />
        <Stat label="Consumed to date" value={fmtQty(consumed)} sub="taken by production runs" />
        <Stat
          label="Negative balance"
          value={negative.length}
          sub={negative.length ? 'ledger needs a correction' : 'ledger is clean'}
          tone={negative.length ? 'bad' : 'good'}
        />
      </div>

      {plant ? (
        <Card title={'Record a purchase · ' + plant.short_name}>
          {loading && !data ? <Spinner /> : data && (
            <EntryForm plantId={plant.id} stock={held} orders={data.orders} onDone={refresh} />
          )}
        </Card>
      ) : (
        <NeedPlant what="record a purchase" />
      )}

      {/* The balance itself, so nobody has to add the ledger up in their head. */}
      {loading && !data ? <Spinner /> : (
        <>
          {HELD_HERE.map((role) => {
            const inRole = held.filter((x) => x.role === role)
            if (inRole.length === 0) return null

            // Grouped by what the article is made of, in the order the categories
            // are listed, with anything uncategorised last rather than dropped.
            const groups = [
              ...MATERIAL_CATEGORIES.map((c) => [c, inRole.filter((x) => x.category === c)] as const),
              ['Uncategorised', inRole.filter((x) => !MATERIAL_CATEGORIES.includes(x.category))] as const,
            ].filter(([, rows]) => rows.length > 0)

            return (
              <Card key={role} title={STOCK_ROLE_LABEL[role]} collapsible={role === 'raw'}>
                <p className="-mt-1 mb-3 text-xs text-slate-500">{ROLE_HINT[role]}</p>
                {role === 'raw' && groups.length > 1 ? groups.map(([cat, rows]) => (
                  <div key={cat} className="mb-5 last:mb-0">
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      {cat}
                      <span className="ml-1 font-normal text-slate-400">({rows.length})</span>
                    </h3>
                    <RoleTable
                      role={role}
                      rows={rows}
                      scope={scope}
                      onEditReorder={saveReorder}
                      editing={editing}
                      setEditing={setEditing}
                    />
                  </div>
                )) : (
                <RoleTable
                  role={role}
                  rows={inRole}
                  scope={scope}
                  onEditReorder={saveReorder}
                  editing={editing}
                  setEditing={setEditing}
                />
                )}
                {role === 'raw' && (
                  <p className="mt-3 text-xs text-slate-500">Click a reorder level to change it for that company.</p>
                )}
                {inRole.some((x) => x.sellable) && (
                  <p className="mt-3 text-xs text-slate-500">
                    {inRole.filter((x) => x.sellable).map((x) => x.code).join(', ')} can also be
                    sold as {inRole.filter((x) => x.sellable).length === 1 ? 'it is' : 'they are'}, so
                    the same balance appears on Finished Stock. It is one pool, not two.
                  </p>
                )}
              </Card>
            )
          })}
        </>
      )}

      <Card
        collapsible
        title="Movements in and out"
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

        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : ledger.length === 0 ? (
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
                  {ledger.map((t) => (
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
