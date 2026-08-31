# Context

What someone needs to know before changing this, that the code does not say.
Read this first; the README covers how to run and deploy it.

> **This repository is public.** GitHub Pages will not serve a private repo on a
> free plan. Nothing personal goes in this file: no employee names, no wages, no
> phone numbers, no customer list. Roles and structure only. Check anything you add
> against that before committing.

**Maintain this file.** When a decision here stops being true, change it in the same
commit that makes it untrue. A stale context file is worse than none, because the
next person will trust it.

---

## What this is

Shop-floor tracking for two manufacturing companies that feed each other.

| | Takes in | Puts out |
|---|---|---|
| **Coating company** (`SAF`) | GI wire rolls, PVC granules | PVC coated GI wire |
| **Fabrication company** (`AGI`) | GI wire rolls, coated wire **from SAF** | DT mesh rolls → gabion boxes |

Supply runs **one way only**: SAF → AGI. AGI never sends material back.

Everything lives in the existing `gabion-intel` Supabase project under an `ff_`
prefix, kept apart from the `in_` / `bt_` / `bh_` tender-intel tables that share it.

---

## The decisions that matter

**Stock is derived, never stored.** `ff_stock_levels` computes
`opening + in − out` per (plant, material) on read. There is no running total to
drift out of sync with the ledger. Every balance traces to `ff_material_txns`.

**Raw vs finished depends on where, not what.** Coated wire is the coating
company's *finished product* and the fabrication company's *raw material*. So
`ff_material_plants.role` (`raw` / `wip` / `finished`) sits on the (material,
plant) pair, not on the material. `ff_materials.category` is only the article's
general nature.

**Adding an article always creates one.** The form used to offer a second mode —
pick an article the other company already has, and stock it here too — which is what
puts one `material_id` at both plants. Only the four `PVCW-*` coated wire codes need
that, because `ff_receive_outward` books a transfer in against the same article id
the dispatch line named; they already have it, and supply runs one way, so no new
article will. The mode is gone. **If Saffron ever coats a new size and sends it to
Agarwal, that article has to exist at both** — which is now a deliberate insert into
`ff_material_plants`, not something the form offers. Article codes are unique across
both companies, and a clash is reported as such rather than as a Postgres error.

**Category is what an article is made of; role is what it does here.** Two
different questions, and both are needed. `ff_materials.category` is global and
carries the floor's own words — **Base Wire**, **Polymer**, Packing, Product —
because Saffron buys base wire and polymer and thinks of them apart, while Agarwal
buys wire and needs no split. Grouping the raw list by category gives the right
answer at both sites from one rule. `ff_material_plants.role` stays per company.

The category was previously a seeded raw/consumable/packing taxonomy that nobody
here uses, and the add-article form never showed the field at all — so every
article added by hand was silently filed as `raw`. The form asks now.

**Only what is manufactured is tracked.** Packing and site accessories are not
stocked here. Seeded articles for HDPE strapping, bundle marking tags and
geotextile were removed for that reason, and `MATERIAL_CATEGORIES` deliberately has
no *Packing* or *Other* to file a stray into — an escape-hatch category is how a
list like that fills back up. Adding a category is one line and should follow a
real article rather than precede one.

**What an article IS and whether it may be SOLD are separate facts.** A DT mesh
roll is made to go into a gabion box *and* sold as it stands; one `role` per
(material, plant) could not say both, and the effect was that no mesh roll could be
put on a customer dispatch at all. So `ff_material_plants.sellable` is its own
column. `role` still decides which page owns the article and whether it gets a
reorder level; `sellable` decides whether it can leave to a customer, appear on
Finished Stock, and be promised on an order line. A trigger forces it true for
`finished`, because that is true by definition; `wip` opts in.

An article that is both shows on **two** pages — Raw Material because it is consumed
there, Finished Stock because it can be sold — and both say so in as many words.
That is one balance doing two jobs, not two piles: there is deliberately no
reservation, because splitting the pool would need somebody to move rolls between
buckets and nobody will.

Anything keyed on an article must carry the plant too: a bare `material_id` collides
across companies, which is what made the material picker render duplicate React keys
in the combined view.

