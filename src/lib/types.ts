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
export type StockRole = 'raw' | 'wip' | 'finished'

export const STOCK_ROLE_LABEL: Record<StockRole, string> = {
  raw: 'Raw materials & consumables',
  wip: 'Work in progress',
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
  role: StockRole
  unit: string
  spec: Record<string, unknown>
  reorder_level: number
  active: boolean
  opening_stock: number
  balance: number
  total_in: number
  total_out: number
  produced: number
  consumed: number
  purchased: number
  received_in: number
  sent_out: number
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
  ff_orders?: { order_no: string } | null
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
export interface DailyLabour {
  id: number
  plant_id: number
  work_date: string
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

export const SHIFTS = [
  { value: 'A', label: 'A (08:00–17:00)' },
  { value: 'B', label: 'B (14:00–22:00)' },
  { value: 'C', label: 'C (22:00–06:00)' },
  { value: 'G', label: 'General' },
]
