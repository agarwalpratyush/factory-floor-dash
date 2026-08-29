import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useQuery } from '../lib/useQuery'
import { usePlant, scopeKey, type PlantScope } from '../lib/plant'
import { useAuth } from '../lib/auth'
import {
  Badge, Button, Card, Empty, ErrorBox, Field, inputCls,
  NotHere, PlantTag, Spinner, Stat,
} from '../components/ui'
import { fmtNum, today } from '../lib/format'
import type { AccountBalance, AccountTxn } from '../lib/types'

/**
 * Three accounts, and an honest note about everything else.
 *
 * An imprest is a float advanced to a person: money in tops it up, money out is
 * what they spent, and the balance is what should still be in their pocket. An
 * expense account only ever goes out. That difference is the whole reason the two
 * are not one table of "transactions" with a sign.
 */

async function loadAccounts(scope: PlantScope) {
  const [accs, txns] = await Promise.all([
    supabase.from('ff_account_balances').select('*').order('kind').order('code'),
    supabase
      .from('ff_account_txns')
      .select('*')
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(200),
  ])
  const failed = [accs, txns].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)

  // Group-level accounts belong to neither company, so they show in Combined only -
  // the same rule group staff follow on Attendance.
  const all = (accs.data ?? []) as AccountBalance[]
  const visible = scope === 'group' ? all : all.filter((a) => a.plant_id === scope)
  const ids = new Set(visible.map((a) => a.account_id))
  return {
    accounts: visible,
    txns: ((txns.data ?? []) as AccountTxn[]).filter((t) => ids.has(t.account_id)),
  }
}

function NewEntryForm({ account, onDone }: { account: AccountBalance; onDone: () => void }) {
  const isImprest = account.kind === 'imprest'
  const [f, setF] = useState({
    direction: 'out',
    amount: '',
    description: '',
    paid_to: '',
    category: '',
    txn_date: today(),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('ff_account_txns').insert({
      account_id: account.account_id,
      txn_date: f.txn_date,
      direction: f.direction,
      amount: Number(f.amount),
      description: f.description.trim(),
      paid_to: f.paid_to.trim() || null,
      category: f.category.trim() || null,
      recorded_by: 'supervisor',
    })
    setBusy(false)
    if (error) setErr(error.message)
    else {
      setF({ ...f, amount: '', description: '', paid_to: '', category: '' })
      onDone()
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Date">
        <input type="date" value={f.txn_date} max={today()} onChange={(e) => setF({ ...f, txn_date: e.target.value })} className={inputCls} />
      </Field>

      {/* An expense account has nothing coming in, so it is not asked about. */}
      {isImprest ? (
        <Field label="Direction">
          <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className={inputCls}>
            <option value="out">Spent</option>
            <option value="in">Topped up</option>
          </select>
        </Field>
      ) : (
        <Field label="Direction">
          <input readOnly value="Spent" className={inputCls + ' bg-slate-100 text-slate-500'} title="An expense account only goes out" />
        </Field>
      )}

      <Field label="Amount (₹) *">
        <input
          required type="number" step="0.01" min="0.01"
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Category">
        <input
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value })}
          className={inputCls}
          placeholder="free text for now"
          title="No chart of accounts has been agreed yet, so this is whatever you write"
        />
      </Field>
      <Field label="What it was for *">
        <input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} placeholder="diesel for the generator" />
      </Field>
      <Field label="Paid to">
        <input value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} className={inputCls} placeholder="shop, driver, supplier…" />
      </Field>

      {err && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{err}</p>}
      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record entry'}</Button>
      </div>
    </form>
  )
}

