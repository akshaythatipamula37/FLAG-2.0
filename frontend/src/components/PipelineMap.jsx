import { coreStages, llmStages } from '../data/demo.js'
import { Icon } from './Icon.jsx'

export function PipelineMap({ run }) {
  function stageStatus(index) {
    if (!run) return 'WAITING'
    if (run.status === 'queued') return 'QUEUED'
    if (run.status === 'running' || run.status === 'failed') return 'UNREPORTED'
    if (run.mode === 'g2t') return index === 0 ? 'COMPLETE' : 'NOT IN MODE'
    return 'COMPLETE'
  }

  return (
    <section className="panel pipeline-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">GENERATION FLOW</div><h3>Core FLAG pipeline</h3></div>
        <span className={`flow-tag ${run?.status === 'running' ? 'flow-tag-running' : ''}`}><span className={`status-dot ${run?.status === 'running' ? 'status-cyan' : 'status-muted'}`} />{run ? `RUN ${run.status.toUpperCase()}` : 'SOURCE-DOCUMENTED FLOW'}</span>
      </div>
      <div className="pipeline-track">
        {coreStages.map((stage, index) => (
          <div className="stage-wrap" key={stage.code}>
            <article className={`stage-card stage-${stage.accent}`}>
              <div className="stage-head"><span className="stage-index">{stage.code}</span><span className="stage-state"><span className={`status-dot ${run?.status === 'running' ? 'status-cyan' : run?.status === 'completed' && stageStatus(index) === 'COMPLETE' ? 'status-green' : 'status-muted'}`} />{stageStatus(index)}</span></div>
              <h4>{stage.title}</h4><div className="stage-subtitle">{stage.subtitle}</div>
              <p>{stage.description}</p>
              <div className="stage-output"><Icon name="file-code" size={13} /><span>{stage.output}</span></div>
            </article>
            {index < coreStages.length - 1 && <div className="stage-connector"><span /><Icon name="chevron-right" size={14} /></div>}
          </div>
        ))}
      </div>
      <div className="pipeline-footnote"><Icon name="circle-help" size={14} /><span>{run ? `Selected run ${run.run_id.slice(0, 8)} · ${run.mode}${run.exit_code === null ? '' : ` · exit ${run.exit_code}`}. The API reports aggregate process status, not internal stage-by-stage progress.` : 'SAT filtering checks generated properties against the supplied finite timing diagrams. It does not prove behavior over an RTL implementation.'}</span></div>

      <div className="llm-flow">
        <div className="llm-rail"><span className="rail-dash" /><span className="rail-label"><Icon name="sparkles" size={14} /> SEPARATE LLM WORKFLOW</span><span className="rail-dash" /></div>
        <div className="llm-stage-list">
          {llmStages.map((stage, index) => <article className="llm-stage" key={stage.title}><span className="llm-stage-index">0{index + 1}</span><div><strong>{stage.title}</strong><small>{stage.detail}</small></div><Icon name="chevron-right" size={14} className="llm-chevron" /></article>)}
        </div>
        <div className="llm-note">Batch request preparation and result parsing are separate from the core CLI.</div>
      </div>
    </section>
  )
}
