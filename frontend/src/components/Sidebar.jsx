import { Icon } from './Icon.jsx'
import { navigation } from '../data/demo.js'

export function Sidebar({ activePage, onNavigate, open, onClose, apiReady }) {
  const groups = [...new Set(navigation.map((item) => item.group))]

  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><span>F</span><i /></div>
          <div className="brand-copy"><strong>FLAG</strong><span>RESEARCH WORKBENCH</span></div>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><Icon name="close" /></button>
        </div>

        <button className="project-switcher" aria-label="Current project">
          <span className="project-avatar">FL</span>
          <span className="project-copy"><strong>FLAG Research</strong><small>Formal property generation</small></span>
          <Icon name="chevron-down" size={14} />
        </button>

        <nav className="side-nav" aria-label="Main navigation">
          {groups.map((group) => (
            <section className="nav-group" key={group}>
              <div className="nav-group-label">{group}</div>
              {navigation.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.label}
                  className={`nav-item ${activePage === item.label ? 'nav-item-active' : ''}`}
                  onClick={() => { onNavigate(item.label); onClose() }}
                  aria-current={activePage === item.label ? 'page' : undefined}
                >
                  <Icon name={item.icon} size={16} />
                  <span>{item.label}</span>
                  {item.label === 'Execution Console' && <span className="nav-live-dot" />}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="backend-status"><span className={`status-dot ${apiReady ? 'status-green' : 'status-muted'}`} /><div><strong>{apiReady ? 'Backend connected' : 'Backend disconnected'}</strong><small>{apiReady ? 'Live repository API' : 'Demo workspace'}</small></div></div>
          <button className="nav-item settings-link" onClick={() => onNavigate('Overview')}><Icon name="settings" size={16} /><span>Workspace settings</span></button>
          <div className="user-row"><div className="user-avatar">VR</div><div><strong>Verification Research</strong><small>Local workspace</small></div><Icon name="more" size={16} className="user-more" /></div>
        </div>
      </aside>
    </>
  )
}
