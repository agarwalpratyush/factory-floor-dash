# Factory Floor Data Dash

Shop-floor tracking for two units that feed each other:

| Unit | Where | Takes in | Puts out |
|---|---|---|---|
| **Saffron Wires & Cables** (`SAF`) | Jalan Complex, Jungalpur, Howrah, WB 711411 | GI wire rolls (bought), PVC granules | PVC coated GI wire |
| **Agarwal Gabion Industries** (`AGI`) | Ethelbari, Birpara, Alipurduar, WB 735204 | GI wire rolls (bought), PVC coated GI wire (**from Saffron**) | DT mesh rolls → gabion boxes |

Vite + React + TypeScript + Tailwind v4, talking straight to Supabase Postgres.

**Live:** https://agarwalpratyush.github.io/factory-floor-dash/

## Running it

```bash
npm install
```

```bash
npm run dev
```

Copy `.env.example` to `.env` and fill in the project URL and publishable key
(`.env` is gitignored; the working one is already in place locally).

## Modules

The sidebar switches between **Saffron**, **Agarwal**, and **Both units**. Group
view is read-only — a new record has to belong to exactly one unit, so entry
forms ask you to pick one first.

| Route | What it does |
|---|---|
| `/` | Dashboard — headcount, open orders, due dates, low stock, goods in transit. In group view, a side-by-side card per unit |
| `/orders` | Order list, stage pipeline, per-line produced qty, stage history |
| `/shift-log` | The coating register, coil by coil. Derives granule use and flags suspect rows |
| `/production` | Record a run: one output, many inputs. Posts both sides of the stock movement |
| `/materials` | Purchases in, issues out, searchable ledger tagged by movement type |
| `/stock` | Live balances per unit, reorder levels, negative-balance and dead-stock checks |
| `/transfers` | Saffron → Agarwal movements, with in-transit tracking and receipt confirmation |
| `/attendance` | Tap-to-mark attendance by department, 30-day summary, daily wage bill |
| `/dispatch` | Customer dispatches with challan/LR/vehicle/driver and status |

## Deploying

```bash
npm run deploy
```

Builds and pushes `dist/` to the `gh-pages` branch, which GitHub Pages serves.

Two things make a single-page app work on Pages. `vite.config.ts` sets
`base: '/factory-floor-dash/'` so assets resolve under the repo subpath, and the
router takes its `basename` from `import.meta.env.BASE_URL` to match. Pages has no
server to rewrite deep links, so `scripts/pages-fixup.mjs` copies `index.html` to
`404.html` — Pages serves that for any unknown path, the app boots, and the router
picks up the route. It also writes `.nojekyll`, without which Pages would hide files
beginning with an underscore.

Hosting somewhere else later needs no code change:

```bash
BASE_PATH=/ npm run build:pages
```

The repository is public, because GitHub Pages will not serve a private repo on a
free plan. That means the built bundle — including the Supabase project URL and
**publishable** key — is readable by anyone. That is how every browser-side Supabase
app works, and it is safe only because of the permissions below: verified from the
live site, an anonymous request with that key returns zero rows from every `ff_`
table, and `staff` returns `permission denied`. Never put a service-role key in this
bundle.

## Data model

All tables are prefixed `ff_` in the existing `gabion-intel` Supabase project
(ref `qqzkqaedroeehuewmiic`), keeping them separate from the `in_`/`bt_`/`bh_`
tender-intel families.

```
ff_plants ─┬─< ff_workers ──< ff_attendance
           ├─< ff_coil_logs ──< ff_coil_entries    (one row per coil)
           ├─< ff_orders ──< ff_order_items
           │         └──< ff_order_stage_log      (trigger-written)
           │         └──< ff_dispatches
           ├─< ff_material_plants >── ff_materials
           ├─< ff_material_txns                   (the one true ledger)
           ├─< ff_production ──< ff_production_inputs
           └─< ff_transfers                       (from_plant → to_plant)
```

### The four decisions that matter

**1. The material master is global; stock is per unit.**
`PVC Coated GI Wire 2.70/3.70` is one row in `ff_materials`, stocked by both
units through `ff_material_plants` (which carries each unit's own opening balance
and reorder level). That is what lets a transfer move a single `material_id`
between plants instead of mapping between two near-identical articles.

**2. Stock is derived, never stored.**
`ff_stock_levels` computes `opening + in − out` per (plant, material) on read.
There is no running total to drift out of sync with the ledger.

**3. Transfers are two-sided on purpose.**
Stock leaves Saffron the day it is dispatched and only arrives at Agarwal when
someone confirms receipt. Howrah to Alipurduar is a 3-day haul, so goods on the
truck are genuinely at neither unit — `ff_in_transit` shows exactly what is on the
road and for how long. Short receipts are allowed: pass the actual quantity and the
gap against the challan stays on record.

