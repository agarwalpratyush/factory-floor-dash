import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NeedPlant, PlantTag, Spinner, Stat,
} from '../components/ui'
import { fmtDate, fmtQty } from '../lib/format'
import type { Material, StockLevel } from '../lib/types'

async function loadStock(scope: PlantScope) {
  let q = supabase.from('ff_stock_levels').select('*').order('plant_code').order('code')
  if (scope !== 'group') q = q.eq('plant_id', scope)
  const [stock, mats] = await Promise.all([
    q,
    supabase.from('ff_materials').select('*').order('code'),
  ])
  if (stock.error) throw new Error(stock.error.message)
  if (mats.error) throw new Error(mats.error.message)
  return { stock: (stock.data ?? []) as StockLevel[], materials: (mats.data ?? []) as Material[] }
}

/** Adds an existing article to this unit's stock list, or creates a new article outright. */
function AddMaterialForm({
  plantId, existing, allMaterials, onDone,
}: {
  plantId: number
  existing: StockLevel[]
  allMaterials: Material[]
  onDone: () => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [pick, setPick] = useState({ material_id: '', opening_stock: '', reorder_level: '' })
  const [f, setF] = useState({
    code: '', name: '', category: 'raw', unit: 'kg', opening_stock: '', reorder_level: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const stockedIds = new Set(existing.map((s) => s.material_id))
  const notStocked = allMaterials.filter((m) => !stockedIds.has(m.id))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)

    let materialId: number
    if (mode === 'existing') {
      materialId = Number(pick.material_id)
    } else {
      const { data, error } = await supabase
        .from('ff_materials')
        .insert({
          code: f.code.trim().toUpperCase(),
          name: f.name.trim(),
          category: f.category,
          unit: f.unit,
        })
        .select('id')
        .single()
      if (error) { setBusy(false); setErr(error.message); return }
      materialId = data.id
    }

    const src = mode === 'existing' ? pick : f
    const { error } = await supabase.from('ff_material_plants').insert({
      material_id: materialId,
      plant_id: plantId,
      opening_stock: src.opening_stock ? Number(src.opening_stock) : 0,
      reorder_level: src.reorder_level ? Number(src.reorder_level) : 0,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        <button type="button" onClick={() => setMode('existing')}
          className={'rounded-md px-4 py-2 text-sm font-medium transition ' + (mode === 'existing' ? 'bg-white shadow-sm' : 'text-slate-600')}>
          Stock an existing article
        </button>
        <button type="button" onClick={() => setMode('new')}
          className={'rounded-md px-4 py-2 text-sm font-medium transition ' + (mode === 'new' ? 'bg-white shadow-sm' : 'text-slate-600')}>
          Create a new article
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Article *">
            <select required value={pick.material_id} onChange={(e) => setPick({ ...pick, material_id: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {notStocked.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
            </select>
          </Field>
          <Field label="Opening stock">
            <input type="number" step="0.001" value={pick.opening_stock} onChange={(e) => setPick({ ...pick, opening_stock: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Reorder level">
            <input type="number" step="0.001" value={pick.reorder_level} onChange={(e) => setPick({ ...pick, reorder_level: e.target.value })} className={inputCls} />
          </Field>
          {notStocked.length === 0 && (
            <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">This unit already stocks every article on the master.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Code *">
            <input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inputCls} placeholder="GIW-4.00" />
          </Field>
          <Field label="Name *">
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="GI Wire Roll 4.00 mm" />
          </Field>
          <Field label="Category">
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputCls}>
              <option value="raw">Raw</option>
              <option value="consumable">Consumable</option>
              <option value="packing">Packing</option>
              <option value="finished">Finished</option>
            </select>
          </Field>
          <Field label="Unit">
            <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={inputCls}>
              {['kg', 'MT', 'nos', 'm', 'roll', 'coil'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Opening stock">
            <input type="number" step="0.001" value={f.opening_stock} onChange={(e) => setF({ ...f, opening_stock: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Reorder level">
            <input type="number" step="0.001" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} className={inputCls} />
          </Field>
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add to this unit'}</Button>
    </form>
  )
}

export default function Stock() {
  const { scope, plant } = usePlant()
  const { data, loading, error, refresh } = useQuery(() => loadStock(scope), 'stock-' + scopeKey(scope))
  const [cat, setCat] = useState('all')
  const [lowOnly, setLowOnly] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const all = useMemo(() => (data?.stock ?? []).filter((s) => s.active), [data])

  const rows = useMemo(() => {
    let r = all
    if (cat !== 'all') r = r.filter((s) => s.category === cat)
    if (lowOnly) r = r.filter((s) => Number(s.balance) < Number(s.reorder_level))
    return r
  }, [all, cat, lowOnly])

  const low = all.filter((s) => Number(s.balance) < Number(s.reorder_level))
  const negative = all.filter((s) => Number(s.balance) < 0)
  const stale = all.filter((s) => {
    if (!s.last_movement) return true
    return (Date.now() - new Date(s.last_movement).getTime()) / 86400000 > 30
  })

  async function saveReorder(s: StockLevel, value: number) {
    const { error } = await supabase
      .from('ff_material_plants')
      .update({ reorder_level: value })
      .eq('material_id', s.material_id)
      .eq('plant_id', s.plant_id)
    if (!error) { setEditing(null); refresh() }
  }

  const keyOf = (s: StockLevel) => s.plant_id + '-' + s.material_id

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Stock Levels</h1>
          <p className="text-sm text-slate-500">
            Balance = opening + in − out, held per unit. The same article carries a separate balance at each plant.
          </p>
        </div>
        {plant && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ Add material'}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'Add material to ' + plant.short_name}>
          <AddMaterialForm
            plantId={plant.id}
            existing={all}
            allMaterials={data.materials}
            onDone={() => { setShowNew(false); refresh() }}
          />
        </Card>
      )}
      {!plant && <NeedPlant what="add a material" />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stocked articles" value={all.length} />
        <Stat
          label="Below reorder level"
          value={low.length}
          sub={low.length ? 'raise purchase order' : 'nothing to raise'}
          tone={low.length ? 'warn' : 'good'}
        />
        <Stat
          label="Negative balance"
          value={negative.length}
          sub={negative.length ? 'ledger needs a correction' : 'ledger is clean'}
          tone={negative.length ? 'bad' : 'good'}
        />
        <Stat label="No movement 30 days" value={stale.length} sub="check for dead stock" tone={stale.length > 4 ? 'warn' : 'neutral'} />
      </div>

      <Card
        title="Current balances"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 rounded" />
              Low only
            </label>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
              <option value="all">All categories</option>
              <option value="raw">Raw</option>
              <option value="consumable">Consumable</option>
              <option value="packing">Packing</option>
              <option value="finished">Finished</option>
            </select>
          </div>
        }
      >
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : rows.length === 0 ? (
          <Empty>No materials match.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[940px] text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
                  {scope === 'group' && <th className="pb-2 font-medium">Unit</th>}
                  <th className="pb-2 font-medium">Material</th>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">Opening</th>
                  <th className="pb-2 text-right font-medium">In</th>
                  <th className="pb-2 text-right font-medium">Out</th>
                  <th className="pb-2 text-right font-medium">Balance</th>
                  <th className="pb-2 text-right font-medium">Reorder at</th>
                  <th className="pb-2 font-medium">Last moved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => {
                  const isLow = Number(s.balance) < Number(s.reorder_level)
                  const isNeg = Number(s.balance) < 0
                  return (
                    <tr key={keyOf(s)} className={isNeg ? 'bg-red-50/60' : isLow ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                      {scope === 'group' && <td className="py-2"><PlantTag code={s.plant_code} /></td>}
                      <td className="py-2">
                        <div className="font-medium text-slate-900">{s.code}</div>
                        <div className="text-xs text-slate-500">{s.name}</div>
                      </td>
                      <td className="py-2"><Badge tone="slate">{s.category}</Badge></td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{fmtQty(s.opening_stock)}</td>
                      <td className="py-2 text-right tabular-nums text-green-700">
                        +{fmtQty(s.total_in)}
                        {Number(s.received_in) > 0 && (
                          <span className="block text-xs font-normal text-slate-400">{fmtQty(s.received_in)} from other unit</span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums text-amber-700">
                        −{fmtQty(s.total_out)}
                        {Number(s.sent_out) > 0 && (
                          <span className="block text-xs font-normal text-slate-400">{fmtQty(s.sent_out)} sent out</span>
                        )}
                      </td>
                      <td className={'py-2 text-right font-semibold tabular-nums ' + (isNeg ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-slate-900')}>
                        {fmtQty(s.balance)} <span className="text-xs font-normal text-slate-500">{s.unit}</span>
                      </td>
                      <td className="py-2 text-right">
                        {editing === keyOf(s) ? (
                          <input
                            autoFocus type="number" step="0.001"
                            defaultValue={Number(s.reorder_level)}
                            onBlur={(e) => saveReorder(s, Number(e.target.value))}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                          />
                        ) : (
                          <button onClick={() => setEditing(keyOf(s))} className="tabular-nums text-slate-600 underline decoration-dotted underline-offset-2 hover:text-blue-600">
                            {fmtQty(s.reorder_level)}
                          </button>
                        )}
                      </td>
                      <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(s.last_movement)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Click a reorder level to change it for that unit.</p>
      </Card>
    </div>
  )
}
