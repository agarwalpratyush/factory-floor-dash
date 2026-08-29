import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Badge, Empty, ErrorBox, Meter, PlantTag, Result, Section, Spinner, STAGE_STATE,
} from '../components/ui'
import { fmtDate, fmtMoney, fmtQty, today } from '../lib/format'
import { STAGE_LABEL } from '../lib/types'
import type {
  Attendance, DailyLabour, InTransit, MaterialTxn, OrderProgress, Plant, StockLevel, Worker,
} from '../lib/types'

async function loadDashboard(scope: PlantScope) {
  const one = <T extends { eq: (c: string, v: unknown) => T }>(q: T) =>
    scope === 'group' ? q : q.eq('plant_id', scope)

  const [stock, orders, att, txns, workers, transit, labour] = await Promise.all([
    one(supabase.from('ff_stock_levels').select('*').eq('active', true)),
    one(supabase.from('ff_order_progress').select('*').neq('stage', 'cancelled')),
    supabase.from('ff_attendance').select('*').eq('work_date', today()),
    one(supabase.from('ff_material_txns').select('*, ff_materials(code,name,unit)').order('txn_date', { ascending: false }).limit(12)),
    scope === 'group'
      ? supabase.from('ff_workers').select('*').eq('active', true)
      : supabase.from('ff_workers').select('*').eq('active', true).eq('plant_id', scope),
    supabase.from('ff_in_transit').select('*'),
    one(supabase.from('ff_daily_labour').select('*').eq('work_date', today())),
  ])

  const failed = [stock, orders, att, txns, workers, transit, labour].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  const wk = (workers.data ?? []) as Worker[]
  const ids = new Set(wk.map((w) => w.id))

  return {
    stock: (stock.data ?? []) as StockLevel[],
    orders: (orders.data ?? []) as OrderProgress[],
    att: ((att.data ?? []) as Attendance[]).filter((a) => ids.has(a.worker_id)),
    txns: (txns.data ?? []) as MaterialTxn[],
    workers: wk,
    transit: (transit.data ?? []) as InTransit[],
    labour: (labour.data ?? []) as DailyLabour[],
  }
}

type Data = Awaited<ReturnType<typeof loadDashboard>>

