import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Button, Card, ErrorBox, NeedPlant, Spinner, Stat,
} from '../components/ui'
import { AddMaterialForm, ROLE_HINT, RoleTable } from '../components/stock'
import { STOCK_ROLE_LABEL } from '../lib/types'
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

export default function Stock() {
  const { scope, plant } = usePlant()
  const { can } = useAuth()
  const { data, loading, error, refresh } = useQuery(() => loadStock(scope), 'stock-' + scopeKey(scope))
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const all = useMemo(() => (data?.stock ?? []).filter((s) => s.active), [data])

  // Stock is finished goods only. Raw material and work in progress live on the
  // Raw Material tab, where they are bought and consumed - an article belongs to
  // one page, so nobody has to ask which balance is the real one.
  const finished = useMemo(() => all.filter((s) => s.role === 'finished'), [all])

  const negative = finished.filter((s) => Number(s.balance) < 0)
  const held = finished.filter((s) => Number(s.balance) > 0)
  const idle = finished.filter((s) => !s.last_movement)

  async function saveReorder(s: StockLevel, value: number) {
    const { error } = await supabase
      .from('ff_material_plants')
      .update({ reorder_level: value })
      .eq('material_id', s.material_id)
      .eq('plant_id', s.plant_id)
    if (!error) { setEditing(null); refresh() }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Finished Stock</h1>
          <p className="text-sm text-slate-500">
            What is made here and ready to leave. Raw material and work in progress are
            on <strong>Raw Material</strong> — an article is bought and consumed there,
            and sold from here.
          </p>
        </div>
        {plant && can('ff_manage') && (
          <Button variant={showNew ? 'ghost' : 'primary'} onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'Cancel' : '+ Add article'}
          </Button>
        )}
      </header>

      {showNew && plant && data && (
        <Card title={'Add a finished article to ' + plant.short_name}>
          <AddMaterialForm
            plantId={plant.id}
            existing={all}
            allMaterials={data.materials}
            allowedRoles={['finished']}
            onDone={() => { setShowNew(false); refresh() }}
          />
        </Card>
      )}
      {!plant && <NeedPlant what="add an article" />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Finished articles" value={finished.length} sub="made here, sold from here" />
        <Stat label="Holding stock" value={held.length} sub={held.length ? 'have a balance' : 'nothing on hand'} />
        <Stat
          label="Never moved"
          value={idle.length}
          sub={idle.length ? 'listed but never made' : 'all have moved'}
          tone={idle.length ? 'warn' : 'good'}
        />
        <Stat
          label="Negative balance"
          value={negative.length}
          sub={negative.length ? 'ledger needs a correction' : 'ledger is clean'}
          tone={negative.length ? 'bad' : 'good'}
        />
      </div>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : (
        <Card title={STOCK_ROLE_LABEL.finished}>
          <p className="-mt-1 mb-3 text-xs text-slate-500">{ROLE_HINT.finished}</p>
          <RoleTable
            role="finished"
            rows={finished}
            scope={scope}
            onEditReorder={saveReorder}
            editing={editing}
            setEditing={setEditing}
          />
        </Card>
      )}
    </div>
  )
}
