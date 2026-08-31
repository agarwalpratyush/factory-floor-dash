import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { Button, ErrorBox, Field, inputCls, Spinner } from '../components/ui'
import { fmtNum, today } from '../lib/format'
import { PRODUCTION_SHIFTS } from '../lib/types'
import type { StockLevel } from '../lib/types'

/**
 * How far a measured diameter may sit from the target before the coil is flagged.
 * Fixed for now, and stated on the form rather than offered as a field - the point
 * is that the floor is told what it is being checked against, not asked to set it.
 */
const GI_TOLERANCE = 0.1
const PVC_TOLERANCE = 0.05

interface CoilRow { gi_weight: string; gi_size: string; pvc_weight: string; pvc_size: string }

export interface CoilLogSummary {
  id: number
  plant_id: number
  plant_code: string
  log_date: string
  shift: string
  shift_label: string | null
  nominal_size_mm: number
  target_pvc_size_mm: number
  power_cuts: number
  remarks: string | null
  coils: number
  gi_total: number
  pvc_total: number
  granules_used: number
  pickup_pct: number
  avg_gi_size: number | null
  avg_pvc_size: number | null
  gi_out_of_tol: number
  pvc_out_of_tol: number
}

interface CoilEntry {
  id: number
  log_id: number
  seq: number
  gi_weight: number
  gi_size: number | null
  pvc_weight: number
  pvc_size: number | null
}

const blankRow = (): CoilRow => ({ gi_weight: '', gi_size: '', pvc_weight: '', pvc_size: '' })

async function loadEntries(logId: number) {
  const { data, error } = await supabase
    .from('ff_coil_entries').select('*').eq('log_id', logId).order('seq')
  if (error) throw new Error(error.message)
  return (data ?? []) as CoilEntry[]
}

