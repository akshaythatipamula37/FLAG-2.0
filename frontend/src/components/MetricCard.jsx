import { Icon } from './Icon.jsx'

export function MetricCard({ label, value, detail, tone }) {
  return (
    <article className="metric-card panel">
      <div className="metric-top"><span className="metric-label">{label}</span><span className={`metric-icon tone-${tone}`}><Icon name={tone === 'amber' ? 'activity' : tone === 'violet' ? 'layers' : tone === 'green' ? 'check' : 'network'} size={15} /></span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail"><span className={`metric-indicator tone-${tone}`} />{detail}</div>
      <span className={`metric-accent metric-accent-${tone}`} />
    </article>
  )
}
