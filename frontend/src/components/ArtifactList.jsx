import { Icon } from './Icon.jsx'
export function ArtifactList({ artifacts = [], onSelect, hasRun }) {
  const rows = artifacts.map((item) => ({ name: item.filename, type: `${item.format.toUpperCase()} · ${item.size_bytes.toLocaleString()} B`, status: 'Generated in this run', path: item.path }))
  return (
    <section className="panel artifacts-panel">
      <div className="panel-heading"><div><div className="eyebrow">RUN ARTIFACTS</div><h3>Pipeline outputs</h3></div><span className={hasRun ? 'live-label' : 'demo-label'}>{hasRun ? 'LIVE' : 'WAITING FOR RUN'}</span></div>
      <div className="artifact-list">
        {rows.length ? rows.slice(0, 6).map((artifact) => <button className="artifact-row artifact-row-button" key={artifact.path} onClick={() => onSelect?.(artifact.path)}><span className="artifact-icon"><Icon name="file-code" size={15} /></span><div className="artifact-copy"><strong>{artifact.name}</strong><small>{artifact.type}</small></div><span className="artifact-status">{artifact.status}</span><Icon name="chevron-right" size={14} className="artifact-chevron" /></button>) : <div className="artifact-empty">{hasRun ? 'No artifacts have been written yet.' : 'Run FLAG to populate this list with generated files.'}</div>}
      </div>
      <div className="artifact-footer"><Icon name="circle-help" size={14} /><span>{hasRun ? 'Artifacts are read from the selected run directory.' : 'No generated files are represented as execution results.'}</span></div>
    </section>
  )
}
