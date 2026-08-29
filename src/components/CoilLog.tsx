import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { Alert, ErrorBox, Field, Result, Spinner } from './ui'
import { fmtNum, today } from '../lib/format'
import { SHIFTS } from '../lib/types'
import type { StockLevel } from '../lib/types'

interface CoilRow { gi_weight: string; gi_size: string; pvc_weight: string; pvc_size: string }

export interface CoilLogSummary {
  id: number
  production_id: number | null
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

/** Every coil of one shift, with the same checks the entry grid applies. */
export function CoilDetail({ log }: { log: CoilLogSummary }) {
  const { data, loading, error, refresh } = useQuery(() => loadEntries(log.id), 'coils-' + log.id)
  if (loading) return <Spinner label="Loading coils" />
  if (error) return <ErrorBox error={error} onRetry={refresh} />
  if (!data) return null

  const pickups = data.map((e) => (Number(e.pvc_weight) - Number(e.gi_weight)) / Number(e.gi_weight) * 100)
  const mean = pickups.reduce((a, b) => a + b, 0) / (pickups.length || 1)

  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th className="n">#</th>
            <th className="n">GI wt kg</th>
            <th className="n">GI mm</th>
            <th className="n">PVC wt kg</th>
            <th className="n">PVC mm</th>
            <th className="n">Pickup</th>
          </tr>
        </thead>
        <tbody>
          {data.map((e, i) => {
            const odd = Math.abs(pickups[i] - mean) > 6
            const giBad = e.gi_size !== null && Math.abs(Number(e.gi_size) - Number(log.nominal_size_mm)) > 0.1
            const pvcBad = e.pvc_size !== null && Math.abs(Number(e.pvc_size) - Number(log.target_pvc_size_mm)) > 0.05
            return (
              <tr key={e.id}>
                <td className="n faint">{e.seq}</td>
                <td className="n">{fmtNum(e.gi_weight, 3)}</td>
                <td className="n" style={giBad ? { color: 'var(--warn)' } : undefined}>
                  {e.gi_size === null ? '—' : fmtNum(e.gi_size, 3)}
                </td>
                <td className="n">{fmtNum(e.pvc_weight, 3)}</td>
                <td className="n" style={pvcBad ? { color: 'var(--warn)' } : undefined}>
                  {e.pvc_size === null ? '—' : fmtNum(e.pvc_size, 3)}
                </td>
                <td className="n" style={odd ? { color: 'var(--fail)' } : undefined}>
                  {pickups[i].toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Shift</td>
            <td className="n">{fmtNum(log.gi_total, 3)}</td>
            <td />
            <td className="n">{fmtNum(log.pvc_total, 3)}</td>
            <td />
            <td className="n">{Number(log.pickup_pct).toFixed(2)}%</td>
          </tr>
        </tfoot>
      </table>
      <p className="faint" style={{ fontSize: 'var(--text-caption)', padding: '4px 8px' }}>
        Red pickup is more than 6 points off this shift&rsquo;s mean of {mean.toFixed(1)}%, usually a
        slipped digit. Amber diameter is outside tolerance.
      </p>
    </div>
  )
}

/** The coating register, entered the way the paper sheet is kept: one row per coil. */
export function CoilEntryGrid({
  plantId, stock, onDone,
}: { plantId: number; stock: StockLevel[]; onDone: () => void }) {
  const [head, setHead] = useState({
    log_date: today(), shift: 'A', shift_label: '7 AM',
    nominal_size_mm: '2.600', target_pvc_size_mm: '3.600',
    gi_material_id: '', pvc_material_id: '', granule_material_id: '',
    power_cuts: '0', remarks: '',
  })
  const [rows, setRows] = useState<CoilRow[]>(Array.from({ length: 12 }, blankRow))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const giOpts = stock.filter((s) => s.code.startsWith('GIW'))
  const pvcOpts = stock.filter((s) => s.code.startsWith('PVCW'))
  const granOpts = stock.filter((s) => s.code.startsWith('PVCG') || s.code.startsWith('MB'))

  const setRow = (i: number, patch: Partial<CoilRow>) =>
    setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)))

  const filled = rows.filter((r) => Number(r.gi_weight) > 0 && Number(r.pvc_weight) > 0)
  const giTotal = filled.reduce((s, r) => s + Number(r.gi_weight), 0)
  const pvcTotal = filled.reduce((s, r) => s + Number(r.pvc_weight), 0)
  const granules = pvcTotal - giTotal
  const pickup = giTotal > 0 ? (granules / giTotal) * 100 : 0

  /** Flags a coil whose pickup sits far from the rest of the shift. */
  function rowFlag(r: CoilRow) {
    const gi = Number(r.gi_weight), pvc = Number(r.pvc_weight)
    const out: string[] = []
    if (gi > 0 && pvc > 0) {
      const p = ((pvc - gi) / gi) * 100
      if (filled.length > 2 && Math.abs(p - pickup) > 6) out.push(p.toFixed(1) + '%')
      if (pvc <= gi) out.push('not above GI')
    }
    if (r.gi_size && Math.abs(Number(r.gi_size) - Number(head.nominal_size_mm)) > 0.1) out.push('GI dia')
    if (r.pvc_size && Math.abs(Number(r.pvc_size) - Number(head.target_pvc_size_mm)) > 0.05) out.push('PVC dia')
    return out.join(' · ')
  }

  /** Paste four columns straight off a typed-up sheet; a leading serial is ignored. */
  function handlePaste(e: React.ClipboardEvent, startIdx: number) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return
    e.preventDefault()
    const parsed = text.trim().split(/\r?\n/).map((line) => {
      const c = line.trim().split(/[\t,]+|\s{2,}|\s+/).filter(Boolean)
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
    if (granules <= 0) { setErr('Total coated weight must exceed total GI weight.'); return }

    setBusy(true); setErr(null); setOk(null)
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
      p_shift_label: head.shift_label.trim() || null,
      p_target_pvc_size_mm: Number(head.target_pvc_size_mm),
      p_power_cuts: Number(head.power_cuts) || 0,
      p_remarks: head.remarks.trim() || null,
      p_recorded_by: 'supervisor',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk('Shift ' + data + ' saved. ' + fmtNum(giTotal / 1000, 3) + ' MT GI and '
      + fmtNum(granules, 1) + ' kg granules consumed, ' + fmtNum(pvcTotal / 1000, 3) + ' MT coated wire in.')
    setRows(Array.from({ length: 12 }, blankRow))
    onDone()
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="grid-2">
        <Field label="Date">
          <input className="input" type="date" value={head.log_date} onChange={(e) => setHead({ ...head, log_date: e.target.value })} />
        </Field>
        <Field label="Shift">
          <select className="select" value={head.shift} onChange={(e) => setHead({ ...head, shift: e.target.value })}>
            {SHIFTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="As written on the sheet">
          <input className="input" value={head.shift_label} onChange={(e) => setHead({ ...head, shift_label: e.target.value })} placeholder="7 AM" />
        </Field>
        <Field label="Size mm">
          <input className="input num" type="number" step="0.001" value={head.nominal_size_mm} onChange={(e) => setHead({ ...head, nominal_size_mm: e.target.value })} />
        </Field>
        <Field label="GI wire used">
          <select className="select" required value={head.gi_material_id} onChange={(e) => setHead({ ...head, gi_material_id: e.target.value })}>
            <option value="">Select</option>
            {giOpts.map((s) => <option key={s.material_id} value={s.material_id}>{s.code}</option>)}
          </select>
        </Field>
        <Field label="Coated wire made">
          <select className="select" required value={head.pvc_material_id} onChange={(e) => setHead({ ...head, pvc_material_id: e.target.value })}>
            <option value="">Select</option>
            {pvcOpts.map((s) => <option key={s.material_id} value={s.material_id}>{s.code}</option>)}
          </select>
        </Field>
        <Field label="Granules used">
          <select className="select" required value={head.granule_material_id} onChange={(e) => setHead({ ...head, granule_material_id: e.target.value })}>
            <option value="">Select</option>
            {granOpts.map((s) => <option key={s.material_id} value={s.material_id}>{s.code}</option>)}
          </select>
        </Field>
        <Field label="Target PVC mm">
          <input className="input num" type="number" step="0.001" value={head.target_pvc_size_mm} onChange={(e) => setHead({ ...head, target_pvc_size_mm: e.target.value })} />
        </Field>
      </div>

      <div className="table-wrap" style={{ maxHeight: 300 }}>
        <table className="table compact">
          <thead>
            <tr>
              <th className="n">#</th>
              <th className="n">GI wire kg</th>
              <th className="n">GI mm</th>
              <th className="n">PVC wire kg</th>
              <th className="n">PVC mm</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="n faint">{i + 1}</td>
                <td><input className="cell-input num" inputMode="decimal" value={r.gi_weight} onPaste={(e) => handlePaste(e, i)} onChange={(e) => setRow(i, { gi_weight: e.target.value })} /></td>
                <td><input className="cell-input num" inputMode="decimal" value={r.gi_size} onChange={(e) => setRow(i, { gi_size: e.target.value })} /></td>
                <td><input className="cell-input num" inputMode="decimal" value={r.pvc_weight} onChange={(e) => setRow(i, { pvc_weight: e.target.value })} /></td>
                <td><input className="cell-input num" inputMode="decimal" value={r.pvc_size} onChange={(e) => setRow(i, { pvc_size: e.target.value })} /></td>
                <td style={{ color: 'var(--warn)', fontSize: 'var(--text-caption)' }}>{rowFlag(r)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{filled.length} coils</td>
              <td className="n">{fmtNum(giTotal, 3)}</td>
              <td />
              <td className="n">{fmtNum(pvcTotal, 3)}</td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
        Paste into the first GI wire cell to fill many rows at once. A leading serial number is ignored.
      </p>

      <div className="grid-3">
        <Result label="GI in" value={fmtNum(giTotal, 3)} sub="kg" flat />
        <Result label="Coated out" value={fmtNum(pvcTotal, 3)} sub="kg" flat />
        <Result
          label="Granules"
          value={fmtNum(granules, 3)}
          state={granules <= 0 ? 'fail' : undefined}
          sub={pickup.toFixed(2) + '% pickup'}
          flat
        />
      </div>

      <div className="grid-2">
        <Field label="Power cuts">
          <input className="input num" type="number" min="0" value={head.power_cuts} onChange={(e) => setHead({ ...head, power_cuts: e.target.value })} />
        </Field>
        <Field label="Remarks">
          <input className="input" value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} placeholder="lite off 2 time" />
        </Field>
      </div>

      {err && <Alert state="fail">{err}</Alert>}
      {ok && <Alert state="ok">{ok}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={busy || filled.length === 0}>
        {busy ? 'Saving…' : 'Save shift'}
      </button>
    </form>
  )
}
