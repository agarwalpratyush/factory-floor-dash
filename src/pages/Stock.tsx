import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Alert, Button, Empty, ErrorBox, Field, NeedPlant, PlantTag, Result, Section, Spinner,
} from '../components/ui'
import { fmtDate, fmtQty } from '../lib/format'
import { STOCK_ROLE_LABEL } from '../lib/types'
import type { Material, StockLevel, StockRole } from '../lib/types'

const ROLE_HINT: Record<StockRole, string> = {
  raw: 'Bought in or received, then consumed here. These carry reorder levels.',
  wip: 'Made here and consumed here. Never bought, never sold.',
  finished: 'Made here and sold or transferred out. Produced to demand, not reordered.',
}

const ROLES: StockRole[] = ['raw', 'wip', 'finished']

async function loadStock(scope: PlantScope) {
  let q = supabase.from('ff_stock_levels').select('*').order('plant_code').order('code')
  if (scope !== 'group') q = q.eq('plant_id', scope)
  const [stock, mats] = await Promise.all([q, supabase.from('ff_materials').select('*').order('code')])
  if (stock.error) throw new Error(stock.error.message)
  if (mats.error) throw new Error(mats.error.message)
  return { stock: (stock.data ?? []) as StockLevel[], materials: (mats.data ?? []) as Material[] }
}