**Buying is the only movement typed by hand.** Production posts what it consumed,
Dispatch posts what left, and a transfer posts both sides — so a purchase is the
one event nothing else records. The old Materials tab also offered an *Issue OUT*,
which overlapped with production consumption and would have double-counted;
nothing ever used it, and it is gone. If material needs to leave the store for
some other reason — wastage, maintenance, job work — add an explicit movement type
for it rather than reviving a general-purpose issue.

**Business facts live in data, not code.** Three things that look like they belong
in `if` statements are rows instead, because they change:

| Fact | Where |
|---|---|
| Which company runs which process | `ff_plants.processes` (`coating`, `fabrication`) |
| Which company a login may see | `staff.plant_id` (NULL = both) |
| Who may supply whom | `ff_supply_routes` |

Never hard-code a plant code to express one of these. A new process or route should
be one `UPDATE`.

**Compound writes go through database functions.** Anything that moves stock on
more than one side is a single transaction in Postgres, so it can never be
half-posted:

| Function | Posts |
|---|---|
| `ff_record_production` | The run, its inputs, an `in` for the output, an `out` per input |
| `ff_record_coil_log` | A whole coating shift, its coils, and the three movements it implies |
| `ff_record_outward` | A load leaving, plus `sale_out` (customer) or `transfer_out` (our other company) |
| `ff_receive_outward` | `transfer_in` at the receiving company, closing the load |
| `ff_set_dispatch_status` | Returns and cancellations, putting goods back |

**Never insert into `ff_production`, `ff_dispatches` or `ff_coil_logs` directly** —
stock would not move. `ff_order_stage_log` works the same way, via a trigger.

**Outward movement is one register.** A customer dispatch and a load to our other
company are the same event — a lorry leaving with a challan. Both are
`ff_dispatches` rows separated by `kind`. The only real differences: where it is
going, and whether someone has to confirm it arrived. A load between companies
belongs to neither while it is on the road; the receiving side books it in.

**Dates are the factory's, not the server's.** Postgres runs on UTC, which rolls
over at 05:30 IST and would file a late-evening entry under the previous working
day. Use `ff_today()`, never `current_date`. The client mirrors this with a local
date, not `toISOString()`.

**Warn, do not block, on negative stock.** Back-dated and corrective entries are
normal on a floor, and a hard block teaches people to fudge the number. Negative
balances are counted separately on the Stock page so a genuine ledger error stays
visible instead of hiding inside a low-stock count.

---

## The coating register

The floor keeps the coating line on paper, one row per coil: GI weight, GI
diameter, coated weight, coated diameter — plus a size heading and a note of power
cuts. `ff_coil_logs` + `ff_coil_entries` mirror that sheet exactly.

Two things fall out of it that the paper cannot give you:

- **Granule consumption without weighing anything.** Nobody weighs the PVC that
  goes onto a coil, but coated weight minus GI weight *is* the granules. A sample
  shift derived 267.810 kg at 19.41% pickup from 1,380.020 kg of wire.
- **Transcription errors, caught on entry.** Per-coil pickup clusters tightly
  around the shift mean, so a coil far off it is almost always a slipped digit
  rather than a process event. Transcribe what the register says and let the system
  flag it; never silently correct the source document.

A coating shift also posts an `ff_production` row underneath, which is why
Production shows one run log for both companies and only the entry form differs.

---

## Access

Login is required; with no session every `ff_` table returns zero rows. This reuses
the project's existing `staff` / `roles` / `has_perm()` system rather than adding a
second one. `roles.permissions` is a jsonb map.

| Permission | Grants |
|---|---|
| `ff_view` | Read dashboards, stock, orders, production |
| `ff_entry` | Record attendance, shift logs, production, material movements |
| `ff_manage` | Dispatches, transfers, material and worker masters |
| `ff_money` | See costs, rates and wages |
| `ff_backdate` | Enter a date other than today |
| `ff_orders_write` | Place or change an order — owner only |

Shop-floor staff have **no** access: entry is a manager's job. Three rules are
enforced in RLS, not the interface:

