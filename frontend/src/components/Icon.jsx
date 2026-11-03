import {
  Activity, Archive, AudioWaveform, Braces, Check, ChevronDown, ChevronRight,
  CircleHelp, Code2, CodeXml, Command, FileCode2, FolderInput, GitBranch,
  Layers, Layers3, LayoutDashboard, ListChecks, Menu, MoreHorizontal,
  Network, PanelLeftClose, Play, Search, Settings2, ShieldCheck, Sparkles,
  TerminalSquare, Workflow, X, BarChart3,
} from 'lucide-react'

const iconMap = {
  activity: Activity, archive: Archive, 'audio-waveform': AudioWaveform,
  braces: Braces, check: Check, 'chevron-down': ChevronDown,
  'chevron-right': ChevronRight, help: CircleHelp, code: Code2,
  'code-xml': CodeXml, command: Command, 'file-code': FileCode2,
  'folder-input': FolderInput, 'git-branch': GitBranch, layers: Layers,
  'layers-3': Layers3, 'layout-dashboard': LayoutDashboard,
  'list-checks': ListChecks, menu: Menu, more: MoreHorizontal,
  network: Network, 'panel-close': PanelLeftClose, play: Play,
  search: Search, settings: Settings2, 'shield-check': ShieldCheck,
  sparkles: Sparkles, 'terminal-square': TerminalSquare, workflow: Workflow,
  close: X, 'chart-no-axes-combined': BarChart3,
}

export function Icon({ name, size = 16, ...props }) {
  const Component = iconMap[name] ?? CircleHelp
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" {...props} />
}
