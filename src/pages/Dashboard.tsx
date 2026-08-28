import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import { Badge, Card, Empty, ErrorBox, PlantTag, Spinner, STAGE_TONE, Stat } from '../components/ui'
import { daysAgo, fmtDate, fmtMoney, fmtQty, today } from '../lib/format'
import { STAGE_LABEL } from '../lib/types'
import type { Attendance, DailyLabour, InTransit, MaterialTxn, OrderProgress, Plant, StockLevel, Worker } from '../lib/types'

async function loadDashboard(scope: PlantScope) {
  const one = <T extends { eq: (c: string, v: unknown) => T }>(q: T) =>
    scope === 'group' ? q : q.eq('plant_id', scope)

  const [stock, orders, att, attHist, txns, workers, transit, labour] = await Promise.all([
    one(supabase.from('ff_stock_levels').select('*').eq('active', true)),
    one(supabase.from('ff_order_progress').select('*').neq('stage', 'cancelled')),
    supabase.from('ff_attendance').select('*').eq('work_date', today()),
    supabase.from('ff_attendance').select('work_date,status,worker_id').gte('work_date', daysAgo(13)),
    one(supabase.from('ff_material_txns').select('*, ff_materials(code,name,unit)').order('txn_date', { ascending: false }).limit(10)),
    // group staff are not any one company's headcount - Combined View only
    scope === 'group'
      ? supabase.from('ff_workers').select('*').eq('active', true)
      : supabase.from('ff_workers').select('*').eq('active', true).eq('plant_id', scope),
    supabase.from('ff_in_transit').select('*'),
    one(supabase.from('ff_daily_labour').select('*').eq('work_date', today())),
  ])

  const failed = [stock, orders, att, attHist, txns, workers, transit, labour].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  const wk = (workers.data ?? []) as Worker[]
  const ids = new Set(wk.map((w) => w.id))

  return {
    stock: (stock.data ?? []) as StockLevel[],
    orders: (orders.data ?? []) as OrderProgress[],
    // attendance has no plant_id — it is scoped through the worker it belongs to
    att: ((att.data ?? []) as Attendance[]).filter((a) => ids.has(a.worker_id)),
    attHist: ((attHist.data ?? []) as Pick<Attendance, 'work_date' | 'status' | 'worker_id'>[])
      .filter((a) => ids.has(a.worker_id)),
    txns: (txns.data ?? []) as MaterialTxn[],
    workers: wk,
    transit: (transit.data ?? []) as InTransit[],
    labour: (labour.data ?? []) as DailyLabour[],
  }
}

const STAGE_COLOR: Record<string, string> = {
  pending: '#94a3b8', material_ready: '#06b6d4', in_production: '#2563eb',
  qc: '#8b5cf6', packed: '#f59e0b', dispatched: '#16a34a', delivered: '#16a34a',
}

