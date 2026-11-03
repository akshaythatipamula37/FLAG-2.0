import { MetricCard } from '../components/MetricCard.jsx'
import { PipelineMap } from '../components/PipelineMap.jsx'
import { ArtifactList } from '../components/ArtifactList.jsx'
import { SectionHeading } from '../components/SectionHeading.jsx'
import { Icon } from '../components/Icon.jsx'
import { RunControls } from '../components/RunControls.jsx'

export default function Overview({ onNavigate, catalog, health, run, artifacts, apiError, onRunCreated, onArtifactSelect }) {
  const counts = catalog?.counts
  const metrics = [
    { label: 'PROTOCOL FAMILIES', value: counts ? String(counts.protocols).padStart(2, '0') : '—', detail: 'Discovered under test_cases/', tone: 'cyan' },
    { label: 'TEST CASES', value: counts ? String(counts.test_cases).padStart(2, '0') : '—', detail: 'Protocol mechanisms', tone: 'violet' },
    { label: 'GRAMMAR FILES', value: counts ? String(counts.grammars).padStart(2, '0') : '—', detail: 'Discovered under grammar/', tone: 'blue' },
    { label: 'TIMING DIAGRAMS', value: counts ? String(counts.timing_diagrams).padStart(2, '0') : '—', detail: 'JSON + supported WaveDrom', tone: 'green' },
  ]
  return (
    <div className="page-content">
      <div className="overview-title-row">
        <SectionHeading eyebrow="FORMAL PROPERTY GENERATION · RESEARCH WORKSPACE" title="Project overview" description="Explore the FLAG pipeline, inspect artifacts, and compare verification workflows." />
        <div className={`demo-banner ${health ? 'connected-banner' : ''}`}><span className="demo-banner-icon"><Icon name="activity" size={15} /></span><div><strong>{health ? 'Repository connected' : 'Backend unavailable'}</strong><small>{health ? 'Live catalog · run data on demand' : 'Start FastAPI to load repository data'}</small></div></div>
      </div>

      {apiError && <div className="api-error-banner" role="alert"><Icon name="circle-help" size={15} />{apiError}</div>}
      <div className="metric-grid">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</div>

      <RunControls catalog={catalog} apiReady={Boolean(health)} onRunCreated={onRunCreated} onNavigate={onNavigate} compact />

      <div className="content-grid">
        <PipelineMap run={run} />
        <div className="right-column">
          <ArtifactList artifacts={artifacts} hasRun={Boolean(run)} onSelect={onArtifactSelect} />
          <section className="panel project-note">
            <div className="panel-heading"><div><div className="eyebrow">RESEARCH CONTEXT</div><h3>FLAG at a glance</h3></div><span className="project-note-icon"><Icon name="command" size={15} /></span></div>
            <p>Formal and LLM-assisted SVA generation for formal specifications of on-chip communication protocols.</p>
            <div className="protocol-tags"><span>AXI</span><span>APB</span><span>PCI</span><span>P-Channel</span><span>Q-Channel</span><span>WISHBONE</span></div>
            <button className="text-link" onClick={() => onNavigate('Input Explorer')}>Explore repository inputs <Icon name="chevron-right" size={14} /></button>
          </section>
        </div>
      </div>

      <div className="overview-footer"><span>FLAG RESEARCH WORKBENCH <i /> {health ? 'LIVE REPOSITORY CATALOG' : 'AWAITING BACKEND'}</span><span>EXECUTION RESULTS ARE PER-RUN ARTIFACTS</span></div>
    </div>
  )
}
