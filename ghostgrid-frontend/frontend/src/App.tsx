import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'
import { DashboardLayout } from './console/ConsoleLayout'
const CityPage = lazy(() => import('./city/CityPage').then((m) => ({ default: m.CityPage })))
const OfficePage = lazy(() => import('./city/office/OfficePage').then((m) => ({ default: m.OfficePage })))
const AgentDetailPage = lazy(() => import('./console/pages/AgentDetailPage').then((m) => ({ default: m.AgentDetailPage })))
const AgentsPage = lazy(() => import('./console/pages/AgentsPage').then((m) => ({ default: m.AgentsPage })))
const ApiKeysPage = lazy(() => import('./console/pages/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })))
const OverviewPage = lazy(() => import('./console/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const RequestLogsPage = lazy(() => import('./console/pages/RequestLogsPage').then((m) => ({ default: m.RequestLogsPage })))

function page(content: ReactNode) {
  return <Suspense fallback={<div role="status" className="p-6 font-mono text-lg text-gg-mute">Loading…</div>}>{content}</Suspense>
}

// Old /console links (still used in some city panels) land on the matching dashboard page.
const CONSOLE_TO_DASHBOARD: Record<string, string> = { agents: 'agents', logs: 'activity', keys: 'keys' }

function ConsoleRedirect() {
  const [head = '', ...rest] = (useParams()['*'] ?? '').split('/')
  const section = CONSOLE_TO_DASHBOARD[head]
  const to = section ? ['/dashboard', section, ...rest].filter(Boolean).join('/') : '/dashboard'
  return <Navigate to={to} replace />
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route path="/" element={page(<CityPage />)} />
        <Route path="/office/:buildingId" element={page(<OfficePage />)} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={page(<OverviewPage />)} />
          <Route path="agents" element={page(<AgentsPage />)} />
          <Route path="agents/:agentId" element={page(<AgentDetailPage />)} />
          <Route path="activity" element={page(<RequestLogsPage />)} />
          <Route path="keys" element={page(<ApiKeysPage />)} />
        </Route>
        <Route path="/console/*" element={<ConsoleRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
