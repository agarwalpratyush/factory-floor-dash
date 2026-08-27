import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Minimal fetch-on-mount hook with a manual refresh.
 * `deps` is a stable string key - when it changes the query re-runs.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fnRef.current())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fnRef.current()
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps])

  return { data, loading, error, refresh: run }
}