function PlantBreakdown({ plants, data, money }: { plants: Plant[]; data: Awaited<ReturnType<typeof loadDashboard>>; money: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {plants.map((p) => {
        const wk = data.workers.filter((w) => w.plant_id === p.id)
        const ids = new Set(wk.map((w) => w.id))
        const att = data.att.filter((a) => ids.has(a.worker_id))
        // group staff count towards the site they logged that day
        const groupIds = new Set(data.workers.filter((w) => w.plant_id === null).map((w) => w.id))
        const groupHere = data.att.filter((a) => groupIds.has(a.worker_id) && a.at_plant_id === p.id)
        const casual = data.labour
          .filter((l) => l.plant_id === p.id)
          .reduce((s, l) => s + Number(l.head_count), 0)
        const groupOnSite = groupHere.filter((a) => a.status === 'present' || a.status === 'half_day').length
        const onFloor = att.filter((a) => a.status === 'present').length
          + att.filter((a) => a.status === 'half_day').length * 0.5
        const orders = data.orders.filter((o) => o.plant_id === p.id && o.stage !== 'delivered')
        const low = data.stock.filter((s) => s.plant_id === p.id && Number(s.balance) < Number(s.reorder_level))
        const value = orders.reduce((s, o) => s + Number(o.value ?? 0), 0)

        return (
          <Card key={p.id} title={p.name}>
            <p className="-mt-1 mb-3 text-xs text-slate-500">{p.city}, {p.state} — {p.pincode}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500 uppercase">On floor</div>
                <div className="text-xl font-semibold tabular-nums">{fmtQty(onFloor + casual + groupOnSite)}</div>
                <div className="text-xs text-slate-500">
                  {fmtQty(onFloor)} on rolls{casual ? ' + ' + casual + ' daily' : ''}
                  {groupOnSite ? ' + ' + groupOnSite + ' group' : ''}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Open orders</div>
                <div className="text-xl font-semibold tabular-nums">{orders.length}</div>
                {money && <div className="text-xs text-slate-500">{fmtMoney(value)}</div>}
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Low stock</div>
                <div className={'text-xl font-semibold tabular-nums ' + (low.length ? 'text-amber-600' : 'text-green-600')}>
                  {low.length}
                </div>
                <div className="text-xs text-slate-500">{low.map((l) => l.code).join(', ') || 'all above level'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Overdue</div>
                <div className="text-xl font-semibold tabular-nums text-slate-900">
                  {orders.filter((o) => o.days_to_due !== null && Number(o.days_to_due) < 0).length}
                </div>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const { scope, plant, plants, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const { data, loading, error, refresh } = useQuery(() => loadDashboard(scope), 'dash-' + scopeKey(scope))

  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={refresh} />
  if (!data) return null

  const low = data.stock.filter((s) => Number(s.balance) < Number(s.reorder_level))
  const present = data.att.filter((a) => a.status === 'present').length
  const halfDay = data.att.filter((a) => a.status === 'half_day').length
  const absent = data.att.filter((a) => a.status === 'absent').length
  const onFloor = present + halfDay * 0.5
  const headcount = data.workers.length
  const casual = data.labour.reduce((s, l) => s + Number(l.head_count), 0)

  const open = data.orders.filter((o) => o.stage !== 'delivered')
  const dueSoon = open.filter((o) => o.days_to_due !== null && Number(o.days_to_due) <= 14)
  const overdue = open.filter((o) => o.days_to_due !== null && Number(o.days_to_due) < 0)
  const openValue = open.reduce((s, o) => s + Number(o.value ?? 0), 0)

  const stageData = Object.entries(
    open.reduce<Record<string, number>>((acc, o) => {
      acc[o.stage] = (acc[o.stage] ?? 0) + 1
      return acc
    }, {}),
  ).map(([stage, count]) => ({ stage: STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage, key: stage, count }))

  const attByDay = Object.entries(
    data.attHist.reduce<Record<string, number>>((acc, a) => {
      const add = a.status === 'present' ? 1 : a.status === 'half_day' ? 0.5 : 0
      acc[a.work_date] = (acc[a.work_date] ?? 0) + add
      return acc
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, n]) => ({ date: fmtDate(d).slice(0, 6), present: n }))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {scope === 'group' ? 'Combined View' : plant?.name}
          </h1>
          <p className="text-sm text-slate-500">
            {fmtDate(today())}
            {plant && ' · ' + plant.city + ', ' + plant.state}
          </p>
        </div>
        <button onClick={refresh} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
          Refresh
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="On floor today"
          value={fmtQty(onFloor + casual)}
          sub={
            fmtQty(onFloor) + ' of ' + headcount + ' on rolls' +
            (casual ? ' · ' + casual + ' daily-wage' : '') +
            (absent ? ' · ' + absent + ' absent' : '')
          }
          tone={headcount && onFloor / headcount < 0.7 ? 'warn' : 'good'}
        />
        <Stat
          label="Open orders"
          value={open.length}
          sub={money ? fmtMoney(openValue) + ' in the book' : dueSoon.length + ' due within a fortnight'}
        />
        <Stat
          label="Due in 14 days"
          value={dueSoon.length}
          sub={overdue.length ? overdue.length + ' already overdue' : 'nothing overdue'}
          tone={overdue.length ? 'bad' : dueSoon.length ? 'warn' : 'good'}
        />
        <Stat
          label="Low stock"
          value={low.length}
          sub={low.length ? low.map((l) => l.plant_code + ' ' + l.code).join(', ') : 'all above reorder level'}
          tone={low.length ? 'warn' : 'good'}
        />
      </div>

      {scope === 'group' && <PlantBreakdown plants={plants} data={data} money={money} />}

      {data.transit.length > 0 && (
        <Card
          title="In transit between units"
          action={<Link to="/dispatch" className="text-xs font-medium text-blue-600 hover:underline">Dispatch</Link>}
        >
          <ul className="divide-y divide-slate-100">
            {data.transit.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium text-slate-900">{t.material_code ?? '—'}</span>
                  <span className="ml-2 text-sm text-slate-600">{fmtQty(t.qty)} {t.unit}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {t.from_plant} → {t.to_plant} · {t.vehicle_no ?? 'no vehicle'}
                  </span>
                </div>
                <Badge tone={Number(t.days_in_transit) > 5 ? 'red' : 'amber'}>
                  {t.days_in_transit}d on the road
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {low.length > 0 && (
        <Card title="Reorder now" action={<Link to="/stock" className="text-xs font-medium text-blue-600 hover:underline">View stock</Link>}>
          <ul className="divide-y divide-slate-100">
            {low.map((l) => (
              <li key={l.plant_id + '-' + l.material_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  {scope === 'group' && <PlantTag code={l.plant_code} />}
                  <span className="font-medium text-slate-900">{l.name}</span>
                  <span className="text-xs text-slate-500">{l.code}</span>
                </div>
                <div className="text-sm tabular-nums">
                  <span className="font-semibold text-amber-600">{fmtQty(l.balance)}</span>
                  <span className="text-slate-500"> / {fmtQty(l.reorder_level)} {l.unit}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Open orders by stage">
          {stageData.length === 0 ? <Empty>No open orders.</Empty> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stageData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} angle={-20} textAnchor="end" height={54} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {stageData.map((d) => <Cell key={d.key} fill={STAGE_COLOR[d.key] ?? '#2563eb'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Headcount on floor — last 14 days">
          {attByDay.length === 0 ? <Empty>No attendance marked yet.</Empty> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={attByDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Line type="monotone" dataKey="present" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Orders needing attention" action={<Link to="/orders" className="text-xs font-medium text-blue-600 hover:underline">All orders</Link>}>
          {dueSoon.length === 0 ? <Empty>Nothing due in the next fortnight.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {dueSoon.slice(0, 6).map((o) => (
                <li key={o.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {scope === 'group' && <PlantTag code={byId(o.plant_id)?.code} />}
                      <span className="font-medium text-slate-900">{o.order_no}</span>
                      <span className="truncate text-sm text-slate-600">{o.customer}</span>
                    </div>
                    <Badge tone={STAGE_TONE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: Math.min(100, Number(o.pct_complete)) + '%' }} />
                    </div>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-600">{Number(o.pct_complete)}%</span>
                    <span className={'w-20 shrink-0 text-right text-xs tabular-nums ' + (Number(o.days_to_due) < 0 ? 'font-semibold text-red-600' : 'text-slate-500')}>
                      {Number(o.days_to_due) < 0 ? Math.abs(Number(o.days_to_due)) + 'd late' : o.days_to_due + 'd left'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Latest material movement" action={<Link to="/materials" className="text-xs font-medium text-blue-600 hover:underline">All movements</Link>}>
          {data.txns.length === 0 ? <Empty>No movements recorded.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {data.txns.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {scope === 'group' && <PlantTag code={byId(t.plant_id)?.code} />}
                    <Badge tone={t.direction === 'in' ? 'green' : 'amber'}>{t.direction === 'in' ? 'IN' : 'OUT'}</Badge>
                    <span className="text-sm font-medium text-slate-900">{t.ff_materials?.code}</span>
                    <span className="truncate text-xs text-slate-500">{t.party}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums text-slate-900">{fmtQty(t.qty)} {t.ff_materials?.unit}</div>
                    <div className="text-xs text-slate-500">{fmtDate(t.txn_date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
