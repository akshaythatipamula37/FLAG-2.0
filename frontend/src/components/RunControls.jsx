import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { Icon } from './Icon.jsx'

export function RunControls({ catalog, apiReady, onRunCreated, onNavigate, compact = false }) {
  const grammars = catalog?.grammar_files ?? []
  const timingFiles = catalog?.timing_diagram_files ?? []
  const protocolFamilies = useMemo(() => [...new Set(timingFiles.map((item) => item.protocol ?? 'Other'))].sort(), [timingFiles])
  const suggestedGrammar = useMemo(() => grammars.find((item) => item.path === 'grammar/complete.json')?.path ?? grammars[0]?.path ?? '', [grammars])
  const suggestedTiming = useMemo(() => timingFiles.find((item) => item.path === 'test_cases/AXI/channel_handshake/timing_diagrams.json')?.path ?? timingFiles[0]?.path ?? '', [timingFiles])
  const [grammarPath, setGrammarPath] = useState('')
  const [timingPath, setTimingPath] = useState('')
  const [mode, setMode] = useState('all')
  const [verbose, setVerbose] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (suggestedGrammar) setGrammarPath((current) => current || suggestedGrammar) }, [suggestedGrammar])
  useEffect(() => { if (suggestedTiming) setTimingPath((current) => current || suggestedTiming) }, [suggestedTiming])

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await api.createRun({ grammar_path: grammarPath, timing_diagram_path: mode === 'g2t' ? null : timingPath, mode, verbose })
      onRunCreated(result)
      onNavigate?.('Pipeline Explorer')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={`panel run-controls ${compact ? 'run-controls-compact' : ''}`}>
      <div className="panel-heading"><div><div className="eyebrow">EXECUTION SETUP</div><h3>Configure FLAG run</h3></div><span className={`api-chip ${apiReady ? 'api-chip-online' : ''}`}><span className="status-dot" />{apiReady ? 'API CONNECTED' : 'API OFFLINE'}</span></div>
      {!catalog ? <div className="inline-loading"><span className="spinner" />Loading repository inputs…</div> : (
        <form className="run-form" onSubmit={submit}>
          <label className="form-field"><span>GRAMMAR FILE</span><select value={grammarPath} onChange={(event) => setGrammarPath(event.target.value)} required disabled={!grammars.length}><option value="" disabled>Select grammar</option>{grammars.map((item) => <option value={item.path} key={item.path}>{item.path}</option>)}</select></label>
          <label className="form-field"><span>TIMING DIAGRAM</span><select value={timingPath} onChange={(event) => setTimingPath(event.target.value)} required={mode !== 'g2t'} disabled={mode === 'g2t' || !timingFiles.length}><option value="">{mode === 'g2t' ? 'Not used for G2T' : 'Select protocol / mechanism'}</option>{protocolFamilies.map((family) => <optgroup label={family} key={family}>{timingFiles.filter((item) => (item.protocol ?? 'Other') === family).map((item) => <option value={item.path} key={item.path}>{item.mechanism?.replaceAll('_', ' ') ?? item.path} — {item.format === 'wavedrom_json' ? 'WaveDrom' : 'Self-defined JSON'}</option>)}</optgroup>)}</select></label>
          <label className="form-field"><span>EXECUTION MODE</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="all">Full pipeline · all</option><option value="g2t">Grammar → templates · g2t</option><option value="t2p">Generate templates, then filter · t2p</option></select></label>
          <label className="verbose-control"><input type="checkbox" checked={verbose} onChange={(event) => setVerbose(event.target.checked)} /><span>Save intermediate candidates</span><span className="form-help">Verbose</span></label>
          <div className="run-form-actions"><span className="run-scope-note">Runs in isolated backend storage; existing results are not overwritten.</span><button className="primary-button" type="submit" disabled={!apiReady || submitting || !grammarPath || (mode !== 'g2t' && !timingPath)}><Icon name={submitting ? 'activity' : 'play'} size={14} />{submitting ? 'Queueing…' : 'Run FLAG'}</button></div>
          {error && <div className="inline-error" role="alert"><Icon name="circle-help" size={14} />{error}</div>}
          {!apiReady && <div className="inline-note">Start the backend to enable execution. Input selections come from the live repository catalog when connected.</div>}
        </form>
      )}
    </section>
  )
}
