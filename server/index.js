'use strict'
/**
 * index.js — 单进程服务：REST API + WebSocket + 静态托管前端
 * 启动：node server/index.js （端口取 settings.port，默认 8787）
 * NO_BROWSER=1 可跳过自动打开浏览器（测试用）。
 */
const http = require('http')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const express = require('express')
const { WebSocketServer } = require('ws')

const { Store, ROOT } = require('./store')
const { Runner } = require('./runner')
const P = require('./parser')

const store = new Store()
const settings = store.loadSettings()
// PORT 环境变量可覆盖（测试用），否则取设置中的端口
const PORT = Number(process.env.PORT) || settings.port || 8787

const app = express()
app.use(express.json({ limit: '2mb' }))

// ---------- 广播（WS） ----------
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

function broadcast(event) {
  const msg = JSON.stringify(event)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    runs: runner.list(),
    serverTime: Date.now()
  }))
  ws.on('close', () => clients.delete(ws))
})

const runner = new Runner(store, broadcast)

// ---------- profiles ----------
function withStatus(profiles) {
  return profiles.map(p => {
    const run = runner.get(p.id)
    return { ...p, run: run ? runner._view(run) : null }
  })
}

app.get('/api/profiles', (req, res) => {
  res.json(withStatus(store.loadProfiles()))
})

app.post('/api/profiles', (req, res) => {
  const b = req.body || {}
  if (!b.name || !Array.isArray(b.args)) {
    return res.status(400).json({ error: 'Missing name / args' })
  }
  const profiles = store.loadProfiles()
  const now = Date.now()
  const profile = {
    id: store.newId(),
    name: String(b.name),
    description: String(b.description || ''),
    exe: String(b.exe || ''), // 可为空：启动时回退设置中的默认路径
    args: b.args,
    env: String(b.env || ''), // 环境变量（KEY=VALUE 行），启动时合并进子进程
    createdAt: now,
    updatedAt: now
  }
  profiles.push(profile)
  store.saveProfiles(profiles)
  res.json(profile)
})

// 拖拽排序：按前端给出的 id 顺序重排（须注册在 /:id 之前）
app.put('/api/profiles/reorder', (req, res) => {
  const ids = (req.body || {}).ids
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Missing ids array' })
  const profiles = store.loadProfiles()
  const byId = new Map(profiles.map(p => [p.id, p]))
  const next = []
  for (const id of ids) {
    const p = byId.get(id)
    if (!p) return res.status(400).json({ error: `Unknown profile id: ${id}` })
    next.push(p)
    byId.delete(id)
  }
  // 请求未覆盖的配置追加在末尾，避免丢数据
  for (const p of byId.values()) next.push(p)
  store.saveProfiles(next)
  res.json({ ok: true })
})

app.put('/api/profiles/:id', (req, res) => {
  const profiles = store.loadProfiles()
  const p = profiles.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Profile not found' })
  const b = req.body || {}
  if (b.name !== undefined) p.name = String(b.name)
  if (b.description !== undefined) p.description = String(b.description)
  if (b.exe !== undefined) p.exe = String(b.exe)
  if (b.env !== undefined) p.env = String(b.env)
  if (Array.isArray(b.args)) p.args = b.args
  p.updatedAt = Date.now()
  store.saveProfiles(profiles)
  res.json(p)
})

app.delete('/api/profiles/:id', (req, res) => {
  if (runner.get(req.params.id)) {
    return res.status(409).json({ error: 'Profile is running, stop it first' })
  }
  const profiles = store.loadProfiles()
  const i = profiles.findIndex(x => x.id === req.params.id)
  if (i < 0) return res.status(404).json({ error: 'Profile not found' })
  const [removed] = profiles.splice(i, 1)
  store.saveProfiles(profiles)
  res.json({ ok: true, removed: removed.name })
})

