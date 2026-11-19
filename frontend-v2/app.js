/**
 * FLAG Formal SVA Studio — Application Logic (frontend-v2)
 * High-performance, silky smooth, responsive vanilla JavaScript (ES6+).
 * Features:
 *  - Ultra-fast virtual pagination (handles 10,000+ properties with zero lag)
 *  - Debounced search & targeted DOM updates (no input stutter or dropped clicks)
 *  - Rejection diagnosis: Identifies and explains why properties were rejected by SMT solver
 *  - Interactive cycle-accurate waveform viewer with high-FPS hover tracking
 *  - 1-click SystemVerilog checker module exporter (.sv)
 *  - Persistent run history switcher
 */

'use strict';

// ============================================================================
// Configuration & State
// ============================================================================

const CONFIG = {
  API_BASE: localStorage.getItem('FLAG_API_BASE') || 'http://127.0.0.1:8000',
  POLL_INTERVAL: 1500,
  CYCLE_WIDTH_BASE: 76,
  ROW_HEIGHT: 52,
  LABEL_WIDTH: 150,
};

const STATE = {
  theme: localStorage.getItem('FLAG_THEME') || 'dark',
  page: 'studio', // 'studio' | 'properties' | 'waveforms' | 'verification' | 'templates' | 'console' | 'artifacts' | 'rag'
  sidebarOpen: false,

  // Backend data
  health: null,
  catalog: null,
  runs: [], // History of runs
  activeRunId: localStorage.getItem('FLAG_ACTIVE_RUN_ID') || null,
  activeRun: null,
  activeRunLogs: null,
  activeRunArtifacts: [],
  artifactsCache: {},

  // Form selections
  selectedGrammar: '',
  selectedTiming: '',
  selectedMode: 'all',
  selectedVerbose: true,
  isSubmitting: false,

  // Waveform state
  waveformFamily: 'AXI',
  waveformMechanism: 'channel_handshake',
  waveformPath: '',
  waveformIndex: 0,
  waveformZoom: 1.0,
  waveformHoverCycle: null,
  waveformInputData: null,

  // SVA / Property Explorer state
  propSearchQuery: '',
  propFilterType: 'survivor', // 'survivor' | 'rejected' | 'candidate'
  propSignalFilter: 'all',
  propCurrentPage: 1,
  propPageSize: 25,
  currentFilteredProperties: [],

  // Templates & Grammar Explorer state
  templateSubTab: 'templates', // 'templates' | 'grammar'
  selectedGrammarFile: 'grammar/complete.json',
  templateSearchQuery: '',
  templateCurrentPage: 1,
  templatePageSize: 25,
  grammarDataCache: {},
  currentGrammarData: null,
  templatesData: null,
  isTemplatesLoading: false,

  // JSON viewer state
  jsonViewerMode: 'code', // 'code' | 'tree'
  selectedArtifactPath: 'sat_filtered_SVA.json',

  // Modal / Drawer
  modalType: null, // 'run_history' | 'ast_detail' | 'sva_export'
  modalData: null,

  // ============================================================
  // RAG Spec Extractor state
  // ============================================================
  ragDocuments: [],          // list of spec_documents from backend
  ragSelectedDocId: null,    // currently viewed document id
  ragDiagrams: [],           // extracted_diagrams for selected doc
  ragJobs: [],               // extraction_jobs for selected doc
  ragJobPollTimer: null,     // setInterval handle for job polling
  ragUploadProtocol: '',
  ragUploadDescription: '',
  ragMechanismQuery: '',
  ragOpenAIKey: localStorage.getItem('FLAG_OPENAI_KEY') || '',
  ragModel: 'rule_based', // 'rule_based' | 'gpt-4o' | 'gpt-4o-mini'
  ragPreviewDiagId: null,    // diagram being previewed
};

// ============================================================================
// API Client
// ============================================================================

async function apiRequest(path, options = {}) {
  const url = `${CONFIG.API_BASE}/api${path}`;
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(url, { ...options, headers });
    let data = null;
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await res.json();
    } else if (res.ok) {
      data = await res.text();
    }

    if (!res.ok) {
      const errMsg = (data && data.detail) ? data.detail : `Server error: ${res.status}`;
      throw new Error(errMsg);
    }
    return data;
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      throw new Error(`Cannot reach backend at ${CONFIG.API_BASE}. Start FastAPI with: python -m uvicorn app.main:app --app-dir backend`);
    }
    throw err;
  }
}

// ============================================================================
// Toast Notifications & Helpers
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <div>${escapeHtml(message)}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, 'success');
  } catch (err) {
    showToast('Failed to copy to clipboard', 'error');
  }
}

// SVA Syntax Highlighter
function highlightSva(svaText = '') {
  if (!svaText) return '';
  let safe = escapeHtml(svaText);

  // Functions ($rose, $fell, $stable, $past, $onehot)
  safe = safe.replace(/(\$(?:rose|fell|stable|past|onehot))\b/g, '<span class="tok-func">$1</span>');

  // Temporal implication & cycles (|->, |=>, ##1, ##[0:$], ##)
  safe = safe.replace(/(\|->|\|=&gt;)/g, '<span class="tok-temporal">$1</span>');
  safe = safe.replace(/(##\[[0-9:\$]+\]|##[0-9]+)/g, '<span class="tok-cycle">$1</span>');

  // Binary/logic literals (1'b1, 1'b0, 0, 1)
  safe = safe.replace(/\b(1'b[01])\b/g, '<span class="tok-literal">$1</span>');

  // Logical & Relational Operators (==, !=, &&, ||, !)
  safe = safe.replace(/(==|!=|&amp;&amp;|\|\|)/g, '<span class="tok-op">$1</span>');

  // Parentheses
  safe = safe.replace(/([()])/g, '<span class="tok-paren">$1</span>');

  return safe;
}

// ============================================================================
// Initialization & Backend Sync
// ============================================================================

async function initApp() {
  document.documentElement.setAttribute('data-theme', STATE.theme);

  // Render static outer shell once
  renderShell();

  try {
    await Promise.allSettled([
      fetchHealth(),
      fetchCatalog(),
      fetchRunHistory(),
    ]);

    if (STATE.activeRunId) {
      await loadRun(STATE.activeRunId, false);
    } else if (STATE.runs && STATE.runs.length > 0) {
      await loadRun(STATE.runs[0].run_id, false);
    }

    if (STATE.catalog && STATE.catalog.timing_diagram_files.length > 0) {
      const defaultTiming = STATE.catalog.timing_diagram_files.find(f => f.path.includes('AXI/channel_handshake'))
        || STATE.catalog.timing_diagram_files[0];
      STATE.waveformPath = defaultTiming.path;
      STATE.waveformFamily = defaultTiming.protocol || 'AXI';
      STATE.waveformMechanism = defaultTiming.mechanism || 'channel_handshake';
      await loadWaveformInput(STATE.waveformPath);
    }
  } catch (err) {
    console.warn('Initialization notice:', err);
  }

  updateHeaderStatus();
  renderCurrentView();
}

async function fetchHealth() {
  try {
    STATE.health = await apiRequest('/health');
  } catch (err) {
    STATE.health = null;
  }
}

async function fetchCatalog() {
  try {
    STATE.catalog = await apiRequest('/catalog');
    if (STATE.catalog) {
      if (!STATE.selectedGrammar && STATE.catalog.grammar_files.length > 0) {
        const complete = STATE.catalog.grammar_files.find(g => g.path === 'grammar/complete.json');
        STATE.selectedGrammar = complete ? complete.path : STATE.catalog.grammar_files[0].path;
      }
      if (!STATE.selectedTiming && STATE.catalog.timing_diagram_files.length > 0) {
        const axi = STATE.catalog.timing_diagram_files.find(t => t.path.includes('AXI/channel_handshake'));
        STATE.selectedTiming = axi ? axi.path : STATE.catalog.timing_diagram_files[0].path;
      }
    }
  } catch (err) {
    console.error('Failed to load catalog:', err);
  }
}

async function fetchRunHistory() {
  try {
    const list = await apiRequest('/runs');
    if (Array.isArray(list)) {
      STATE.runs = list;
    }
  } catch (err) {
    const stored = localStorage.getItem('FLAG_RUNS_HISTORY');
    if (stored) {
      try { STATE.runs = JSON.parse(stored); } catch (e) {}
    }
  }
}

async function loadRun(runId, shouldRerender = true) {
  if (!runId) return;
  STATE.activeRunId = runId;
  localStorage.setItem('FLAG_ACTIVE_RUN_ID', runId);

  try {
    const [runMeta, logs, artifacts] = await Promise.all([
      apiRequest(`/runs/${runId}`),
      apiRequest(`/runs/${runId}/logs`).catch(() => ({ combined: '', stdout: '', stderr: '' })),
      apiRequest(`/runs/${runId}/artifacts`).catch(() => ({ artifacts: [] })),
    ]);

    STATE.activeRun = runMeta;
    STATE.activeRunLogs = logs;
    STATE.activeRunArtifacts = artifacts.artifacts || [];

    // Pre-cache key artifacts
    const keysToLoad = ['sat_filtered_SVA.json', 'sat_filtered.json', 'candidates.json', 'templates.json'];
    for (const key of keysToLoad) {
      if (STATE.activeRunArtifacts.some(a => a.path === key)) {
        loadArtifact(key, false);
      }
    }

    if (['queued', 'running'].includes(runMeta.status)) {
      schedulePoll();
    }
  } catch (err) {
    showToast(`Could not load run ${runId.slice(0, 8)}: ${err.message}`, 'error');
  }

  updateHeaderStatus();
  if (shouldRerender) renderCurrentView();
}

async function loadArtifact(artifactPath, shouldRerender = true) {
  if (!STATE.activeRunId || !artifactPath) return;
  const cacheKey = `${STATE.activeRunId}:${artifactPath}`;

  if (STATE.artifactsCache[cacheKey]) {
    if (shouldRerender) renderCurrentView();
    return STATE.artifactsCache[cacheKey];
  }

  try {
    const data = await apiRequest(`/runs/${STATE.activeRunId}/artifacts/${artifactPath}`);
    STATE.artifactsCache[cacheKey] = data;
    if (shouldRerender) renderCurrentView();
    return data;
  } catch (err) {
    console.error('Failed to load artifact:', artifactPath, err);
    return null;
  }
}

async function loadWaveformInput(path) {
  if (!path) return;
  try {
    const data = await apiRequest(`/inputs/${path}`);
    STATE.waveformInputData = data;
    STATE.waveformIndex = 0;
  } catch (err) {
    console.error('Failed to load waveform input:', err);
    STATE.waveformInputData = null;
  }
}

let pollTimer = null;
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!STATE.activeRunId) return;
    try {
      const runMeta = await apiRequest(`/runs/${STATE.activeRunId}`);
      const oldStatus = STATE.activeRun?.status;
      STATE.activeRun = runMeta;

      const logs = await apiRequest(`/runs/${STATE.activeRunId}/logs`).catch(() => null);
      if (logs) {
        STATE.activeRunLogs = logs;
        // Targeted log update if on console page (no DOM rebuild!)
        const consoleStream = document.getElementById('console-stream');
        if (consoleStream && STATE.page === 'console') {
          consoleStream.textContent = logs.combined || 'No logs captured yet.';
        }
      }

      updateHeaderStatus();

      if (['completed', 'failed'].includes(runMeta.status)) {
        const artifacts = await apiRequest(`/runs/${STATE.activeRunId}/artifacts`).catch(() => ({ artifacts: [] }));
        STATE.activeRunArtifacts = artifacts.artifacts || [];
        showToast(
          runMeta.status === 'completed' ? 'FLAG generation completed successfully!' : 'FLAG execution failed.',
          runMeta.status === 'completed' ? 'success' : 'error'
        );
        for (const key of ['sat_filtered_SVA.json', 'sat_filtered.json', 'candidates.json']) {
          if (STATE.activeRunArtifacts.some(a => a.path === key)) {
            loadArtifact(key, false);
          }
        }
        await fetchRunHistory();
        renderCurrentView();
      } else {
        if (oldStatus !== runMeta.status) {
          renderCurrentView();
        }
        schedulePoll();
      }
    } catch (err) {
      console.warn('Poll notice:', err);
    }
  }, CONFIG.POLL_INTERVAL);
}

// ============================================================================
// Actions & Handlers
// ============================================================================

async function handleLaunchRun(event) {
  if (event) event.preventDefault();
  if (STATE.isSubmitting) return;

  if (!STATE.selectedGrammar) {
    showToast('Please select a grammar file.', 'error');
    return;
  }
  if (STATE.selectedMode !== 'g2t' && !STATE.selectedTiming) {
    showToast('Please select a timing diagram for this mode.', 'error');
    return;
  }

  STATE.isSubmitting = true;
  renderCurrentView();

  try {
    const payload = {
      grammar_path: STATE.selectedGrammar,
      timing_diagram_path: STATE.selectedMode === 'g2t' ? null : STATE.selectedTiming,
      mode: STATE.selectedMode,
      verbose: STATE.selectedVerbose,
    };

    const runRes = await apiRequest('/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showToast(`Run ${runRes.run_id.slice(0, 8)} queued!`, 'info');
    STATE.activeRunId = runRes.run_id;
    STATE.activeRun = runRes;
    STATE.activeRunLogs = { combined: '', stdout: '', stderr: '' };
    STATE.activeRunArtifacts = [];
    localStorage.setItem('FLAG_ACTIVE_RUN_ID', runRes.run_id);

    if (!STATE.runs.some(r => r.run_id === runRes.run_id)) {
      STATE.runs.unshift(runRes);
      localStorage.setItem('FLAG_RUNS_HISTORY', JSON.stringify(STATE.runs.slice(0, 50)));
    }

    updateHeaderStatus();
    schedulePoll();
  } catch (err) {
    showToast(`Launch failed: ${err.message}`, 'error');
  } finally {
    STATE.isSubmitting = false;
    renderCurrentView();
  }
}

function toggleTheme() {
  STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('FLAG_THEME', STATE.theme);
  document.documentElement.setAttribute('data-theme', STATE.theme);
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) themeBtn.textContent = STATE.theme === 'dark' ? '☀️' : '🌙';
}

function navigateTo(page) {
  if (STATE.page === page) return;
  // Stop RAG job polling when leaving the rag view
  if (STATE.page === 'rag' && STATE.ragJobPollTimer) {
    clearInterval(STATE.ragJobPollTimer);
    STATE.ragJobPollTimer = null;
  }
  STATE.page = page;
  STATE.sidebarOpen = false;

  // Update active class on nav buttons without re-rendering the sidebar
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.remove('open');

  updateBreadcrumb();
  renderCurrentView();
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (page === 'templates') {
    loadTemplatesAndGrammar();
  }
  if (page === 'rag') {
    ragLoadDocuments();
  }
  if (page === 'properties' && !STATE.waveformInputData) {
    const defaultTimingPath = STATE.activeRun?.timing_diagram_path
      || STATE.catalog?.timing_diagram_files?.[0]?.path
      || 'test_cases/AXI/channel_handshake/timing_diagrams.json';
    loadWaveformInput(defaultTimingPath).then(() => renderPropertyList());
  }
}

