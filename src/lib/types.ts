export type Direction = 'in' | 'out'

export type TxnType =
  | 'purchase' | 'production_in' | 'transfer_in' | 'return_in'
  | 'issue' | 'production_out' | 'transfer_out' | 'sale_out' | 'adjustment'

export type OrderStage =
  | 'pending' | 'material_ready' | 'in_production'
  | 'qc' | 'packed' | 'dispatched' | 'delivered' | 'cancelled'

export type AttendanceStatus =
  | 'present' | 'absent' | 'half_day' | 'leave' | 'week_off'

export type DispatchStatus =
  | 'loaded' | 'in_transit' | 'delivered' | 'received' | 'returned' | 'cancelled'

/** Where a load is going. A customer load is sold and gone; an inter-unit load only
 *  lands in the other company's stock once someone there confirms it arrived. */
export type OutwardKind = 'customer' | 'inter_unit'

/** Which production processes a company runs. Held in the database, not in code,
 *  because a company can take on a new one without a code change. */
export type PlantProcess = 'coating' | 'fabrication'

export interface Plant {
  id: number
  code: string
  name: string
  short_name: string
  processes: PlantProcess[]
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  active: boolean
}

export interface Material {
  id: number
  code: string
  name: string
  category: string
  unit: string
  spec: Record<string, unknown>
}

/** What an article IS at a given company. The same article can be finished goods at
 *  one plant and raw material at another — PVC coated wire is exactly that. */
/**
 * No work in progress is held. Something half-made that is also sold - a mesh roll -
 * is `finished` and `sellable`; that it is also woven into a box is a fact about its
 * movements, not about the article. The `ff_stock_role` enum still has the value in
 * Postgres, because a used enum value cannot simply be dropped, but nothing writes it.
 */
export type StockRole = 'raw' | 'finished'

export const STOCK_ROLE_LABEL: Record<StockRole, string> = {
  raw: 'Raw material',
  finished: 'Finished goods',
}

/** One row per (plant, material) pair — there is no single global balance. */
export interface StockLevel {
  plant_id: number
  plant_code: string
  plant_name: string
  material_id: number
  code: string
  name: string
  category: string
  /** The floor's word for one pack: coil, bag or piece. Every article has one -
   *  counting is compulsory. Carries no conversion to the weight. */
  pack_unit: string
  /** Mesh and mesh products, which are sold by area as well as by weight. */
  sold_by_area: boolean
  role: StockRole
  /** May go out to a customer. Always true for a finished article, which since
   *  work in progress was dropped is everything that is made here. */
  sellable: boolean
  unit: string
  spec: Record<string, unknown>
  reorder_level: number
  /** Reorder level as a count. Either measure being breached marks the article
   *  low; null means that one is not watched. */
  reorder_packs: number | null
  active: boolean
  opening_stock: number
  /** The count at the opening, alongside the weight. Nothing derives one from
   *  the other, so both are asked for. */
  opening_packs: number | null
  balance: number
  total_in: number
  total_out: number
  produced: number
  consumed: number
  purchased: number
  received_in: number
  sent_out: number
  /** Observed measures, netted in and out. Each counts only the movements that
   *  recorded it, hence the *_seen counts: a partial total must not read as a
   *  full one. None of these converts to `balance`. */
  packs_balance: number
  weight_kg_balance: number
  sqm_balance: number
  packs_seen: number
  weight_seen: number
  sqm_seen: number
  movements: number
  last_movement: string | null
}

export interface MaterialTxn {
  id: number
  txn_date: string
  direction: Direction
  txn_type: TxnType
  material_id: number
  plant_id: number
  qty: number
  unit_rate: number | null
  party: string | null
  ref_no: string | null
  order_id: number | null
  production_id: number | null
  transfer_id: number | null
  remarks: string | null
  recorded_by: string | null
  ff_materials?: Pick<Material, 'code' | 'name' | 'unit'>
  ff_orders?: { order_no: string   /** Recorded, never derived - see the column comments. */
  qty_packs: number | null
  qty_weight_kg: number | null
  qty_sqm: number | null
} | null
}

