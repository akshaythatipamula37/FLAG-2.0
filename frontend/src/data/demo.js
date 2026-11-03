export const demoMetrics = [
  { label: 'PIPELINE STAGES', value: '04', detail: 'Core generation path', tone: 'cyan' },
  { label: 'PROTOCOL FAMILIES', value: '06', detail: 'In repository examples', tone: 'violet' },
  { label: 'INPUT FORMAT', value: 'JSON', detail: '+ WaveDrom subset', tone: 'blue' },
  { label: 'WORKBENCH MODE', value: 'DEMO', detail: 'No backend connected', tone: 'amber' },
]

export const coreStages = [
  { code: '01', title: 'G2T', subtitle: 'Grammar → Templates', description: 'Expand grammar categories into property-template ASTs.', accent: 'cyan', output: 'templates.json' },
  { code: '02', title: 'T2P', subtitle: 'Templates → Properties', description: 'Instantiate templates against declared signals and words.', accent: 'blue', output: 'candidates*.json' },
  { code: '03', title: 'SAT FILTER', subtitle: 'Z3 trace consistency', description: 'Check candidates against supplied timing diagrams.', accent: 'violet', output: 'sat_filtered*.json' },
  { code: '04', title: 'SVA OUTPUT', subtitle: 'Rendered properties', description: 'Expose SVA strings alongside NL, LTL-like text, and AST.', accent: 'green', output: 'sat_filtered_SVA.json' },
]

export const llmStages = [
  { title: 'Relevant text extraction', detail: 'Specification PDF → mechanism description' },
  { title: 'Signal mapping & selection', detail: 'Prepare candidate rules for Batch API review' },
  { title: 'LLM-as-a-judge', detail: 'Prepare evaluation requests and parse returned files' },
]

export const demoArtifacts = [
  { name: 'timing_diagrams.json', type: 'INPUT · JSON', status: 'Repository example', icon: 'braces' },
  { name: 'templates.json', type: 'G2T · JSON', status: 'Generated artifact format', icon: 'layers' },
  { name: 'sat_filtered.json', type: 'SAT · JSON', status: 'Generated artifact format', icon: 'check' },
  { name: 'sat_filtered_SVA.json', type: 'SVA · JSON', status: 'Generated artifact format', icon: 'code' },
]

export const navigation = [
  { label: 'Overview', icon: 'layout-dashboard', group: 'WORKSPACE' },
  { label: 'Pipeline Explorer', icon: 'workflow', group: 'WORKSPACE' },
  { label: 'Input Explorer', icon: 'folder-input', group: 'EXPLORE' },
  { label: 'Timing Diagram Viewer', icon: 'audio-waveform', group: 'EXPLORE' },
  { label: 'Template Explorer', icon: 'layers-3', group: 'EXPLORE' },
  { label: 'Property Explorer', icon: 'list-checks', group: 'EXPLORE' },
  { label: 'SVA Explorer', icon: 'code-xml', group: 'EXPLORE' },
  { label: 'Verification Dashboard', icon: 'shield-check', group: 'ANALYSIS' },
  { label: 'LLM Evaluation', icon: 'sparkles', group: 'ANALYSIS' },
  { label: 'Artifact Explorer', icon: 'archive', group: 'ANALYSIS' },
  { label: 'Traceability', icon: 'git-branch', group: 'ANALYSIS' },
  { label: 'Experiment Comparison', icon: 'chart-no-axes-combined', group: 'ANALYSIS' },
  { label: 'Execution Console', icon: 'terminal-square', group: 'SYSTEM' },
]

export const pageDescriptions = {
  'Pipeline Explorer': 'Inspect the core generation stages and the separate LLM-assisted workflow.',
  'Input Explorer': 'Browse grammar, timing-diagram, and configuration inputs when a data source is connected.',
  'Timing Diagram Viewer': 'Review protocol timing traces in the repository JSON or supported WaveDrom subset.',
  'Template Explorer': 'Inspect grammar-derived templates with their AST, NL, and LTL-like representations.',
  'Property Explorer': 'Explore candidate and SAT-filtered property records across their available representations.',
  'SVA Explorer': 'Read generated SystemVerilog Assertions as code-oriented artifacts.',
  'Verification Dashboard': 'Review the current trace-based SAT filtering artifacts and their documented limits.',
  'LLM Evaluation': 'Inspect the separate LLM batch preparation, response, and evaluation workflow.',
  'Artifact Explorer': 'Browse source inputs and generated artifact formats from a selected run.',
  Traceability: 'Follow property relationships across source rules and generated artifacts where identifiers permit.',
  'Experiment Comparison': 'Compare saved experiment artifacts after run metadata and selection are available.',
  'Execution Console': 'View process output and stage logs for a connected backend run.',
}