function AccountCard({
  account, txns, plantCode, canEnter, onDone,
}: {
  account: AccountBalance
  txns: AccountTxn[]
  plantCode: string | undefined
  canEnter: boolean
  onDone: () => void
}) {
  const [adding, setAdding] = useState(false)
  const isImprest = account.kind === 'imprest'

  // An imprest balance is money still held. An expense account has no balance to
  // speak of - what matters is what has gone out - so it is labelled as spend.
  const headline = isImprest ? Number(account.balance) : Number(account.total_out)
  const short = isImprest && headline < 0

  return (
    <Card
      title={account.name}
      action={
        canEnter && (
          <Button variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : '+ Entry'}
          </Button>
        )
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone={isImprest ? 'violet' : 'slate'}>{isImprest ? 'Imprest float' : 'Expense account'}</Badge>
        {account.plant_id !== null ? <PlantTag code={plantCode} /> : <Badge tone="violet">Group</Badge>}
        {account.holder && <span>held by {account.holder}</span>}
        <span className="ml-auto font-mono">{account.code}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label={isImprest ? 'Float in hand' : 'Spent to date'}
          value={'₹' + fmtNum(headline, 0)}
          sub={isImprest ? 'topped up less spent' : 'all entries'}
          tone={short ? 'bad' : undefined}
        />
        {isImprest && <Stat label="Topped up" value={'₹' + fmtNum(Number(account.total_in), 0)} />}
        <Stat
          label="Entries"
          value={Number(account.entries)}
          sub={account.last_entry ? 'last on ' + account.last_entry : 'nothing recorded yet'}
        />
      </div>

      {adding && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <NewEntryForm account={account} onDone={() => { setAdding(false); onDone() }} />
        </div>
      )}

      <div className="mt-4">
        {txns.length === 0 ? (
          <Empty>Nothing recorded against this account yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-slate-500 uppercase">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">What for</th>
                  <th className="py-2 pr-3 font-medium">Paid to</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{t.txn_date}</td>
                    <td className="py-2 pr-3">{t.description}</td>
                    <td className="py-2 pr-3 text-slate-500">{t.paid_to ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-500">{t.category ?? '—'}</td>
                    <td
                      className={
                        'py-2 pr-3 text-right tabular-nums ' +
                        (t.direction === 'in' ? 'text-green-700' : 'text-slate-900')
                      }
                    >
                      {t.direction === 'in' ? '+' : '−'}₹{fmtNum(Number(t.amount), 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

export default function Accounts() {
  const { scope, byId } = usePlant()
  const { can } = useAuth()
  const money = can('ff_money')
  const canEnter = can('ff_entry') && money

  const q = useQuery(() => loadAccounts(scope), 'accounts-' + scopeKey(scope))

  const byAccount = useMemo(() => {
    const m = new Map<number, AccountTxn[]>()
    for (const t of q.data?.txns ?? []) {
      const list = m.get(t.account_id) ?? []
      list.push(t)
      m.set(t.account_id, list)
    }
    return m
  }, [q.data])

  if (!money) {
    return (
      <NotHere title="Accounts">
        This page is money end to end, so it needs the costs and rates permission.
      </NotHere>
    )
  }

  const accounts = q.data?.accounts ?? []

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Accounts</h1>
        <p className="text-sm text-slate-500">
          Cash that moves without touching stock. Satish's float belongs to neither
          company, so it appears in the combined view only.
        </p>
      </header>

      {q.loading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={q.refresh} />
      ) : accounts.length === 0 ? (
        <Empty>No accounts for this company. Switch to Combined for the group float.</Empty>
      ) : (
        accounts.map((a) => (
          <AccountCard
            key={a.account_id}
            account={a}
            txns={byAccount.get(a.account_id) ?? []}
            plantCode={a.plant_id !== null ? byId(a.plant_id)?.code : undefined}
            canEnter={canEnter}
            onDone={q.refresh}
          />
        ))
      )}

      {/*
        Said plainly rather than mocked up. A page that shows an empty Profit and
        Loss implies one is coming; this says what is actually missing and why.
      */}
      <Card title="Yet to be configured">
        <ul className="space-y-2 text-sm text-slate-600">
          <li>
            <span className="font-medium text-slate-900">Opening balances.</span>{' '}
            Every account starts at zero. Whatever was in Satish's hand on day one
            has to be entered as a top-up before the float means anything.
          </li>
          <li>
            <span className="font-medium text-slate-900">Categories.</span>{' '}
            Free text for now. A fixed list would make the totals look tidy before
            anyone has agreed what the headings are.
          </li>
          <li>
            <span className="font-medium text-slate-900">Bank and cash accounts.</span>{' '}
            Only a float and two expense accounts exist. Nothing here reconciles to
            a bank statement.
          </li>
          <li>
            <span className="font-medium text-slate-900">Bills, receipts and payments in.</span>{' '}
            Money owed to and by the companies is not modelled at all. Orders carry
            values; nothing tracks whether they were paid.
          </li>
          <li>
            <span className="font-medium text-slate-900">Approval and reimbursement.</span>{' '}
            An imprest spend is recorded, not approved, and topping the float back up
            is a manual entry.
          </li>
          <li>
            <span className="font-medium text-slate-900">Periods and closing.</span>{' '}
            There is no month end. Entries can be added to any past date the
            permission allows, and nothing is ever locked.
          </li>
        </ul>
      </Card>
    </div>
  )
}