1. **No back-dating or post-dating** without `ff_backdate`.
2. **Only the author may edit** — entry tables carry `created_by`, defaulted to
   `current_email()`. Rows written before this existed have a null `created_by` and
   are admin-only, which is the safe default.
3. **Company scoping** via `ff_can_see_plant()`, which deliberately returns false
   for NULL-plant rows: group staff belong to no company, so a scoped login has no
   business seeing them.

> ⚠ **A view must be created `with (security_invoker = on)`.** Without it a view runs
> as its owner and quietly bypasses the row level security on the tables underneath.
> Every `ff_` view sets it. `ff_attendance_pay` lost the option when it was rebuilt
> with `drop view` / `create view` — which exposed wages past the policies on
> `ff_attendance` — and had to have it put back. Check `reloptions` in `pg_class`
> after rebuilding any view.

> ⚠ **`roles.permissions` is shared with the other tools and has been wiped before.**
> An edit from the group dashboard replaced the whole jsonb object and dropped every
> `ff_*` key, which silently left this app admin-only — nothing errored, queries just
> returned nothing. Always check `select role, permissions from roles` before trusting
> permission behaviour, and always restore with `permissions || jsonb_build_object(...)`
> so the other tools' keys survive.

**Attendance is present or absent.** Five buttons on every row made a simple
question look hard, so the surface offers `P` and `A` only. `half_day`, `leave` and
`week_off` remain in the enum: rows already carrying them still read back and still
price correctly (half a day pays half), and the row shows the recorded status rather
than pretending to be unmarked. Nothing new is written with them. Do not delete
those enum values or the pay branches that handle them — that would silently repay
days already recorded.

**A marked day keeps its detail behind a button.** Shift, overtime and — for group
staff — which site they were at sit behind a small **Details** toggle that appears
only once someone is marked present. An absent day has none of them, and a row is
usually left alone after P is pressed, so the strip stays shut until asked for. The
toggle turns amber when a group person's day is credited to no company, because that
is the one thing in there nobody can be trusted to remember. Everything in the strip
amends the existing row through one `patch()` helper, so a change is saved where it
is made; the site picker used to set local state only and quietly lose its value.

Which rows are open is held in the page component, not in `WorkerRow` — that is
declared inside `Attendance` and so remounts on every render, which is also why the
overtime input is uncontrolled.

**The date is said once, and the caption under the picker is not a repeat of it.**
A page about a single day carried its date three times — in the picker and again in
each card heading. The picker is now the only thing that says *which* day; under it
sits the one thing a date input cannot express, which is where that day stands:
`Sunday · today`, `Saturday · yesterday`, `Friday · 2 days ago`. It turns amber the
moment it is not today, because entering a day's attendance against the wrong date
is the easiest mistake to make here and the hardest to notice afterwards. The
weekday rides along because an attendance page is often really asking whether the
day was a Sunday.

Everywhere a date is printed as text rather than picked, it goes through `fmtDate`
so the month is a word: a numeric ISO date gets misread.

**Clock times are always twelve hour.** The floor says half past eight, never twenty
thirty, and a night shift written `20:00` is read wrong more often than it is read.
`fmtTime` in `src/lib/format.ts` is the only way a time reaches the screen. Note
that `<input type="time">` renders to the viewer's own locale and cannot be forced,
which is why the clocked span is echoed back in words beside it — `8:00 pm → 8:30 am`
— rather than trusting the widget to say it.

**An unmarked day is a missing row, not a third status.** Pressing the lit button
again takes the mark off, and that deletes the row — which is why deleting from
`ff_attendance` follows the same rule as editing (`ff_entry`, own row, a date you
may write to) rather than being administrator-only as it was. Do not add a `none`
status to the enum to represent this: every count on the page is written as
&ldquo;marked&rdquo; versus &ldquo;not marked&rdquo;, and a third value would have to
be excluded everywhere by hand.

Where the day carries more than the mark — overtime, a remark, clock times, or a
site chosen for group staff — the second press asks first, because those are typed
by hand and would go with it. `at_plant_id` deliberately counts only for group
staff: a trigger stamps it on everyone else, so treating it as detail would make
every unmark ask, and a prompt that always appears is one nobody reads.