/** Detail table for one saved shift, with the same flags the entry grid shows. */
export function CoilDetail({ log }: { log: CoilLogSummary }) {
  const { data, loading, error, refresh } = useQuery(() => loadEntries(log.id), 'coils-' + log.id)
  if (loading) return <Spinner label="Loading coils…" />
  if (error) return <ErrorBox error={error} onRetry={refresh} />
  if (!data) return null

  const pickups = data.map((e) => (Number(e.pvc_weight) - Number(e.gi_weight)) / Number(e.gi_weight) * 100)
  const mean = pickups.reduce((a, b) => a + b, 0) / (pickups.length || 1)

  return (
    <div className="mt-3 scroll-x rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
            <th className="pb-2 font-medium">#</th>
            <th className="pb-2 text-right font-medium">GI wt (kg)</th>
            <th className="pb-2 text-right font-medium">GI size</th>
            <th className="pb-2 text-right font-medium">PVC wt (kg)</th>
            <th className="pb-2 text-right font-medium">PVC size</th>
            <th className="pb-2 text-right font-medium">Pickup</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {data.map((e, i) => {
            const pickup = pickups[i]
            const odd = Math.abs(pickup - mean) > 6
            const giBad = e.gi_size !== null && Math.abs(Number(e.gi_size) - Number(log.nominal_size_mm)) > GI_TOLERANCE
            const pvcBad = e.pvc_size !== null && Math.abs(Number(e.pvc_size) - Number(log.target_pvc_size_mm)) > PVC_TOLERANCE
            return (
              <tr key={e.id} className={odd ? 'bg-red-50' : undefined}>
                <td className="py-1.5 text-slate-500">{e.seq}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-800">{fmtNum(e.gi_weight, 3)}</td>
                <td className={'py-1.5 text-right tabular-nums ' + (giBad ? 'font-semibold text-amber-700' : 'text-slate-600')}>
                  {e.gi_size === null ? '—' : fmtNum(e.gi_size, 3)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-800">{fmtNum(e.pvc_weight, 3)}</td>
                <td className={'py-1.5 text-right tabular-nums ' + (pvcBad ? 'font-semibold text-amber-700' : 'text-slate-600')}>
                  {e.pvc_size === null ? '—' : fmtNum(e.pvc_size, 3)}
                </td>
                <td className={'py-1.5 text-right tabular-nums ' + (odd ? 'font-semibold text-red-600' : 'text-slate-600')}>
                  {pickup.toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Red = pickup more than 6 points off this shift&rsquo;s mean of {mean.toFixed(1)}%, usually a slipped digit.
        Amber = diameter outside tolerance.
      </p>
    </div>
  )
}

export function CoilEntryGrid({
  plantId, stock, onDone,
}: {
  plantId: number
  stock: StockLevel[]
  onDone: () => void
}) {
  const [head, setHead] = useState({
    log_date: today(), shift: 'A',
    nominal_size_mm: '2.600', target_pvc_size_mm: '3.600',
    gi_material_id: '', pvc_material_id: '', granule_material_id: '',
    power_cuts: '0', remarks: '',
  })
  const [rows, setRows] = useState<CoilRow[]>(Array.from({ length: 10 }, blankRow))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  /** Picking what is being made fills in what it is made to. */
  function pickProduct(id: string) {
    const made = stock.find((s) => String(s.material_id) === id)
    setHead((prev) => ({
      ...prev,
      pvc_material_id: id,
      nominal_size_mm: made?.core_mm != null ? String(made.core_mm) : '',
      target_pvc_size_mm: made?.od_mm != null ? String(made.od_mm) : '',
    }))
  }

  const giOpts = stock.filter((s) => s.role === 'raw' && s.category === 'Base Wire')
  const granOpts = stock.filter((s) => s.role === 'raw' && s.category === 'Polymer')
  const pvcOpts = stock.filter((s) => s.role === 'finished' && s.category === 'Polymer Coated GI Wire')

  function setRow(i: number, patch: Partial<CoilRow>) {
    setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)))
  }

  const filled = rows.filter((r) => Number(r.gi_weight) > 0 && Number(r.pvc_weight) > 0)
  const giTotal = filled.reduce((s, r) => s + Number(r.gi_weight), 0)
  const pvcTotal = filled.reduce((s, r) => s + Number(r.pvc_weight), 0)
  const granules = pvcTotal - giTotal
  const pickup = giTotal > 0 ? (granules / giTotal) * 100 : 0

  /** Flags a coil whose pickup sits far from the rest of the shift. */
  function rowFlags(r: CoilRow) {
    const gi = Number(r.gi_weight), pvc = Number(r.pvc_weight)
    const out: string[] = []
    if (gi > 0 && pvc > 0) {
      const p = ((pvc - gi) / gi) * 100
      if (filled.length > 2 && Math.abs(p - pickup) > 6) out.push('pickup ' + p.toFixed(1) + '%')
      if (pvc <= gi) out.push('coated weight not above GI')
    }
    if (r.gi_size && head.nominal_size_mm
      && Math.abs(Number(r.gi_size) - Number(head.nominal_size_mm)) > GI_TOLERANCE) out.push('GI dia')
    if (r.pvc_size && head.target_pvc_size_mm
      && Math.abs(Number(r.pvc_size) - Number(head.target_pvc_size_mm)) > PVC_TOLERANCE) out.push('PVC dia')
    return out
  }

  /** Paste four whitespace- or tab-separated columns straight off a typed-up sheet. */
  function handlePaste(e: React.ClipboardEvent, startIdx: number) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return
    e.preventDefault()
    const parsed = text.trim().split(/\r?\n/).map((line) => {
      const c = line.trim().split(/[\t,]+|\s{2,}|\s+/).filter(Boolean)
      // tolerate a leading serial number like "1)" or "1."
      const nums = c.map((x) => x.replace(/[^0-9.]/g, '')).filter((x) => x !== '')
      const take = nums.length >= 5 ? nums.slice(1, 5) : nums.slice(0, 4)
      return { gi_weight: take[0] ?? '', gi_size: take[1] ?? '', pvc_weight: take[2] ?? '', pvc_size: take[3] ?? '' }
    })
    setRows((prev) => {
      const next = [...prev]
      parsed.forEach((p, i) => {
        while (next.length <= startIdx + i) next.push(blankRow())
        next[startIdx + i] = p
      })
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (filled.length === 0) { setErr('Enter at least one coil.'); return }
    if (granules <= 0) { setErr('Total coated weight must exceed total base wire weight — check the figures.'); return }

    setBusy(true)
    setErr(null)
    setOk(null)
    const { data, error } = await supabase.rpc('ff_record_coil_log', {
      p_plant_id: plantId,
      p_nominal_size_mm: Number(head.nominal_size_mm),
      p_gi_material_id: Number(head.gi_material_id),
      p_pvc_material_id: Number(head.pvc_material_id),
      p_granule_material_id: Number(head.granule_material_id),
      p_entries: filled.map((r, i) => ({
        seq: i + 1,
        gi_weight: Number(r.gi_weight),
        gi_size: r.gi_size ? Number(r.gi_size) : null,
        pvc_weight: Number(r.pvc_weight),
        pvc_size: r.pvc_size ? Number(r.pvc_size) : null,
      })),
      p_log_date: head.log_date,
      p_shift: head.shift,
      p_shift_label: null,
      p_target_pvc_size_mm: Number(head.target_pvc_size_mm),
      p_power_cuts: Number(head.power_cuts) || 0,
      p_remarks: head.remarks.trim() || null,
      p_recorded_by: 'supervisor',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk('Shift log #' + data + ' saved. ' + fmtNum(giTotal / 1000, 3) + ' MT GI and ' +
      fmtNum(granules, 1) + ' kg polymer consumed, ' + fmtNum(pvcTotal / 1000, 3) + ' MT coated wire into stock.')
    setRows(Array.from({ length: 10 }, blankRow))
    onDone()
  }

  const cell = 'w-full rounded border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums focus:border-blue-500 focus:ring-1 focus:ring-blue-100'

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Which day this shift was is a header fact, not one of the things being
          chosen, so it sits at the top right rather than in the run of fields. */}
      <div className="flex items-center justify-end gap-2">
        <label className="text-xs tracking-wide text-slate-500 uppercase" htmlFor="coil-log-date">
          Shift date
        </label>
        <input
          id="coil-log-date"
          type="date" value={head.log_date} max={today()}
          onChange={(e) => setHead({ ...head, log_date: e.target.value })}
          className={inputCls + ' w-auto'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Finished Product *">
          <select required value={head.pvc_material_id} onChange={(e) => pickProduct(e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {pvcOpts.map((s) => <option key={s.material_id} value={s.material_id}>{s.code} — {s.name}</option>)}
          </select>
        </Field>
        <Field label="Base Wire Used *">
          <select required value={head.gi_material_id} onChange={(e) => setHead({ ...head, gi_material_id: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {giOpts.map((s) => <option key={s.material_id} value={s.material_id}>{s.code} — {s.name}</option>)}
          </select>
        </Field>
        <Field label="Polymer Used *">
          <select required value={head.granule_material_id} onChange={(e) => setHead({ ...head, granule_material_id: e.target.value })} className={inputCls}>
            <option value="">Select…</option>
            {granOpts.map((s) => <option key={s.material_id} value={s.material_id}>{s.code} — {s.name}</option>)}
          </select>
        </Field>
        <Field label="Shift">
          <select value={head.shift} onChange={(e) => setHead({ ...head, shift: e.target.value })} className={inputCls}>
            {PRODUCTION_SHIFTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      {/* Stated, not offered. The size comes off the article; a box here would
          invite changing it, and two shifts of one product would drift apart. */}
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
        {!head.pvc_material_id ? (
          <>Choose the finished product above and its sizes will be checked against each coil.</>
        ) : !head.nominal_size_mm && !head.target_pvc_size_mm ? (
          <>
            No size is set for this product, so nothing will be checked. Set it on{' '}
            <strong>Finished Stock</strong>.
          </>
        ) : (
          <>
            Each coil is checked against{' '}
            {head.nominal_size_mm && (
              <><strong>{head.nominal_size_mm} mm</strong> base wire (± {GI_TOLERANCE})</>
            )}
            {head.nominal_size_mm && head.target_pvc_size_mm && ' and '}
            {head.target_pvc_size_mm && (
              <><strong>{head.target_pvc_size_mm} mm</strong> coated (± {PVC_TOLERANCE})</>
            )}
            . Anything outside that turns amber.
          </>
        )}
      </p>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Coils</span>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setRows((r) => [...r, ...Array.from({ length: 5 }, blankRow)])} className="font-medium text-blue-600 hover:underline">
              + 5 rows
            </button>
            <button type="button" onClick={() => setRows(Array.from({ length: 10 }, blankRow))} className="font-medium text-slate-500 hover:underline">
              Clear
            </button>
          </div>
        </div>

        <div className="scroll-x">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="text-xs tracking-wide text-slate-500 uppercase">
                <th className="w-8 pb-1 text-left font-medium">#</th>
                <th className="pb-1 text-right font-medium">Base wire (kg)</th>
                <th className="pb-1 text-right font-medium">GI size</th>
                <th className="pb-1 text-right font-medium">PVC wire (kg)</th>
                <th className="pb-1 text-right font-medium">PVC size</th>
                <th className="pb-1 pl-2 text-left font-medium">Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const flags = rowFlags(r)
                return (
                  <tr key={i}>
                    <td className="py-0.5 text-xs text-slate-400">{i + 1}</td>
                    <td className="py-0.5 pr-1">
                      <input inputMode="decimal" value={r.gi_weight} onPaste={(e) => handlePaste(e, i)}
                        onChange={(e) => setRow(i, { gi_weight: e.target.value })} className={cell} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <input inputMode="decimal" value={r.gi_size}
                        onChange={(e) => setRow(i, { gi_size: e.target.value })} className={cell} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <input inputMode="decimal" value={r.pvc_weight}
                        onChange={(e) => setRow(i, { pvc_weight: e.target.value })} className={cell} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <input inputMode="decimal" value={r.pvc_size}
                        onChange={(e) => setRow(i, { pvc_size: e.target.value })} className={cell} />
                    </td>
                    <td className="py-0.5 pl-2 text-xs whitespace-nowrap text-amber-700">
                      {flags.join(' · ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Paste into the first base wire box to fill many rows at once — a leading serial number is ignored.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 lg:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500 uppercase">Coils</div>
          <div className="text-lg font-semibold tabular-nums">{filled.length}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase">GI in</div>
          <div className="text-lg font-semibold tabular-nums">{fmtNum(giTotal, 3)} kg</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase">Coated out</div>
          <div className="text-lg font-semibold tabular-nums">{fmtNum(pvcTotal, 3)} kg</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase">Polymer (derived)</div>
          <div className={'text-lg font-semibold tabular-nums ' + (granules <= 0 ? 'text-red-600' : 'text-slate-900')}>
            {fmtNum(granules, 3)} kg
          </div>
          <div className="text-xs text-slate-500">{pickup.toFixed(2)}% pickup</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Power cuts this shift">
          <input type="number" min="0" value={head.power_cuts} onChange={(e) => setHead({ ...head, power_cuts: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Remarks">
          <input value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} className={inputCls} placeholder="lite off 2 time" />
        </Field>
      </div>

      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

      <Button type="submit" disabled={busy || filled.length === 0}>
        {busy ? 'Saving…' : 'Save shift log'}
      </Button>
    </form>
  )
}
