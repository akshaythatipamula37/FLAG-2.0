import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon.jsx'
import { JsonExplorer } from './JsonExplorer.jsx'
import { api } from '../lib/api.js'

function waveformLanes(data, waveform) {
  const declarations = new Map((data?.signals ?? []).map((signal) => [signal.name, signal]))
  const rawLanes = waveform?.signals ?? waveform?.signal ?? []
  return rawLanes.map((lane, laneIndex) => {
    let values = lane.values
    if (!Array.isArray(values)) {
      let dataIndex = 0
      let lastValue = ''
      values = [...(lane.wave ?? '')].map((symbol) => {
        let value
        if (symbol === '0' || symbol === '1') value = Number(symbol)
        else if (symbol === 'x') value = 'X'
        else if (symbol === '=') {
          value = lane.data?.[dataIndex] ?? `_var_${laneIndex}_${dataIndex}`
          dataIndex += 1
        } else if (symbol === '.') value = lastValue
        else value = `?${symbol}`
        lastValue = value
        return value
      })
    }
    const declaration = declarations.get(lane.name) ?? {}
    const bus = declaration.type === 'word' || Number(declaration.width ?? 1) > 1 || values.some((value) => typeof value === 'string' && !['X', 'x'].includes(value))
    return { name: lane.name, values, bus, declaration }
  })
}

function DigitalLane({ lane, index, cycleCount, labelWidth, cycleWidth, rowHeight }) {
  const top = 30 + index * rowHeight
  const high = top + 13
  const low = top + 39
  const mid = top + 26
  let path = ''
  lane.values.forEach((value, cycle) => {
    if (value === 'X' || value === 'x') return
    const x0 = labelWidth + cycle * cycleWidth
    const x1 = x0 + cycleWidth
    const y = value === 1 || value === '1' ? high : value === 0 || value === '0' ? low : mid
    const previous = lane.values[cycle - 1]
    const previousY = previous === 1 || previous === '1' ? high : previous === 0 || previous === '0' ? low : mid
    path += cycle === 0 || previous === 'X' || previous === 'x' ? `M ${x0} ${y} H ${x1} ` : `M ${x0} ${previousY} V ${y} H ${x1} `
  })
  return <g><path className="timing-digital-path" d={path} /><text className="timing-lane-label" x="10" y={top + 30}>{lane.name}</text>{lane.values.map((value, cycle) => {
    if (value !== 'X' && value !== 'x') return null
    return <g key={`${lane.name}-${cycle}`}><path className="timing-unknown-path" d={`M ${labelWidth + cycle * cycleWidth + 4} ${mid} H ${labelWidth + (cycle + 1) * cycleWidth - 4}`} /><text className="timing-value-label" x={labelWidth + (cycle + .5) * cycleWidth} y={mid - 4}>X</text></g>
  })}<title>{lane.name}: {lane.values.map(String).join(' · ')}</title></g>
}

function BusLane({ lane, index, cycleCount, labelWidth, cycleWidth, rowHeight }) {
  const top = 30 + index * rowHeight
  const center = top + 26
  const inset = 9
  return <g><text className="timing-lane-label" x="10" y={center + 4}>{lane.name}</text>{lane.values.map((value, cycle) => {
    const x0 = labelWidth + cycle * cycleWidth
    const x1 = x0 + cycleWidth
    const points = `${x0 + inset},${top + 10} ${x0},${center} ${x0 + inset},${top + 42} ${x1 - inset},${top + 42} ${x1},${center} ${x1 - inset},${top + 10}`
    return <g key={`${lane.name}-${cycle}`}><polygon className={`timing-bus-shape ${value === 'X' || value === 'x' ? 'timing-bus-unknown' : ''}`} points={points} /><text className="timing-bus-label" x={(x0 + x1) / 2} y={center + 4}>{String(value)}</text></g>
  })}<title>{lane.name}: {lane.values.map(String).join(' · ')}</title></g>
}

function TimingSvg({ lanes, waveform }) {
  const cycleCount = Math.max(0, ...lanes.map((lane) => lane.values.length))
  const labelWidth = 150
  const cycleWidth = 90
  const rowHeight = 58
  const height = 42 + lanes.length * rowHeight + 9
  const width = labelWidth + cycleCount * cycleWidth + 12
  return <div className="timing-svg-scroll"><svg className="timing-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`Discrete cycle timing diagram: ${waveform?.name ?? 'selected waveform'}`}>
    {Array.from({ length: cycleCount + 1 }, (_, cycle) => <g key={`grid-${cycle}`}><line className="timing-grid-line" x1={labelWidth + cycle * cycleWidth} x2={labelWidth + cycle * cycleWidth} y1="20" y2={height - 8} /><text className="timing-cycle-label" x={labelWidth + cycle * cycleWidth + cycleWidth / 2} y="14">{cycle}</text></g>)}
    {lanes.map((lane, index) => lane.bus
      ? <BusLane key={lane.name} lane={lane} index={index} cycleCount={cycleCount} labelWidth={labelWidth} cycleWidth={cycleWidth} rowHeight={rowHeight} />
      : <DigitalLane key={lane.name} lane={lane} index={index} cycleCount={cycleCount} labelWidth={labelWidth} cycleWidth={cycleWidth} rowHeight={rowHeight} />)}
  </svg></div>
}