**The Attendance page splits by how someone is paid, not by whether we know their
name.** Anyone whose designation is `Labour` is listed under Daily-wage labour
rather than on the roll, and moves there the moment the designation is changed —
there is no separate flag to keep in step. They keep their code and are still marked
individually; being paid by the day is not the same as being anonymous. That is why
the labour card has two parts: *On the books* (named, marked P or A) and *Counted,
not named* (the lots).

**Casual labour is its own register, not a footnote to the roll.** Nobody in it is
named, nothing is marked present or absent, and the count changes every day, so it
sits in a separate card under the roll rather than among people who have codes.

`ff_daily_labour` used to be `unique (plant_id, work_date)` — one head count and one
rate per company per day. That cannot describe a real day: four on mesh at 500 and
two on loading at 400 average into a figure true of neither lot. The constraint is
gone and a day carries as many lots as it needs, each with its own count and rate;
`work` is what tells them apart. Deleting a lot needs only `ff_entry` and
authorship now, not an administrator — removing a line you just typed should not
need somebody else.

**Leaving has a date, not a switch.** `ff_workers.left_on` is the last working day:
somebody who left on the 12th belongs on the 12th and on every day before it, and
appears on none after. A boolean cannot say that, so the Attendance page filters on
`left_on is null or left_on >= the date being viewed` rather than on `active`.
`active` still exists because much of the app filters on it, but a trigger derives
it from `left_on` — two flags kept in step by hand always drift apart. Rejoining
clears the date and nothing else: same code, same wage, every day still theirs.

**Adding and editing a worker live on the two header buttons, `+` and the pencil**,
not on the attendance rows. A row is for marking somebody present; an Edit button on
every one of them put a rarely-used control in the busiest place on the page.
Rejoining sits under `+` because coming back is the same event as joining.

**A worker profile is editable; the days behind it are not.** Everything on
`ff_workers` can be changed except `code` — the code is how a person is identified
on the paper register and on every day already recorded, so it is read-only once the
row exists. Two routes by which an edit could have reached backwards are closed:

- **The wage is stamped onto the day.** `ff_attendance_pay` used to read the
  worker's *current* `daily_wage`, so a raise repriced every day that person had
  ever worked. `ff_attendance.day_wage` is now filled in by
  `ff_stamp_attendance_facts()` when the row is written, and the view prefers it. A
  raise applies from the day it is given. The trigger only ever fills a null, never
  overwrites, so amending a row keeps the day's own facts. Rows written before this
  were backfilled from the wage then in force.
- **The company is stamped too.** `at_plant_id` is set for everyone now, not just
  group staff, and the view reads `coalesce(a.at_plant_id, w.plant_id)`. Moving
  someone between companies no longer moves their history with them.

**Deleting a worker is refused once they have days recorded.** The foreign key was
`on delete cascade`, so removing someone erased every day they had ever worked; it
is now `on delete restrict`. Somebody leaving is not a reason to lose the record of
their work — untick *On the rolls* (`active`) instead, which takes them off the
floor and keeps it. A worker with no days can still be deleted outright, which is
what makes a mistyped new entry easy to undo.

**Clock times are shown, not applied.** `in_time` and `out_time` sit in the details
strip beside the shift, and the strip reports the span between them — wrapping past
midnight, because the night shift runs 20:00 to 08:00 and a naive subtraction gives
a negative day. Where that span runs past `standard_day_hours` the excess is
flagged, but it is never written into `ot_hours`: what the clock says and what
someone is paid overtime for are two decisions, and only the second is a manager's
to make. Deriving one from the other would quietly turn a late finish into a wage.

**A remark is the reason the row reads the way it does**, so it belongs to any
marked day, present or absent — which is why the Details toggle appears on both,
even though shift, overtime and site are present-only. A remark that has been
written shows on the row itself, quoted, without opening anything: nobody reads a
note they have to go looking for. Blank saves as null, not an empty string.

**General is the default shift.** Most people here are not on a rota at all, so `G`
is what both column defaults give and what a new worker's form starts on. `A` (day)
and `B` (night) are for someone actually working a shift.

