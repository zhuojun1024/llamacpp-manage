import { reactive } from 'vue'
import { api } from './api'

const LOG_LIMIT = 5000 // 与后端环形缓冲一致

export const state = reactive({
  profiles: [],          // 配置列表（含 run 状态快照）
  runs: {},              // profileId -> run 视图
  logs: {},              // profileId -> { lines: [], keyInfo: {} }
  connected: false,
  loading: false
})

function logBuf(profileId) {
  if (!state.logs[profileId]) {
    state.logs[profileId] = { lines: [], keyInfo: {} }
  }
  return state.logs[profileId]
}

function appendLog(profileId, line, level, ts) {
  const buf = logBuf(profileId)
  buf.lines.push({ line, level, ts })
  if (buf.lines.length > LOG_LIMIT) buf.lines.splice(0, buf.lines.length - LOG_LIMIT)
}

export async function refreshProfiles() {
  state.loading = true
  try {
    state.profiles = await api.listProfiles()
    // 同步 runs 快照
    for (const p of state.profiles) {
      if (p.run) state.runs[p.id] = p.run
    }
  } finally {
    state.loading = false
  }
}

// 对运行中但本地没有日志缓冲的实例做补拉（WS 断线恢复 / 页面刷新）
async function catchUp(run) {
  const buf = logBuf(run.profileId)
  if (buf.lines.length) return
  try {
    const lines = await api.logCatchUp(run.profileId, 0)
    for (const l of lines) buf.lines.push(l)
    if (buf.lines.length > LOG_LIMIT) buf.lines.splice(0, buf.lines.length - LOG_LIMIT)
  } catch { /* 忽略 */ }
}

let ws = null
let retryTimer = null

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.onopen = () => { state.connected = true }

  ws.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    switch (msg.type) {
      case 'hello':
        for (const run of msg.runs) {
          state.runs[run.profileId] = run
          catchUp(run)
        }
        refreshProfiles()
        break
      case 'log':
        appendLog(msg.profileId, msg.line, msg.level, msg.ts)
        break
      case 'status':
        state.runs[msg.run.profileId] = msg.run
        logBuf(msg.run.profileId).keyInfo = { ...msg.run.keyInfo }
        refreshProfiles()
        break
      case 'exit': {
        const run = state.runs[msg.profileId]
        if (run) delete state.runs[msg.profileId]
        refreshProfiles()
        break
      }
    }
  }

  ws.onclose = () => {
    state.connected = false
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, 2000)
  }
  ws.onerror = () => ws.close()
}

export { logBuf, appendLog }
