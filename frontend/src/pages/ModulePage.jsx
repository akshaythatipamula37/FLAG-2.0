import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { SectionHeading } from '../components/SectionHeading.jsx'
import { RunControls } from '../components/RunControls.jsx'
import { JsonExplorer } from '../components/JsonExplorer.jsx'
import { TimingDiagramViewer } from '../components/TimingDiagramViewer.jsx'
import { pageDescriptions } from '../data/demo.js'
import { api } from '../lib/api.js'

const moduleData = {
  'Pipeline Explorer': { icon: 'workflow', section: 'PIPELINE' },
  'Input Explorer': { icon: 'folder-input', section: 'INPUTS' },
  'Timing Diagram Viewer': { icon: 'audio-waveform', section: 'WAVEFORMS' },
  'Template Explorer': { icon: 'layers-3', section: 'TEMPLATES' },
  'Property Explorer': { icon: 'list-checks', section: 'PROPERTIES' },
  'SVA Explorer': { icon: 'code-xml', section: 'ASSERTION OUTPUT' },
  'Verification Dashboard': { icon: 'shield-check', section: 'FILTERING' },
  'LLM Evaluation': { icon: 'sparkles', section: 'LLM WORKFLOW' },
  'Artifact Explorer': { icon: 'archive', section: 'FILES' },
  Traceability: { icon: 'git-branch', section: 'LINEAGE' },
  'Experiment Comparison': { icon: 'chart-no-axes-combined', section: 'COMPARISON' },
  'Execution Console': { icon: 'terminal-square', section: 'PROCESS OUTPUT' },
}

function EmptyState({ children }) {
  return <div className="data-empty"><Icon name="circle-help" size={16} /><span>{children}</span></div>
}

function ArtifactSelector({ artifacts, selected, onSelect }) {
  if (!artifacts.length) return <EmptyState>Start a run to populate this view with generated artifacts.</EmptyState>
  return <div className="artifact-selector">{artifacts.map((artifact) => <button className={`artifact-select-row ${selected === artifact.path ? 'artifact-select-active' : ''}`} key={artifact.path} onClick={() => onSelect(artifact.path)}><Icon name="file-code" size={14} /><span>{artifact.path}</span><small>{artifact.size_bytes.toLocaleString()} B</small></button>)}</div>
}

function JsonPanel({ title, value, loading, error }) {
  return <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">JSON INSPECTOR</div><h3>{title}</h3></div><span className="live-label">READ ONLY</span></div><JsonExplorer value={value} title={title} loading={loading} error={error} /></section>
}

