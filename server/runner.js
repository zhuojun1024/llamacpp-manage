'use strict'
/**
 * runner.js — 子进程生命周期管理（启动 / 日志流 / 停止 / 恢复）
 *
 * 安全红线（最高优先级）：
 *  - 只记录、只操作本管理器自己 spawn 的子进程 PID，或 runtime.json 中
 *    本管理器历史上记录过的 PID；
 *  - 停止一律按 PID 精确终止（child.kill() 或 taskkill /F /T /PID <pid>）；
 *  - 绝不按进程名扫描/批量杀（taskkill /IM）——机器上可能存在与本管理器
 *    无关的 llama.cpp 进程（例如正在服务 AI 会话的进程），误杀后果不可逆。
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const net = require('net')
const { LOGS_DIR } = require('./store')
const { fieldsOf, generateCommand, tokenize } = require('./parser')

const LOG_RING = 5000 // 每个 run 内存中保留的最近行数（WS 断线补拉用）

/** 日志行分类：error / warn / ready / normal */
function classify(line) {
  const l = line.toLowerCase()
  if (/\b(error|fatal|failed|exception|segfault|core dump|aborting)\b/.test(l)) return 'error'
  if (/\bwarn(ing)?\b/.test(l)) return 'warn'
  if (/listening on http/.test(l)) return 'ready'
  return 'normal'
}

/** 从日志行提取关键信息（best-effort，容忍版本差异） */
function extractKeyInfo(line, info) {
  let m
  if ((m = line.match(/listening on http:\/\/([^:/\s]+):(\d+)/))) {
    info.listenHost = m[1]; info.listenPort = m[2]
  }
  if ((m = line.match(/load time\s*=\s*([\d.]+)\s*ms/))) info.loadTimeMs = m[1]
  if ((m = line.match(/n_ctx\s*=\s*(\d+)/))) info.nCtx = m[1]
  if ((m = line.match(/n_gpu_layers\s*=\s*(\d+)/))) info.nGpuLayers = m[1]
  if ((m = line.match(/model size\s*=\s*([\d.]+)\s*[GMK]B/))) info.modelSize = m[1] + ' B'
  return info
}

/** PID 是否存活（仅探测，不发送信号） */
function isPidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/** 端口是否被占用 */
function portInUse(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(true))
    srv.listen(port, host, () => srv.close(() => resolve(false)))
  })
}

/** 按 PID 精确终止进程树（仅用于 runtime.json 中记录过的 PID） */
function killByPid(pid) {
  const r = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
    windowsHide: true, encoding: 'utf8'
  })
  return r.status === 0 || /SUCCESS|成功/i.test(r.stdout || '')
}

class Runner {
  constructor(store, broadcast) {
    this.store = store
    this.broadcast = broadcast // (event) => void
    this.runs = new Map() // profileId -> run
    this._restore()
  }

  /** 管理器重启后恢复：PID 存活 → lost（可停止、无日志流）；已死 → 移除记录 */
  _restore() {
    const rt = this.store.loadRuntime()
    for (const rec of Object.values(rt.runs || {})) {
      const alive = isPidAlive(rec.pid)
      if (!alive) continue
      this.runs.set(rec.profileId, {
        profileId: rec.profileId,
        pid: rec.pid,
        port: rec.port,
        startedAt: rec.startedAt,
        logFile: rec.logFile,
        status: 'lost', // 失联：进程在跑但不是本进程 spawn 的，无日志流
        child: null,
        keyInfo: {},
        lines: []
      })
    }
    this._persist()
  }

  _persist() {
    const runs = {}
    for (const run of this.runs.values()) {
      runs[run.profileId] = {
        profileId: run.profileId, pid: run.pid, port: run.port,
        startedAt: run.startedAt, logFile: run.logFile
      }
    }
    this.store.saveRuntime({ runs })
  }

  list() {
    return [...this.runs.values()].map(r => ({
      profileId: r.profileId, pid: r.pid, port: r.port,
      startedAt: r.startedAt, status: r.status, keyInfo: r.keyInfo,
      logFile: r.logFile
    }))
  }

  get(profileId) { return this.runs.get(profileId) }