function AddMaterialForm({
  plantId, existing, allMaterials, onDone,
}: { plantId: number; existing: StockLevel[]; allMaterials: Material[]; onDone: () => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [role, setRole] = useState<StockRole>('raw')
  const [f, setF] = useState({
    material_id: '', code: '', name: '', category: 'raw', unit: 'kg',
    opening_stock: '', reorder_level: '',
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
      materialId = Number(f.material_id)
    } else {
      const { data, error } = await supabase.from('ff_materials')
        .insert({ code: f.code.trim().toUpperCase(), name: f.name.trim(), category: f.category, unit: f.unit })
        .select('id').single()
      if (error) { setBusy(false); setErr(error.message); return }
      materialId = data.id
    }

    const { error } = await supabase.from('ff_material_plants').insert({
      material_id: materialId,
      plant_id: plantId,
      role,
      opening_stock: f.opening_stock ? Number(f.opening_stock) : 0,
      reorder_level: role === 'raw' && f.reorder_level ? Number(f.reorder_level) : 0,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="btn-group">
        <button type="button" className={'btn btn-sm' + (mode === 'existing' ? ' is-active' : '')} onClick={() => setMode('existing')}>
          Existing article
        </button>
        <button type="button" className={'btn btn-sm' + (mode === 'new' ? ' is-active' : '')} onClick={() => setMode('new')}>
          New article
        </button>
      </div>

      {mode === 'existing' ? (
        <Field label="Article">
          <select className="select" required value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })}>
            <option value="">Select</option>
            {notStocked.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Code">
            <input className="input mono" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="GIW-4.00" />
          </Field>
          <Field label="Name">
            <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Unit">
            <select className="select" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {['kg', 'MT', 'nos', 'm', 'roll', 'coil'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </>
      )}

      <Field label="What is it here">
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as StockRole)}>
          <option value="raw">Raw material</option>
          <option value="wip">Work in progress</option>
          <option value="finished">Finished goods</option>
        </select>
      </Field>
      <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>{ROLE_HINT[role]}</p>

      <Field label="Opening stock">
        <input className="input num" type="number" step="0.001" value={f.opening_stock} onChange={(e) => setF({ ...f, opening_stock: e.target.value })} />
      </Field>
      {role === 'raw' && (
        <Field label="Reorder level">
          <input className="input num" type="number" step="0.001" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} />
        </Field>
      )}

      {err && <Alert state="fail">{err}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Add to this company'}
      </button>
    </form>
  )
}

function RoleTable({
  role, rows, scope, editing, setEditing, onEditReorder,
}: {
  role: StockRole
  rows: StockLevel[]
  scope: PlantScope
  editing: string | null
  setEditing: (k: string | null) => void
  onEditReorder: (s: StockLevel, v: number) => void
}) {
  const keyOf = (s: StockLevel) => s.plant_id + '-' + s.material_id
  const isRaw = role === 'raw'
  if (rows.length === 0) return <Empty>Nothing in this group.</Empty>

  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            {scope === 'group' && <th>Unit</th>}
            <th>Code</th>
            <th>Material</th>
            <th className="n">Opening</th>
            <th className="n">{isRaw ? 'In' : 'Made'}</th>
            <th className="n">{isRaw ? 'Consumed' : role === 'wip' ? 'Consumed' : 'Sent out'}</th>
            <th className="n">Balance</th>
            {isRaw && <th className="n">Reorder at</th>}
            <th className="n">Last moved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const low = isRaw && Number(s.balance) < Number(s.reorder_level)
            const neg = Number(s.balance) < 0
            return (
              <tr key={keyOf(s)}>
                {scope === 'group' && <td><PlantTag code={s.plant_code} /></td>}
                <td className="mono">{s.code}</td>
                <td className="muted">{s.name}</td>
                <td className="n faint">{fmtQty(s.opening_stock)}</td>
                <td className="n">
                  {fmtQty(isRaw ? Number(s.purchased) + Number(s.received_in) : Number(s.produced))}
                </td>
                <td className="n">
                  {fmtQty(isRaw || role === 'wip' ? Number(s.consumed) : Number(s.sent_out))}
                </td>
                <td className="n" style={neg ? { color: 'var(--fail)' } : low ? { color: 'var(--warn)' } : undefined}>
                  {fmtQty(s.balance)} <span className="faint">{s.unit}</span>
                </td>
                {isRaw && (
                  <td className="n">
                    {editing === keyOf(s) ? (
                      <input
                        className="cell-input num" autoFocus type="number" step="0.001"
                        defaultValue={Number(s.reorder_level)}
                        onBlur={(e) => onEditReorder(s, Number(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    ) : (
                      <button type="button" className="cell-input num" onClick={() => setEditing(keyOf(s))}>
                        {fmtQty(s.reorder_level)}
                      </button>
                    )}
                  </td>
                )}
                <td className="n muted">{fmtDate(s.last_movement)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Stock() {
  const { scope, plant } = usePlant()
  const { can } = useAuth()
  const { data, loading, error, refresh } = useQuery(() => loadStock(scope), 'stock-' + scopeKey(scope))
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const all = useMemo(() => (data?.stock ?? []).filter((s) => s.active), [data])
  const byRole = useMemo(() => ({
    raw: all.filter((s) => s.role === 'raw'),
    wip: all.filter((s) => s.role === 'wip'),
    finished: all.filter((s) => s.role === 'finished'),
  }), [all])

  const low = byRole.raw.filter((s) => Number(s.balance) < Number(s.reorder_level))
  const negative = all.filter((s) => Number(s.balance) < 0)
  const stale = all.filter((s) => !s.last_movement
    || (Date.now() - new Date(s.last_movement).getTime()) / 86400000 > 30)

  async function saveReorder(s: StockLevel, value: number) {
    const { error } = await supabase.from('ff_material_plants')
      .update({ reorder_level: value })
      .eq('material_id', s.material_id).eq('plant_id', s.plant_id)
    if (!error) { setEditing(null); refresh() }
  }

  return (
    <>
      <div className="col w-sm">
        <span className="label">Stock</span>
        <p className="faint" style={{ fontSize: 'var(--text-caption)' }}>
          Held by what each article is here. The same article can be finished goods at one
          company and raw material at the other.
        </p>
        <Result label="Raw articles" value={byRole.raw.length} sub="bought in and consumed" />
        <Result
          label="Below reorder"
          value={low.length}
          state={low.length ? 'warn' : 'ok'}
          sub={low.length ? low.map((l) => l.code).join(', ') : 'nothing to raise'}
        />
        <Result label="Finished goods" value={byRole.finished.length} sub={byRole.wip.length + ' work in progress'} />
        <Result
          label="Negative balance"
          value={negative.length}
          state={negative.length ? 'fail' : 'ok'}
          sub={negative.length ? 'ledger needs a correction' : 'ledger is clean'}
        />
        <Result label="No movement 30 days" value={stale.length} sub="check for dead stock" />

        {plant && can('ff_manage') && (
          <Button variant={showNew ? undefined : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : 'Add material'}
          </Button>
        )}
        {!plant && <NeedPlant what="add a material" />}
      </div>

      <div className="col fill">
        {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : (
          ROLES.map((role) => (
            (byRole[role].length > 0 || role === 'raw') && (
              <Section key={role} title={STOCK_ROLE_LABEL[role]} flush>
                <RoleTable
                  role={role}
                  rows={byRole[role]}
                  scope={scope}
                  editing={editing}
                  setEditing={setEditing}
                  onEditReorder={saveReorder}
                />
              </Section>
            )
          ))
        )}
      </div>

      {showNew && plant && data && (
        <div className="col w-md">
          <Section title={'Add material · ' + plant.short_name}>
            <AddMaterialForm
              plantId={plant.id}
              existing={all}
              allMaterials={data.materials}
              onDone={() => { setShowNew(false); refresh() }}
            />
          </Section>
        </div>
      )}
    </>
  )
}
