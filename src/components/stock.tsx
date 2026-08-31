import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { type PlantScope } from '../lib/plant'
import { Button, Empty, Field, inputCls, PlantTag } from './ui'
import { fmtDate, fmtQty, fmtWeight, toStored } from '../lib/format'
import { PACK_BY_CATEGORY, PACK_LABEL, STOCK_UNIT } from '../lib/types'
import type { StockLevel, StockRole } from '../lib/types'

/**
 * The article table and the add-an-article form, shared by the two pages that
 * hold stock. Raw Material carries raw and work in progress; Stock carries
 * finished goods. Same table either side, because a balance reads the same
 * whatever the article is for.
 */

export const ROLE_HINT: Record<StockRole, string> = {
  raw: 'Bought in or received, then consumed here. These are the ones with reorder levels.',
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
/** Quoted by the square metre as well as by weight: everything woven. */
const AREA_CATEGORIES = ['Gabion Box', 'Rolls', 'Mattress']

/** Drawn to a diameter, so a size means something. A gabion box has dimensions
 *  but not a gauge, which is a different question and not this one. */
const WIRE_CATEGORIES = ['Base Wire', 'GI Wire', 'Polymer Coated GI Wire']

/**
 * One form for adding an article and for editing one. The code is the only thing
 * that cannot change - it is how the article is known on a purchase order, a
 * challan and every movement already recorded against it.
 *
 * Editing touches two tables: what the article *is* lives on `ff_materials` and is
 * shared by both companies; how *this* company files and stocks it lives on
 * `ff_material_plants`. Changing the name changes it everywhere, and that is
 * correct - it is one article.
 */
export function ArticleForm({
  plantId, role, categories, article, onDone,
}: {
  plantId: number
  /** What this page holds. Raw Material creates raw, Finished Stock creates
   *  finished, and neither offers the other - an article filed under both pages
   *  would have two balances answering the same question. Passed rather than
   *  asked, because with work in progress gone there is only ever one answer. */
  role: StockRole
  /** What this company may make or buy at this role. A list of one is still
   *  correct - it says there is one answer, not that the question is missing. */
  categories: string[]
  /** Given, this edits that article instead of creating one. */
  article?: StockLevel
  onDone: () => void
}) {
  const editing = article !== undefined
  // A finished article is sellable by definition; anything else opts in. The
  // database enforces the first half, so this only has to offer the second.
  const [sellable, setSellable] = useState(article?.sellable ?? false)
  const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
  const [f, setF] = useState({
    // MT is the standard, so it is what a new article starts on.
    code: article?.code ?? '',
    name: article?.name ?? '',
    category: article?.category ?? categories[0] ?? '',
    sold_by_area: article?.sold_by_area ?? false,
    opening_stock: str(article?.opening_stock),
    opening_packs: str(article?.opening_packs),
    reorder_level: article
      ? str(Number(article.reorder_packs) > 0 ? article.reorder_packs : article.reorder_level)
      : '',
    core_mm: str(article?.core_mm),
    od_mm: str(article?.od_mm),
    core_tol_minus: str(article?.core_tol_minus),
    core_tol_plus: str(article?.core_tol_plus),
    od_tol_minus: str(article?.od_tol_minus),
    od_tol_plus: str(article?.od_tol_plus),
  })
  // Opening stock is typed in whichever unit the person has it in, like a purchase.
  // Where it lands is not a choice: every new article is kept in MT.
  const [openingUnit, setOpeningUnit] = useState<'MT' | 'kg'>('MT')
  // A reorder level is one number in one measure; which measure is the other half
  // of the answer, not a second level.
  const [reorderIn, setReorderIn] = useState<'weight' | 'packs'>(
    article && Number(article.reorder_packs) > 0 ? 'packs' : 'weight',
  )
  // The sizes and what a coil may vary from them, opened on request.
  const [tolOpen, setTolOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  /** The category is the only choice here: it decides what the article is counted
   *  in, and whether it is measured by area. A trigger sets the pack word from it. */
  function setCategory(category: string) {
    setF((prev) => ({
      ...prev,
      category,
      sold_by_area: AREA_CATEGORIES.includes(category) ? prev.sold_by_area : false,
    }))
  }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** What the article is, shared by both companies. */
  function articleFields() {
    return {
      name: f.name.trim(),
      category: f.category,
      // The size it is made to belongs to the article, so every shift is checked
      // against the same target rather than one typed that morning.
      core_mm: f.core_mm ? Number(f.core_mm) : null,
      od_mm: f.od_mm ? Number(f.od_mm) : null,
      core_tol_minus: f.core_tol_minus ? Number(f.core_tol_minus) : null,
      core_tol_plus: f.core_tol_plus ? Number(f.core_tol_plus) : null,
      od_tol_minus: f.od_tol_minus ? Number(f.od_tol_minus) : null,
      od_tol_plus: f.od_tol_plus ? Number(f.od_tol_plus) : null,
      sold_by_area: f.sold_by_area,
    }
  }

  /** How this company files and stocks it. */
  function plantFields() {
    return {
      // How this company files it. The article carries the same to begin with;
      // they part company only where two companies file one article differently.
      category: f.category,
      sellable: role === 'finished' ? true : sellable,
      opening_stock: f.opening_stock ? toStored(Number(f.opening_stock), openingUnit, STOCK_UNIT) : 0,
      // Blank on an edit means still unknown, which is not the same as zero. A
      // typed zero says the article opened with none; null says nobody counted.
      opening_packs: f.opening_packs ? Number(f.opening_packs) : (editing ? null : 0),
      // One measure or the other. Null rather than zero on the one not chosen:
      // not watching a measure is not the same as watching it for zero.
      reorder_level: role === 'raw' && reorderIn === 'weight' && f.reorder_level
        ? toStored(Number(f.reorder_level), 'MT', STOCK_UNIT)
        : 0,
      reorder_packs: role === 'raw' && reorderIn === 'packs' && f.reorder_level
        ? Number(f.reorder_level)
        : null,
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)

    if (article) {
      // Two tables, because the two halves belong to different owners: the name
      // and the gauge are the article's and change for both companies; the
      // filing and the levels are this company's alone.
      const upd = await supabase.from('ff_materials').update(articleFields()).eq('id', article.material_id)
      if (upd.error) { setBusy(false); setErr(upd.error.message); return }

      const updPlant = await supabase.from('ff_material_plants').update(plantFields())
        .eq('material_id', article.material_id).eq('plant_id', article.plant_id)
      setBusy(false)
      if (updPlant.error) setErr(updPlant.error.message)
      else onDone()
      return
    }

    const { data, error: makeErr } = await supabase
      .from('ff_materials')
      .insert({ ...articleFields(), code: f.code.trim().toUpperCase(), unit: STOCK_UNIT })
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

    const { error } = await supabase.from('ff_material_plants').insert({
      ...plantFields(), material_id: data.id, plant_id: plantId, role,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  /** Only an article nothing has ever moved can go. Anything with a movement
   *  behind it would take that movement with it, or be refused by the database. */
  async function remove() {
    if (!article) return
    setBusy(true)
    setErr(null)
    const off = await supabase.from('ff_material_plants').delete()
      .eq('material_id', article.material_id).eq('plant_id', article.plant_id)
    if (off.error) { setBusy(false); setErr(off.error.message); return }
    // The article itself goes only if no other company still stocks it.
    await supabase.from('ff_materials').delete().eq('id', article.material_id)
    setBusy(false)
    setConfirming(false)
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={editing ? 'Code (cannot change)' : 'Code *'}>
              <input
                required={!editing}
                readOnly={editing}
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value })}
                className={inputCls + (editing ? ' bg-slate-100 text-slate-500' : '')}
                title={editing ? 'How this article is known on a purchase order, a challan and every movement recorded against it' : undefined}
                placeholder="GIW-4.00"
              />
            </Field>
            <Field label="Name *">
              <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="GI Wire Roll 4.00 mm" />
            </Field>
            <Field label="Category">
              <select value={f.category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
        <Field label={'Opening Stock (' + PACK_LABEL[f.category] + ')' + (editing ? '' : ' *')}>
          <input
            required={!editing}
            type="number" step="1" min="0"
            value={f.opening_packs}
            onChange={(e) => setF({ ...f, opening_packs: e.target.value })}
            className={inputCls}
            placeholder={editing ? 'not counted' : undefined}
            title={editing
              ? 'Left blank it stays as it was. An article opened before counting cannot be counted backwards.'
              : 'How many were on hand at the opening. Counted, like the weight.'}
          />
        </Field>
        <Field label="Opening Stock (Weight) *">
          <div className="flex gap-2">
            <input
              required
              type="number" step="0.001" min="0"
              value={f.opening_stock}
              onChange={(e) => setF({ ...f, opening_stock: e.target.value })}
              className={inputCls}
              title="Type 0 if there is none. A stated nothing is worth more than a blank."
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
        {WIRE_CATEGORIES.includes(f.category) && !tolOpen && (
          <div className="flex items-end">
            <Button type="button" variant="ghost" onClick={() => setTolOpen(true)}>
              {f.core_mm || f.od_mm ? 'Tolerance · set' : 'Tolerance'}
            </Button>
          </div>
        )}
        {role === 'raw' && (
          <Field label="Reorder at">
            <div className="flex gap-2">
              <input
                type="number" step={reorderIn === 'packs' ? 1 : 0.001} min="0"
                value={f.reorder_level}
                onChange={(e) => setF({ ...f, reorder_level: e.target.value })}
                className={inputCls}
                placeholder="leave blank if not watched"
              />
              <select
                value={reorderIn}
                onChange={(e) => setReorderIn(e.target.value as 'weight' | 'packs')}
                className="rounded-lg border border-slate-300 px-2 text-sm"
                title="Whichever runs out first is the one that stops the line"
              >
                <option value="weight">MT</option>
                <option value="packs">{PACK_BY_CATEGORY[f.category] ?? 'piece'}s</option>
              </select>
            </div>
          </Field>
        )}
      </div>

      <p className="text-xs text-slate-500">
        {ROLE_HINT[role]} A balance is always a weight — how many
        {' ' + (PACK_BY_CATEGORY[f.category] ?? 'piece')}s it came in is the count beside
        it, not a second way of holding the same stock.
      </p>

      {AREA_CATEGORIES.includes(f.category) && (
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

      {role !== 'finished' && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sellable}
            onChange={(e) => setSellable(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          Can be sold to a customer
          <span className="text-xs text-slate-500">— tick if this is resold as it stands</span>
        </label>
      )}
      {tolOpen && WIRE_CATEGORIES.includes(f.category) && (
        <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Size and tolerance
            </span>
            <button type="button" onClick={() => setTolOpen(false)} className="text-xs text-slate-500 hover:underline">
              Close
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            What a coil is checked against on a shift log. Minus and plus are separate,
            because a tolerance is often not the same either side. Left blank, the coil
            log falls back to its own default.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Base wire size (mm)">
              <input type="number" step="0.001" min="0" value={f.core_mm}
                onChange={(e) => setF({ ...f, core_mm: e.target.value })}
                className={inputCls} placeholder="the wire inside" />
            </Field>
            <Field label="May measure under by">
              <input type="number" step="0.001" min="0" value={f.core_tol_minus}
                onChange={(e) => setF({ ...f, core_tol_minus: e.target.value })}
                className={inputCls} placeholder="0.100" />
            </Field>
            <Field label="May measure over by">
              <input type="number" step="0.001" min="0" value={f.core_tol_plus}
                onChange={(e) => setF({ ...f, core_tol_plus: e.target.value })}
                className={inputCls} placeholder="0.100" />
            </Field>
          </div>

          {f.category === 'Polymer Coated GI Wire' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Coated size (mm)">
                <input type="number" step="0.001" min="0" value={f.od_mm}
                  onChange={(e) => setF({ ...f, od_mm: e.target.value })}
                  className={inputCls} placeholder="outside diameter" />
              </Field>
              <Field label="May measure under by">
                <input type="number" step="0.001" min="0" value={f.od_tol_minus}
                  onChange={(e) => setF({ ...f, od_tol_minus: e.target.value })}
                  className={inputCls} placeholder="0.050" />
              </Field>
              <Field label="May measure over by">
                <input type="number" step="0.001" min="0" value={f.od_tol_plus}
                  onChange={(e) => setF({ ...f, od_tol_plus: e.target.value })}
                  className={inputCls} placeholder="0.050" />
              </Field>
            </div>
          )}

          {f.core_mm && (
            <p className="mt-3 text-xs text-slate-600">
              A base wire coil passes between{' '}
              <strong>{(Number(f.core_mm) - Number(f.core_tol_minus || 0)).toFixed(3)}</strong> and{' '}
              <strong>{(Number(f.core_mm) + Number(f.core_tol_plus || 0)).toFixed(3)}</strong> mm.
              {f.od_mm && (
                <> Coated, between{' '}
                <strong>{(Number(f.od_mm) - Number(f.od_tol_minus || 0)).toFixed(3)}</strong> and{' '}
                <strong>{(Number(f.od_mm) + Number(f.od_tol_plus || 0)).toFixed(3)}</strong> mm.</>
              )}
            </p>
          )}
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add to this company'}
        </Button>
        {editing && <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}

        {editing && Number(article.movements) > 0 && (
          <span className="ml-auto text-xs text-slate-500">
            {article.movements} movement{Number(article.movements) === 1 ? '' : 's'} recorded, so this
            article cannot be removed — its history would go with it.
          </span>
        )}
        {editing && Number(article.movements) === 0 && !confirming && (
          <Button type="button" variant="ghost" className="ml-auto text-red-700" onClick={() => setConfirming(true)}>
            Remove from this company
          </Button>
        )}
        {editing && Number(article.movements) === 0 && confirming && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-600">Remove {article.code}?</span>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>No</Button>
            <Button type="button" variant="danger" disabled={busy} onClick={remove}>Remove</Button>
          </div>
        )}
      </div>
    </form>
  )
}

/** One table per role, with the columns that role actually needs. */
export function RoleTable({
  role, rows, scope, onEditReorder, onEdit, editing, setEditing,
}: {
  role: StockRole
  rows: StockLevel[]
  scope: PlantScope
  onEditReorder: (s: StockLevel, patch: { reorder_level?: number; reorder_packs?: number | null }) => void
  /** Given, each row offers a way into the whole article. */
  onEdit?: (s: StockLevel) => void
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
                <th className="pb-2 text-right font-medium">Used</th>
              </>
            )}
            <th className="pb-2 text-right font-medium">Balance</th>
            {isRaw && <th className="pb-2 text-right font-medium">Reorder at</th>}
            <th className="pb-2 font-medium">Last moved</th>
            {onEdit && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((s) => {
            const lowWeight = isRaw && Number(s.reorder_level) > 0 && Number(s.balance) < Number(s.reorder_level)
            const lowPacks = isRaw && s.reorder_packs !== null && Number(s.reorder_packs) > 0
              && Number(s.packs_balance) < Number(s.reorder_packs)
            const low = lowWeight || lowPacks
            const neg = Number(s.balance) < 0
            return (
              <tr key={keyOf(s)} className={neg ? 'bg-red-50/60' : low ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                {scope === 'group' && <td className="py-2"><PlantTag code={s.plant_code} /></td>}
                <td className="py-2">
                  <div className="font-medium text-slate-900">{s.code}</div>
                  <div className="text-xs text-slate-500">{s.name}</div>
                </td>
                <td className="py-2 text-right tabular-nums text-slate-500">
                  {fmtWeight(s.opening_stock, s.unit)}
                  {s.opening_packs !== null && Number(s.opening_packs) > 0 && (
                    <div className="text-xs text-slate-400">{fmtQty(s.opening_packs)} {s.pack_unit}s</div>
                  )}
                </td>
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
                      −{fmtWeight(Number(s.sent_out) + Number(s.consumed), s.unit)}
                      {Number(s.consumed) > 0 && Number(s.sent_out) > 0 && (
                        <span className="block text-xs font-normal text-slate-400">
                          {fmtWeight(s.consumed, s.unit)} used here
                        </span>
                      )}
                    </td>
                  </>
                )}
                <td className={'py-2 text-right font-semibold tabular-nums ' + (neg ? 'text-red-600' : low ? 'text-amber-600' : 'text-slate-900')}>
                  {fmtWeight(s.balance, s.unit)}
                  {(Number(s.packs_seen) > 0 || Number(s.opening_packs) > 0 || Number(s.sqm_seen) > 0 || s.sold_by_area) && (
                    <div className="text-xs font-normal text-slate-500">
                      {(Number(s.packs_seen) > 0 || Number(s.opening_packs) > 0) && (() => {
                        // A count that has stood still while stock moved is the
                        // opening figure, not a balance. Say which it is, or the
                        // two numbers on this row look like they disagree.
                        const stale = Number(s.packs_seen) === 0 && Number(s.movements) > 0
                        return (
                          <span
                            className={stale ? 'text-slate-400' : undefined}
                            title={stale
                              ? 'None of the ' + s.movements + ' movements was counted, so this is the opening figure'
                              : Number(s.packs_seen) + ' of ' + s.movements + ' movements counted'}
                          >
                            {fmtQty(s.packs_balance)} {s.pack_unit}s{stale ? ' at opening' : ''}
                          </span>
                        )
                      })()}
                      {(Number(s.packs_seen) > 0 || Number(s.opening_packs) > 0) && (Number(s.sqm_seen) > 0 || s.sold_by_area) && ' · '}
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
                {isRaw && (() => {
                  // One level, in one measure. Which measure is part of the answer,
                  // so it is chosen beside the number rather than in a second field:
                  // setting it in coils means it is not being watched in weight.
                  const inPacks = s.reorder_packs !== null && Number(s.reorder_packs) > 0
                  const editKey = keyOf(s) + (inPacks ? ':packs' : ':weight')
                  const editingPacks = editing === keyOf(s) + ':packs'
                  const isEditing = editing === keyOf(s) + ':weight' || editingPacks
                  return (
                    <td className="py-2 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <input
                            autoFocus
                            type="number" step={editingPacks ? 1 : 0.001} min="0"
                            defaultValue={editingPacks
                              ? (s.reorder_packs === null ? '' : Number(s.reorder_packs))
                              : Number(s.reorder_level)}
                            onBlur={(e) => onEditReorder(s, editingPacks
                              ? { reorder_packs: e.target.value === '' ? null : Number(e.target.value), reorder_level: 0 }
                              : { reorder_level: Number(e.target.value), reorder_packs: null })}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                          />
                          <select
                            value={editingPacks ? 'packs' : 'weight'}
                            onChange={(e) => setEditing(keyOf(s) + ':' + e.target.value)}
                            className="rounded-md border border-slate-300 px-1 text-xs"
                          >
                            <option value="weight">{s.unit}</option>
                            <option value="packs">{s.pack_unit}s</option>
                          </select>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditing(editKey)}
                          className={'tabular-nums underline decoration-dotted underline-offset-2 hover:text-blue-600 '
                            + (low ? 'text-amber-700' : 'text-slate-600')}
                        >
                          {inPacks
                            ? fmtQty(s.reorder_packs) + ' ' + s.pack_unit + 's'
                            : Number(s.reorder_level) > 0 ? fmtWeight(s.reorder_level, s.unit) : 'not set'}
                        </button>
                      )}
                    </td>
                  )
                })()}
                <td className="py-2 whitespace-nowrap text-slate-600">{fmtDate(s.last_movement)}</td>
                {onEdit && (
                  <td className="py-2 pl-2 text-right">
                    <button
                      onClick={() => onEdit(s)}
                      title={'Edit ' + s.code}
                      className="rounded-md px-2 py-1 text-xs text-slate-500 ring-1 ring-slate-300 transition hover:bg-slate-100"
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

