import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Button, Card, ErrorBox, NeedPlant, Spinner, Stat,
} from '../components/ui'
import { ArticleForm, ROLE_HINT, RoleTable } from '../components/stock'
import { categoriesFor } from '../lib/types'
import type { StockLevel } from '../lib/types'

async function loadStock(scope: PlantScope) {
  let q = supabase.from('ff_stock_levels').select('*').order('plant_code').order('code')
  if (scope !== 'group') q = q.eq('plant_id', scope)
  const stock = await q
  if (stock.error) throw new Error(stock.error.message)
  return { stock: (stock.data ?? []) as StockLevel[] }
}

export default function Stock() {
  const { scope, plant } = usePlant()
  const { can } = useAuth()
  const { data, loading, error, refresh } = useQuery(() => loadStock(scope), 'stock-' + scopeKey(scope))
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  // Which article's whole record is open. Held by the page so the form can sit
  // above the table rather than inside a row of it.
  const [editArticle, setEditArticle] = useState<StockLevel | null>(null)

  const all = useMemo(() => (data?.stock ?? []).filter((s) => s.active), [data])

  // Everything that can go out to a customer, which is every finished article plus
  // any half-made one that is also sold as it stands. Those also appear on Raw
  // Material, because they are consumed there too - one balance, shown where each
  // page needs it, and labelled so nobody adds the two together.
  const finished = useMemo(() => all.filter((s) => s.sellable), [all])
  const alsoConsumed = finished.filter((s) => s.role !== 'finished')

  const negative = finished.filter((s) => Number(s.balance) < 0)
  const held = finished.filter((s) => Number(s.balance) > 0)
  const idle = finished.filter((s) => !s.last_movement)

  /** Either level can be set on its own, and the count can be cleared back to
   *  not watched, which is why it takes a patch rather than a number. */
  async function saveReorder(x: StockLevel, patch: { reorder_level?: number; reorder_packs?: number | null }) {
    const { error } = await supabase
      .from('ff_material_plants')
      .update(patch)
      .eq('material_id', x.material_id)
      .eq('plant_id', x.plant_id)
    if (!error) { setEditing(null); refresh() }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Finished Stock</h1>
          <p className="text-sm text-slate-500">
            What can go out to a customer. Raw material is on <strong>Raw Material</strong>;
            anything half-made that is also sold appears on both, because it is one
            balance doing two jobs.
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
          <ArticleForm
            plantId={plant.id}
            role="finished"
            categories={categoriesFor(plant.processes, 'finished')}
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

      {editArticle && (
        <Card title={'Edit ' + editArticle.code}>
          <ArticleForm
            key={editArticle.plant_id + '-' + editArticle.material_id}
            plantId={editArticle.plant_id}
            role={editArticle.role}
            categories={[...new Set([editArticle.category, ...categoriesFor(plant?.processes ?? [], 'finished')])]}
            article={editArticle}
            onDone={() => { setEditArticle(null); refresh() }}
          />
        </Card>
      )}

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={refresh} /> : (
        <Card title="Sellable articles">
          <p className="-mt-1 mb-3 text-xs text-slate-500">
            {ROLE_HINT.finished}
            {alsoConsumed.length > 0 && (
              <> {alsoConsumed.map((s) => s.code).join(', ')} {alsoConsumed.length === 1 ? 'is' : 'are'}{' '}
              also consumed here, so the same balance shows on Raw Material — it is not extra stock.</>
            )}
          </p>
          <RoleTable
            role="finished"
            rows={finished}
            scope={scope}
            onEditReorder={saveReorder}
            onEdit={can('ff_manage') ? setEditArticle : undefined}
            editing={editing}
            setEditing={setEditing}
          />
        </Card>
      )}
    </div>
  )
}
