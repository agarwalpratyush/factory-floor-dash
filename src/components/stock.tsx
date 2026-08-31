import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { type PlantScope } from '../lib/plant'
import { Button, Empty, Field, inputCls, PlantTag } from './ui'
import { fmtDate, fmtQty, fmtWeight, toStored } from '../lib/format'
import { MATERIAL_CATEGORIES, PACK_BY_CATEGORY, STOCK_UNIT } from '../lib/types'
import type { StockLevel, StockRole } from '../lib/types'

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
/**
 * Creates an article and stocks it here, in one step.
 *
 * It used to offer a second mode - pick an article another company already has
 * and stock it here too - which is what makes one article id live at both. Only
 * the four coated wire codes need that, they already have it, and supply runs one
 * way, so nothing new will. The mode is gone rather than sitting there for a case
 * that does not recur; a shared article is now a deliberate act, not a menu item.
 */
export function AddMaterialForm({
  plantId, allowedRoles, onDone,
}: {
  plantId: number
  /** Which roles this page is allowed to create. Raw Material owns raw and wip;
   *  Stock owns finished. Offering all three from both would let the same article
   *  be filed under two pages. */
  allowedRoles: StockRole[]
  onDone: () => void
}) {
  const [role, setRole] = useState<StockRole>(allowedRoles[0])
  // A finished article is sellable by definition; anything else opts in. The
  // database enforces the first half, so this only has to offer the second.
  const [sellable, setSellable] = useState(false)
  const [f, setF] = useState({
    // MT is the standard, so it is what a new article starts on.
    code: '', name: '', category: MATERIAL_CATEGORIES[0],
    sold_by_area: false,
    opening_stock: '', reorder_level: '',
  })
  // Opening stock is typed in whichever unit the person has it in, like a purchase.
  // Where it lands is not a choice: every new article is kept in MT.
  const [openingUnit, setOpeningUnit] = useState<'MT' | 'kg'>('MT')

  /** The category is the only choice here: it decides what the article is counted
   *  in, and whether it is measured by area. A trigger sets the pack word from it. */
  function setCategory(category: string) {
    setF((prev) => ({
      ...prev,
      category,
      sold_by_area: category === 'Product' ? prev.sold_by_area : false,
    }))
  }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)

    const { data, error: makeErr } = await supabase
      .from('ff_materials')
      .insert({
        code: f.code.trim().toUpperCase(),
        name: f.name.trim(),
        category: f.category,
        unit: STOCK_UNIT,
        sold_by_area: f.sold_by_area,
      })
      .select('id')
      .single()
    if (makeErr) {
      setBusy(false)
      // Codes are unique across both companies, so the clash is usually with an
      // article the other one already has. Say that rather than the raw error.
      setErr(makeErr.code === '23505'
        ? 'That code is already taken — possibly at the other company. Codes are unique across both, so pick another.'
        : makeErr.message)
      return
    }

    const src = f
    const { error } = await supabase.from('ff_material_plants').insert({
      material_id: data.id,
      plant_id: plantId,
      role,
      sellable: role === 'finished' ? true : sellable,
      opening_stock: src.opening_stock ? toStored(Number(src.opening_stock), openingUnit, STOCK_UNIT) : 0,
      // Only raw materials get reordered; the rest are produced to demand.
      reorder_level: role === 'raw' && src.reorder_level
        ? toStored(Number(src.reorder_level), openingUnit, STOCK_UNIT)
        : 0,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Code *">
              <input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inputCls} placeholder="GIW-4.00" />
            </Field>
            <Field label="Name *">
              <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="GI Wire Roll 4.00 mm" />
            </Field>
            <Field label="Category">
              <select value={f.category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {MATERIAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Counted in">
              <div className={inputCls + ' bg-slate-50 text-slate-600'}>
                {PACK_BY_CATEGORY[f.category] ?? 'piece'}s
              </div>
            </Field>
        <Field label="What is it here? *">
          <select value={role} onChange={(e) => setRole(e.target.value as StockRole)} className={inputCls}>
            {allowedRoles.includes('raw') && <option value="raw">Raw material — bought in, consumed here</option>}
            {allowedRoles.includes('wip') && <option value="wip">Work in progress — made here, consumed here</option>}
            {allowedRoles.includes('finished') && <option value="finished">Finished goods — made here, sold out</option>}
          </select>
        </Field>
        <Field label="Opening stock">
          <div className="flex gap-2">
            <input
              type="number" step="0.001"
              value={f.opening_stock}
              onChange={(e) => setF({ ...f, opening_stock: e.target.value })}
              className={inputCls}
            />
            <select
              value={openingUnit}
              onChange={(e) => setOpeningUnit(e.target.value as 'MT' | 'kg')}
              className="rounded-lg border border-slate-300 px-2 text-sm"
              title="How you are typing it. It is kept in MT either way."
            >
              <option value="MT">MT</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </Field>
        {role === 'raw' && (
          <Field label="Reorder level">
            <input
              type="number" step="0.001"
              value={f.reorder_level}
              onChange={(e) => setF({ ...f, reorder_level: e.target.value })}
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <p className="text-xs text-slate-500">
        {ROLE_HINT[role]} A balance is always a weight — how many
        {' ' + (PACK_BY_CATEGORY[f.category] ?? 'piece')}s it came in is the count beside
        it, not a second way of holding the same stock.
      </p>

      {f.category === 'Product' && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={f.sold_by_area}
            onChange={(e) => setF({ ...f, sold_by_area: e.target.checked })}
            className="h-4 w-4 rounded"
          />
          Also measured in square metres
          <span className="text-xs text-slate-500">
            — mesh, gabion boxes and mattresses, which are quoted by area as well as by weight
          </span>
        </label>
      )}

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
            ? '— always, for a finished article'
            : '— tick for something half-made that is also sold as it stands, like a mesh roll'}
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
                <td className="py-2 text-right tabular-nums text-slate-500">{fmtWeight(s.opening_stock, s.unit)}</td>
                {isRaw ? (
                  <>
                    <td className="py-2 text-right tabular-nums text-green-700">
                      +{fmtWeight(Number(s.purchased) + Number(s.received_in), s.unit)}
                      {Number(s.received_in) > 0 && (
                        <span className="block text-xs font-normal text-slate-400">{fmtWeight(s.received_in, s.unit)} from other unit</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-amber-700">−{fmtWeight(s.consumed, s.unit)}</td>
                  </>
                ) : (
                  <>
                    <td className="py-2 text-right tabular-nums text-green-700">+{fmtWeight(s.produced, s.unit)}</td>
                    <td className="py-2 text-right tabular-nums text-amber-700">
                      −{fmtWeight(role === 'wip' ? s.consumed : s.sent_out, s.unit)}
                    </td>
                  </>
                )}
                <td className={'py-2 text-right font-semibold tabular-nums ' + (neg ? 'text-red-600' : low ? 'text-amber-600' : 'text-slate-900')}>
                  {fmtWeight(s.balance, s.unit)}
                  {(Number(s.packs_seen) > 0 || Number(s.sqm_seen) > 0 || s.sold_by_area) && (
                    <div className="text-xs font-normal text-slate-500">
                      {Number(s.packs_seen) > 0 && (
                        <span title={Number(s.packs_seen) + ' of ' + s.movements + ' movements counted'}>
                          {fmtQty(s.packs_balance)} {s.pack_unit}s
                        </span>
                      )}
                      {Number(s.packs_seen) > 0 && (Number(s.sqm_seen) > 0 || s.sold_by_area) && ' · '}
                      {Number(s.sqm_seen) > 0 ? (
                        <span title={Number(s.sqm_seen) + ' of ' + s.movements + ' movements measured'}>
                          {fmtQty(s.sqm_balance)} sqm
                        </span>
                      ) : s.sold_by_area && (
                        <span className="text-slate-400" title="Worked out from the article's size once the formula is set">
                          sqm pending
                        </span>
                      )}
                    </div>
                  )}
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

