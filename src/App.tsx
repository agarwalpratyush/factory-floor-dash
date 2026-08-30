import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { PlantProvider } from './lib/plant'
import { AuthProvider, useAuth } from './lib/auth'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Production from './pages/Production'
import RawMaterial from './pages/RawMaterial'
import Stock from './pages/Stock'
import Attendance from './pages/Attendance'
import Accounts from './pages/Accounts'
import Dispatch from './pages/Dispatch'

function Gate() {
  const { session, me, loading, can } = useAuth()

  if (loading) {
    return <div className="flex min-h-full items-center justify-center"><Spinner label="Signing in…" /></div>
  }
  if (!session || !me) return <Login />

  // On the staff list, but not for this app.
  if (!can('ff_view')) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-xl bg-white p-6 text-center shadow ring-1 ring-slate-200">
          <h1 className="font-semibold text-slate-900">No factory access</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your account ({me.role_label ?? me.role}) does not have access to the factory floor
            system. Ask the administrator if you need it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <PlantProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="orders" element={<Orders />} />
            <Route path="production" element={<Production />} />
            {/* Shift Log folded into Production; keep old links working. */}
            <Route path="shift-log" element={<Navigate to="/production" replace />} />
            {/* Transfers folded into Dispatch; keep old links working. */}
            <Route path="transfers" element={<Navigate to="/dispatch" replace />} />
            <Route path="raw-material" element={<RawMaterial />} />
            {/* The tab this replaced. Anyone with it bookmarked lands in the right place. */}
            <Route path="materials" element={<Navigate to="/raw-material" replace />} />
            <Route path="stock" element={<Stock />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="dispatch" element={<Dispatch />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PlantProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
