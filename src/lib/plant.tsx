import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { Plant, PlantProcess, SupplyRoute } from './types'

/** 'group' is the Combined View — read-only, since a new record must belong to one company. */
export type PlantScope = number | 'group'

interface Ctx {
  plants: Plant[]
  /** Set when this login is locked to one company; Combined View is then unavailable. */
  pinned: number | null
  scope: PlantScope
  setScope: (s: PlantScope) => void
  /** The single selected plant, or null when viewing the group. */
  plant: Plant | null
  loading: boolean
  error: string | null
  byId: (id: number) => Plant | undefined
  /** True in Combined View, or when the selected company runs this process. */
  runs: (p: PlantProcess) => boolean
  /** Companies this one may send material to. Supply runs one way. */
  sendableTo: (fromPlantId: number) => Plant[]
}

const PlantContext = createContext<Ctx | null>(null)

const STORAGE_KEY = 'ff.scope'

export function PlantProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  // A login pinned to one company never gets the Combined View.
  const pinned = me?.plant_id ?? null
  const [plants, setPlants] = useState<Plant[]>([])
  const [routes, setRoutes] = useState<SupplyRoute[]>([])
  const [scope, setScopeRaw] = useState<PlantScope>(pinned ?? 'group')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    supabase.from('ff_supply_routes').select('*').then(({ data }) => {
      if (alive) setRoutes((data ?? []) as SupplyRoute[])
    })

    supabase
      .from('ff_plants')
      .select('*')
      .eq('active', true)
      .order('code')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { setError(error.message); setLoading(false); return }
        // RLS already trims this to what the login may see
        const list = (data ?? []) as Plant[]
        setPlants(list)

        if (pinned !== null) {
          setScopeRaw(pinned)
        } else {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved === 'group') setScopeRaw('group')
          else if (saved && list.some((p) => String(p.id) === saved)) setScopeRaw(Number(saved))
          else setScopeRaw('group')
        }

        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  function setScope(s: PlantScope) {
    if (pinned !== null) return          // pinned logins cannot switch company
    setScopeRaw(s)
    localStorage.setItem(STORAGE_KEY, String(s))
  }

  const value = useMemo<Ctx>(() => ({
    plants,
    pinned,
    scope,
    setScope,
    plant: scope === 'group' ? null : plants.find((p) => p.id === scope) ?? null,
    loading,
    error,
    byId: (id: number) => plants.find((p) => p.id === id),
    sendableTo: (fromPlantId: number) =>
      routes
        .filter((r) => r.from_plant_id === fromPlantId)
        .map((r) => plants.find((p) => p.id === r.to_plant_id))
        .filter((p): p is Plant => !!p),
    runs: (proc: PlantProcess) => {
      const sel = scope === 'group' ? null : plants.find((p) => p.id === scope)
      return sel ? (sel.processes ?? []).includes(proc) : true
    },
  }), [plants, routes, pinned, scope, loading, error])

  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>
}

export function usePlant() {
  const ctx = useContext(PlantContext)
  if (!ctx) throw new Error('usePlant must be used inside <PlantProvider>')
  return ctx
}

/**
 * Applies the current scope to a Supabase query on a table with a plant_id column.
 * In group scope the query is left unfiltered.
 */
export function scoped<T extends { eq: (col: string, val: unknown) => T }>(
  query: T,
  scope: PlantScope,
  column = 'plant_id',
): T {
  return scope === 'group' ? query : query.eq(column, scope)
}

/** Stable cache key so useQuery re-runs when the plant changes. */
export const scopeKey = (scope: PlantScope) => String(scope)