function protocolLabel(protocol) {
  return protocol || 'Other'
}

export function TimingDiagramViewer({ catalog }) {
  const timingFiles = catalog?.timing_diagram_files ?? []
  const families = useMemo(() => [...new Set(timingFiles.map((item) => item.protocol ?? 'Other'))].sort(), [timingFiles])
  const [family, setFamily] = useState('')
  const [mechanism, setMechanism] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [data, setData] = useState(null)
  const [waveformIndex, setWaveformIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (families.length && !family) setFamily(families.includes('AXI') ? 'AXI' : families[0]) }, [families, family])
  const familyFiles = timingFiles.filter((item) => item.protocol === family)
  const mechanisms = [...new Set(familyFiles.map((item) => item.mechanism).filter(Boolean))].sort()
  useEffect(() => { if (mechanisms.length && !mechanisms.includes(mechanism)) setMechanism(mechanisms[0]) }, [family, mechanisms.join('|')])
  const mechanismFiles = familyFiles.filter((item) => item.mechanism === mechanism)
  useEffect(() => {
    if (!mechanismFiles.length) { setSelectedPath(''); return }
    if (!mechanismFiles.some((item) => item.path === selectedPath)) {
      setSelectedPath(mechanismFiles.find((item) => item.format === 'self_defined_json')?.path ?? mechanismFiles[0].path)
    }
  }, [mechanism, family, mechanismFiles.map((item) => item.path).join('|'), selectedPath])
  useEffect(() => {
    let cancelled = false
    if (!selectedPath) { setData(null); return undefined }
    setLoading(true); setError(''); setWaveformIndex(0)
    api.input(selectedPath).then((result) => { if (!cancelled) setData(result) }).catch((issue) => { if (!cancelled) setError(issue.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedPath])

  const waveforms = data?.waveforms ?? []
  const waveform = waveforms[waveformIndex]
  const lanes = waveformLanes(data, waveform)
  return <div className="timing-workspace">
    <section className="panel timing-controls-panel"><div className="timing-controls-intro"><div className="eyebrow">CYCLE-ACCURATE INPUT VIEW</div><h3>Timing diagram</h3><p>Choose a protocol family, mechanism, source format, and waveform. Each step represents one encoded cycle from the repository input.</p></div>
      <div className="timing-selectors"><label className="form-field"><span>PROTOCOL FAMILY</span><select value={family} onChange={(event) => { setFamily(event.target.value); setMechanism(''); setSelectedPath('') }}>{families.map((item) => <option key={item} value={item}>{protocolLabel(item)}</option>)}</select></label><label className="form-field"><span>MECHANISM</span><select value={mechanism} onChange={(event) => setMechanism(event.target.value)}>{mechanisms.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label className="form-field"><span>INPUT FORMAT</span><select value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)}>{mechanismFiles.map((item) => <option value={item.path} key={item.path}>{item.format === 'wavedrom_json' ? 'WaveDrom JSON' : 'Self-defined JSON'}</option>)}</select></label></div>
      <div className="timing-source-path"><Icon name="folder-input" size={14} /><code>{selectedPath || 'Waiting for repository catalog'}</code></div>
    </section>
    <section className="panel timing-diagram-panel"><div className="panel-heading"><div><div className="eyebrow">{family || 'PROTOCOL'} / {(mechanism || '').replaceAll('_', ' ').toUpperCase()}</div><h3>{waveform?.name ?? 'Waveform'}</h3></div>{waveforms.length > 0 && <label className="waveform-select"><span>WAVEFORM</span><select value={waveformIndex} onChange={(event) => setWaveformIndex(Number(event.target.value))}>{waveforms.map((item, index) => <option value={index} key={`${item.name}-${index}`}>{item.name ?? `Waveform ${index + 1}`}</option>)}</select></label>}</div>
      {loading ? <div className="inline-loading"><span className="spinner" />Loading timing input…</div> : error ? <div className="inline-error" role="alert"><Icon name="circle-help" size={14} />{error}</div> : lanes.length ? <><div className="timing-legend"><span><i className="legend-high" />Logic high</span><span><i className="legend-low" />Logic low</span><span><i className="legend-bus" />Bus / symbolic value</span><span><i className="legend-unknown" />Unknown</span></div><TimingSvg lanes={lanes} waveform={waveform} /><div className="timing-accuracy-note"><Icon name="circle-help" size={15} /><span>These inputs encode values per cycle, not sub-cycle transition times. Edges are placed at cycle boundaries; the diagram does not infer clock phase or edge timing absent from the source.</span></div></> : <div className="data-empty"><Icon name="audio-waveform" size={17} /><span>Select a timing diagram input to render its traces.</span></div>}
    </section>
    <section className="panel data-panel timing-source-json"><div className="panel-heading"><div><div className="eyebrow">SOURCE INSPECTOR</div><h3>Timing input JSON</h3></div><span className="live-label">ACTUAL INPUT</span></div><JsonExplorer value={data} title={selectedPath.split('/').at(-1) || 'Timing diagram input'} loading={loading} error={error} /></section>
  </div>
}