// ---------- 运行控制 ----------
app.post('/api/profiles/:id/start', async (req, res) => {
  const profiles = store.loadProfiles()
  const p = profiles.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Profile not found' })
  try {
    const run = await runner.start(p)
    res.json(run)
  } catch (err) {
    res.status(409).json({ error: err.message })
  }
})

app.post('/api/runs/:id/stop', async (req, res) => {
  try {
    await runner.stop(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/runs', (req, res) => {
  res.json(runner.list())
})

app.get('/api/runs/:id/log', (req, res) => {
  const after = Number(req.query.after || 0)
  res.json(runner.logCatchUp(req.params.id, after))
})

app.get('/api/runs/:id/logfile', (req, res) => {
  const run = runner.get(req.params.id)
  const file = run ? run.logFile : null
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Log file not found' })
  res.download(file, path.basename(file))
})

// ---------- 导入 / 导出 ----------
app.post('/api/import', (req, res) => {
  const b = req.body || {}
  let text = b.text
  if (!text && b.path) {
    try { text = fs.readFileSync(b.path, 'utf8') }
    catch (err) { return res.status(400).json({ error: 'Failed to read file: ' + err.message }) }
  }
  if (!text) return res.status(400).json({ error: 'Provide text or path' })

  const items = P.importTxt(text)
  const profiles = store.loadProfiles()
  const defaultExe = store.loadSettings().exe
  const withDefaultExe = (p) => p.exe ? p : { ...p, exe: defaultExe }
  const existingCmds = new Set(profiles.map(p => P.generateCommand(withDefaultExe(p))))
  let added = 0, skipped = 0, failed = 0
  const now = Date.now()
  for (const item of items) {
    if (item.error) { failed++; continue }
    const cmd = P.generateCommand(withDefaultExe(item))
    if (existingCmds.has(cmd)) { skipped++; continue }
    existingCmds.add(cmd)
    profiles.push({
      id: store.newId(),
      name: item.name,
      description: item.description,
      exe: item.exe,
      args: item.args,
      env: item.env || '',
      createdAt: now,
      updatedAt: now
    })
    added++
  }
  store.saveProfiles(profiles)
  res.json({ added, skipped, failed, total: profiles.length })
})

app.get('/api/export', (req, res) => {
  // exe 为空的配置导出时回退默认路径，保证导出文件可直接执行
  const defaultExe = store.loadSettings().exe
  const text = P.exportTxt(store.loadProfiles().map(p => p.exe ? p : { ...p, exe: defaultExe }))
  res.type('text/plain; charset=utf-8')
  res.attachment('llama-server.txt')
  res.send(text)
})

// ---------- 字段元数据（前端表单渲染） ----------
app.get('/api/fields', (req, res) => {
  const fields = Object.entries(P.FIELDS).map(([name, def]) => ({
    name,
    canonical: def.canonical,
    aliases: def.aliases,
    takesValue: def.takesValue,
    type: def.type || 'string',
    ...(P.FIELD_META[name] || { label: name, group: 'other' })
  }))
  res.json({ fields, groups: P.GROUPS })
})

// ---------- 单条命令解析（表单"粘贴命令"用） ----------
app.post('/api/parse', (req, res) => {
  const line = String((req.body || {}).command || '').trim()
  if (!line) return res.status(400).json({ error: 'Provide command' })
  try {
    const { exe, args } = P.parseCommand(line)
    res.json({ exe, args, fields: P.fieldsOf(args) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ---------- 健康检查（服务端代理，避免浏览器 CORS） ----------
app.get('/api/health-check', async (req, res) => {
  const host = String(req.query.host || '127.0.0.1')
  const port = Number(req.query.port || 8080)
  const url = `http://${host}:${port}/health`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const resp = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    res.json({ online: true, health: resp.ok, status: resp.status })
  } catch {
    // /health 不可达：降级为 TCP 端口探测
    const { portInUse } = require('./runner')
    const busy = await portInUse(port, host === '0.0.0.0' ? '127.0.0.1' : host)
    res.json({ online: busy, health: false, status: null })
  }
})

// ---------- 模型目录浏览（路径自动补全） ----------
/** 递归收集目录下全部 .gguf（含子目录） */
function walkGguf(dir, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkGguf(full, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) out.push(full.replace(/\//g, '\\'))
  }
}
app.get('/api/browse', (req, res) => {
  const dir = String(req.query.dir || '')
  if (!dir) return res.json({ files: [] })
  const files = []
  if (String(req.query.recursive) === '1') {
    walkGguf(dir, files)
  } else {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) files.push(path.join(dir, e.name).replace(/\//g, '\\'))
      }
    } catch {
      return res.json({ files: [], error: 'Directory not readable' })
    }
  }
  res.json({ files })
})

// ---------- GPU 用量（nvidia-smi，前端轮询） ----------
app.get('/api/gpus', (req, res) => {
  const { execFile } = require('child_process')
  execFile('nvidia-smi', [
    '--query-gpu=index,utilization.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits'
  ], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
    if (err) return res.json({ gpus: [] }) // 无 nvidia-smi / 无 NVIDIA 显卡：返回空
    const gpus = String(stdout).trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [index, util, memUsedMiB, memTotalMiB] = line.split(',').map(s => s.trim())
      const used = Number(memUsedMiB) || 0, total = Number(memTotalMiB) || 0
      return {
        index: Number(index),
        util: Number(util) || 0,
        memPct: total ? Math.round(used / total * 100) : 0,
        memUsedGb: Math.round(used / 1024 * 100) / 100 // MiB → GB，保留两位小数
      }
    })
    res.json({ gpus })
  })
})

// ---------- 设置 ----------
app.get('/api/settings', (req, res) => {
  res.json(store.loadSettings())
})

app.put('/api/settings', (req, res) => {
  const cur = store.loadSettings()
  const b = req.body || {}
  const next = { ...cur }
  if (b.exe !== undefined) next.exe = String(b.exe)
  if (b.logKeep !== undefined) next.logKeep = Math.max(1, Number(b.logKeep) || 1)
  store.saveSettings(next)
  res.json(next)
})

// ---------- 静态前端 ----------
const distDir = path.join(ROOT, 'web', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api|\/ws).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
} else {
  app.get('/', (req, res) => res.send('Frontend not built, run: npm run build'))
}

// ---------- 启动 ----------
const listening = new Promise((resolve, reject) => {
  server.once('listening', resolve)
  server.once('error', reject)
  // ws 会把 http server 的 error 转发到 wss（websocket-server.js addListeners），
  // wss 上无监听器会触发未处理 'error' 崩溃；此处统一处理
  wss.on('error', (err) => {
    if (!server.listening) reject(err) // 启动失败（promise 若已 reject 则为 no-op）
    else console.error(`[llamacpp-manage] 服务错误: ${err.message}`)
  })
})
// 独立运行时（无人 await）端口冲突等错误在此兜底：打印并以非零码退出
listening.catch(err => {
  console.error(`[llamacpp-manage] 服务启动失败: ${err.message}`)
  process.exitCode = 1
})
server.listen(PORT, () => {
  console.log(`[llamacpp-manage] 服务已启动: http://localhost:${PORT}`)
  if (!process.env.NO_BROWSER) {
    try {
      spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true, detached: true }).unref()
    } catch { /* 忽略 */ }
  }
})

// ---------- 退出清理（Electron 主进程调用；独立运行时亦可复用） ----------
/** 按 PID 精确终止全部实例（含失联），再关闭 WS 与 HTTP 服务 */
async function shutdown() {
  const { killByPid, isPidAlive } = require('./runner')
  for (const view of runner.list()) {
    const run = runner.get(view.profileId)
    if (run && run.child) {
      try { run.child.kill() } catch { /* 已退出 */ }
    }
    if (isPidAlive(view.pid)) killByPid(view.pid) // taskkill /F /T，同步、覆盖进程树
    if (run) runner._finish(run, null)
  }
  wss.close()
  server.close()
}

module.exports = { shutdown, getPort: () => PORT, listening }
