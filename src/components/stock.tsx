import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { type PlantScope } from '../lib/plant'
import { Button, Empty, Field, inputCls, PlantTag } from './ui'
import { fmtDate, fmtQty } from '../lib/format'
import type { Material, StockLevel, StockRole } from '../lib/types'

/**
 * The article table and the add-an-article form, shared by the two pages that
 * hold stock. Raw Material carries raw and work in progress; Stock carries
 * finished goods. Same table either side, because a balance reads the same
 * whatever the article is for.
 */

export const ROLE_HINT: Record<StockRole, string> = {
  raw: 'Bought in or received, then consumed here. These are the ones with reorder levels.',
  wip: 'Made here and then consumed here. Never bought, never sold.',
  finished: 'Made here and sold or transferred out. Not reordered — produced to demand.',
}

/** Adds an article to this company's list, or creates a new one outright. */
export function AddMaterialForm({
  plantId, existing, allMaterials, allowedRoles, onDone,
}: {
  plantId: number
  existing: StockLevel[]
  allMaterials: Material[]
  /** Which roles this page is allowed to create. Raw Material owns raw and wip;
   *  Stock owns finished. Offering all three from both would let the same article
   *  be filed under two pages. */
  allowedRoles: StockRole[]
  onDone: () => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [role, setRole] = useState<StockRole>(allowedRoles[0])
  // A finished article is sellable by definition; anything else opts in. The
  // database enforces the first half, so this only has to offer the second.
  const [sellable, setSellable] = useState(false)
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
      role,
      sellable: role === 'finished' ? true : sellable,
      opening_stock: src.opening_stock ? Number(src.opening_stock) : 0,
      // Only raw materials get reordered; the rest are produced to demand.
      reorder_level: role === 'raw' && src.reorder_level ? Number(src.reorder_level) : 0,
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mode === 'existing' ? (
          <Field label="Article *">
            <select required value={pick.material_id} onChange={(e) => setPick({ ...pick, material_id: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {notStocked.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Code *">
              <input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inputCls} placeholder="GIW-4.00" />
            </Field>
            <Field label="Name *">
              <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="GI Wire Roll 4.00 mm" />
            </Field>
            <Field label="Unit">
              <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={inputCls}>
                {['kg', 'MT', 'nos', 'm', 'roll', 'coil'].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
          </>
        )}

        <Field label="What is it here? *">
          <select value={role} onChange={(e) => setRole(e.target.value as StockRole)} className={inputCls}>
            {allowedRoles.includes('raw') && <option value="raw">Raw material — bought in, consumed here</option>}
            {allowedRoles.includes('wip') && <option value="wip">Work in progress — made here, consumed here</option>}
            {allowedRoles.includes('finished') && <option value="finished">Finished goods — made here, sold out</option>}
          </select>
        </Field>
        <Field label="Opening stock">
          <input
            type="number" step="0.001"
            value={mode === 'existing' ? pick.opening_stock : f.opening_stock}
            onChange={(e) => mode === 'existing'
              ? setPick({ ...pick, opening_stock: e.target.value })
              : setF({ ...f, opening_stock: e.target.value })}
            className={inputCls}
          />
        </Field>
        {role === 'raw' && (
          <Field label="Reorder level">
            <input
              type="number" step="0.001"
              value={mode === 'existing' ? pick.reorder_level : f.reorder_level}
              onChange={(e) => mode === 'existing'
                ? setPick({ ...pick, reorder_level: e.target.value })
                : setF({ ...f, reorder_level: e.target.value })}
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <p className="text-xs text-slate-500">{ROLE_HINT[role]}</p>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={role === 'finished' ? true : sellable}
          disabled={role === 'finished'}
          onChange={(e) => setSellable(e.target.checked)}
          className="h-4 w-4 rounded"
        />
        Can be sold to a customer
        <span className="text-xs text-slate-500">
          {role === 'finished'
            ? '\u2014 always, for a finished article'
            : '\u2014 tick for something half-made that is also sold as it stands, like a mesh roll'}
        </span>
      </label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add to this company'}</Button>
    </form>
  )
}

/** One table per role, with the columns that role actually needs. */
export function RoleTable({
  role, rows, scope, onEditReorder, editing, setEditing,
}: {
  role: StockRole
  rows: StockLevel[]
  scope: PlantScope
  onEditReorder: (s: StockLevel, v: number) => void
  editing: string | null
  setEditing: (k: string | null) => void
}) {
  const keyOf = (s: StockLevel) => s.plant_id + '-' + s.material_id
  const isRaw = role === 'raw'

  if (rows.length === 0) {
    return <Empty>Nothing in this group yet.</Empty>
  }

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
            {scope === 'group' && <th className="pb-2 font-medium">Unit</th>}
            <th className="pb-2 font-medium">Material</th>
            <th className="pb-2 text-right font-medium">Opening</th>
            {isRaw ? (
              <>
                <th className="pb-2 text-right font-medium">Bought</th>
                <th className="pb-2 text-right font-medium">Consumed</th>
              </>
            ) : (
              <>
                <th className="pb-2 text-right font-medium">Made</th>
                <th className="pb-2 text-right font-medium">{role === 'wip' ? 'Consumed' : 'Sent out'}</th>
              </>
            )}
            <th className="pb-2 text-right font-medium">Balance</th>
            {isRaw && <th className="pb-2 text-right font-medium">Reorder at</th>}
            <th className="pb-2 font-medium">Last moved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((s) => {
            const low = isRaw && Number(s.balance) < Number(s.reorder_level)
            const neg = Number(s.balance) < 0
            return (
              <tr key={keyOf(s)} className={neg ? 'bg-red-50/60' : low ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                {scope === 'group' && <td className="py-2"><PlantTag code={s.plant_code} /></td>}
                <td className="py-2">
                  <div className="font-medium text-slate-900">{s.code}</div>
                  <div className="text-xs text-slate-500">{s.name}</div>
                </td>
                <td className="py-2 text-right tabular-nums text-slate-500">{fmtQty(s.opening_stock)}</td>
                {isRaw ? (
                  <>
                    <td className="py-2 text-right tabular-nums text-green-700">
                      +{fmtQty(Number(s.purchased) + Number(s.received_in))}
                      {Number(s.received_in) > 0 && (
                        <span className="block text-xs font-normal text-slate-400">{fmtQty(s.received_in)} from other unit</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-amber-700">−{fmtQty(s.consumed)}</td>
                  </>
                ) : (
                  <>
                    <td className="py-2 text-right tabular-nums text-green-700">+{fmtQty(s.produced)}</td>
                    <td className="py-2 text-right tabular-nums text-amber-700">
                      −{fmtQty(role === 'wip' ? s.consumed : s.sent_out)}
                    </td>
                  </>
                )}
                <td className={'py-2 text-right font-semibold tabular-nums ' + (neg ? 'text-red-600' : low ? 'text-amber-600' : 'text-slate-900')}>
                  {fmtQty(s.balance)} <span className="text-xs font-normal text-slate-500">{s.unit}</span>
                </td>
                {isRaw && (
                  <td className="py-2 text-right">
                    {editing === keyOf(s) ? (
                      <input
                        autoFocus type="number" step="0.001"
                        defaultValue={Number(s.reorder_level)}
                        onBlur={(e) => onEditReorder(s, Number(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                      />
                    ) : (
                      <button onClick={() => setEditing(keyOf(s))} className="tabular-nums text-slate-600 underline decoration-dotted underline-offset-2 hover:text-blue-600">
                        {fmtQty(s.reorder_level)}
                      </button>
                    )}
                  </td>
                )}
                <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(s.last_movement)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