  /** 启动一个 profile；同时只允许运行一个模型；端口被占则抛错 */
  async start(profile) {
    const existing = this.runs.get(profile.id)
    if (existing) throw new Error('该配置已有运行中的实例（' + existing.status + '）')
    if (this.runs.size > 0) {
      const other = [...this.runs.values()][0]
      const name = (this.store.loadProfiles().find(x => x.id === other.profileId) || {}).name || other.profileId
      throw new Error(`已有模型「${name}」在运行，每次只能运行一个模型，请先停止`)
    }

    const f = fieldsOf(profile.args)
    const port = f.port ? Number(f.port) : 8080
    const host = f.host || '127.0.0.1'
    if (await portInUse(port)) {
      throw new Error(`端口 ${port} 已被占用，请修改该配置的端口后重试`)
    }

    // 由 args 条目重建 argv（不经过 shell，避免引号歧义）
    const argv = []
    for (const e of profile.args) {
      if (e.raw) { for (const t of tokenize(e.raw)) argv.push(t.text) }
      else {
        argv.push(e.flag)
        if (e.value !== undefined && e.value !== null && e.value !== '') argv.push(e.value)
      }
    }

    const now = Date.now()
    const logFile = this.store.logFile(profile.id, now)
    this.store.pruneLogs(profile.id, this.store.loadSettings().logKeep)
    const logStream = fs.createWriteStream(logFile, { flags: 'a' })

    let child
    try {
      child = spawn(profile.exe, argv, {
        cwd: require('path').dirname(profile.exe),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      logStream.end()
      throw new Error('启动失败：' + err.message)
    }

    const run = {
      profileId: profile.id,
      pid: child.pid,
      port,
      startedAt: now,
      logFile,
      status: 'starting',
      child,
      keyInfo: {},
      lines: [],
      _buf: ''
    }
    this.runs.set(profile.id, run)
    this._persist()

    const onData = (buf) => this._onData(run, buf.toString('utf8'))
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    child.on('error', (err) => {
      this._appendLine(run, `[管理器] 进程错误：${err.message}`, 'error')
      this._finish(run, -1)
    })
    child.on('exit', (code, signal) => {
      this._appendLine(run, `[管理器] 进程已退出 code=${code} signal=${signal || '-'}`, code === 0 ? 'normal' : 'error')
      this._finish(run, code)
    })

    this.broadcast({ type: 'status', run: this._view(run) })
    return this._view(run)
  }

  _onData(run, chunk) {
    run._buf += chunk
    let idx
    while ((idx = run._buf.indexOf('\n')) >= 0) {
      const line = run._buf.slice(0, idx).replace(/\r$/, '')
      if (line !== '') this._appendLine(run, line, classify(line))
      run._buf = run._buf.slice(idx + 1)
    }
    if (run._buf.length > 65536) run._buf = '' // 防御：无换行的超长输出
  }

  _appendLine(run, line, level) {
    extractKeyInfo(line, run.keyInfo)
    try { require('fs').appendFileSync(run.logFile, line + '\n') } catch { /* 文件句柄异常不阻塞 */ }
    run.lines.push({ line, level, ts: Date.now() })
    if (run.lines.length > LOG_RING) run.lines.splice(0, run.lines.length - LOG_RING)
    this.broadcast({ type: 'log', profileId: run.profileId, line, level, ts: Date.now() })
    if (level === 'ready' && run.status === 'starting') {
      run.status = 'running'
      this._persist()
      this.broadcast({ type: 'status', run: this._view(run) })
    }
  }

  _finish(run, code) {
    if (run.child) {
      run.child.stdout.removeAllListeners('data')
      run.child.stderr.removeAllListeners('data')
    }
    this.runs.delete(run.profileId)
    this._persist()
    this.broadcast({ type: 'exit', profileId: run.profileId, code })
  }

  /** 停止：仅按已记录 PID 精确终止 */
  async stop(profileId) {
    const run = this.runs.get(profileId)
    if (!run) throw new Error('没有运行中的实例')
    const pid = run.pid
    if (run.child) {
      try { run.child.kill() } catch { /* 已退出 */ }
      // 兜底：若 2 秒后仍存活（Windows 上 kill 仅作用于该 PID），按 PID 精确终止
      setTimeout(() => {
        if (isPidAlive(pid)) killByPid(pid)
      }, 2000).unref()
    } else {
      // lost 进程：无 ChildProcess 句柄，按 runtime.json 记录的 PID 精确终止
      const ok = killByPid(pid)
      if (!ok) throw new Error(`taskkill 未能终止 PID ${pid}（可能已退出或权限不足）`)
      this._finish(run, null)
    }
    return true
  }

  /** 日志补拉（WS 断线恢复） */
  logCatchUp(profileId, afterTs = 0) {
    const run = this.runs.get(profileId)
    if (!run) return []
    return run.lines.filter(l => l.ts > afterTs)
  }

  _view(run) {
    return {
      profileId: run.profileId, pid: run.pid, port: run.port,
      startedAt: run.startedAt, status: run.status, keyInfo: run.keyInfo,
      logFile: run.logFile
    }
  }
}

module.exports = { Runner, classify, extractKeyInfo, isPidAlive, portInUse, killByPid }