export interface Worker {
  id: number
  /** null = group staff covering both units */
  plant_id: number | null
  code: string
  name: string
  phone: string | null
  dept: string
  designation: string | null
  /** Managers are salaried for the job, not the hour, so they draw no overtime. */
  ot_eligible: boolean
  notes: string | null
  shift_default: string
  daily_wage: number | null
  date_joined: string | null
  /** Last working day. Null means still with us; set, they drop off the list the
   *  day after. Derived from it, `active` is never set by hand. */
  left_on: string | null
  active: boolean
}

export interface Attendance {
  id: number
  work_date: string
  worker_id: number
  /** Which site a group-level person worked at. Null for plant-bound staff. */
  at_plant_id: number | null
  status: AttendanceStatus
  shift: string
  in_time: string | null
  out_time: string | null
  ot_hours: number
  remarks: string | null
}

/** An imprest is a float advanced to a person; an expense account only goes out. */
export type AccountKind = 'imprest' | 'expense'

export interface Account {
  id: number
  code: string
  name: string
  kind: AccountKind
  /** Null is group level - the account belongs to neither company. */
  plant_id: number | null
  holder: string | null
  active: boolean
}

export interface AccountTxn {
  id: number
  account_id: number
  txn_date: string
  direction: 'in' | 'out'
  amount: number
  description: string
  paid_to: string | null
  /** Free text until a chart of accounts is agreed. */
  category: string | null
  recorded_by: string | null
  created_by: string | null
}

/** Derived on read, like stock: no stored total to drift out of step. */
export interface AccountBalance {
  account_id: number
  code: string
  name: string
  kind: AccountKind
  plant_id: number | null
  holder: string | null
  active: boolean
  total_in: number
  total_out: number
  balance: number
  entries: number
  last_entry: string | null
}

export interface Order {
  id: number
  plant_id: number
  order_no: string
  customer: string
  po_ref: string | null
  order_date: string
  due_date: string | null
  stage: OrderStage
  priority: string
  value: number | null
  site: string | null
  remarks: string | null
}

export interface OrderProgress {
  id: number
  plant_id: number
  order_no: string
  customer: string
  site: string | null
  order_date: string
  due_date: string | null
  stage: OrderStage
  priority: string
  value: number | null
  qty_ordered: number
  qty_produced: number
  pct_complete: number
  days_to_due: number | null
}

export interface OrderItem {
  id: number
  order_id: number
  description: string
  qty: number
  unit: string
  qty_produced: number
  rate: number | null
  /** The article promised, when the line names one. Null on a free-text line. */
  material_id: number | null
}

export interface DispatchItem {
  id: number
  dispatch_id: number
  material_id: number
  order_item_id: number | null
  qty: number
  unit: string
  ff_materials?: Pick<Material, 'code' | 'name' | 'unit'>
}

export interface Dispatch {
  id: number
  plant_id: number
  kind: OutwardKind
  /** Set for inter_unit only: which of our companies is receiving. */
  to_plant_id: number | null
  received_date: string | null
  received_by: string | null
  dispatch_date: string
  order_id: number | null
  challan_no: string | null
  vehicle_no: string | null
  driver_name: string | null
  driver_phone: string | null
  transporter: string | null
  lr_no: string | null
  qty: number | null
  unit: string
  destination: string | null
  status: DispatchStatus
  remarks: string | null
  ff_orders?: { order_no: string; customer: string } | null
  ff_dispatch_items?: DispatchItem[]
}

export interface Production {
  id: number
  plant_id: number
  prod_date: string
  shift: string
  output_material_id: number
  output_qty: number
  order_id: number | null
  remarks: string | null
  recorded_by: string | null
  ff_materials?: Pick<Material, 'code' | 'name' | 'unit'>
  ff_orders?: { order_no: string } | null
  ff_production_inputs?: ProductionInput[]
}

export interface ProductionInput {
  id: number
  production_id: number
  material_id: number
  qty: number
  ff_materials?: Pick<Material, 'code' | 'name' | 'unit'>
}

/** Which of our companies may send material to which. Missing means it never happens. */
export interface SupplyRoute {
  from_plant_id: number
  to_plant_id: number
  note: string | null
}

