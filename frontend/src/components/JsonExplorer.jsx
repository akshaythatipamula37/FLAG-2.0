import { useMemo, useState } from 'react'
import { Icon } from './Icon.jsx'

function valueClass(value) {
  if (value === null) return 'json-null'
  if (typeof value === 'string') return 'json-string'
  if (typeof value === 'number') return 'json-number'
  if (typeof value === 'boolean') return 'json-boolean'
  return 'json-punctuation'
}

function TreeValue({ label, value, depth = 0, root = false }) {
  const isArray = Array.isArray(value)
  const isObject = value !== null && typeof value === 'object' && !isArray
  if (isArray || isObject) {
    const entries = isArray ? value.map((entry, index) => [String(index), entry]) : Object.entries(value)
    const open = root || depth === 0
    return (
      <details className="json-tree-node" open={open}>
        <summary><span className="json-tree-key">{label}</span><span className="json-punctuation">{isArray ? '[ ]' : '{ }'}</span><span className="json-tree-meta">{entries.length} {isArray ? 'items' : 'keys'}</span></summary>
        <div className="json-tree-children">{entries.map(([key, child]) => <TreeValue key={`${label}-${key}`} label={isArray ? `[${key}]` : key} value={child} depth={depth + 1} />)}</div>
      </details>
    )
  }
  const rendered = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return <div className="json-tree-leaf"><span className="json-tree-key">{label}</span><span className={valueClass(value)}>{rendered}</span></div>
}

function CodeView({ value }) {
  const lines = JSON.stringify(value, null, 2).split('\n')
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:])/g
  return <div className="json-code-view">{lines.map((line, index) => {
    const tokens = line.split(tokenPattern).filter((token) => token !== undefined && token !== '')
    return <div className="json-code-line" key={index}><span className="json-line-number">{index + 1}</span><code>{tokens.map((token, tokenIndex) => {
      let kind = 'json-punctuation'
      if (token.startsWith('"')) kind = /^"(?:\\.|[^"\\])*"\s*:?$/.test(token) && line.slice(line.indexOf(token) + token.length).trimStart().startsWith(':') ? 'json-key-token' : 'json-string'
      else if (/^-?\d/.test(token)) kind = 'json-number'
      else if (token === 'true' || token === 'false') kind = 'json-boolean'
      else if (token === 'null') kind = 'json-null'
      return <span className={kind} key={tokenIndex}>{token}</span>
    })}</code></div>
  })}</div>
}

export function JsonExplorer({ value, title = 'JSON data', loading = false, error = '' }) {
  const [view, setView] = useState('tree')
  const encoded = useMemo(() => value === null || value === undefined ? '' : JSON.stringify(value, null, 2), [value])
  if (loading) return <div className="inline-loading"><span className="spinner" />Loading JSON…</div>
  if (error) return <div className="inline-error" role="alert"><Icon name="circle-help" size={14} />{error}</div>
  if (value === null || value === undefined) return <div className="data-empty"><Icon name="braces" size={16} /><span>Select a JSON file or generated artifact to inspect it.</span></div>

  return (
    <div className="json-explorer" data-bytes={new Blob([encoded]).size}>
      <div className="json-explorer-toolbar"><div className="json-explorer-title"><Icon name="braces" size={15} /><span>{title}</span></div><div className="json-view-tabs" role="tablist" aria-label="JSON view"><button className={view === 'tree' ? 'json-tab-active' : ''} onClick={() => setView('tree')} role="tab" aria-selected={view === 'tree'}>Tree</button><button className={view === 'code' ? 'json-tab-active' : ''} onClick={() => setView('code')} role="tab" aria-selected={view === 'code'}>Code</button></div></div>
      <div className={`json-explorer-content ${view === 'code' ? 'json-code-mode' : 'json-tree-mode'}`}>
        {view === 'tree' ? <TreeValue label="root" value={value} root /> : <CodeView value={value} />}
      </div>
    </div>
  )
}