// Debounce helper
let searchDebounceTimer = null;
function handleSearchInput(value) {
  STATE.propSearchQuery = value;
  STATE.propCurrentPage = 1;

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderPropertyList();
  }, 120);
}

function handleFilterTypeChange(type) {
  STATE.propFilterType = type;
  STATE.propCurrentPage = 1;

  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === type);
  });

  renderPropertyList();
}

function handleSignalFilterChange(signal) {
  STATE.propSignalFilter = signal;
  STATE.propCurrentPage = 1;
  renderPropertyList();
}

function handlePageChange(newPage) {
  STATE.propCurrentPage = newPage;
  renderPropertyList();
  const listEl = document.querySelector('.assertions-list');
  if (listEl) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handlePageSizeChange(newSize) {
  STATE.propPageSize = Number(newSize);
  STATE.propCurrentPage = 1;
  renderPropertyList();
}

// ============================================================================
// Counterexample & SMT Rejection Diagnosis Engine
// ============================================================================

function parseWaveformLanes(wave) {
  if (!wave) return {};
  const rawLanes = wave.signals || wave.signal || [];
  const map = {};
  rawLanes.forEach(lane => {
    let vals = lane.values;
    if (!Array.isArray(vals)) {
      let dataIdx = 0;
      let lastVal = 0;
      vals = [...(lane.wave || '')].map(ch => {
        let v;
        if (ch === '.') v = lastVal;
        else if (ch === '0') v = 0;
        else if (ch === '1') v = 1;
        else if (ch === 'x' || ch === 'X') v = 'X';
        else if (ch === '=') {
          v = (lane.data && lane.data[dataIdx]) ? lane.data[dataIdx] : `DATA_${dataIdx}`;
          dataIdx++;
        } else {
          v = ch;
        }
        lastVal = v;
        return v;
      });
    }
    map[lane.name] = vals;
  });
  return map;
}

function evalNodeAtCycle(node, sigMap, t, totalCycles) {
  if (!node) return null;
  const ntype = node.type;

  if (ntype === 'basic') {
    const op = node.operator;
    const sig = node.operands?.[0]?.value;
    const vals = sigMap[sig];
    if (!vals || t >= vals.length) return null;

    if (op === '==' || op === '!=') {
      const expected = node.operands?.[1]?.value;
      const actual = vals[t];
      if (actual === 'X' || actual === undefined) return null;
      const match = (String(actual) === String(expected));
      return (op === '==') ? match : !match;
    } else if (op === '$rose') {
      if (t === 0) return false;
      return (vals[t - 1] === 0 || vals[t - 1] === '0') && (vals[t] === 1 || vals[t] === '1');
    } else if (op === '$fell') {
      if (t === 0) return false;
      return (vals[t - 1] === 1 || vals[t - 1] === '1') && (vals[t] === 0 || vals[t] === '0');
    } else if (op === '$stable') {
      if (t === 0) return true;
      return vals[t - 1] !== 'X' && String(vals[t - 1]) === String(vals[t]);
    }
  } else if (ntype === 'operator') {
    const op = node.operator;
    if (op === 'And') {
      const res = node.operands.map(c => evalNodeAtCycle(c, sigMap, t, totalCycles));
      return res.every(r => r === true);
    } else if (op === 'Or') {
      const res = node.operands.map(c => evalNodeAtCycle(c, sigMap, t, totalCycles));
      return res.some(r => r === true);
    } else if (op === 'Implies') {
      const ante = evalNodeAtCycle(node.operands[0], sigMap, t, totalCycles);
      if (ante === false) return true;
      if (ante === true) {
        return evalNodeAtCycle(node.operands[1], sigMap, t, totalCycles);
      }
      return null;
    } else if (op === 'X') {
      if (t + 1 >= totalCycles) return null;
      return evalNodeAtCycle(node.operands[0], sigMap, t + 1, totalCycles);
    } else if (op === 'F') {
      for (let cyc = t; cyc < totalCycles; cyc++) {
        if (evalNodeAtCycle(node.operands[0], sigMap, cyc, totalCycles) === true) return true;
      }
      return false;
    }
  }
  return null;
}

function diagnosePropertyRejection(prop, waveforms) {
  if (!waveforms || waveforms.length === 0) {
    return {
      title: 'SMT Solver Trace Counterexample',
      detail: 'The Z3 SMT solver proved that under the supplied protocol waveforms, this property is contradicted.',
      badge: 'SMT Rejected',
    };
  }

  const ast = prop.ast;
  if (!ast) {
    return {
      title: 'SMT Trace Inconsistency',
      detail: 'Contradicted finite trace assertions in the Z3 solver.',
      badge: 'Trace Inconsistency',
    };
  }

  let ante = null;
  let conseq = null;

  if (ast.operator === 'G' && ast.operands?.[0]?.operator === 'Implies') {
    ante = ast.operands[0].operands[0];
    conseq = ast.operands[0].operands[1];
  } else if (ast.operator === 'Implies') {
    ante = ast.operands[0];
    conseq = ast.operands[1];
  }

  if (ante && conseq) {
    for (const w of waveforms) {
      const sigMap = parseWaveformLanes(w);
      const totalCycles = Math.max(0, ...Object.values(sigMap).map(v => v.length));

      for (let cyc = 0; cyc < totalCycles; cyc++) {
        const aVal = evalNodeAtCycle(ante, sigMap, cyc, totalCycles);
        if (aVal === true) {
          const cVal = evalNodeAtCycle(conseq, sigMap, cyc, totalCycles);
          if (cVal === false) {
            const wName = w.name || 'Protocol Waveform';
            const isNext = (conseq.operator === 'X');
            const nextCycle = isNext ? cyc + 1 : cyc;
            const cycleText = isNext ? `cycle T${cyc} → T${nextCycle}` : `cycle T${cyc}`;

            let obsStr = '';
            const targetNode = isNext ? conseq.operands?.[0] : conseq;
            if (targetNode?.operands?.[0]?.value) {
              const sig = targetNode.operands[0].value;
              const obs = sigMap[sig]?.[nextCycle];
              if (obs !== undefined) {
                obsStr = ` (observed ${sig} = '${obs}' at T${nextCycle})`;
              }
            }

            return {
              title: `Violated on "${wName}" at ${cycleText}`,
              detail: `At ${cycleText}, the precondition triggered, but the assertion failed because the expected consequent was contradicted${obsStr}.`,
              waveform: wName,
              cycle: cycleText,
              badge: `Violated at T${cyc}`,
            };
          }
        }
      }
    }
  }

  const sva = prop.sva || '';
  if (sva.includes('$rose') || sva.includes('$fell')) {
    return {
      title: 'Signal Transition Edge Not Satisfied',
      detail: 'The transition trigger condition did not hold or lead to the asserted target state on the protocol traces.',
      badge: 'Edge Inconsistency',
    };
  }

  if (sva.includes('$stable')) {
    return {
      title: 'Signal Value Stability Violated',
      detail: 'The signal altered values across observed clock intervals instead of maintaining stability.',
      badge: 'Stability Violation',
    };
  }

  return {
    title: 'SMT Solver Trace Inconsistency',
    detail: 'Solver proved the negation of this property is satisfiable under the waveform constraints.',
    badge: 'Counterexample Found',
  };
}

// ============================================================================
// Waveform SVG Generator
// ============================================================================

function renderWaveformSvg(inputData, waveIdx = 0, zoom = 1.0) {
  if (!inputData || !inputData.waveforms || !inputData.waveforms[waveIdx]) {
    return `
      <div style="padding: 48px; text-align: center; color: var(--text-muted);">
        Select a timing diagram to inspect cycle-accurate signal waveforms.
      </div>
    `;
  }

  const wave = inputData.waveforms[waveIdx];
  const rawLanes = wave.signals || wave.signal || [];

  const parsedLanes = rawLanes.map(lane => {
    let vals = lane.values;
    if (!Array.isArray(vals)) {
      let dataIdx = 0;
      let lastVal = 0;
      vals = [...(lane.wave || '')].map(ch => {
        let v;
        if (ch === '.') v = lastVal;
        else if (ch === '0') v = 0;
        else if (ch === '1') v = 1;
        else if (ch === 'x' || ch === 'X') v = 'X';
        else if (ch === '=') {
          v = (lane.data && lane.data[dataIdx]) ? lane.data[dataIdx] : `DATA_${dataIdx}`;
          dataIdx++;
        } else {
          v = ch;
        }
        lastVal = v;
        return v;
      });
    }

    const isBus = vals.some(v => typeof v === 'string' && !['X', 'x'].includes(v));
    return {
      name: lane.name || 'UNNAMED',
      values: vals,
      isBus,
    };
  });

  const maxCycles = Math.max(0, ...parsedLanes.map(l => l.values.length));
  const cycleWidth = Math.round(CONFIG.CYCLE_WIDTH_BASE * zoom);
  const labelWidth = CONFIG.LABEL_WIDTH;
  const rowHeight = CONFIG.ROW_HEIGHT;
  const totalWidth = labelWidth + (maxCycles * cycleWidth) + 30;
  const totalHeight = 44 + (parsedLanes.length * rowHeight) + 16;

  let gridSvg = '';
  for (let c = 0; c <= maxCycles; c++) {
    const x = labelWidth + (c * cycleWidth);
    gridSvg += `<line class="timing-grid-line" x1="${x}" y1="24" x2="${x}" y2="${totalHeight - 8}" />`;
    if (c < maxCycles) {
      gridSvg += `<text class="timing-cycle-label" x="${x + (cycleWidth / 2)}" y="18">T${c}</text>`;
    }
  }

  // Hover cycle elements (initially hidden or at 0)
  const hoverSvg = `
    <rect class="timing-cursor-band" x="0" y="24" width="0" height="${totalHeight - 32}" style="opacity: 0;" />
    <line class="timing-cursor-line" x1="0" y1="24" x2="0" y2="${totalHeight - 8}" style="opacity: 0;" />
  `;

  let lanesSvg = '';
  parsedLanes.forEach((lane, idx) => {
    const top = 34 + (idx * rowHeight);
    const mid = top + (rowHeight / 2);
    const yHigh = top + 12;
    const yLow = top + 38;

    lanesSvg += `
      <text class="timing-lane-label" x="12" y="${mid + 5}">${escapeHtml(lane.name)}</text>
      <text x="${labelWidth - 14}" y="${mid + 4}" font-size="9" font-weight="700" fill="var(--text-muted)" text-anchor="end">
        ${lane.isBus ? 'BUS' : '1-BIT'}
      </text>
    `;

    if (lane.isBus) {
      lane.values.forEach((val, c) => {
        const x = labelWidth + (c * cycleWidth);
        const pad = 4;
        const pts = [
          `${x + pad},${mid}`,
          `${x + pad + 7},${yHigh}`,
          `${x + cycleWidth - pad - 7},${yHigh}`,
          `${x + cycleWidth - pad},${mid}`,
          `${x + cycleWidth - pad - 7},${yLow}`,
          `${x + pad + 7},${yLow}`,
        ].join(' ');

        lanesSvg += `
          <polygon class="timing-bus-shape" points="${pts}" />
          <text class="timing-bus-label" x="${x + (cycleWidth / 2)}" y="${mid}">${escapeHtml(String(val))}</text>
        `;
      });
    } else {
      let pathD = '';
      lane.values.forEach((val, c) => {
        const x = labelWidth + (c * cycleWidth);
        const xEnd = x + cycleWidth;
        const isHigh = (val === 1 || val === '1');
        const isLow = (val === 0 || val === '0');
        const y = isHigh ? yHigh : (isLow ? yLow : mid);

        if (c === 0) {
          pathD += `M ${x} ${y} H ${xEnd} `;
        } else {
          const prevVal = lane.values[c - 1];
          const prevHigh = (prevVal === 1 || prevVal === '1');
          const prevLow = (prevVal === 0 || prevVal === '0');
          const prevY = prevHigh ? yHigh : (prevLow ? yLow : mid);

          if (prevY !== y) {
            pathD += `V ${y} H ${xEnd} `;
          } else {
            pathD += `H ${xEnd} `;
          }
        }
      });
      lanesSvg += `<path class="timing-digital-path" d="${pathD}" />`;
    }
  });

  return `
    <svg class="timing-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" id="timing-svg-canvas">
      ${gridSvg}
      ${hoverSvg}
      ${lanesSvg}
    </svg>
  `;
}

// ============================================================================
// SystemVerilog Module Exporter
// ============================================================================

function generateSvaModule(runId, properties, metadata = {}) {
  const dateStr = new Date().toISOString().split('T')[0];
  const protocol = metadata.protocol || 'PROTOCOL';
  const mechanism = metadata.mechanism || 'MECHANISM';

  const signals = new Set();
  properties.forEach(p => {
    const text = p.sva || '';
    const matches = text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
    matches.forEach(m => {
      if (!['rose', 'fell', 'stable', 'past', 'onehot', 'b1', 'b0', 'clk', 'rst_n', 'assert', 'property'].includes(m) && isNaN(m)) {
        signals.add(m);
      }
    });
  });

  const signalPorts = Array.from(signals).sort().map(s => `  input logic        ${s}`).join(',\n');

  const assertionBlocks = properties.map((prop, idx) => {
    const num = idx + 1;
    const nl = prop.nl || 'Generated property assertion';
    const sva = prop.sva || '1';
    return `
  // Property ${num}: ${nl}
  property p_${num};
    ${sva};
  endproperty
  assert_p_${num}: assert property (p_${num})
    else $error("Assertion p_${num} violated: %s", "${escapeHtml(nl).replace(/"/g, '\\"')}");
    `;
  }).join('\n');

  return `// ============================================================================
// SystemVerilog Assertions (SVA) Module
// Generated by FLAG — Formal Property Generation Workbench
// Run ID: ${runId || 'N/A'} | Date: ${dateStr}
// Target Protocol: ${protocol} (${mechanism})
// Total Assertions: ${properties.length}
// ============================================================================

module ${protocol.toLowerCase()}_sva_checker (
  input logic        clk,
  input logic        rst_n,
${signalPorts}
);

  default clocking cb @(posedge clk); endclocking
  default disable iff (!rst_n);

${assertionBlocks}

endmodule
`;
}

// ============================================================================
// Sub-View Renderers
// ============================================================================

// 1. Studio View (Form + Pipeline Stepper + Overview)
function renderStudioView() {
  const activeRun = STATE.activeRun;
  const isRunning = activeRun && ['queued', 'running'].includes(activeRun.status);
  const isCompleted = activeRun && activeRun.status === 'completed';

  const grammarFiles = STATE.catalog?.grammar_files || [];
  const timingFiles = STATE.catalog?.timing_diagram_files || [];
  const families = [...new Set(timingFiles.map(t => t.protocol || 'Other'))].sort();

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">Interactive Studio</div>
        <h2>Formal Property Generation Workbench</h2>
        <p>Synthesize and filter cycle-accurate SystemVerilog Assertions (SVA) from formal grammar specifications and timing traces.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" onclick="openRunHistoryModal()">
          <span>⏱</span> Run History (${STATE.runs.length})
        </button>
      </div>
    </div>

    <!-- Studio Grid: Run Form + Active Run Card -->
    <div class="run-studio-grid">
      <!-- Run Configuration Form -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3>Pipeline Configuration</h3>
            <p>Select your grammar definitions, timing diagram trace, and pipeline stage.</p>
          </div>
          <span class="chip ${STATE.health ? 'chip-emerald' : 'chip-rose'}">
            ${STATE.health ? 'API Ready' : 'API Offline'}
          </span>
        </div>
        <div class="card-body">
          <form onsubmit="handleLaunchRun(event)">
            <div class="form-grid">
              <div class="form-group form-field-full">
                <label class="form-label">Grammar Definition</label>
                <select class="form-select" onchange="STATE.selectedGrammar = this.value;">
                  ${grammarFiles.map(g => `
                    <option value="${escapeHtml(g.path)}" ${g.path === STATE.selectedGrammar ? 'selected' : ''}>
                      ${escapeHtml(g.path)}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group form-field-full">
                <label class="form-label">Timing Diagram Trace</label>
                <select class="form-select" id="timing-select" onchange="STATE.selectedTiming = this.value;" ${STATE.selectedMode === 'g2t' ? 'disabled' : ''}>
                  <option value="">Select protocol & mechanism...</option>
                  ${families.map(fam => `
                    <optgroup label="${escapeHtml(fam)}">
                      ${timingFiles.filter(t => (t.protocol || 'Other') === fam).map(t => `
                        <option value="${escapeHtml(t.path)}" ${t.path === STATE.selectedTiming ? 'selected' : ''}>
                          ${escapeHtml((t.mechanism || t.path).replace(/_/g, ' '))} (${t.format === 'wavedrom_json' ? 'WaveDrom' : 'Self-defined'})
                        </option>
                      `).join('')}
                    </optgroup>
                  `).join('')}
                </select>
              </div>

              <div class="form-group form-field-full">
                <label class="form-label">Execution Mode</label>
                <div class="mode-toggle-group">
                  <button type="button" class="mode-toggle-btn ${STATE.selectedMode === 'all' ? 'selected' : ''}" onclick="setExecutionMode('all')">
                    Full Pipeline (all)
                  </button>
                  <button type="button" class="mode-toggle-btn ${STATE.selectedMode === 'g2t' ? 'selected' : ''}" onclick="setExecutionMode('g2t')">
                    Grammar → Templates (g2t)
                  </button>
                  <button type="button" class="mode-toggle-btn ${STATE.selectedMode === 't2p' ? 'selected' : ''}" onclick="setExecutionMode('t2p')">
                    Templates → SAT (t2p)
                  </button>
                </div>
              </div>

              <div class="form-group form-field-full">
                <label class="checkbox-label">
                  <input type="checkbox" ${STATE.selectedVerbose ? 'checked' : ''} onchange="STATE.selectedVerbose = this.checked;">
                  <span>Save intermediate candidates & verbose trace logs (--verbose)</span>
                </label>
              </div>
            </div>

            <div class="form-actions">
              <div style="font-size: 0.78rem; color: var(--text-muted);">
                Runs isolated in <code>backend/data/runs/</code>
              </div>
              <button type="submit" class="btn btn-primary" ${!STATE.health || isRunning || STATE.isSubmitting ? 'disabled' : ''}>
                <span>${isRunning || STATE.isSubmitting ? '⏳' : '▶'}</span>
                <span>${isRunning ? 'Running Pipeline...' : 'Launch FLAG Pipeline'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Active Run Metadata Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3>Active Run Status</h3>
            <p>${activeRun ? `ID: ${activeRun.run_id.slice(0, 8)}...` : 'No run selected'}</p>
          </div>
          ${activeRun ? `
            <span class="chip ${
              activeRun.status === 'completed' ? 'chip-emerald' :
              activeRun.status === 'running' ? 'chip-cyan' :
              activeRun.status === 'failed' ? 'chip-rose' : 'chip-muted'
            }">
              ${activeRun.status.toUpperCase()}
            </span>
          ` : ''}
        </div>
        <div class="card-body">
          ${activeRun ? `
            <div class="run-status-card">
              <div class="run-status-row">
                <div class="run-meta-item">
                  <span class="meta-label">Mode</span>
                  <span class="meta-value">${activeRun.mode}</span>
                </div>
                <div class="run-meta-item">
                  <span class="meta-label">Exit Code</span>
                  <span class="meta-value">${activeRun.exit_code !== null ? activeRun.exit_code : 'Running...'}</span>
                </div>
              </div>

              <div class="run-meta-item">
                <span class="meta-label">Grammar Source</span>
                <span class="meta-value" style="font-size: 0.78rem; word-break: break-all;">${escapeHtml(activeRun.grammar_path)}</span>
              </div>

              ${activeRun.timing_diagram_path ? `
                <div class="run-meta-item">
                  <span class="meta-label">Timing Diagram</span>
                  <span class="meta-value" style="font-size: 0.78rem; word-break: break-all;">${escapeHtml(activeRun.timing_diagram_path)}</span>
                </div>
              ` : ''}

              <div class="run-meta-item">
                <span class="meta-label">Created At</span>
                <span class="meta-value" style="font-size: 0.78rem;">${new Date(activeRun.created_at).toLocaleString()}</span>
              </div>

              ${activeRun.error ? `
                <div style="padding: 10px; border-radius: var(--radius-sm); background: var(--accent-rose-bg); color: var(--accent-rose); font-size: 0.78rem;">
                  ${escapeHtml(activeRun.error)}
                </div>
              ` : ''}

              <div style="display: flex; gap: 8px; margin-top: 6px;">
                <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="navigateTo('properties')">
                  Explore SVA
                </button>
                <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="navigateTo('console')">
                  View Logs
                </button>
              </div>
            </div>
          ` : `
            <div style="padding: 32px 16px; text-align: center; color: var(--text-muted);">
              <p>No active run in session.</p>
              <p style="font-size: 0.8rem; margin-top: 6px;">Launch a run above to generate and inspect properties.</p>
            </div>
          `}
        </div>
      </div>
    </div>

    <!-- Visual Pipeline Stepper -->
    <div style="margin-bottom: 28px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.8px;">
          Generation & Verification Pipeline Stages
        </span>
        <span style="font-size: 0.78rem; color: var(--text-muted);">Trace-based finite consistency check</span>
      </div>

      <div class="pipeline-stepper">
        <div class="stage-step-card ${isCompleted ? 'stage-completed' : (isRunning ? 'stage-active' : '')}">
          <div class="stage-top">
            <span class="stage-number">STAGE 01</span>
            <span class="stage-status-pill ${isCompleted ? 'completed' : (isRunning ? 'running' : 'waiting')}">
              ${isCompleted ? 'Done' : (isRunning ? 'Active' : 'Standby')}
            </span>
          </div>
          <div class="stage-title">Grammar → Templates</div>
          <div class="stage-desc">Expands production rules from BNF grammar into formal property templates.</div>
          <button class="stage-output-link" onclick="STATE.selectedArtifactPath = 'templates.json'; navigateTo('artifacts');">
            <span>▧</span> templates.json
          </button>
        </div>

        <div class="stage-step-card ${isCompleted ? 'stage-completed' : (isRunning ? 'stage-active' : '')}">
          <div class="stage-top">
            <span class="stage-number">STAGE 02</span>
            <span class="stage-status-pill ${isCompleted ? 'completed' : (isRunning ? 'running' : 'waiting')}">
              ${isCompleted ? 'Done' : (isRunning ? 'Active' : 'Standby')}
            </span>
          </div>
          <div class="stage-title">Templates → Properties</div>
          <div class="stage-desc">Instantiates templates with signals, levels, and timing intervals to form candidates.</div>
          <button class="stage-output-link" onclick="STATE.selectedArtifactPath = 'candidates.json'; navigateTo('artifacts');">
            <span>▧</span> candidates.json
          </button>
        </div>

        <div class="stage-step-card ${isCompleted ? 'stage-completed' : (isRunning ? 'stage-active' : '')}">
          <div class="stage-top">
            <span class="stage-number">STAGE 03</span>
            <span class="stage-status-pill ${isCompleted ? 'completed' : (isRunning ? 'running' : 'waiting')}">
              ${isCompleted ? 'Done' : (isRunning ? 'Active' : 'Standby')}
            </span>
          </div>
          <div class="stage-title">SAT Trace Filtering</div>
          <div class="stage-desc">Encodes timing traces into Z3 SMT solver constraints to eliminate inconsistent candidates.</div>
          <button class="stage-output-link" onclick="STATE.selectedArtifactPath = 'sat_filtered.json'; navigateTo('artifacts');">
            <span>▧</span> sat_filtered.json
          </button>
        </div>

        <div class="stage-step-card ${isCompleted ? 'stage-completed' : (isRunning ? 'stage-active' : '')}">
          <div class="stage-top">
            <span class="stage-number">STAGE 04</span>
            <span class="stage-status-pill ${isCompleted ? 'completed' : (isRunning ? 'running' : 'waiting')}">
              ${isCompleted ? 'Done' : (isRunning ? 'Active' : 'Standby')}
            </span>
          </div>
          <div class="stage-title">SVA Assertions Output</div>
          <div class="stage-desc">Renders surviving properties into IEEE 1800 SystemVerilog Assertions format.</div>
          <button class="stage-output-link" onclick="navigateTo('properties');">
            <span>⌘</span> sat_filtered_SVA.json
          </button>
        </div>
      </div>
    </div>

    <!-- Repository Counts at a Glance -->
    <div>
      <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.8px; margin-bottom: 12px;">
        Repository Assets Overview
      </div>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Protocol Families</span>
            <div class="metric-icon-wrap metric-icon-cyan">◈</div>
          </div>
          <div class="metric-val">${STATE.catalog?.counts?.protocols ?? '—'}</div>
          <div class="metric-sub">AXI, APB, PCI, P-Chan, Q-Chan, WISHBONE</div>
          <div class="metric-bar metric-bar-cyan"></div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Test Cases</span>
            <div class="metric-icon-wrap metric-icon-violet">◇</div>
          </div>
          <div class="metric-val">${STATE.catalog?.counts?.test_cases ?? '—'}</div>
          <div class="metric-sub">Protocol mechanisms tested</div>
          <div class="metric-bar metric-bar-indigo"></div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Timing Diagrams</span>
            <div class="metric-icon-wrap metric-icon-emerald">∿</div>
          </div>
          <div class="metric-val">${STATE.catalog?.counts?.timing_diagrams ?? '—'}</div>
          <div class="metric-sub">JSON & WaveDrom cycle traces</div>
          <div class="metric-bar metric-bar-emerald"></div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Grammar Rules</span>
            <div class="metric-icon-wrap metric-icon-amber">▱</div>
          </div>
          <div class="metric-val">${STATE.catalog?.counts?.grammars ?? '—'}</div>
          <div class="metric-sub">Formal property expansion rules</div>
          <div class="metric-bar metric-bar-amber"></div>
        </div>
      </div>
    </div>
  `;
}

function setExecutionMode(mode) {
  STATE.selectedMode = mode;
  const timingSelect = document.getElementById('timing-select');
  if (timingSelect) {
    timingSelect.disabled = (mode === 'g2t');
  }
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.textContent.includes(mode));
  });
}

