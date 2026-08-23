// REST API 封装
async function req(method, url, body) {
  const opt = { method, headers: {} }
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json'
    opt.body = JSON.stringify(body)
  }
  const resp = await fetch(url, opt)
  let data = null
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) data = await resp.json()
  else data = await resp.text()
  if (!resp.ok) throw new Error((data && data.error) || `HTTP ${resp.status}`)
  return data
}

export const api = {
  listProfiles: () => req('GET', '/api/profiles'),
  createProfile: (p) => req('POST', '/api/profiles', p),
  updateProfile: (id, p) => req('PUT', `/api/profiles/${id}`, p),
  deleteProfile: (id) => req('DELETE', `/api/profiles/${id}`),
  startProfile: (id) => req('POST', `/api/profiles/${id}/start`),
  stopRun: (id) => req('POST', `/api/runs/${id}/stop`),
  listRuns: () => req('GET', '/api/runs'),
  logCatchUp: (id, after = 0) => req('GET', `/api/runs/${id}/log?after=${after}`),
  importProfiles: (payload) => req('POST', '/api/import', payload),
  exportProfiles: () => req('GET', '/api/export'),
  parseCommand: (command) => req('POST', '/api/parse', { command }),
  healthCheck: (host, port) => req('GET', `/api/health-check?host=${encodeURIComponent(host)}&port=${port}`),
  browse: (dir, recursive) => req('GET', `/api/browse?dir=${encodeURIComponent(dir)}${recursive ? '&recursive=1' : ''}`),
  getFields: () => req('GET', '/api/fields'),
  gpus: () => req('GET', '/api/gpus'),
  getSettings: () => req('GET', '/api/settings'),
  putSettings: (s) => req('PUT', '/api/settings', s)
}

// 导出 txt（文件下载）
export async function downloadExport() {
  const resp = await fetch('/api/export')
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'llama-server.txt'
  a.click()
  URL.revokeObjectURL(url)
}
