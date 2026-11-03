import { Icon } from './Icon.jsx'

export function Topbar({ title, onMenu, apiReady, run }) {
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" /></button>
        <div className="breadcrumb"><span>FLAG</span><Icon name="chevron-right" size={13} /><strong>{title}</strong></div>
      </div>
      <div className="topbar-tools">
        <div className="project-id"><span>PROJECT</span><code>FLAG-RESEARCH</code></div>
        <span className="topbar-divider" />
        <div className="system-status"><span className={`status-dot ${apiReady ? 'status-green' : 'status-muted'}`} /><span>{apiReady ? (run ? `RUN ${run.status.toUpperCase()}` : 'API CONNECTED') : 'API OFFLINE'}</span></div>
        <button className="icon-button topbar-help" aria-label="Help"><Icon name="help" size={17} /></button>
      </div>
    </header>
  )
}