// 2. SVA & Properties Explorer (Fast, Paginated, Rejection-Aware)
function renderPropertiesView() {
  const activeRunId = STATE.activeRunId;
  const survivorsKey = `${activeRunId}:sat_filtered.json`;
  const candidatesKey = `${activeRunId}:candidates.json`;

  const survivors = STATE.artifactsCache[survivorsKey] || [];
  const candidates = STATE.artifactsCache[candidatesKey] || [];

  // Build sets to classify survivors vs rejected candidates
  const survivorSvaSet = new Set(survivors.map(s => s.sva || s.ltl));
  const rejectedCount = Math.max(0, candidates.length - survivors.length);

  // Extract all unique signals across candidates/survivors for filtering
  const signalSet = new Set();
  (candidates.length ? candidates : survivors).forEach(item => {
    const text = item.sva || '';
    const words = text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
    words.forEach(w => {
      if (!['rose', 'fell', 'stable', 'past', 'onehot', 'b1', 'b0', 'clk', 'rst_n', 'assert'].includes(w) && isNaN(w)) {
        signalSet.add(w);
      }
    });
  });
  const allSignals = Array.from(signalSet).sort();

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">Assertion Studio</div>
        <h2>SystemVerilog Assertions & Properties</h2>
        <p>Browse, filter, copy, and inspect why candidate properties survived or were rejected by SAT filtering.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" onclick="copyAllFilteredSva()">
          <span>📋</span> Copy All SVA
        </button>
        <button class="btn btn-emerald btn-sm" onclick="openSvaExportModal()">
          <span>💾</span> Export .sv Module
        </button>
      </div>
    </div>

    <!-- Filter & Search Toolbar (DOM-stable: never recreated while typing) -->
    <div class="filter-bar">
      <div class="search-box-wrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          id="prop-search-input"
          class="search-input"
          placeholder="Search assertions by signal, operator, or natural language..."
          value="${escapeHtml(STATE.propSearchQuery)}"
          oninput="handleSearchInput(this.value)"
        >
      </div>

      <div class="filter-tabs">
        <button
          class="filter-pill ${STATE.propFilterType === 'survivor' ? 'active' : ''}"
          data-filter="survivor"
          onclick="handleFilterTypeChange('survivor')"
        >
          SAT Survivors (${survivors.length})
        </button>
        <button
          class="filter-pill ${STATE.propFilterType === 'rejected' ? 'active' : ''}"
          data-filter="rejected"
          onclick="handleFilterTypeChange('rejected')"
          style="${STATE.propFilterType === 'rejected' ? 'background: var(--accent-rose); border-color: var(--accent-rose);' : ''}"
        >
          Rejected Properties (${rejectedCount})
        </button>
        <button
          class="filter-pill ${STATE.propFilterType === 'candidate' ? 'active' : ''}"
          data-filter="candidate"
          onclick="handleFilterTypeChange('candidate')"
        >
          All Candidates (${candidates.length})
        </button>

        ${allSignals.length > 0 ? `
          <select class="form-select" style="width: auto; padding: 6px 10px; font-size: 0.8rem;" onchange="handleSignalFilterChange(this.value)">
            <option value="all">All Signals</option>
            ${allSignals.map(sig => `
              <option value="${escapeHtml(sig)}" ${STATE.propSignalFilter === sig ? 'selected' : ''}>
                Signal: ${escapeHtml(sig)}
              </option>
            `).join('')}
          </select>
        ` : ''}
      </div>
    </div>

    <!-- Dynamic Container for Assertions & Pagination -->
    <div id="assertions-container">
      ${renderPropertyListHtml()}
    </div>
  `;
}

// Generates the filtered + paginated properties list HTML
function renderPropertyListHtml() {
  const activeRunId = STATE.activeRunId;
  const survivorsKey = `${activeRunId}:sat_filtered.json`;
  const candidatesKey = `${activeRunId}:candidates.json`;

  const survivors = STATE.artifactsCache[survivorsKey] || [];
  const candidates = STATE.artifactsCache[candidatesKey] || [];
  const survivorSvaSet = new Set(survivors.map(s => s.sva || s.ltl));

  const waveforms = STATE.waveformInputData?.waveforms || [];

  let sourceList = [];
  if (STATE.propFilterType === 'survivor') {
    sourceList = survivors.map(item => ({ ...item, isSurvivor: true, isRejected: false }));
  } else if (STATE.propFilterType === 'rejected') {
    sourceList = candidates
      .filter(c => !survivorSvaSet.has(c.sva || c.ltl))
      .map(item => {
        const diag = diagnosePropertyRejection(item, waveforms);
        return {
          ...item,
          isSurvivor: false,
          isRejected: true,
          rejectionTitle: diag.title,
          rejectionDetail: diag.detail,
          rejectionBadge: diag.badge,
          rejectionWaveform: diag.waveform,
          rejectionCycle: diag.cycle,
        };
      });
  } else {
    // All candidates
    sourceList = candidates.map(c => {
      const isSurv = survivorSvaSet.has(c.sva || c.ltl);
      const diag = isSurv ? null : diagnosePropertyRejection(c, waveforms);
      return {
        ...c,
        isSurvivor: isSurv,
        isRejected: !isSurv,
        rejectionTitle: diag?.title,
        rejectionDetail: diag?.detail,
        rejectionBadge: diag?.badge,
        rejectionWaveform: diag?.waveform,
        rejectionCycle: diag?.cycle,
      };
    });
  }

  // Filter by query and signal
  const q = STATE.propSearchQuery.trim().toLowerCase();
  const filtered = sourceList.filter(item => {
    if (STATE.propSignalFilter !== 'all') {
      if (!item.sva || !item.sva.includes(STATE.propSignalFilter)) return false;
    }
    if (!q) return true;
    const nl = (item.nl || '').toLowerCase();
    const sva = (item.sva || '').toLowerCase();
    const ltl = (item.ltl || '').toLowerCase();
    return nl.includes(q) || sva.includes(q) || ltl.includes(q);
  });

  STATE.currentFilteredProperties = filtered;

  // Pagination slice
  const total = filtered.length;
  const pageSize = STATE.propPageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, STATE.propCurrentPage), totalPages);
  STATE.propCurrentPage = currentPage;

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px;">
      <span>Showing ${total > 0 ? `${startIdx + 1}–${endIdx} of ${total}` : '0'} properties</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span>Page size:</span>
        <select class="form-select" style="width: auto; padding: 3px 8px; font-size: 0.78rem;" onchange="handlePageSizeChange(this.value)">
          <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
        </select>
      </div>
    </div>

    <!-- Properties Cards (Only pageItems rendered -> blazing fast) -->
    <div class="assertions-list">
      ${pageItems.length > 0 ? pageItems.map((item, localIdx) => {
        const globalIdx = startIdx + localIdx;
        return `
          <div class="assertion-card ${item.isSurvivor ? 'survivor' : (item.isRejected ? 'rejected' : 'candidate')}">
            <div class="assertion-top">
              <div class="assertion-index-group">
                <span class="assertion-index">#${String(globalIdx + 1).padStart(3, '0')}</span>
                <span class="chip ${item.isSurvivor ? 'chip-emerald' : (item.isRejected ? 'chip-rose' : 'chip-amber')}">
                  ${item.isSurvivor ? 'SAT Verified' : (item.isRejected ? '✕ Rejected by SMT' : 'Pre-filter Candidate')}
                </span>
              </div>
              <div class="assertion-actions">
                <button class="btn btn-secondary btn-sm" onclick="copySvaByIndex(${globalIdx})">
                  Copy SVA
                </button>
                <button class="btn btn-secondary btn-sm" onclick="openAstByIndex(${globalIdx})">
                  ${item.isRejected ? 'Inspect Reason & AST' : 'View AST / LTL'}
                </button>
              </div>
            </div>

            <div class="assertion-nl">
              ${escapeHtml(item.nl || 'Natural language description unavailable')}
            </div>

            <div class="sva-formula-box">
              ${highlightSva(item.sva || 'SVA syntax unavailable')}
            </div>

            ${item.isRejected ? `
              <div class="rejection-box">
                <span class="rejection-icon">✕</span>
                <div>
                  <strong>${escapeHtml(item.rejectionTitle || 'Rejected during SMT Trace Check')}</strong>
                  <p style="margin-top: 3px; font-size: 0.8rem; color: var(--text-main);">${escapeHtml(item.rejectionDetail || 'Contradicted finite protocol timing trace: Z3 solver found counterexample on a waveform.')}</p>
                </div>
              </div>
            ` : ''}

            <div class="assertion-footer">
              <div class="ltl-preview" title="${escapeHtml(item.ltl || '')}">
                <strong>LTL:</strong> ${escapeHtml(item.ltl || 'N/A')}
              </div>
            </div>
          </div>
        `;
      }).join('') : `
        <div class="card" style="padding: 48px; text-align: center; color: var(--text-muted);">
          <p>No properties match the selected filter or search query.</p>
          ${!activeRunId ? '<p style="font-size: 0.82rem; margin-top: 6px;">Launch a run from Studio to generate properties.</p>' : ''}
        </div>
      `}
    </div>

    <!-- Pagination Controls Bar -->
    ${totalPages > 1 ? `
      <div class="pagination-bar">
        <div class="pagination-info">
          Page <strong>${currentPage}</strong> of <strong>${totalPages}</strong>
        </div>
        <div class="pagination-controls">
          <button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="handlePageChange(1)">
            « First
          </button>
          <button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="handlePageChange(${currentPage - 1})">
            ‹ Prev
          </button>
          <span style="font-size: 0.8rem; margin: 0 6px; font-weight: 600;">
            ${currentPage} / ${totalPages}
          </span>
          <button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="handlePageChange(${currentPage + 1})">
            Next ›
          </button>
          <button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="handlePageChange(${totalPages})">
            Last »
          </button>
        </div>
      </div>
    ` : ''}
  `;
}