function InputExplorer({ catalog, run }) {
  const [selectedPath, setSelectedPath] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputs = useMemo(() => catalog ? [...catalog.grammar_files, ...catalog.timing_diagram_files, ...catalog.specification_files] : [], [catalog])
  const groups = [
    { label: 'GRAMMARS', entries: catalog?.grammar_files ?? [] },
    { label: 'TIMING DIAGRAMS', entries: catalog?.timing_diagram_files ?? [], groupedByProtocol: true },
    { label: 'SPECIFICATIONS', entries: catalog?.specification_files ?? [] },
  ]
  useEffect(() => {
    const preferredPath = run?.timing_diagram_path || run?.grammar_path
    if (preferredPath) setSelectedPath(preferredPath)
  }, [run?.run_id])
  useEffect(() => {
    if (run?.run_id || !inputs.length || selectedPath) return
    setSelectedPath(inputs.find((item) => item.path.includes('AXI/channel_handshake/timing_diagrams.json'))?.path ?? inputs[0].path)
  }, [inputs, selectedPath, run?.run_id])
  useEffect(() => {
    let cancelled = false
    const selected = inputs.find((item) => item.path === selectedPath)
    if (!selected || selected.format === 'pdf') { setData(null); return undefined }
    setLoading(true); setError('')
    api.input(selected.path).then((result) => { if (!cancelled) setData(result) }).catch((issue) => { if (!cancelled) setError(issue.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedPath, inputs])

  return <div className="input-explorer-grid">
    <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">LIVE REPOSITORY DISCOVERY</div><h3>Available inputs</h3></div><span className="live-label">{inputs.length} FILES</span></div>
      {run && <div className="run-inputs"><div className="input-group-label">INPUTS FROM LATEST RUN <span>{run.status.toUpperCase()}</span></div>{[["Grammar", run.grammar_path], ["Timing diagram", run.timing_diagram_path]].filter(([, path]) => path).map(([label, path]) => <button className={`run-input-chip ${selectedPath === path ? 'run-input-chip-active' : ''}`} key={path} onClick={() => setSelectedPath(path)}><Icon name={label === 'Grammar' ? 'layers' : 'audio-waveform'} size={14} /><span><small>{label}</small><code>{path}</code></span><Icon name="chevron-right" size={14} /></button>)}</div>}
      <div className="input-groups">
        {groups.map(({ label, entries, groupedByProtocol }) => <div className="input-group" key={label}><div className="input-group-label">{label} <span>{entries.length}</span></div>{groupedByProtocol ? [...new Set(entries.map((item) => item.protocol ?? 'Other'))].sort().map((family) => <details className="protocol-input-group" key={family} open={family === 'AXI'}><summary>{family}<span>{entries.filter((item) => (item.protocol ?? 'Other') === family).length} files</span></summary>{entries.filter((item) => (item.protocol ?? 'Other') === family).map((item) => <button className={`input-file-row ${selectedPath === item.path ? 'input-file-active' : ''}`} key={item.path} onClick={() => setSelectedPath(item.path)}><Icon name="audio-waveform" size={14} /><span>{item.mechanism?.replaceAll('_', ' ')} · {item.format === 'wavedrom_json' ? 'WaveDrom' : 'JSON'}</span></button>)}</details>) : entries.map((item) => <button className={`input-file-row ${selectedPath === item.path ? 'input-file-active' : ''}`} key={item.path} onClick={() => setSelectedPath(item.path)}><Icon name={item.kind === 'grammar' ? 'layers' : 'file-code'} size={14} /><span>{item.path}</span><small>{item.format}</small></button>)}</div>)}
        {!catalog && <EmptyState>Waiting for the repository catalog.</EmptyState>}
      </div>
    </section>
    {inputs.find((item) => item.path === selectedPath)?.format === 'pdf' ? <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">SPECIFICATION DOCUMENT</div><h3>{selectedPath.split('/').at(-1)}</h3></div></div><div className="pdf-note"><Icon name="archive" size={18} /><span>PDF is available from the backend input endpoint. Specification text extraction is not part of this viewer.</span></div></section> : <JsonPanel title={selectedPath.split('/').at(-1) || 'Input preview'} value={data} loading={loading} error={error} />}
  </div>
}

function RunStatus({ run }) {
  if (!run) return <EmptyState>No run has been submitted in this session.</EmptyState>
  return <div className="run-status-card"><div className={`run-status-icon run-status-${run.status}`}><Icon name={run.status === 'completed' ? 'check' : run.status === 'failed' ? 'circle-help' : 'activity'} size={17} /></div><div className="run-status-copy"><strong>{run.status.toUpperCase()} · {run.mode}</strong><small>Run ID <code>{run.run_id}</code> · exit {run.exit_code ?? 'pending'}</small><small>Created {new Date(run.created_at).toLocaleString()}</small>{run.error && <small className="run-error-text">{run.error}</small>}</div><span className={`run-status-pill run-status-${run.status}`}>{run.status}</span></div>
}

function ArtifactView({ title, artifacts, artifactData, loadingArtifact, artifactError, selectedArtifact, onSelect, predicate, empty }) {
  const filtered = artifacts.filter((item) => predicate(item.path))
  return <div className="artifact-view-grid"><div className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">SELECTED RUN ARTIFACTS</div><h3>{title}</h3></div><span className="live-label">{filtered.length} FILES</span></div><ArtifactSelector artifacts={filtered} selected={selectedArtifact} onSelect={onSelect} />{!filtered.length && <p className="muted-caption">{empty}</p>}</div><JsonPanel title={selectedArtifact?.split('/').at(-1) || 'Artifact preview'} value={selectedArtifact ? artifactData[selectedArtifact] : null} loading={loadingArtifact} error={artifactError} /></div>
}

function TemplateExplorerView({ templates, loading, error }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = Array.isArray(templates) ? templates[selectedIndex] : null
  useEffect(() => { if (selectedIndex >= (templates?.length ?? 0)) setSelectedIndex(0) }, [templates, selectedIndex])
  return <div className="template-explorer-layout">
    <section className="panel template-output-panel"><div className="panel-heading"><div><div className="eyebrow">G2T · GRAMMAR-DERIVED OUTPUT</div><h3>Template output</h3></div><span className="live-label">{Array.isArray(templates) ? `${templates.length} TEMPLATES` : 'CURRENT RUN'}</span></div>
      {loading ? <div className="inline-loading"><span className="spinner" />Loading templates…</div> : error ? <div className="inline-error" role="alert">{error}</div> : !Array.isArray(templates) || !templates.length ? <EmptyState>Run G2T or the full pipeline to generate templates.json.</EmptyState> : <div className="template-output-grid"><div className="template-index-list">{templates.map((template, index) => <button key={`${template.ltl}-${index}`} className={`template-index-row ${selectedIndex === index ? 'template-index-active' : ''}`} onClick={() => setSelectedIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span><span>{template.nl}</span></button>)}</div><div className="template-selected-output"><div className="template-selection-label">TEMPLATE {String(selectedIndex + 1).padStart(2, '0')} / {templates.length}</div><div className="template-natural-language">{selected?.nl}</div><div className="template-formula-label">LTL-LIKE REPRESENTATION</div><code className="template-formula">{selected?.ltl}</code><div className="template-selection-note">Select an entry to inspect its corresponding AST below.</div></div></div>}
    </section>
    <section className="panel template-ast-panel"><div className="panel-heading"><div><div className="eyebrow">STRUCTURED REPRESENTATION</div><h3>{selected ? `Template ${selectedIndex + 1} · AST` : 'Template AST explorer'}</h3></div><span className="live-label">COLLAPSIBLE JSON</span></div><JsonExplorer value={selected?.ast ?? null} title={selected ? `template-${String(selectedIndex + 1).padStart(2, '0')}.ast` : 'template.ast'} loading={loading} error={error} /></section>
  </div>
}

function PropertyTable({ records, title, subtitle }) {
  if (!Array.isArray(records) || !records.length) return <EmptyState>{subtitle}</EmptyState>
  return <div className="property-table-wrap"><div className="property-table-head"><strong>{title}</strong><span>{records.length} properties</span></div><div className="property-table">{records.slice(0, 150).map((record, index) => <article className="property-row" key={`${record.ltl ?? record.sva ?? index}-${index}`}><span className="property-index">{String(index + 1).padStart(3, '0')}</span><div><p>{record.nl ?? 'Natural-language form unavailable'}</p><code>{record.sva ?? record.ltl ?? 'Code representation unavailable'}</code></div></article>)}</div>{records.length > 150 && <div className="muted-caption">Showing 150 of {records.length}; full data is available in the JSON artifact.</div>}</div>
}

function JsonList({ records, title, empty }) {
  if (!Array.isArray(records) || !records.length) return <EmptyState>{empty}</EmptyState>
  return <div className="sva-list">{records.map((record, index) => <article className="sva-row" key={`${record}-${index}`}><span>{String(index + 1).padStart(3, '0')}</span><code>{typeof record === 'string' ? record : JSON.stringify(record)}</code></article>)}</div>
}

function LogsPanel({ logs, run }) {
  return <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">CAPTURED SUBPROCESS OUTPUT</div><h3>Run console</h3></div><span className={run ? 'live-label' : 'demo-label'}>{run ? run.status.toUpperCase() : 'NO RUN'}</span></div>{!run ? <EmptyState>Submit a run to capture the FLAG CLI stdout and stderr.</EmptyState> : <pre className="console-viewer">{logs?.combined || (run.status === 'queued' ? 'Run is queued…' : run.status === 'running' ? 'Waiting for process output…' : 'Process produced no output.')}</pre>}</section>
}

export default function ModulePage({ title, catalog, health, run, artifacts, artifactData, logs, onRunCreated, apiError, artifactLoading, onArtifactLoad }) {
  const data = moduleData[title]
  const [selectedArtifact, setSelectedArtifact] = useState('')
  const [artifactError, setArtifactError] = useState('')

  useEffect(() => { setSelectedArtifact(''); setArtifactError('') }, [run?.run_id, title])
  useEffect(() => {
    if (!artifacts.length) return
    const matches = (path) => title === 'Template Explorer' ? path.startsWith('templates') : title === 'Verification Dashboard' ? path.startsWith('sat_filtered') : true
    if (!selectedArtifact || !artifacts.some((item) => item.path === selectedArtifact && matches(item.path))) {
      setSelectedArtifact(artifacts.find((item) => matches(item.path))?.path ?? '')
    }
  }, [artifacts, selectedArtifact, title])

  function selectArtifact(path) {
    setSelectedArtifact(path)
    setArtifactError('')
    onArtifactLoad(path).catch((error) => setArtifactError(error.message))
  }

  const candidateArtifact = artifacts.find((item) => item.path === 'candidates.json')
  const satArtifact = artifacts.find((item) => item.path === 'sat_filtered.json')
  const svaArtifact = artifacts.find((item) => item.path === 'sat_filtered_SVA.json')
  const candidates = candidateArtifact ? artifactData[candidateArtifact.path] : undefined
  const satResults = satArtifact ? artifactData[satArtifact.path] : undefined
  const svaResults = svaArtifact ? artifactData[svaArtifact.path] : undefined

  useEffect(() => {
    if (selectedArtifact && !Object.hasOwn(artifactData, selectedArtifact) && !artifactLoading) {
      onArtifactLoad(selectedArtifact).catch((error) => setArtifactError(error.message))
    }
  }, [selectedArtifact, artifactData, artifactLoading, onArtifactLoad])

  useEffect(() => {
    const requested = title === 'Property Explorer' || title === 'Verification Dashboard'
      ? ['candidates.json', 'sat_filtered.json']
      : title === 'SVA Explorer' ? ['sat_filtered_SVA.json']
        : title === 'Template Explorer' ? ['templates.json'] : []
    for (const path of requested) {
      if (artifacts.some((item) => item.path === path) && !Object.hasOwn(artifactData, path) && !artifactLoading) {
        onArtifactLoad(path).catch((error) => setArtifactError(error.message))
      }
    }
  }, [title, artifacts, artifactData, artifactLoading, onArtifactLoad])

  return (
    <div className="page-content module-page">
      <SectionHeading eyebrow={`FLAG WORKBENCH · ${data.section}`} title={title} description={pageDescriptions[title]} />
      {apiError && <div className="api-error-banner" role="alert"><Icon name="circle-help" size={15} />{apiError}</div>}

      {title === 'Pipeline Explorer' && <><RunControls catalog={catalog} apiReady={Boolean(health)} onRunCreated={onRunCreated} /><section className="module-content-panel"><div className="module-panel-heading"><div><div className="eyebrow">LIVE EXECUTION STATUS</div><h3>Pipeline progress</h3></div></div><RunStatus run={run} /><div className="module-stage-map"><span>G2T</span><Icon name="chevron-right" size={14} /><span>T2P</span><Icon name="chevron-right" size={14} /><span>SAT FILTERING</span><Icon name="chevron-right" size={14} /><span>SVA OUTPUT</span></div><div className="muted-caption">The existing CLI reports overall process status. It does not expose internal stage progress events.</div></section></>}

      {title === 'Input Explorer' && <InputExplorer catalog={catalog} run={run} />}

      {title === 'Timing Diagram Viewer' && <TimingDiagramViewer catalog={catalog} />}

      {title === 'Template Explorer' && <TemplateExplorerView templates={artifactData['templates.json']} loading={artifactLoading && !artifactData['templates.json']} error={artifactError} />}

      {title === 'Property Explorer' && <div className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">GENERATED PROPERTY RECORDS</div><h3>Candidate properties</h3></div><span className="live-label">{Array.isArray(candidates) ? `${candidates.length} CANDIDATES` : 'RUN VERBOSE MODE'}</span></div><PropertyTable records={candidates} title="Pre-filter candidates" subtitle="Candidate properties are written when verbose output is enabled. Run all or t2p with verbose enabled to produce candidates.json." /><div className="result-divider" /><PropertyTable records={satResults} title="SAT-filtered properties" subtitle="No SAT-filtered JSON is available for the current run." /></div>}

      {title === 'SVA Explorer' && <div className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">SYSTEMVERILOG ASSERTION STRINGS</div><h3>Generated SVA</h3></div><span className="live-label">{Array.isArray(svaResults) ? `${svaResults.length} ASSERTIONS` : 'AWAITING RUN'}</span></div><JsonList records={svaResults} title="SVA output" empty="Run the pipeline or t2p mode to generate sat_filtered_SVA.json." /></div>}

      {title === 'Verification Dashboard' && <div className="verification-grid"><section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">CURRENT RUN SUMMARY</div><h3>Trace-based filtering</h3></div></div><RunStatus run={run} /><div className="verification-counts"><div><span>PRE-FILTER CANDIDATES</span><strong>{Array.isArray(candidates) ? candidates.length : '—'}</strong></div><div><span>SAT-FILTERED SURVIVORS</span><strong>{Array.isArray(satResults) ? satResults.length : '—'}</strong></div><div><span>EXIT CODE</span><strong>{run?.exit_code ?? '—'}</strong></div></div><div className="module-info"><Icon name="circle-help" size={14} /><span>Survival means the generated property holds on the supplied finite timing traces under the core checker’s encoding; this is not RTL model checking.</span></div></section><ArtifactView title="SAT result JSON" artifacts={artifacts} artifactData={artifactData} loadingArtifact={artifactLoading} artifactError={artifactError} selectedArtifact={selectedArtifact} onSelect={selectArtifact} predicate={(path) => path.startsWith('sat_filtered')} empty="SAT-filtered output appears after a successful all or t2p run." /></div>}

      {title === 'Artifact Explorer' && <ArtifactView title="Generated files" artifacts={artifacts} artifactData={artifactData} loadingArtifact={artifactLoading} artifactError={artifactError} selectedArtifact={selectedArtifact} onSelect={selectArtifact} predicate={() => true} empty="No generated artifacts are available for the current run." />}

      {title === 'Execution Console' && <><RunStatus run={run} /><LogsPanel logs={logs} run={run} /></>}

      {title === 'LLM Evaluation' && <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">SEPARATE WORKFLOW · EXISTING BATCH SCRIPTS</div><h3>LLM request and response files</h3></div><span className="demo-label">NOT RUN BY CORE CLI</span></div><div className="llm-info-grid">{['Relevant text extraction', 'Signal mapping', 'Property batching and selection', 'LLM-as-a-judge'].map((step, index) => <article className="module-item panel" key={step}><span className="module-item-number">0{index + 1}</span><div><strong>{step}</strong><small>Repository scripts prepare requests and parse returned batch files; API submission is not connected here.</small></div></article>)}</div></section>}

      {title === 'Traceability' && <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">CURRENT ARTIFACT LINEAGE</div><h3>Property traceability</h3></div><span className="demo-label">PARTIAL</span></div><div className="module-info"><Icon name="circle-help" size={14} /><span>Current core JSON records have AST/text representations but no durable property IDs or per-stage lineage. A selected run’s artifacts are available in Artifact Explorer.</span></div>{run && <ArtifactSelector artifacts={artifacts} selected={selectedArtifact} onSelect={selectArtifact} />}</section>}

      {title === 'Experiment Comparison' && <section className="panel data-panel"><div className="panel-heading"><div><div className="eyebrow">RUN HISTORY</div><h3>Experiment comparison</h3></div><span className="demo-label">NOT IMPLEMENTED</span></div><EmptyState>The API currently exposes the selected run only; it does not persist a queryable experiment index or compare runs.</EmptyState></section>}
    </div>
  )
}