function PerCompany({ plants, data, money }: { plants: Plant[]; data: Data; money: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th>Company</th>
            <th className="n">On floor</th>
            <th className="n">Open orders</th>
            {money && <th className="n">Book value</th>}
            <th className="n">Low stock</th>
            <th className="n">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {plants.map((p) => {
            const wk = data.workers.filter((w) => w.plant_id === p.id)
            const ids = new Set(wk.map((w) => w.id))
            const att = data.att.filter((a) => ids.has(a.worker_id))
            const groupIds = new Set(data.workers.filter((w) => w.plant_id === null).map((w) => w.id))
            const groupHere = data.att.filter(
              (a) => groupIds.has(a.worker_id) && a.at_plant_id === p.id
                && (a.status === 'present' || a.status === 'half_day'),
            ).length
            const casual = data.labour.filter((l) => l.plant_id === p.id)
              .reduce((s, l) => s + Number(l.head_count), 0)
            const onRolls = att.filter((a) => a.status === 'present').length
              + att.filter((a) => a.status === 'half_day').length * 0.5
            const orders = data.orders.filter((o) => o.plant_id === p.id && o.stage !== 'delivered')
            const low = data.stock.filter(
              (s) => s.plant_id === p.id && s.role === 'raw' && Number(s.balance) < Number(s.reorder_level),
            )
            const overdue = orders.filter((o) => o.days_to_due !== null && Number(o.days_to_due) < 0).length
            return (
              <tr key={p.id}>
                <td>{p.short_name}</td>
                <td className="n">
                  {fmtQty(onRolls + casual + groupHere)}
                  <span className="faint"> / {wk.length}</span>
                </td>
                <td className="n">{orders.length}</td>
                {money && <td className="n">{fmtMoney(orders.reduce((s, o) => s + Number(o.value ?? 0), 0))}</td>}
                <td className="n">{low.length > 0 ? <span className="badge is-warn">{low.length}</span> : 0}</td>
                <td className="n">{overdue > 0 ? <span className="badge is-fail">{overdue}</span> : 0}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard() {
  const { scope, plants, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const { data, loading, error, refresh } = useQuery(() => loadDashboard(scope), 'dash-' + scopeKey(scope))

  if (loading) return <div className="col fill"><Spinner /></div>
  if (error) return <div className="col fill"><ErrorBox error={error} onRetry={refresh} /></div>
  if (!data) return null

  const low = data.stock.filter((s) => s.role === 'raw' && Number(s.balance) < Number(s.reorder_level))
  const negative = data.stock.filter((s) => Number(s.balance) < 0)
  const present = data.att.filter((a) => a.status === 'present').length
  const half = data.att.filter((a) => a.status === 'half_day').length
  const absent = data.att.filter((a) => a.status === 'absent').length
  const casual = data.labour.reduce((s, l) => s + Number(l.head_count), 0)
  const onFloor = present + half * 0.5 + casual

  const open = data.orders.filter((o) => o.stage !== 'delivered')
  const dueSoon = open.filter((o) => o.days_to_due !== null && Number(o.days_to_due) <= 14)
  const overdue = open.filter((o) => o.days_to_due !== null && Number(o.days_to_due) < 0)
  const openValue = open.reduce((s, o) => s + Number(o.value ?? 0), 0)

  const byStage = Object.entries(
    open.reduce<Record<string, number>>((acc, o) => {
      acc[o.stage] = (acc[o.stage] ?? 0) + 1
      return acc
    }, {}),
  )

  return (
    <>
      {/* Left: what the day looks like. */}
      <div className="col w-sm">
        <span className="label">{fmtDate(today())}</span>
        <Result
          label="On floor"
          value={fmtQty(onFloor)}
          sub={present + ' present · ' + half + ' half · ' + absent + ' absent' + (casual ? ' · ' + casual + ' daily' : '')}
        />
        <Result label="Open orders" value={open.length} sub={money ? fmtMoney(openValue) + ' in the book' : undefined} />
        <Result
          label="Due in 14 days"
          value={dueSoon.length}
          state={overdue.length ? 'fail' : dueSoon.length ? 'warn' : 'ok'}
          sub={overdue.length ? overdue.length + ' already overdue' : 'nothing overdue'}
        />
        <Result
          label="Below reorder"
          value={low.length}
          state={low.length ? 'warn' : 'ok'}
          sub={low.length ? low.map((l) => l.code).join(', ') : 'raw stock above level'}
        />
        {negative.length > 0 && (
          <Result label="Negative balance" value={negative.length} state="fail" sub="ledger needs a correction" />
        )}
        <button type="button" className="btn" onClick={refresh}>Refresh</button>
      </div>

      {/* Centre: the work itself. */}
      <div className="col fill">
        {scope === 'group' && (
          <Section title="By company" flush>
            <PerCompany plants={plants} data={data} money={money} />
          </Section>
        )}

        <Section
          title="Orders needing attention"
          action={<Link to="/orders" className="btn btn-sm btn-ghost">All orders</Link>}
          flush
        >
          {dueSoon.length === 0 ? <Empty>Nothing due in the next fortnight.</Empty> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    {scope === 'group' && <th>Unit</th>}
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Stage</th>
                    <th className="n">Made</th>
                    <th style={{ width: 70 }} />
                    <th className="n">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {dueSoon.slice(0, 10).map((o) => {
                    const late = Number(o.days_to_due) < 0
                    return (
                      <tr key={o.id}>
                        {scope === 'group' && <td><PlantTag code={byId(o.plant_id)?.code} /></td>}
                        <td className="mono">{o.order_no}</td>
                        <td>{o.customer}</td>
                        <td><Badge state={STAGE_STATE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge></td>
                        <td className="n">{Number(o.pct_complete)}%</td>
                        <td>
                          <Meter pct={Number(o.pct_complete)} state={Number(o.pct_complete) >= 100 ? 'ok' : undefined} />
                        </td>
                        <td className="n">
                          {late
                            ? <span className="badge is-fail">{Math.abs(Number(o.days_to_due))}d late</span>
                            : o.days_to_due + 'd'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title="Latest material movement"
          action={<Link to="/materials" className="btn btn-sm btn-ghost">Ledger</Link>}
          flush
        >
          {data.txns.length === 0 ? <Empty>No movements recorded.</Empty> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    {scope === 'group' && <th>Unit</th>}
                    <th className="n">Date</th>
                    <th>Dir</th>
                    <th>Material</th>
                    <th className="n">Qty</th>
                    <th>Party</th>
                  </tr>
                </thead>
                <tbody>
                  {data.txns.map((t) => (
                    <tr key={t.id}>
                      {scope === 'group' && <td><PlantTag code={byId(t.plant_id)?.code} /></td>}
                      <td className="n">{fmtDate(t.txn_date)}</td>
                      <td className="mono">{t.direction === 'in' ? 'IN' : 'OUT'}</td>
                      <td className="mono">{t.ff_materials?.code}</td>
                      <td className="n">{fmtQty(t.qty)} {t.ff_materials?.unit}</td>
                      <td className="muted">{t.party}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {/* Right: what the tool worked out. */}
      <div className="col w-md">
        <Section title="Open orders by stage" flush>
          {byStage.length === 0 ? <Empty>No open orders.</Empty> : (
            <table className="table compact">
              <tbody>
                {byStage.map(([stage, count]) => (
                  <tr key={stage}>
                    <td>{STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage}</td>
                    <td className="n" style={{ width: 44 }}>{count}</td>
                    <td style={{ width: 80 }}>
                      <Meter pct={(count / open.length) * 100} state={STAGE_STATE[stage]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section
          title="Between our companies"
          action={<Link to="/dispatch" className="btn btn-sm btn-ghost">Dispatch</Link>}
          flush
        >
          {data.transit.length === 0 ? <Empty>Nothing on the road.</Empty> : (
            <table className="table compact">
              <thead>
                <tr><th>Material</th><th className="n">Qty</th><th className="n">Out</th></tr>
              </thead>
              <tbody>
                {data.transit.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="mono">{t.material_code ?? '—'}</span>
                      <div className="faint" style={{ fontSize: 'var(--text-caption)' }}>
                        {t.from_plant} → {t.to_plant}
                      </div>
                    </td>
                    <td className="n">{fmtQty(t.qty)} {t.unit}</td>
                    <td className="n">
                      <span className={'badge ' + (Number(t.days_in_transit) > 5 ? 'is-fail' : 'is-warn')}>
                        {t.days_in_transit}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {low.length > 0 && (
          <Section title="Reorder" flush>
            <table className="table compact">
              <thead>
                <tr>
                  {scope === 'group' && <th>Unit</th>}
                  <th>Material</th>
                  <th className="n">On hand</th>
                  <th className="n">Level</th>
                </tr>
              </thead>
              <tbody>
                {low.map((l) => (
                  <tr key={l.plant_id + '-' + l.material_id}>
                    {scope === 'group' && <td><PlantTag code={l.plant_code} /></td>}
                    <td className="mono">{l.code}</td>
                    <td className="n" style={{ color: 'var(--warn)' }}>{fmtQty(l.balance)}</td>
                    <td className="n muted">{fmtQty(l.reorder_level)} {l.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>
    </>
  )
}