// High-speed targeted DOM update for properties view
function renderPropertyList() {
  const container = document.getElementById('assertions-container');
  if (container) {
    container.innerHTML = renderPropertyListHtml();
  }
}

function copyAllFilteredSva() {
  const list = STATE.currentFilteredProperties || [];
  if (list.length === 0) {
    showToast('No SVA properties to copy.', 'error');
    return;
  }
  const text = list.map(item => item.sva).filter(Boolean).join('\n');
  copyToClipboard(text, `Copied ${list.length} SVA properties!`);
}

function copySvaByIndex(globalIdx) {
  const item = STATE.currentFilteredProperties?.[globalIdx];
  if (item && item.sva) {
    copyToClipboard(item.sva, 'SVA formula copied!');
  }
}

function openAstByIndex(globalIdx) {
  const item = STATE.currentFilteredProperties?.[globalIdx];
  if (item) {
    openAstModal(item);
  }
}

function copyAstSva() {
  if (STATE.modalData && STATE.modalData.sva) {
    copyToClipboard(STATE.modalData.sva, 'SVA formula copied!');
  }
}

function downloadActiveSvaModule() {
  const activeRunId = STATE.activeRunId;
  const survivors = STATE.artifactsCache[`${activeRunId}:sat_filtered.json`] || [];
  const moduleCode = generateSvaModule(activeRunId, survivors, {
    protocol: STATE.waveformFamily || 'PROTOCOL',
    mechanism: STATE.waveformMechanism || 'MECHANISM',
  });
  downloadSvaFile(moduleCode);
}

function copyActiveSvaModule() {
  const activeRunId = STATE.activeRunId;
  const survivors = STATE.artifactsCache[`${activeRunId}:sat_filtered.json`] || [];
  const moduleCode = generateSvaModule(activeRunId, survivors, {
    protocol: STATE.waveformFamily || 'PROTOCOL',
    mechanism: STATE.waveformMechanism || 'MECHANISM',
  });
  copyToClipboard(moduleCode, 'SystemVerilog checker module copied!');
}

