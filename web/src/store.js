import { reactive } from 'vue'
import { api } from './api'

const LOG_LIMIT = 5000 // 与后端环形缓冲一致
const FLUSH_MS = 100   // 日志批量写入间隔：限制高频输出时的重渲染频率

export const state = reactive({
  profiles: [],          // 配置列表（含 run 状态快照）
  runs: {},              // profileId -> run 视图
  logs: {},              // profileId -> { lines: [], keyInfo: {} }
  connected: false,
  loading: false
})

let nextLineId = 1 // 行 id（单调递增）：作列表渲染的稳定 key，头部裁剪不再引起整表 diff

function logBuf(profileId) {
  if (!state.logs[profileId]) {
    state.logs[profileId] = { lines: [], keyInfo: {} }
  }
  return state.logs[profileId]
}

// 高频日志先攒入普通数组，定时批量写入响应式缓冲，避免每行触发一次重渲染
const pending = new Map()
let flushTimer = null
function appendLog(profileId, line, level, ts) {
  let arr = pending.get(profileId)
  if (!arr) { arr = []; pending.set(profileId, arr) }
  arr.push({ id: nextLineId++, line, level, ts })
  if (!flushTimer) flushTimer = setTimeout(flushLogs, FLUSH_MS)
}
function flushLogs() {
  flushTimer = null
  for (const [profileId, arr] of pending) {
    pending.delete(profileId)
    const buf = logBuf(profileId)
    buf.lines.push(...arr)
    if (buf.lines.length > LOG_LIMIT) buf.lines.splice(0, buf.lines.length - LOG_LIMIT)
  }
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
  flushLogs() // 先把挂起的实时日志落库，保证下面的判空准确
  const buf = logBuf(run.profileId)
  if (buf.lines.length) return
  try {
    const lines = await api.logCatchUp(run.profileId, 0)
    if (buf.lines.length || pending.has(run.profileId)) return // 等待期间已有实时日志，跳过补拉避免重复
    for (const l of lines) buf.lines.push({ ...l, id: nextLineId++ })
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
        delete state.logs[msg.profileId] // 释放日志缓冲，避免重启同一配置时残留旧日志
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