/** A row of ff_in_transit: left one of our companies, not yet booked in at the other. */
export interface InTransit {
  id: number
  transfer_date: string
  challan_no: string | null
  vehicle_no: string | null
  transporter: string | null
  from_plant_id: number
  to_plant_id: number
  from_plant: string
  to_plant: string
  qty: number
  material_code: string | null
  unit: string | null
  days_in_transit: number
}

export const ORDER_STAGES: OrderStage[] = [
  'pending', 'material_ready', 'in_production', 'qc', 'packed', 'dispatched', 'delivered',
]

export const STAGE_LABEL: Record<OrderStage, string> = {
  pending: 'Pending',
  material_ready: 'Material Ready',
  in_production: 'In Production',
  qc: 'QC',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half Day',
  leave: 'Leave',
  week_off: 'Week Off',
}

export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  purchase: 'Purchase',
  production_in: 'Produced',
  transfer_in: 'Transfer in',
  return_in: 'Return in',
  issue: 'Issue',
  production_out: 'Consumed',
  transfer_out: 'Transfer out',
  sale_out: 'Sale',
  adjustment: 'Adjustment',
}

/** Saffron runs one coating line with a handful of hands; Agarwal has real departments. */
export const DEPTS_BY_PLANT: Record<string, string[]> = {
  SAF: ['extrusion', 'general', 'maintenance'],
  AGI: ['mesh', 'assembly', 'packing', 'dispatch', 'maintenance', 'qc'],
}

export const DESIGNATIONS = [
  'Operator', 'Labour', 'Helper', 'Fitter', 'Driver',
  'Supervisor', 'Manager', 'Main Manager', 'Technical',
]

/** Daily-wage labour is hired by the day, so it is counted rather than named. */
/** Casual hands, counted rather than named. Many lots per company per day. */
export interface DailyLabour {
  id: number
  plant_id: number
  work_date: string
  work: string | null
  head_count: number
  rate_per_head: number | null
  remarks: string | null
}

/** Below this headcount, grouping people by department is noise. */
export const DEPT_GROUPING_MIN = 7

export const ALL_DEPTS = [
  'extrusion', 'general', 'mesh', 'assembly',
  'qc', 'packing', 'dispatch', 'maintenance',
]

/** Twelve hour shifts, so the day is split two ways and not three. The stored
 *  codes are unchanged - 'A' has always been the day shift - so rows written under
 *  the old eight hour labels still mean what they say. 'C' is gone; it was never
 *  used. 'G' is for group staff, who are not on a shift at all. */
/**
 * What an article is made of, in the floor's words. Saffron buys base wire and
 * polymer; Agarwal buys wire. Global to the article, and what the raw material
 * list is grouped by - not to be confused with `role`, which is what the article
 * does at one company.
 *
 * Deliberately short. Only what is manufactured is tracked here, so there is no
 * Packing or Other to file a stray into: seeded articles for strapping, marking
 * tags and geotextile were removed for exactly that reason. Adding a category is
 * one line, and should follow a real article rather than precede one.
 */
export const MATERIAL_CATEGORIES = ['Base Wire', 'Polymer', 'Product']

/**
 * Every balance is a weight, so there is nothing to choose: a new article is kept
 * in MT. kg is not an alternative to it, only a smaller way of saying the same
 * thing, which is a question for how a number is typed and shown - never for how
 * it is held. Pieces, coils and bags are the count beside the weight.
 *
 * Articles created before this rule are still kept in `kg`, `nos` or `roll`. They
 * keep working: a balance still means what it always meant, and `fmtWeight` reads
 * each one in its own terms.
 */
export const STOCK_UNIT = 'MT'

/** The floor's word for one pack. Counted alongside the weight, never converted. */
export const PACK_UNITS = ['coil', 'bag', 'piece']

/** The usual pack word for a category. A default offered, not a rule enforced. */
export const PACK_BY_CATEGORY: Record<string, string> = {
  'Base Wire': 'coil',
  Polymer: 'bag',
  Product: 'piece',
}

export const SHIFTS = [
  { value: 'A', label: 'Day (8 am – 8 pm)' },
  { value: 'B', label: 'Night (8 pm – 8 am)' },
  { value: 'G', label: 'General' },
]