// 3. Waveform / Timing Diagram Viewer
function renderWaveformsView() {
  const files = STATE.catalog?.timing_diagram_files || [];
  const families = [...new Set(files.map(x => x.protocol || 'Other'))].sort();

  const subset = files.filter(x => (x.protocol || 'Other') === STATE.waveformFamily);
  const mechanisms = [...new Set(subset.map(x => x.mechanism).filter(Boolean))];
  const choices = subset.filter(x => x.mechanism === STATE.waveformMechanism);

  const currentPath = STATE.waveformPath || (choices[0] ? choices[0].path : '');
  const inputData = STATE.waveformInputData;
  const waveforms = inputData?.waveforms || [];
  const activeWave = waveforms[STATE.waveformIndex] || null;

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">Timing Trace Analyzer</div>
        <h2>Protocol Waveform Viewer</h2>
        <p>Interactive cycle-accurate digital waveform viewer for AMBA, PCI, and standard bus protocols.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" onclick="setWaveformZoom(0.2)">
          🔍 Zoom In
        </button>
        <button class="btn btn-secondary btn-sm" onclick="setWaveformZoom(-0.2)">
          🔍 Zoom Out
        </button>
        <button class="btn btn-secondary btn-sm" onclick="resetWaveformZoom()">
          Reset View
        </button>
      </div>
    </div>

    <!-- Controls Bar -->
    <div class="waveform-controls-bar">
      <!-- Protocol Family Tabs -->
      <div class="waveform-nav-tabs">
        ${families.map(fam => `
          <button class="waveform-tab-btn ${STATE.waveformFamily === fam ? 'active' : ''}" onclick="selectWaveformFamily('${fam}')">
            ${fam}
          </button>
        `).join('')}
      </div>

      <!-- Mechanism & Waveform Selectors -->
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <select class="form-select" style="width: auto; padding: 6px 12px; font-size: 0.8rem;" onchange="selectWaveformMechanism(this.value)">
          ${mechanisms.map(m => `
            <option value="${escapeHtml(m)}" ${m === STATE.waveformMechanism ? 'selected' : ''}>
              Mechanism: ${escapeHtml(m.replace(/_/g, ' '))}
            </option>
          `).join('')}
        </select>

        <select class="form-select" style="width: auto; padding: 6px 12px; font-size: 0.8rem;" onchange="selectWaveformPath(this.value)">
          ${choices.map(c => `
            <option value="${escapeHtml(c.path)}" ${c.path === currentPath ? 'selected' : ''}>
              ${c.format === 'wavedrom_json' ? 'WaveDrom JSON' : 'Self-defined JSON'}
            </option>
          `).join('')}
        </select>

        ${waveforms.length > 1 ? `
          <select class="form-select" style="width: auto; padding: 6px 12px; font-size: 0.8rem;" onchange="setWaveformIndex(this.value)">
            ${waveforms.map((w, i) => `
              <option value="${i}" ${i === STATE.waveformIndex ? 'selected' : ''}>
                ${escapeHtml(w.name || `Waveform ${i + 1}`)}
              </option>
            `).join('')}
          </select>
        ` : ''}
      </div>
    </div>

    <!-- Waveform Viewport Card -->
    <div class="waveform-viewport-card" style="margin-top: 16px;">
      <div class="waveform-viewport-header">
        <div>
          <span style="font-weight: 700; color: var(--text-main); font-size: 0.94rem;">
            ${escapeHtml(activeWave?.name || 'Protocol Timing Diagram')}
          </span>
          <span style="font-size: 0.78rem; color: var(--text-muted); margin-left: 10px;">
            ${currentPath}
          </span>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">
          Cycle depth: ${activeWave?.signals?.[0]?.values?.length || activeWave?.signal?.[0]?.wave?.length || 0} cycles
        </div>
      </div>

      <div class="waveform-svg-scroll" id="waveform-scroll-container">
        ${renderWaveformSvg(inputData, STATE.waveformIndex, STATE.waveformZoom)}
      </div>

      <!-- Real-time hover info tooltip -->
      <div class="waveform-hover-info" id="waveform-hover-info" style="display: none;"></div>
    </div>

    <div class="notice-banner" style="margin-top: 20px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <div>
        <strong>Cycle-Accurate Abstraction:</strong>
        Timing diagrams encode discrete values per clock cycle (0, 1, X, or Bus labels). If a candidate property does not hold at any cycle $T$ on any of these traces, the Z3 solver rejects it.
      </div>
    </div>
  `;
}

function setWaveformZoom(delta) {
  STATE.waveformZoom = Math.min(2.2, Math.max(0.6, STATE.waveformZoom + delta));
  const container = document.getElementById('waveform-scroll-container');
  if (container) {
    container.innerHTML = renderWaveformSvg(STATE.waveformInputData, STATE.waveformIndex, STATE.waveformZoom);
    attachWaveformHover();
  }
}

function resetWaveformZoom() {
  STATE.waveformZoom = 1.0;
  const container = document.getElementById('waveform-scroll-container');
  if (container) {
    container.innerHTML = renderWaveformSvg(STATE.waveformInputData, STATE.waveformIndex, STATE.waveformZoom);
    attachWaveformHover();
  }
}

function setWaveformIndex(idx) {
  STATE.waveformIndex = Number(idx);
  renderCurrentView();
}

async function selectWaveformFamily(family) {
  STATE.waveformFamily = family;
  const files = STATE.catalog?.timing_diagram_files || [];
  const subset = files.filter(x => (x.protocol || 'Other') === family);
  if (subset.length > 0) {
    STATE.waveformMechanism = subset[0].mechanism || '';
    STATE.waveformPath = subset[0].path;
    await loadWaveformInput(STATE.waveformPath);
  }
  renderCurrentView();
}

async function selectWaveformMechanism(mech) {
  STATE.waveformMechanism = mech;
  const files = STATE.catalog?.timing_diagram_files || [];
  const match = files.find(x => (x.protocol || 'Other') === STATE.waveformFamily && x.mechanism === mech);
  if (match) {
    STATE.waveformPath = match.path;
    await loadWaveformInput(STATE.waveformPath);
  }
  renderCurrentView();
}

async function selectWaveformPath(path) {
  STATE.waveformPath = path;
  await loadWaveformInput(path);
  renderCurrentView();
}

// 4. Verification & Analytics Dashboard
function renderVerificationView() {
  const activeRunId = STATE.activeRunId;
  const survivors = STATE.artifactsCache[`${activeRunId}:sat_filtered.json`] || [];
  const candidates = STATE.artifactsCache[`${activeRunId}:candidates.json`] || [];

  const survivorCount = survivors.length;
  const candidateCount = candidates.length;
  const survivalRate = candidateCount > 0 ? ((survivorCount / candidateCount) * 100).toFixed(1) : 0;
  const rejectedCount = Math.max(0, candidateCount - survivorCount);
  const rejectionRate = candidateCount > 0 ? ((rejectedCount / candidateCount) * 100).toFixed(1) : 0;

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">SMT Analytics</div>
        <h2>Verification & Filtering Metrics</h2>
        <p>Quantitative breakdown of candidate generation, Z3 SMT solver trace consistency, and survivor rates.</p>
      </div>
    </div>

    <!-- KPI Grid -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Pre-filter Candidates</span>
          <div class="metric-icon-wrap metric-icon-amber">☷</div>
        </div>
        <div class="metric-val">${candidateCount || '—'}</div>
        <div class="metric-sub">Generated from grammar templates</div>
        <div class="metric-bar metric-bar-amber"></div>
      </div>

      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">SAT Survivors</span>
          <div class="metric-icon-wrap metric-icon-emerald">✓</div>
        </div>
        <div class="metric-val">${survivorCount || '—'}</div>
        <div class="metric-sub">Consistent with timing traces</div>
        <div class="metric-bar metric-bar-emerald"></div>
      </div>

      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Survivor Yield</span>
          <div class="metric-icon-wrap metric-icon-cyan">%</div>
        </div>
        <div class="metric-val">${survivalRate}%</div>
        <div class="metric-sub">Passed Z3 trace checks</div>
        <div class="metric-bar metric-bar-cyan"></div>
      </div>

      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-title">Rejected by SMT</span>
          <div class="metric-icon-wrap metric-icon-indigo">✕</div>
        </div>
        <div class="metric-val">${rejectionRate}%</div>
        <div class="metric-sub">${rejectedCount} candidates rejected</div>
        <div class="metric-bar metric-bar-indigo"></div>
      </div>
    </div>

    <!-- Visual Charts Grid -->
    <div class="analytics-grid">
      <div class="chart-card">
        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 4px;">SAT Filtering Efficiency</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">
          Ratio of survivors to rejected candidates in active run.
        </p>

        <div class="survival-bar-wrap">
          <div class="survival-segment-survivor" style="width: ${survivalRate}%;">
            ${survivalRate > 10 ? `${survivalRate}% Survivors` : ''}
          </div>
          <div class="survival-segment-rejected" style="width: ${rejectionRate}%;">
            ${rejectionRate > 10 ? `${rejectionRate}% Filtered` : ''}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary);">
          <span style="display: flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--accent-emerald);"></span>
            Valid Survivors (${survivorCount})
          </span>
          <span style="display: flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--bg-surface-elevated); border: 1px solid var(--border-medium);"></span>
            Violated / Rejected (${rejectedCount})
          </span>
        </div>

        <div style="margin-top: 20px;">
          <button class="btn btn-secondary btn-sm" onclick="STATE.propFilterType = 'rejected'; navigateTo('properties');">
            View All ${rejectedCount} Rejected Properties →
          </button>
        </div>
      </div>

      <div class="chart-card">
        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 4px;">Why Properties Get Rejected</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">
          How FLAG checks property consistency.
        </p>
        <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.84rem; line-height: 1.5;">
          <div style="display: flex; gap: 10px;">
            <span style="color: var(--accent-rose); font-weight: 700;">1.</span>
            <span><strong>Trace Inconsistency (Counterexample):</strong> If $\text{Waveform} \land \neg \text{Property}$ is satisfiable, Z3 has found a cycle $T$ where the antecedent holds, but the consequent is violated.</span>
          </div>
          <div style="display: flex; gap: 10px;">
            <span style="color: var(--accent-amber); font-weight: 700;">2.</span>
            <span><strong>Vacuous / Tautology:</strong> If the antecedent never triggers on the waveform (or holds on all unconstrained waveforms), it provides no verification value.</span>
          </div>
          <div style="display: flex; gap: 10px;">
            <span style="color: var(--accent-cyan); font-weight: 700;">3.</span>
            <span><strong>Signal Absence:</strong> If the template refers to signals not present in the current protocol waveform trace, it is safely omitted.</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// Grammar & Templates Loader
// ============================================================================

async function loadTemplatesAndGrammar() {
  STATE.isTemplatesLoading = true;
  renderCurrentView();

  if (!STATE.currentGrammarData) {
    await loadGrammarFile(STATE.selectedGrammarFile || 'grammar/complete.json');
  }

  if (!STATE.templatesData || STATE.templatesData.length === 0) {
    if (STATE.activeRunId) {
      const activeData = await loadArtifact('templates.json', false);
      if (activeData && Array.isArray(activeData) && activeData.length > 0) {
        STATE.templatesData = activeData;
      }
    }

    if (!STATE.templatesData || STATE.templatesData.length === 0) {
      for (const r of STATE.runs) {
        if (r.status === 'completed') {
          try {
            const data = await apiRequest(`/runs/${r.run_id}/artifacts/templates.json`);
            if (data && Array.isArray(data) && data.length > 0) {
              STATE.templatesData = data;
              break;
            }
          } catch (e) {}
        }
      }
    }
  }

  STATE.isTemplatesLoading = false;
  renderCurrentView();
}

async function loadGrammarFile(path) {
  if (!path) path = 'grammar/complete.json';
  STATE.selectedGrammarFile = path;
  if (STATE.grammarDataCache[path]) {
    STATE.currentGrammarData = STATE.grammarDataCache[path];
    renderCurrentView();
    return;
  }
  try {
    const data = await apiRequest(`/inputs/${path}`);
    STATE.grammarDataCache[path] = data;
    STATE.currentGrammarData = data;
  } catch (err) {
    console.error('Failed to load grammar file:', err);
  }
  renderCurrentView();
}

function setTemplateSubTab(tab) {
  STATE.templateSubTab = tab;
  renderCurrentView();
}

// 5. Templates & Grammar Explorer (Dual View: G2T Templates & BNF Rules)
function renderTemplatesView() {
  const grammarFiles = STATE.catalog?.grammar_files || [
    { path: 'grammar/complete.json' },
    { path: 'grammar/PCI-based.json' },
    { path: 'grammar/PCI_QC-based.json' },
  ];
  const templates = STATE.templatesData || [];
  const grammar = STATE.currentGrammarData;
  const isLoading = STATE.isTemplatesLoading;

  const q = (STATE.templateSearchQuery || '').trim().toLowerCase();
  const filteredTemplates = templates.filter(t => {
    if (!q) return true;
    return (t.nl || '').toLowerCase().includes(q) || (t.ltl || '').toLowerCase().includes(q);
  });

  const total = filteredTemplates.length;
  const pageSize = STATE.templatePageSize || 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, STATE.templateCurrentPage || 1), totalPages);
  STATE.templateCurrentPage = currentPage;

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filteredTemplates.slice(startIdx, endIdx);

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">Formal Expansion</div>
        <h2>Grammar Rules & Property Templates</h2>
        <p>Explore formal BNF production rules and grammar-derived temporal property templates (G2T).</p>
      </div>
      <div class="page-header-actions">
        ${templates.length > 0 ? `
          <button class="btn btn-secondary btn-sm" onclick="copyToClipboard(JSON.stringify(STATE.templatesData, null, 2), 'Templates JSON copied!')">
            <span>📋</span> Copy Templates JSON
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Sub-Tabs Navigation (Generated Templates vs BNF Grammar Rules) -->
    <div class="sub-tabs-bar">
      <button
        class="sub-tab-btn ${STATE.templateSubTab === 'templates' ? 'active' : ''}"
        onclick="setTemplateSubTab('templates')"
      >
        Generated Templates (G2T Output) ${templates.length ? `(${templates.length})` : ''}
      </button>
      <button
        class="sub-tab-btn ${STATE.templateSubTab === 'grammar' ? 'active' : ''}"
        onclick="setTemplateSubTab('grammar')"
      >
        BNF Grammar Rules & Categories
      </button>
    </div>

    ${isLoading ? `
      <div class="card" style="padding: 48px; text-align: center; color: var(--text-muted);">
        <p>Loading grammar rules and templates...</p>
      </div>
    ` : STATE.templateSubTab === 'templates' ? `
      <!-- ================= GENERATED TEMPLATES TAB ================= -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <div class="card-title-group">
            <h3>Generated Templates (G2T)</h3>
            <p>Abstract templates expanded from formal grammar before signal mapping.</p>
          </div>
          <div class="search-box-wrap" style="max-width: 360px;">
            <input
              type="text"
              class="search-input"
              placeholder="Search templates by text or LTL..."
              value="${escapeHtml(STATE.templateSearchQuery)}"
              oninput="STATE.templateSearchQuery = this.value; STATE.templateCurrentPage = 1; renderCurrentView();"
            >
          </div>
        </div>

        <div class="card-body">
          ${pageItems.length > 0 ? `
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px;">
              <span>Showing ${startIdx + 1}–${endIdx} of ${total} templates</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${pageItems.map((tpl, i) => {
                const globalIdx = startIdx + i + 1;
                return `
                  <div style="background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 16px 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-muted); font-weight: 700;">
                        TEMPLATE #${String(globalIdx).padStart(3, '0')}
                      </span>
                      <span class="chip chip-indigo">AST Pattern</span>
                    </div>

                    <div style="font-size: 0.94rem; font-weight: 500; color: var(--text-main); margin-bottom: 8px; line-height: 1.4;">
                      ${escapeHtml(tpl.nl || '').replace(/\[([^\]]+)\]/g, '<span class="token-pill token-sig">[$1]</span>')}
                    </div>

                    <div style="font-family: var(--font-mono); font-size: 0.84rem; color: var(--accent-cyan); background: var(--code-bg); padding: 8px 12px; border-radius: 4px; overflow-x: auto;">
                      ${escapeHtml(tpl.ltl || '')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Templates Pagination -->
            ${totalPages > 1 ? `
              <div class="pagination-bar">
                <div class="pagination-info">Page <strong>${currentPage}</strong> of <strong>${totalPages}</strong></div>
                <div class="pagination-controls">
                  <button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="STATE.templateCurrentPage = 1; renderCurrentView();">« First</button>
                  <button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="STATE.templateCurrentPage = ${currentPage - 1}; renderCurrentView();">‹ Prev</button>
                  <span style="font-size: 0.8rem; margin: 0 6px; font-weight: 600;">${currentPage} / ${totalPages}</span>
                  <button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="STATE.templateCurrentPage = ${currentPage + 1}; renderCurrentView();">Next ›</button>
                  <button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="STATE.templateCurrentPage = ${totalPages}; renderCurrentView();">Last »</button>
                </div>
              </div>
            ` : ''}
          ` : `
            <div style="padding: 40px; text-align: center; color: var(--text-muted);">
              <p>No templates loaded yet.</p>
              <button class="btn btn-primary btn-sm" style="margin-top: 12px;" onclick="loadTemplatesAndGrammar()">
                Refresh Templates
              </button>
            </div>
          `}
        </div>
      </div>
    ` : `
      <!-- ================= BNF GRAMMAR RULES TAB ================= -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3>BNF Production Rules</h3>
            <p>Categories and terminal/non-terminal expansion definitions.</p>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Grammar File:</label>
            <select class="form-select" style="width: auto; padding: 6px 12px; font-size: 0.82rem;" onchange="loadGrammarFile(this.value)">
              ${grammarFiles.map(gf => `
                <option value="${escapeHtml(gf.path)}" ${gf.path === STATE.selectedGrammarFile ? 'selected' : ''}>
                  ${escapeHtml(gf.path)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <div class="card-body">
          ${grammar ? `
            <div class="grammar-grid">
              ${Object.entries(grammar).map(([catName, rules]) => `
                <div class="grammar-cat-card">
                  <div class="grammar-cat-header">
                    <span class="grammar-cat-title">
                      <span style="color: var(--accent-indigo);">⟨</span>${escapeHtml(catName)}<span style="color: var(--accent-indigo);">⟩</span>
                    </span>
                    <span class="chip chip-muted">${rules.length} rule${rules.length > 1 ? 's' : ''}</span>
                  </div>

                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${rules.map(rule => `
                      <div class="grammar-rule-item">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                          <span style="color: var(--text-muted);">::=</span>
                          ${
                            rule.type === 'category' ? `<span class="token-pill token-cat">⟨${escapeHtml(rule.category)}⟩</span>` :
                            rule.type === 'basic' ? `<span class="token-pill token-op">${escapeHtml(rule.operator)}</span> ${rule.operands?.map(o => `<span class="token-pill token-sig">[${escapeHtml(o.type)}]</span>`).join(' ') || ''}` :
                            rule.type === 'operator' ? `<span class="token-pill token-op">${escapeHtml(rule.operator)}</span> (${rule.operands?.map(o => o.category ? `<span class="token-pill token-cat">⟨${escapeHtml(o.category)}⟩</span>` : `<span class="token-pill token-sig">[${escapeHtml(o.type || 'term')}]</span>`).join(', ') || ''})` :
                            `<code>${escapeHtml(JSON.stringify(rule))}</code>`
                          }
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div style="padding: 40px; text-align: center; color: var(--text-muted);">
              Select a grammar file above to inspect production rules.
            </div>
          `}
        </div>
      </div>
    `}
  `;
}

// 6. Execution Console
function renderConsoleView() {
  const activeRun = STATE.activeRun;
  const logs = STATE.activeRunLogs || { combined: '', stdout: '', stderr: '' };

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">Subprocess Terminal</div>
        <h2>Execution Console & Logs</h2>
        <p>Live stream of stdout and stderr captured from Python and the Z3 solver.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" onclick="copyToClipboard(STATE.activeRunLogs?.combined || '', 'Terminal logs copied!')">
          <span>📋</span> Copy Logs
        </button>
      </div>
    </div>

    <div class="console-container">
      <div class="console-header">
        <div class="console-tabs">
          <button class="console-tab-btn active">Combined Stream</button>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${activeRun ? `
            <span class="chip ${activeRun.status === 'completed' ? 'chip-emerald' : activeRun.status === 'running' ? 'chip-cyan' : 'chip-muted'}">
              Status: ${activeRun.status.toUpperCase()}
            </span>
          ` : ''}
        </div>
      </div>

      <div class="console-output" id="console-stream">
        ${escapeHtml(logs.combined || 'No logs captured yet. Submit a run to begin capturing terminal output.')}
      </div>
    </div>
  `;
}

// 7. Repository & Artifacts Browser
function renderArtifactsView() {
  const artifacts = STATE.activeRunArtifacts || [];
  const selectedPath = STATE.selectedArtifactPath || (artifacts[0] ? artifacts[0].path : '');
  const activeRunId = STATE.activeRunId;
  const fileContent = activeRunId && selectedPath ? STATE.artifactsCache[`${activeRunId}:${selectedPath}`] : null;

  return `
    <div class="page-header">
      <div class="page-title-group">
        <div class="eyebrow">Artifact Storage</div>
        <h2>Repository & Run Artifacts</h2>
        <p>Inspect intermediate JSON representations, SVA assertions, and pipeline outputs.</p>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 320px 1fr; gap: 20px;">
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3>Generated Files</h3>
            <p>${artifacts.length} artifacts available</p>
          </div>
        </div>
        <div class="card-body" style="padding: 12px;">
          ${artifacts.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${artifacts.map(a => `
                <button
                  class="nav-btn ${a.path === selectedPath ? 'active' : ''}"
                  style="justify-content: space-between;"
                  onclick="selectArtifact('${escapeHtml(a.path)}')"
                >
                  <span style="font-family: var(--font-mono); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(a.filename)}
                  </span>
                  <span style="font-size: 0.72rem; color: var(--text-muted);">
                    ${(a.size_bytes / 1024).toFixed(1)} KB
                  </span>
                </button>
              `).join('')}
            </div>
          ` : `
            <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.84rem;">
              No artifacts generated for the selected run.
            </div>
          `}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <h3>${escapeHtml(selectedPath || 'File Inspector')}</h3>
            <p>JSON Data Viewer</p>
          </div>
          <div class="json-mode-tabs">
            <button class="json-mode-btn ${STATE.jsonViewerMode === 'code' ? 'active' : ''}" onclick="STATE.jsonViewerMode = 'code'; renderCurrentView();">
              Raw Code
            </button>
            <button class="json-mode-btn ${STATE.jsonViewerMode === 'tree' ? 'active' : ''}" onclick="STATE.jsonViewerMode = 'tree'; renderCurrentView();">
              Tree Mode
            </button>
          </div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="json-content">
            ${fileContent !== null && fileContent !== undefined ? (
              STATE.jsonViewerMode === 'code'
                ? `<pre style="white-space: pre-wrap; font-family: var(--font-mono);">${escapeHtml(JSON.stringify(fileContent, null, 2))}</pre>`
                : renderJsonTree(fileContent, 'root')
            ) : `
              <div style="padding: 32px; text-align: center; color: var(--text-muted);">
                Select an artifact from the list to inspect its contents.
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function selectArtifact(path) {
  STATE.selectedArtifactPath = path;
  await loadArtifact(path, true);
}

function renderJsonTree(val, key, depth = 0) {
  if (val && typeof val === 'object') {
    const isArr = Array.isArray(val);
    const entries = Object.entries(val);
    return `
      <details class="json-tree-node" ${depth < 1 ? 'open' : ''}>
        <summary>
          <span class="json-key">${escapeHtml(key)}</span>
          <span style="color: var(--text-muted);">${isArr ? `[${entries.length}]` : `{${entries.length}}`}</span>
        </summary>
        <div>
          ${entries.map(([k, v]) => renderJsonTree(v, isArr ? `[${k}]` : k, depth + 1)).join('')}
        </div>
      </details>
    `;
  }

  let cls = 'json-string';
  if (val === null) cls = 'json-null';
  else if (typeof val === 'number') cls = 'json-number';
  else if (typeof val === 'boolean') cls = 'json-boolean';

  return `
    <div style="margin-left: 20px; font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.6;">
      <span class="json-key">${escapeHtml(key)}</span>: <span class="${cls}">${escapeHtml(JSON.stringify(val))}</span>
    </div>
  `;
}

// ============================================================================
// Modals & Slide-over Drawers
// ============================================================================

function openRunHistoryModal() {
  STATE.modalType = 'run_history';
  renderModalContainer();
}

function openAstModal(propertyItem) {
  STATE.modalType = 'ast_detail';
  STATE.modalData = propertyItem;
  renderModalContainer();
}

function openSvaExportModal() {
  STATE.modalType = 'sva_export';
  renderModalContainer();
}

function closeModal() {
  STATE.modalType = null;
  STATE.modalData = null;
  renderModalContainer();
}

function renderModalContainer() {
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;

  if (STATE.modalType) {
    modalContainer.hidden = false;
    modalContainer.innerHTML = renderModalHtml();
  } else {
    modalContainer.hidden = true;
    modalContainer.innerHTML = '';
  }
}

function renderModalHtml() {
  if (STATE.modalType === 'run_history') {
    return `
      <div class="modal-backdrop" onclick="if (event.target === this) closeModal();">
        <div class="slide-drawer">
          <div class="drawer-header">
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">Run History</h3>
              <p style="font-size: 0.8rem; color: var(--text-muted);">Switch between previous FLAG generation runs</p>
            </div>
            <button class="icon-btn" onclick="closeModal()">✕</button>
          </div>

          <div class="drawer-body">
            ${STATE.runs.length > 0 ? STATE.runs.map(r => `
              <div
                class="card"
                style="padding: 14px; cursor: pointer; border-color: ${r.run_id === STATE.activeRunId ? 'var(--accent-indigo)' : 'var(--border-subtle)'};"
                onclick="loadRun('${r.run_id}'); closeModal();"
              >
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem;">
                    ${r.run_id.slice(0, 12)}...
                  </span>
                  <span class="chip ${r.status === 'completed' ? 'chip-emerald' : r.status === 'running' ? 'chip-cyan' : 'chip-rose'}">
                    ${r.status.toUpperCase()}
                  </span>
                </div>
                <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px;">
                  Mode: <strong>${r.mode}</strong> | Created: ${new Date(r.created_at).toLocaleString()}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); word-break: break-all;">
                  Grammar: ${r.grammar_path}
                </div>
              </div>
            `).join('') : `
              <div style="text-align: center; color: var(--text-muted); padding: 40px 0;">
                No runs recorded in history.
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  if (STATE.modalType === 'ast_detail') {
    const prop = STATE.modalData;
    return `
      <div class="modal-backdrop" onclick="if (event.target === this) closeModal();">
        <div class="slide-drawer">
          <div class="drawer-header">
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">
                ${prop.isRejected ? 'Rejected Property Diagnosis' : 'Property AST Inspector'}
              </h3>
              <p style="font-size: 0.8rem; color: var(--text-muted);">
                ${prop.isRejected ? 'SMT Counterexample & AST Information' : 'Abstract syntax tree & formal logic definition'}
              </p>
            </div>
            <button class="icon-btn" onclick="closeModal()">✕</button>
          </div>

          <div class="drawer-body">
            ${prop.isRejected ? `
              <div class="rejection-box" style="margin-bottom: 12px; flex-direction: column; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="rejection-icon">✕</span>
                  <strong style="color: var(--accent-rose); font-size: 0.88rem;">${escapeHtml(prop.rejectionTitle || 'SMT Trace Violation')}</strong>
                </div>
                <p style="font-size: 0.82rem; color: var(--text-main); margin-left: 22px; line-height: 1.45;">
                  ${escapeHtml(prop.rejectionDetail || 'Contradicted finite protocol timing trace in Z3 solver.')}
                </p>
                ${prop.rejectionWaveform ? `
                  <div style="margin-left: 22px; margin-top: 4px;">
                    <button class="btn btn-secondary btn-sm" onclick="closeModal(); navigateTo('waveforms');">
                      ∿ View in Waveform Viewer (${escapeHtml(prop.rejectionCycle || 'Waveform')})
                    </button>
                  </div>
                ` : ''}
              </div>
            ` : ''}

            <div>
              <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Natural Language Description</span>
              <p style="font-size: 0.94rem; font-weight: 500; margin-top: 4px; color: var(--text-main);">${escapeHtml(prop.nl || '')}</p>
            </div>

            <div>
              <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">SystemVerilog Assertion (SVA)</span>
              <div class="sva-formula-box" style="margin-top: 4px;">
                ${highlightSva(prop.sva || '')}
              </div>
            </div>

            <div>
              <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">LTL Representation</span>
              <pre style="background: var(--code-bg); padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.82rem; margin-top: 4px; color: var(--accent-cyan); overflow-x: auto;">${escapeHtml(prop.ltl || '')}</pre>
            </div>

            <div>
              <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">Abstract Syntax Tree (AST)</span>
              <div class="json-content" style="background: var(--code-bg); border-radius: var(--radius-sm); padding: 12px; margin-top: 4px;">
                ${renderJsonTree(prop.ast, 'ast')}
              </div>
            </div>
          </div>

          <div class="drawer-footer">
            <button class="btn btn-secondary btn-sm" onclick="copyAstSva()">
              Copy SVA
            </button>
            <button class="btn btn-primary btn-sm" onclick="closeModal()">
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (STATE.modalType === 'sva_export') {
    const activeRunId = STATE.activeRunId;
    const survivors = STATE.artifactsCache[`${activeRunId}:sat_filtered.json`] || [];
    const moduleCode = generateSvaModule(activeRunId, survivors, {
      protocol: STATE.waveformFamily || 'PROTOCOL',
      mechanism: STATE.waveformMechanism || 'MECHANISM',
    });

    return `
      <div class="modal-backdrop" onclick="if (event.target === this) closeModal();">
        <div class="slide-drawer" style="width: 720px;">
          <div class="drawer-header">
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">Export SystemVerilog Checker (.sv)</h3>
              <p style="font-size: 0.8rem; color: var(--text-muted);">Ready-to-use module wrapper for VCS, Questa, ModelSim, or Vivado</p>
            </div>
            <button class="icon-btn" onclick="closeModal()">✕</button>
          </div>

          <div class="drawer-body">
            <pre style="background: var(--code-bg); padding: 16px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.5; color: var(--text-main); overflow: auto; height: 100%; border: 1px solid var(--border-subtle);">${escapeHtml(moduleCode)}</pre>
          </div>

          <div class="drawer-footer">
            <button class="btn btn-secondary btn-sm" onclick="copyActiveSvaModule()">
              Copy Code
            </button>
            <button class="btn btn-emerald btn-sm" onclick="downloadActiveSvaModule()">
              Download .sv File
            </button>
            <button class="btn btn-primary btn-sm" onclick="closeModal()">
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return '';
}

function downloadSvaFile(code) {
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(STATE.waveformFamily || 'flag').toLowerCase()}_sva_checker.sv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded .sv checker module!', 'success');
}

// ============================================================================
// Shell & Main View Architecture
// ============================================================================

// Render outer shell ONCE to avoid DOM destruction
function renderShell() {
  const root = document.getElementById('app');
  if (!root) return;

  root.innerHTML = `
    <!-- Sidebar Navigation (Persistent DOM) -->
    <aside class="sidebar">
      <div class="brand-section">
        <a href="#" class="brand-badge" onclick="navigateTo('studio'); return false;">
          <div class="brand-icon">F</div>
          <div class="brand-text">
            <h1>FLAG</h1>
            <span>Formal SVA Studio</span>
          </div>
        </a>
        <button class="icon-btn mobile-menu-btn" onclick="document.querySelector('.sidebar').classList.remove('open');">✕</button>
      </div>

      <nav class="nav-groups">
        <div>
          <div class="nav-group-title">WORKSPACE</div>
          <div class="nav-items">
            <button class="nav-btn ${STATE.page === 'studio' ? 'active' : ''}" data-page="studio" onclick="navigateTo('studio')">
              <span class="nav-icon">◫</span>
              <span>Pipeline Studio</span>
              <span class="nav-badge live-pulse" id="running-pulse-badge" style="display: none;">RUNNING</span>
            </button>
            <button class="nav-btn ${STATE.page === 'properties' ? 'active' : ''}" data-page="properties" onclick="navigateTo('properties')">
              <span class="nav-icon">⌘</span>
              <span>SVA Properties</span>
            </button>
            <button class="nav-btn ${STATE.page === 'waveforms' ? 'active' : ''}" data-page="waveforms" onclick="navigateTo('waveforms')">
              <span class="nav-icon">∿</span>
              <span>Waveform Viewer</span>
            </button>
            <button class="nav-btn ${STATE.page === 'rag' ? 'active' : ''}" data-page="rag" onclick="navigateTo('rag')">
              <span class="nav-icon">⬆</span>
              <span>Spec Extractor (RAG)</span>
            </button>
          </div>
        </div>

        <div>
          <div class="nav-group-title">ANALYSIS & METRICS</div>
          <div class="nav-items">
            <button class="nav-btn ${STATE.page === 'verification' ? 'active' : ''}" data-page="verification" onclick="navigateTo('verification')">
              <span class="nav-icon">◇</span>
              <span>Verification Analytics</span>
            </button>
            <button class="nav-btn ${STATE.page === 'templates' ? 'active' : ''}" data-page="templates" onclick="navigateTo('templates')">
              <span class="nav-icon">▱</span>
              <span>Grammar Templates</span>
            </button>
            <button class="nav-btn ${STATE.page === 'artifacts' ? 'active' : ''}" data-page="artifacts" onclick="navigateTo('artifacts')">
              <span class="nav-icon">▣</span>
              <span>Artifact Inspector</span>
            </button>
          </div>
        </div>

        <div>
          <div class="nav-group-title">SYSTEM</div>
          <div class="nav-items">
            <button class="nav-btn ${STATE.page === 'console' ? 'active' : ''}" data-page="console" onclick="navigateTo('console')">
              <span class="nav-icon">▤</span>
              <span>Execution Console</span>
            </button>
          </div>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="backend-status-card">
          <span class="status-dot offline" id="sidebar-status-dot"></span>
          <div class="status-text">
            <strong id="sidebar-status-title">Checking backend...</strong>
            <small id="sidebar-status-sub">127.0.0.1:8000</small>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Shell -->
    <div class="main-wrapper">
      <!-- Topbar -->
      <header class="topbar">
        <div class="topbar-left">
          <button class="mobile-menu-btn" onclick="document.querySelector('.sidebar').classList.add('open');">☰</button>
          <div class="breadcrumbs">
            <span>FLAG</span>
            <span class="crumb-sep">/</span>
            <span class="crumb-current" id="topbar-crumb-current">Pipeline Studio</span>
          </div>
        </div>

        <div class="topbar-right">
          <!-- Active Run Pill -->
          <div id="topbar-run-pill-wrap"></div>

          <!-- Theme Toggle -->
          <button class="icon-btn" id="theme-toggle-btn" onclick="toggleTheme()" title="Toggle Dark/Light Mode">
            ${STATE.theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <!-- Content View Container (Targeted updates -> No layout thrash) -->
      <main class="main-content">
        <div id="view-container"></div>
      </main>
    </div>
  `;
}

function updateHeaderStatus() {
  const isOnline = Boolean(STATE.health);
  const activeRun = STATE.activeRun;
  const isRunning = activeRun && ['queued', 'running'].includes(activeRun.status);

  const dot = document.getElementById('sidebar-status-dot');
  const title = document.getElementById('sidebar-status-title');
  const sub = document.getElementById('sidebar-status-sub');
  const pulse = document.getElementById('running-pulse-badge');
  const runWrap = document.getElementById('topbar-run-pill-wrap');

  if (dot) {
    dot.className = `status-dot ${isOnline ? (isRunning ? 'busy' : 'online') : 'offline'}`;
  }
  if (title) {
    title.textContent = isOnline ? (isRunning ? 'FLAG Executing' : 'FastAPI Connected') : 'Backend Offline';
  }
  if (sub) {
    sub.textContent = isOnline ? `Python ${STATE.health.python_version}` : '127.0.0.1:8000';
  }
  if (pulse) {
    pulse.style.display = isRunning ? 'inline-flex' : 'none';
  }
  if (runWrap) {
    if (STATE.activeRunId) {
      runWrap.innerHTML = `
        <button class="chip chip-muted" style="cursor: pointer;" onclick="openRunHistoryModal()">
          <span>⏱</span>
          <span>Run: ${STATE.activeRunId.slice(0, 8)}</span>
          <span style="opacity: 0.6;">▼</span>
        </button>
      `;
    } else {
      runWrap.innerHTML = '';
    }
  }
}

function updateBreadcrumb() {
  const crumb = document.getElementById('topbar-crumb-current');
  if (crumb) {
    const titles = {
      studio: 'Pipeline Studio',
      properties: 'SVA Properties',
      waveforms: 'Waveform Viewer',
      verification: 'Verification Analytics',
      templates: 'Grammar Templates',
      console: 'Execution Console',
      artifacts: 'Artifact Inspector',
      rag: 'Spec Extractor (RAG)',
    };
    crumb.textContent = titles[STATE.page] || 'Studio';
  }
}

// Render only the current view into #view-container
function renderCurrentView() {
  const container = document.getElementById('view-container');
  if (!container) return;

  if (STATE.page === 'studio') container.innerHTML = renderStudioView();
  else if (STATE.page === 'properties') container.innerHTML = renderPropertiesView();
  else if (STATE.page === 'waveforms') {
    container.innerHTML = renderWaveformsView();
    attachWaveformHover();
  }
  else if (STATE.page === 'verification') container.innerHTML = renderVerificationView();
  else if (STATE.page === 'templates') container.innerHTML = renderTemplatesView();
  else if (STATE.page === 'console') container.innerHTML = renderConsoleView();
  else if (STATE.page === 'rag') {
    container.innerHTML = renderRagView();
    ragAttachDragDrop();
  }
  else container.innerHTML = renderArtifactsView();
}

// High-speed direct SVG attribute manipulation (60+ FPS waveform hover)
function attachWaveformHover() {
  const svg = document.getElementById('timing-svg-canvas');
  const hoverInfo = document.getElementById('waveform-hover-info');
  if (!svg) return;

  const band = svg.querySelector('.timing-cursor-band');
  const line = svg.querySelector('.timing-cursor-line');

  svg.onmousemove = e => {
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (svg.viewBox.baseVal.width / rect.width);
    const cycleWidth = Math.round(CONFIG.CYCLE_WIDTH_BASE * STATE.waveformZoom);
    const labelWidth = CONFIG.LABEL_WIDTH;

    if (x > labelWidth) {
      const cycle = Math.floor((x - labelWidth) / cycleWidth);
      const hx = labelWidth + (cycle * cycleWidth);

      if (band && line) {
        band.setAttribute('x', hx);
        band.setAttribute('width', cycleWidth);
        band.style.opacity = '1';

        line.setAttribute('x1', hx + (cycleWidth / 2));
        line.setAttribute('x2', hx + (cycleWidth / 2));
        line.style.opacity = '1';
      }

      if (hoverInfo) {
        hoverInfo.style.display = 'block';
        hoverInfo.textContent = `Cycle T${cycle} highlighted`;
      }
    }
  };

  svg.onmouseleave = () => {
    if (band && line) {
      band.style.opacity = '0';
      line.style.opacity = '0';
    }
    if (hoverInfo) hoverInfo.style.display = 'none';
  };
}

// ============================================================================
// RAG Spec Extractor — Full View + API Integration
// ============================================================================

// --- RAG API helpers ---

async function ragApiRequest(path, options = {}) {
  const url = `${CONFIG.API_BASE}/api/rag${path}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = `Server error ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.blob();
}

async function ragLoadDocuments() {
  try {
    STATE.ragDocuments = await ragApiRequest('/documents');
    if (STATE.ragSelectedDocId && STATE.ragDocuments.some(d => d.id === STATE.ragSelectedDocId)) {
      await ragLoadDiagrams(STATE.ragSelectedDocId);
    } else {
      STATE.ragSelectedDocId = null;
      STATE.ragDiagrams = [];
      STATE.ragJobs = [];
    }
  } catch (err) {
    showToast(`RAG: ${err.message}`, 'error');
    STATE.ragDocuments = [];
  }
  if (STATE.page === 'rag') renderCurrentView();
}

async function ragLoadDiagrams(docId) {
  STATE.ragSelectedDocId = docId;
  try {
    const [diagrams, jobs] = await Promise.all([
      ragApiRequest(`/documents/${docId}/diagrams`),
      ragApiRequest(`/jobs?doc_id=${docId}`),
    ]);
    STATE.ragDiagrams = diagrams;
    STATE.ragJobs = jobs;
  } catch (err) {
    STATE.ragDiagrams = [];
    STATE.ragJobs = [];
    showToast(`Failed to load diagrams: ${err.message}`, 'error');
  }
  if (STATE.page === 'rag') renderCurrentView();
}

async function ragUploadDocument(file, protocol, description) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('protocol', protocol);
  fd.append('description', description);
  try {
    const doc = await ragApiRequest('/documents', { method: 'POST', body: fd });
    showToast(`Uploaded "${doc.filename}" (${doc.page_count || '?'} pages)`, 'success');
    await ragLoadDocuments();
    // Auto-select the newly uploaded doc
    STATE.ragSelectedDocId = doc.id;
    await ragLoadDiagrams(doc.id);
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

async function ragDeleteDocument(docId) {
  if (!confirm('Delete this document and all its extracted diagrams?')) return;
  try {
    await ragApiRequest(`/documents/${docId}`, { method: 'DELETE' });
    if (STATE.ragSelectedDocId === docId) {
      STATE.ragSelectedDocId = null;
      STATE.ragDiagrams = [];
      STATE.ragJobs = [];
    }
    await ragLoadDocuments();
    showToast('Document deleted.', 'success');
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

async function ragTestApiKey() {
  const apiKey = document.getElementById('rag-apikey-input')?.value?.trim() || STATE.ragOpenAIKey;
  const model = document.getElementById('rag-model-select')?.value || 'gpt-4o';
  if (!apiKey) {
    showToast('Please enter your OpenAI API key in the field below.', 'error');
    return;
  }
  const testBtn = document.getElementById('rag-test-key-btn');
  if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Verifying…'; }
  try {
    const fd = new FormData();
    fd.append('openai_api_key', apiKey);
    fd.append('model', model);
    const res = await ragApiRequest('/test-key', { method: 'POST', body: fd });
    showToast(res.message || 'API key verified! Tokens can now be billed.', 'success');
    localStorage.setItem('FLAG_OPENAI_KEY', apiKey);
    STATE.ragOpenAIKey = apiKey;
  } catch (err) {
    showToast(`Key Error: ${err.message}`, 'error');
  } finally {
    if (testBtn) { testBtn.disabled = false; testBtn.textContent = 'Verify Key'; }
  }
}

async function ragStartExtraction(docId) {
  const mechanism = document.getElementById('rag-mechanism-input')?.value?.trim() ?? STATE.ragMechanismQuery;
  const model = document.getElementById('rag-model-select')?.value || STATE.ragModel;
  const apiKey = document.getElementById('rag-apikey-input')?.value?.trim() || STATE.ragOpenAIKey;

  if (model !== 'rule_based' && !apiKey) {
    showToast('OpenAI API key required for VLM models. Or switch to "Rule-Based Extractor (Offline / 0 Tokens)".', 'error');
    return;
  }

  const fd = new FormData();
  fd.append('doc_id', docId);
  fd.append('mechanism', mechanism);
  fd.append('openai_api_key', apiKey || '');
  fd.append('model', model);

  try {
    const job = await ragApiRequest('/extract', { method: 'POST', body: fd });
    showToast(`Extraction started (${model === 'rule_based' ? 'Rule-Based Extractor' : model})`, 'success');
    if (apiKey) {
      localStorage.setItem('FLAG_OPENAI_KEY', apiKey);
      STATE.ragOpenAIKey = apiKey;
    }
    STATE.ragJobs = [job, ...STATE.ragJobs];
    if (STATE.page === 'rag') renderCurrentView();
    ragStartJobPolling(docId);
  } catch (err) {
    showToast(`Extraction failed: ${err.message}`, 'error');
  }
}

function ragStartJobPolling(docId) {
  if (STATE.ragJobPollTimer) clearInterval(STATE.ragJobPollTimer);
  STATE.ragJobPollTimer = setInterval(async () => {
    if (STATE.page !== 'rag' || STATE.ragSelectedDocId !== docId) {
      clearInterval(STATE.ragJobPollTimer);
      STATE.ragJobPollTimer = null;
      return;
    }
    try {
      const jobs = await ragApiRequest(`/jobs?doc_id=${docId}`);
      STATE.ragJobs = jobs;
      const anyRunning = jobs.some(j => j.status === 'queued' || j.status === 'running');
      if (!anyRunning) {
        clearInterval(STATE.ragJobPollTimer);
        STATE.ragJobPollTimer = null;
        // Reload diagrams after job completes
        const diagrams = await ragApiRequest(`/documents/${docId}/diagrams`);
        STATE.ragDiagrams = diagrams;
        const finished = jobs.find(j => j.status === 'completed');
        if (finished) showToast(`Extraction complete! Found ${diagrams.length} timing diagram(s).`, 'success');
        const failed = jobs.find(j => j.status === 'failed');
        if (failed) showToast(`Extraction failed: ${failed.error || 'Unknown error'}`, 'error');
      }
      if (STATE.page === 'rag') renderCurrentView();
    } catch (_) {}
  }, 2000);
}

async function ragDeleteDiagram(diagId) {
  if (!confirm('Delete this extracted timing diagram?')) return;
  try {
    await ragApiRequest(`/diagrams/${diagId}`, { method: 'DELETE' });
    STATE.ragDiagrams = STATE.ragDiagrams.filter(d => d.id !== diagId);
    if (STATE.ragPreviewDiagId === diagId) STATE.ragPreviewDiagId = null;
    if (STATE.page === 'rag') renderCurrentView();
    showToast('Diagram deleted.', 'success');
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

async function ragPromoteDiagram(diagId) {
  const diag = STATE.ragDiagrams.find(d => d.id === diagId);
  if (!diag) return;
  const doc = STATE.ragDocuments.find(d => d.id === diag.doc_id);
  const protocol = prompt('Protocol family (e.g. AXI, APB):', doc?.protocol || '');
  if (!protocol) return;
  const mechanism = prompt('Mechanism name (e.g. channel_handshake):', diag.mechanism || '');
  if (!mechanism) return;
  const fd = new FormData();
  fd.append('protocol', protocol);
  fd.append('mechanism', mechanism);
  try {
    const res = await ragApiRequest(`/diagrams/${diagId}/promote`, { method: 'POST', body: fd });
    showToast(`Promoted to test_cases/${protocol}/${mechanism}/`, 'success');
  } catch (err) {
    showToast(`Promote failed: ${err.message}`, 'error');
  }
}

// --- Drag-and-drop wiring ---

function ragAttachDragDrop() {
  const zone = document.getElementById('rag-dropzone');
  if (!zone) return;
  ['dragenter', 'dragover'].forEach(evt => {
    zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag-over'); });
  });
  zone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.name.endsWith('.pdf'));
    if (!files.length) { showToast('Only PDF files are accepted.', 'error'); return; }
    const protocol = document.getElementById('rag-upload-protocol')?.value.trim() || 'Unknown';
    const description = document.getElementById('rag-upload-desc')?.value.trim() || '';
    files.forEach(f => ragUploadDocument(f, protocol, description));
  });
}

function ragHandleFileInput(input) {
  const files = Array.from(input.files || []).filter(f => f.name.endsWith('.pdf'));
  if (!files.length) return;
  const protocol = document.getElementById('rag-upload-protocol')?.value.trim() || 'Unknown';
  const description = document.getElementById('rag-upload-desc')?.value.trim() || '';
  files.forEach(f => ragUploadDocument(f, protocol, description));
  input.value = '';
}

// --- Render ---

function renderRagView() {
  const selectedDoc = STATE.ragDocuments.find(d => d.id === STATE.ragSelectedDocId) || null;
  const previewDiag = STATE.ragPreviewDiagId
    ? STATE.ragDiagrams.find(d => d.id === STATE.ragPreviewDiagId)
    : null;

  const activeJob = STATE.ragJobs.find(j => j.status === 'queued' || j.status === 'running');

  const docListHtml = STATE.ragDocuments.length === 0
    ? `<div class="empty-state" style="padding: 2rem; text-align:center; color: var(--text-muted);">
         <div style="font-size:2rem; margin-bottom:.5rem;">📄</div>
         <div>No documents uploaded yet.</div>
       </div>`
    : STATE.ragDocuments.map(doc => `
        <div class="rag-doc-item ${doc.id === STATE.ragSelectedDocId ? 'active' : ''}"
             onclick="ragLoadDiagrams('${doc.id}').then(() => renderCurrentView())">
          <div class="rag-doc-icon">📄</div>
          <div class="rag-doc-info">
            <div class="rag-doc-name">${escapeHtml(doc.filename)}</div>
            <div class="rag-doc-meta">
              <span class="rag-tag">${escapeHtml(doc.protocol)}</span>
              ${doc.page_count ? `<span class="rag-meta-text">${doc.page_count} pages</span>` : ''}
              <span class="rag-meta-text">${formatFileSize(doc.file_size)}</span>
            </div>
            ${doc.description ? `<div class="rag-doc-desc">${escapeHtml(doc.description)}</div>` : ''}
          </div>
          <button class="icon-btn rag-doc-delete" title="Delete document"
                  onclick="event.stopPropagation(); ragDeleteDocument('${doc.id}')">🗑</button>
        </div>`).join('');

  const jobBadgeHtml = activeJob
    ? `<div class="rag-job-banner">
         <div class="live-dot"></div>
         <span>Extracting… ${activeJob.progress}/${activeJob.total || '?'} figures</span>
         <div class="rag-progress-bar">
           <div class="rag-progress-fill" style="width: ${activeJob.total ? Math.round((activeJob.progress / activeJob.total) * 100) : 5}%"></div>
         </div>
       </div>`
    : '';

  const diagramListHtml = !selectedDoc
    ? `<div class="empty-state" style="padding:3rem; text-align:center; color:var(--text-muted);">
         <div style="font-size:2rem;margin-bottom:.5rem;">↖</div>
         <div>Select a document from the list to view extracted timing diagrams.</div>
       </div>`
    : STATE.ragDiagrams.length === 0 && !activeJob
    ? `<div class="empty-state" style="padding:3rem; text-align:center; color:var(--text-muted);">
         <div style="font-size:2rem;margin-bottom:.5rem;">🔍</div>
         <div>No timing diagrams extracted yet.</div>
         <div style="margin-top:.5rem; font-size:0.85rem;">Use the extraction panel on the right to run the RAG pipeline.</div>
       </div>`
    : STATE.ragDiagrams.map(diag => `
        <div class="rag-diag-card ${diag.id === STATE.ragPreviewDiagId ? 'active' : ''}"
             onclick="STATE.ragPreviewDiagId = '${diag.id}'; renderCurrentView();">
          <div class="rag-diag-header">
            <div class="rag-diag-fig">${escapeHtml(diag.figure_number || 'Figure')}</div>
            <div class="rag-diag-page">p.${diag.page_number || '?'}</div>
          </div>
          <div class="rag-diag-caption">${escapeHtml(diag.caption || 'Untitled')}</div>
          <div class="rag-diag-signals">
            ${(diag.signal_names || []).slice(0, 6).map(s => `<span class="sva-token">${escapeHtml(s)}</span>`).join('')}
            ${(diag.signal_names || []).length > 6 ? `<span class="rag-more">+${diag.signal_names.length - 6}</span>` : ''}
          </div>
          <div class="rag-diag-wavecount">
            ${diag.timing_json?.waveforms?.length || 0} waveform(s)
          </div>
          <div class="rag-diag-actions" onclick="event.stopPropagation()">
            <button class="btn btn-secondary btn-sm" title="Preview" 
                    onclick="STATE.ragPreviewDiagId = '${diag.id}'; renderCurrentView();">Preview</button>
            <button class="btn btn-secondary btn-sm" title="Promote to test_cases"
                    onclick="ragPromoteDiagram('${diag.id}')">Use in FLAG</button>
            <button class="icon-btn" title="Delete" onclick="ragDeleteDiagram('${diag.id}')">🗑</button>
          </div>
        </div>`).join('');

  // Right panel: extraction config OR preview
  const rightPanelHtml = previewDiag
    ? ragRenderDiagramPreview(previewDiag)
    : ragRenderExtractionPanel(selectedDoc);

  return `
    <div class="rag-layout">
      <!-- LEFT: Document Library -->
      <div class="rag-lib-panel">
        <div class="rag-panel-header">
          <h2>Spec Library</h2>
          <span class="rag-count">${STATE.ragDocuments.length} document(s)</span>
        </div>

        <!-- Upload Zone -->
        <div class="rag-upload-section">
          <div class="rag-upload-fields">
            <input type="text" id="rag-upload-protocol" class="form-input"
                   placeholder="Protocol (e.g. AXI, APB, PCI)"
                   value="${escapeHtml(STATE.ragUploadProtocol)}"
                   oninput="STATE.ragUploadProtocol = this.value">
            <input type="text" id="rag-upload-desc" class="form-input"
                   placeholder="Description (optional)"
                   value="${escapeHtml(STATE.ragUploadDescription)}"
                   oninput="STATE.ragUploadDescription = this.value">
          </div>
          <div class="rag-dropzone" id="rag-dropzone"
               onclick="document.getElementById('rag-file-input').click()">
            <div class="rag-dropzone-icon">⬆</div>
            <div class="rag-dropzone-text">Drop PDF here or <u>click to browse</u></div>
            <div class="rag-dropzone-hint">Protocol specification PDFs only</div>
            <input type="file" id="rag-file-input" accept=".pdf" multiple style="display:none"
                   onchange="ragHandleFileInput(this)">
          </div>
        </div>

        <!-- Document list -->
        <div class="rag-doc-list">
          ${docListHtml}
        </div>
      </div>

      <!-- MIDDLE: Extracted Diagrams -->
      <div class="rag-diag-panel">
        <div class="rag-panel-header">
          <h2>Extracted Diagrams</h2>
          ${selectedDoc ? `<span class="rag-count">${STATE.ragDiagrams.length} found</span>` : ''}
        </div>
        ${jobBadgeHtml}
        <div class="rag-diag-list">
          ${diagramListHtml}
        </div>
      </div>

      <!-- RIGHT: Extraction Config or Preview -->
      <div class="rag-right-panel">
        ${rightPanelHtml}
      </div>
    </div>`;
}

function ragRenderExtractionPanel(selectedDoc) {
  if (!selectedDoc) {
    return `<div class="rag-right-empty">
      <div style="font-size:2.5rem;margin-bottom:1rem;">⚙</div>
      <div style="color:var(--text-muted);text-align:center;">Select a document to configure extraction</div>
    </div>`;
  }

  const lastJob = STATE.ragJobs[0];
  const lastErrorHtml = (lastJob && lastJob.error)
    ? `<div class="rag-error-banner" style="margin-bottom:1rem; padding:0.75rem 1rem; border-radius:var(--radius); background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); font-size:0.8rem; color:#ef4444;">
         <div style="font-weight:700; margin-bottom:0.25rem;">⚠️ Extraction Notice / Error:</div>
         <div>${escapeHtml(lastJob.error)}</div>
       </div>`
    : '';

  const jobHistoryHtml = STATE.ragJobs.length === 0 ? '' : `
    <div class="rag-job-history">
      <div class="prop-section-label">Recent Jobs</div>
      ${STATE.ragJobs.slice(0, 5).map(j => `
        <div class="rag-job-row" style="flex-direction:column; align-items:flex-start; gap:0.25rem; padding:0.4rem 0;">
          <div style="display:flex; width:100%; align-items:center; gap:0.5rem;">
            <span class="status-pill status-${j.status}">${j.status}</span>
            <span class="rag-job-mech">${escapeHtml(j.mechanism || 'all')}</span>
            <span class="rag-job-model" style="font-size:0.7rem;">${j.model}</span>
            <span class="rag-job-count">${j.progress}/${j.total || '?'}</span>
          </div>
          ${j.error ? `<div style="font-size:0.7rem; color:var(--status-failed, #ef4444); line-height:1.3;">${escapeHtml(j.error)}</div>` : ''}
        </div>`).join('')}
    </div>`;

  const isRuleBased = STATE.ragModel === 'rule_based';

  const isOpenRouter = STATE.ragOpenAIKey.trim().startsWith('sk-or-');

  return `
    <div class="rag-extract-panel">
      <div class="rag-panel-header" style="border-bottom: 1px solid var(--border); padding-bottom: .75rem; margin-bottom: 1rem;">
        <h2>Extract Timing Diagrams</h2>
      </div>

      ${lastErrorHtml}

      <div class="rag-extract-doc-info">
        <div class="rag-tag">${escapeHtml(selectedDoc.protocol)}</div>
        <span style="font-weight:600; color:var(--text-primary);">${escapeHtml(selectedDoc.filename)}</span>
        ${selectedDoc.page_count ? `<span style="color:var(--text-muted);">${selectedDoc.page_count} pages</span>` : ''}
      </div>

      <div class="form-group">
        <label class="form-label">Mechanism / Target Handshake</label>
        <input type="text" class="form-input" id="rag-mechanism-input"
               placeholder="e.g. channel_handshake, reset, transfers"
               value="${escapeHtml(STATE.ragMechanismQuery)}"
               oninput="STATE.ragMechanismQuery = this.value">
        <div class="form-hint">E.g., "channel_handshake" or leave blank to extract all timing rules from this protocol.</div>
      </div>

      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label class="form-label" style="margin:0;">Extraction Engine / Model</label>
          ${isOpenRouter ? '<span class="rag-tag" style="background:rgba(16,185,129,0.15); color:#10b981; border-color:rgba(16,185,129,0.3);">🟢 OpenRouter Mode</span>' : ''}
        </div>
        <select class="form-select" id="rag-model-select"
                onchange="STATE.ragModel = this.value; renderCurrentView();">
          <option value="rule_based" ${STATE.ragModel === 'rule_based' ? 'selected' : ''}>⚡ Protocol Rule Extractor (Offline / 0 Tokens)</option>
          ${isOpenRouter ? `
            <option value="openai/gpt-4o" ${STATE.ragModel === 'openai/gpt-4o' || STATE.ragModel === 'gpt-4o' ? 'selected' : ''}>🧠 OpenRouter: GPT-4o (Vision)</option>
            <option value="openai/gpt-4o-mini" ${STATE.ragModel === 'openai/gpt-4o-mini' || STATE.ragModel === 'gpt-4o-mini' ? 'selected' : ''}>⚡ OpenRouter: GPT-4o-mini (Low Cost)</option>
            <option value="anthropic/claude-3.5-sonnet" ${STATE.ragModel === 'anthropic/claude-3.5-sonnet' ? 'selected' : ''}>🎯 OpenRouter: Claude 3.5 Sonnet</option>
            <option value="google/gemini-flash-1.5" ${STATE.ragModel === 'google/gemini-flash-1.5' ? 'selected' : ''}>⚡ OpenRouter: Gemini Flash 1.5</option>
          ` : `
            <option value="gpt-4o" ${STATE.ragModel === 'gpt-4o' ? 'selected' : ''}>🧠 OpenAI GPT-4o Vision (High Quality)</option>
            <option value="gpt-4o-mini" ${STATE.ragModel === 'gpt-4o-mini' ? 'selected' : ''}>⚡ OpenAI GPT-4o-mini Vision (Low Cost)</option>
            <option value="openai/gpt-4o" ${STATE.ragModel === 'openai/gpt-4o' ? 'selected' : ''}>🌐 OpenRouter: openai/gpt-4o</option>
          `}
        </select>
        <div class="form-hint">
          ${isRuleBased 
            ? '✅ Zero tokens needed. Extracts verified timing_diagrams.json directly from the protocol document specification rules.' 
            : (isOpenRouter ? 'Uses your OpenRouter token balance. Fully vision-enabled.' : 'Requires an active OpenAI API key with available billing balance.')}
        </div>
      </div>

      ${isRuleBased ? '' : `
      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label class="form-label" style="margin:0;">
            ${isOpenRouter ? 'OpenRouter API Key' : 'OpenRouter or OpenAI API Key'}
          </label>
          <button type="button" class="btn btn-secondary btn-sm" id="rag-test-key-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="ragTestApiKey()">
            Verify Key &amp; Balance
          </button>
        </div>
        <input type="password" class="form-input" id="rag-apikey-input"
               placeholder="sk-or-v1-... (OpenRouter) or sk-... (OpenAI)"
               value="${escapeHtml(STATE.ragOpenAIKey)}"
               oninput="STATE.ragOpenAIKey = this.value; localStorage.setItem('FLAG_OPENAI_KEY', this.value); if(this.value.startsWith('sk-or-') && !STATE.ragModel.includes('/')) STATE.ragModel = 'openai/gpt-4o-mini';">
        <div class="form-hint">
          ${isOpenRouter 
            ? '🟢 OpenRouter key detected. Click "Verify Key & Balance" to check your token usage & limit.' 
            : 'Stored locally in your browser. Paste your OpenRouter key (sk-or-v1-...) to use OpenRouter tokens.'}
        </div>
      </div>
      `}

      <button class="btn btn-primary" style="width:100%; margin-top:.5rem;"
              onclick="ragStartExtraction('${selectedDoc.id}')">
        ▶ Extract Timing Diagrams (JSON)
      </button>

      <div class="rag-pipeline-info">
        <div class="prop-section-label" style="margin-top:1.5rem;">Pipeline Output</div>
        <div class="rag-stage-list">
          <div class="rag-stage"><span class="rag-stage-num">1</span> Discovers timing diagram waveforms from protocol spec</div>
          <div class="rag-stage"><span class="rag-stage-num">2</span> Parses signal list (control signals &amp; multi-bit data buses)</div>
          <div class="rag-stage"><span class="rag-stage-num">3</span> Encodes cycle values: 0, 1, X (don't care), symbolic words</div>
          <div class="rag-stage"><span class="rag-stage-num">4</span> Generates FLAG-compatible <code>timing_diagrams.json</code></div>
          <div class="rag-stage"><span class="rag-stage-num">5</span> Generates WaveDrom-compatible <code>timing_diagrams_wavedrom.json</code></div>
          <div class="rag-stage"><span class="rag-stage-num">6</span> One-click promotion to <code>test_cases/</code> for SVA generation</div>
        </div>
      </div>

      ${jobHistoryHtml}
    </div>`;
}

function ragRenderDiagramPreview(diag) {
  const doc = STATE.ragDocuments.find(d => d.id === diag.doc_id);
  const timing = diag.timing_json || {};
  const waveforms = timing.waveforms || [];
  const signals = timing.signals || [];

  const waveformHtml = waveforms.map((wf, wi) => {
    const lanes = wf.signals || [];
    const nCycles = lanes.length ? (lanes[0].values || []).length : 0;
    const cycleLabels = Array.from({ length: nCycles }, (_, i) => `T${i}`).join('');

    return `
      <div class="rag-wf-block">
        <div class="rag-wf-name">${escapeHtml(wf.name || `Waveform ${wi+1}`)}</div>
        <div class="rag-wf-table-wrap">
          <table class="rag-wf-table">
            <thead>
              <tr>
                <th class="rag-wf-sig-col">Signal</th>
                ${Array.from({ length: nCycles }, (_, i) => `<th>T${i}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${lanes.map(lane => {
                const sigDef = signals.find(s => s.name === lane.name);
                const isBus = sigDef?.type === 'word';
                return `<tr>
                  <td class="rag-wf-sig-col"><span class="sva-token">${escapeHtml(lane.name)}</span></td>
                  ${(lane.values || []).map(v => {
                    if (v === 'X' || v === 'x') return `<td class="rag-cell-x">X</td>`;
                    if (isBus || typeof v === 'string') return `<td class="rag-cell-bus">${escapeHtml(String(v))}</td>`;
                    return v === 1 ? `<td class="rag-cell-hi">1</td>` : `<td class="rag-cell-lo">0</td>`;
                  }).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="rag-preview-panel">
      <div class="rag-panel-header" style="border-bottom:1px solid var(--border); padding-bottom:.75rem; margin-bottom:1rem;">
        <h2>${escapeHtml(diag.figure_number || 'Figure')}</h2>
        <button class="btn btn-secondary btn-sm" onclick="STATE.ragPreviewDiagId = null; renderCurrentView();">✕ Close</button>
      </div>

      <div class="rag-preview-caption">${escapeHtml(diag.caption || 'Untitled')}</div>
      <div class="rag-preview-meta">
        <span class="rag-tag">${escapeHtml(doc?.protocol || '?')}</span>
        <span class="rag-meta-text">Page ${diag.page_number || '?'}</span>
        <span class="rag-meta-text">${signals.length} signal(s)</span>
        <span class="rag-meta-text">${waveforms.length} waveform(s)</span>
      </div>

      ${diag.figure_image_path ? `
        <div class="rag-figure-img-wrap">
          <img src="${CONFIG.API_BASE}/api/rag/diagrams/${diag.id}/figure"
               alt="Figure crop"
               class="rag-figure-img"
               onerror="this.style.display='none'">
        </div>` : ''}

      <div class="rag-waveforms-section">
        <div class="prop-section-label" style="margin-bottom:.75rem;">Extracted Timing Waveforms</div>
        ${waveformHtml || '<div style="color:var(--text-muted);">No waveforms extracted.</div>'}
      </div>

      <div class="rag-preview-actions">
        <button class="btn btn-primary btn-sm" onclick="ragPromoteDiagram('${diag.id}')">
          ▶ Use in FLAG Run
        </button>
        <button class="btn btn-secondary btn-sm"
                onclick="navigator.clipboard.writeText(JSON.stringify(${JSON.stringify(timing)}, null, 2)); showToast('Copied timing JSON', 'success')">
          Copy JSON
        </button>
        <button class="btn btn-secondary btn-sm" style="color:var(--status-failed);"
                onclick="ragDeleteDiagram('${diag.id}')">Delete</button>
      </div>

      <div class="rag-json-section">
        <div class="prop-section-label" style="margin-bottom:.5rem; cursor:pointer;"
             onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
          ▸ Raw timing_diagrams.json
        </div>
        <pre class="rag-json-pre" style="display:none;">${escapeHtml(JSON.stringify(timing, null, 2))}</pre>
      </div>
    </div>`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Global keybindings
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && STATE.modalType) {
    closeModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleLaunchRun();
  }
});

// Boot up
document.addEventListener('DOMContentLoaded', initApp);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initApp();
}
