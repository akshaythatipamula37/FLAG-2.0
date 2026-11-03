const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    })
  } catch (error) {
    throw new Error(`Cannot reach FLAG backend at ${API_BASE}. Start the FastAPI server and retry.`)
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.detail
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status}).`)
  }
  return payload
}

export const api = {
  health: () => request('/api/health'),
  catalog: () => request('/api/catalog'),
  input: (path) => request(`/api/inputs/${path.split('/').map(encodeURIComponent).join('/')}`),
  createRun: (body) => request('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  run: (runId) => request(`/api/runs/${encodeURIComponent(runId)}`),
  logs: (runId) => request(`/api/runs/${encodeURIComponent(runId)}/logs`),
  artifacts: (runId) => request(`/api/runs/${encodeURIComponent(runId)}/artifacts`),
  artifact: (runId, filename) => request(`/api/runs/${encodeURIComponent(runId)}/artifacts/${filename.split('/').map(encodeURIComponent).join('/')}`),
}