**4. Compound writes go through RPCs, not the client.**

| Function | Posts |
|---|---|
| `ff_record_production(...)` | The run, its inputs, an `in` for the output, an `out` per input |
| `ff_record_transfer(...)` | The transfer plus the `out` at the sending unit |
| `ff_receive_transfer(...)` | The `in` at the receiving unit, and closes the transfer |

Each runs in one transaction, so stock can never be half-posted. **Never insert
into `ff_production` or `ff_transfers` directly** — stock would not move.
`ff_order_stage_log` works the same way via a trigger on `ff_orders`.

`ff_material_txns.txn_type` records *why* stock moved (`purchase`, `production_in`,
`transfer_in`, `issue`, `production_out`, `transfer_out`, …). Direction alone
cannot tell a bought tonne from a produced one, and they cost very differently.

### The coating shift log

The floor keeps the coating line on paper, one row per coil:

```
18.7.26   7 AM        SIZE :- 2.6 mm
GI WIRE   GI SIZE   P.V.C WIRE   P.V.C SIZE
36.500    2.596     42.620       3.629
73.610    2.596     87.230       3.624
...
                                  lite off 2 time
```

`ff_coil_logs` + `ff_coil_entries` mirror that sheet exactly, and
`ff_record_coil_log(...)` turns one shift into three stock movements. Two things
fall out of it that the paper cannot give you:

**Granule consumption, without weighing anything.** Nobody weighs the PVC that goes
onto a coil. But coated weight minus GI weight *is* the granules, coil by coil. The
18 July shift: 1,380.020 kg in, 1,647.830 kg out, so 267.810 kg of granules at
19.41% pickup. That figure is derived, never keyed.

**Bad rows, caught on entry.** Per-coil pickup should cluster tightly around the
shift mean. On that same sheet coil 3 reads 55.280 → 76.300, a 38.0% pickup against
a 19.4% mean — if the 76.300 were 66.300 it lands at 19.9%, so it is almost
certainly a slipped digit. The entry grid flags a row as you type it, and the saved
detail view keeps flagging it, because it is transcribed as written rather than
silently corrected. Diameters outside tolerance are flagged separately: on that
shift coils 10 and 11 ran 2.74–2.76 mm GI against a 2.6 nominal, which is an
incoming-wire problem, not a line problem.

Paste support: dropping four columns into the first cell fills the grid, and a
leading serial number like `1)` is ignored.

### Negative stock

Issues and production runs warn when a quantity exceeds the current balance but do
not block it — back-dated entry is normal on a shop floor, and a hard block just
teaches people to fudge the number. The Stock page counts negative balances
separately so a genuine ledger error stays visible instead of hiding inside a
"low stock" count.

## Permissions

Login is required. There is no anonymous access: with no session, every `ff_` table
returns zero rows.

This reuses the `staff` / `roles` system already in the project rather than adding a
second one. `roles.permissions` is a jsonb map; four keys were added for the factory:

| Permission | Grants |
|---|---|
| `ff_view` | Read dashboards, stock, orders, production |
| `ff_entry` | Record attendance, shift logs, production, material movements |
| `ff_manage` | Create and edit orders, dispatches, transfers, material masters |
| `ff_money` | See wages, order values, rates and purchase prices |
| `admin` | Everything, both companies (pre-existing) |

| Role | view | entry | manage | money |
|---|---|---|---|---|
| `admin` | yes | yes | yes | yes |
| `office` | yes | yes | yes | yes |
| `factory_manager` | yes | yes | yes | yes |
| `factory` | yes | yes | — | — |
| `tender`, `design` | — | — | — | — |

`staff.plant_id` scopes a login to one company; NULL means both. A scoped login
cannot see the other company's rows at all, cannot see group staff (who belong to
neither company), and is pinned out of the Combined View. Transfers are the one
exception: they are visible from both ends, so a receiving manager can see what is
coming.

Enforcement is in the database, not the client. `ff_can_see_plant()` and
`has_perm()` sit inside the RLS policies on every table; the React app reads
`ff_me()` only to decide what to draw. Signup is already gated by
`enforce_staff_signup()` — an email that is not on the staff list cannot create an
account.

### Known limit

`ff_money` currently hides money in the interface, and RLS stops the wrong *rows*
being read, but it does not stop a signed-in `factory` user from reading a money
*column* through the API directly. Column-level enforcement needs masking views
plus revoking base-table SELECT, which is a follow-up. Treat `ff_money` as
"colleagues should not see this", not as a hard boundary against a determined
signed-in user.
