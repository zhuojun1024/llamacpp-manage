'use strict'
/**
 * store.js — JSON 文件存储（profiles / settings / runtime）
 * 写入采用 tmp+rename 原子替换，避免半写文件。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
// 支持环境变量覆盖（测试隔离用）
const DATA_DIR = process.env.LLAMA_MANAGE_DATA || path.join(ROOT, 'data')
const LOGS_DIR = process.env.LLAMA_MANAGE_LOGS || path.join(ROOT, 'logs')

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }) }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file))
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

const DEFAULT_SETTINGS = {
  exe: 'C:\\llama\\llama-server.exe', // 默认 llama-server 路径
  port: 8787,                        // 本管理服务端口
  logKeep: 20,                       // 每个配置保留的日志份数
  modelDir: 'D:\\LLM'                // 模型目录（路径自动补全扫描范围）
}

class Store {
  constructor() {
    ensureDir(DATA_DIR)
    ensureDir(LOGS_DIR)
    this.profilesFile = path.join(DATA_DIR, 'profiles.json')
    this.settingsFile = path.join(DATA_DIR, 'settings.json')
    this.runtimeFile = path.join(DATA_DIR, 'runtime.json')
  }

  loadProfiles() { return readJson(this.profilesFile, []) }
  saveProfiles(list) { writeJson(this.profilesFile, list) }

  loadSettings() { return Object.assign({}, DEFAULT_SETTINGS, readJson(this.settingsFile, {})) }
  saveSettings(s) { writeJson(this.settingsFile, s) }

  loadRuntime() { return readJson(this.runtimeFile, { runs: {} }) }
  saveRuntime(r) { writeJson(this.runtimeFile, r) }

  newId() { return crypto.randomBytes(6).toString('hex') }

  logFile(profileId, ts) {
    const stamp = new Date(ts).toISOString().replace(/[-:T]/g, '').slice(0, 15)
    return path.join(LOGS_DIR, `run-${profileId}-${stamp}.log`)
  }

  /** 清理某配置超出保留份数的旧日志 */
  pruneLogs(profileId, keep) {
    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith(`run-${profileId}-`) && f.endsWith('.log'))
      .sort()
    for (const f of files.slice(0, Math.max(0, files.length - keep))) {
      try { fs.unlinkSync(path.join(LOGS_DIR, f)) } catch { /* 忽略 */ }
    }
  }
}

module.exports = { Store, ROOT, DATA_DIR, LOGS_DIR, DEFAULT_SETTINGS }