**Overtime is a right, not a bonus.** It is paid at `ff_plants.ot_multiplier`
(default 2.00, the statutory rate) times the ordinary hourly rate, where ordinary
hourly is the daily wage over `ff_plants.standard_day_hours`. **Both sites run
twelve hour shifts**, so that is 12, not the 8 an eight-hour day would imply - a
daily wage buys twelve hours here, and a hand on 300 a day is worth 25 an hour, not
37.50. Both numbers sit on the company so a site can differ. `ff_workers.ot_eligible` decides who draws it —
managers do not, because they are salaried for the job rather than the hour. A
trigger refuses overtime hours on an ineligible worker however they are written, and
`ff_attendance_pay` computes what a day is worth.

---

## Accounts

Cash that moves without touching stock. Three accounts exist and nothing else does:
a float held by a group manager, and one expense account per company.

**An imprest is not an expense account**, which is why `ff_accounts.kind` exists
rather than one table of signed amounts. A float is advanced to a person, topped up
and spent down, and its balance is money that should still be in their pocket — a
number somebody can be asked to account for. An expense account only ever goes out;
it has no balance worth showing, so the page shows spend instead. The entry form
follows: only an imprest is asked which direction the money went.

Balances are derived on read in `ff_account_balances`, the same rule stock follows.
Group-level accounts (`plant_id is null`) appear in the combined view only, the same
rule group staff follow.

The whole tab is behind `ff_money`, both in the sidebar and in RLS — it is money end
to end, so there is no useful read-only view of it for someone who may not see money.

**The page says what it is not.** A *Yet to be configured* card lists what does not
exist: opening balances, an agreed chart of accounts, bank and cash accounts,
receivables and payables, approval and reimbursement, and any notion of a period or
month end. `category` is deliberately free text — inventing a list of headings would
produce tidy totals before anyone had agreed what the headings mean. Say what is
missing rather than shipping an empty statement that implies it is coming.

---

## People

Both companies are owner-operator sized — under ten on the rolls in total. Anything
that assumes departmental headcount, shift rosters or an HR hierarchy is wrong by an
order of magnitude: one operator runs a whole coating line.

- **Group staff** (`ff_workers.plant_id IS NULL`) cover both companies. They are
  marked in the **combined view only**, get one attendance row per day because they
  are one person, and record which site they were at via `at_plant_id`.
- **Daily-wage labour** is hired by the day and cannot be named rows. It lives in
  `ff_daily_labour` as a head count and rate per site per day.
- Department groupings switch off below `DEPT_GROUPING_MIN` heads, because with
  three people the headings are noise.

---

## Design

The interface follows a supplied tool-design brief. The token block at the top of
`src/index.css` is the source of truth:

- IBM Plex Sans and Plex Mono, 13px body, 2px corners, hairline rules
- **No hex outside the token block.** Anything needing a colour in script reads it
  through `token()` in `src/lib/tokens.ts`
- **Colour reports state and nothing else** — green pass, amber review, red fail.
  Anything else is grey. Violet and cyan are mapped to grey for this reason
- Tailwind's palette, fonts and radii are remapped onto the tokens with
  `@theme inline`, so existing markup picks up the design without classes changing

The brief also specifies a layout pattern (app bar, tabs, three columns). **That was
deliberately not adopted** — the sidebar and page structure are the app's own. Apply
the surface, not the information architecture.

---

## Still open

- **Most seeded data is invented.** The two companies, the staff, the permissions and
  one transcribed coil log are real. Customer orders, suppliers, purchases, dispatch
  records and every opening balance are placeholder. Do not present them as findings.
  Four early dispatches have no line items and never moved stock; they cannot be
  backfilled because nothing records which article left.
- **`ff_money` is not a hard boundary.** It hides money in the interface and RLS
  filters rows, but a signed-in user could still read a money column through the
  REST API. Real column enforcement needs masking views plus revoking base-table
  SELECT.
- **Print is written but unverified.** `@media print` rules exist; nobody has run
  Ctrl+P on a production log.
