import { useCallback, useEffect, useState } from 'react'
import { Icon } from './components/Icon.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { Topbar } from './components/Topbar.jsx'
import Overview from './pages/Overview.jsx'
import ModulePage from './pages/ModulePage.jsx'
import { api } from './lib/api.js'

export default function App() {
  const [activePage, setActivePage] = useState('Overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [health, setHealth] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [apiError, setApiError] = useState('')
  const [run, setRun] = useState(null)
  const [logs, setLogs] = useState(null)
  const [artifacts, setArtifacts] = useState([])
  const [artifactData, setArtifactData] = useState({})
  const [artifactLoading, setArtifactLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([api.health(), api.catalog()]).then(([healthResult, catalogResult]) => {
      if (cancelled) return
      const issues = []
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
      else issues.push(healthResult.reason.message)
      if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value)
      else issues.push(catalogResult.reason.message)
      setApiError(issues.join(' '))
    })
    return () => { cancelled = true }
  }, [])

  const loadArtifact = useCallback(async (path) => {
    if (!run || !path) return
    if (Object.hasOwn(artifactData, path)) return artifactData[path]
    setArtifactLoading(true)
    try {
      const content = await api.artifact(run.run_id, path)
      setArtifactData((current) => ({ ...current, [path]: content }))
      return content
    } finally {
      setArtifactLoading(false)
    }
  }, [run, artifactData])

  const handleRunCreated = useCallback((createdRun) => {
    setRun(createdRun)
    setLogs(null)
    setArtifacts([])
    setArtifactData({})
  }, [])

  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return undefined
    let cancelled = false
    const poll = async () => {
      try {
        const [updatedRun, updatedLogs] = await Promise.all([api.run(run.run_id), api.logs(run.run_id)])
        if (!cancelled) { setRun(updatedRun); setLogs(updatedLogs) }
      } catch (error) {
        if (!cancelled) setApiError(error.message)
      }
    }
    poll()
    const timer = window.setInterval(poll, 1400)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [run?.run_id, run?.status])

  useEffect(() => {
    if (!run || !['completed', 'failed'].includes(run.status)) return
    let cancelled = false
    Promise.all([api.artifacts(run.run_id), api.logs(run.run_id)]).then(([result, finalLogs]) => {
      if (!cancelled) { setArtifacts(result.artifacts); setLogs(finalLogs) }
    }).catch((error) => { if (!cancelled) setApiError(error.message) })
    return () => { cancelled = true }
  }, [run?.run_id, run?.status])

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} apiReady={Boolean(health)} />
      <div className="main-shell">
        <Topbar title={activePage} onMenu={() => setSidebarOpen(true)} apiReady={Boolean(health)} run={run} />
        <main key={activePage} className="main-content">
          {activePage === 'Overview'
            ? <Overview onNavigate={setActivePage} catalog={catalog} health={health} run={run} artifacts={artifacts} apiError={apiError} onRunCreated={handleRunCreated} onArtifactSelect={(path) => { setActivePage('Artifact Explorer'); loadArtifact(path).catch((error) => setApiError(error.message)) }} />
            : <ModulePage title={activePage} catalog={catalog} health={health} run={run} artifacts={artifacts} artifactData={artifactData} logs={logs} onRunCreated={handleRunCreated} apiError={apiError} artifactLoading={artifactLoading} onArtifactLoad={loadArtifact} />}
        </main>
        <footer className="app-footer"><span><i className="footer-mark" />FLAG <b>RESEARCH WORKBENCH</b></span><span>{health ? 'LIVE REPOSITORY' : 'BACKEND NOT CONNECTED'} <i /> CORE REMAINS UNMODIFIED</span></footer>
      </div>
      <div className="command-hint"><Icon name="command" size={13} /><span>K</span></div>
    </div>
  )
}
