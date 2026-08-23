'use strict'
/**
 * smoke-electron.js — 验证 server/index.js 的 shutdown() 导出（Electron 关闭即终止链路）
 *
 * 使用隔离数据目录（临时目录），绝不触碰真实 data/ 与机器上运行中的进程：
 *  1. 启动一个哑子进程（cmd → ping），模拟 runtime.json 中记录的历史实例
 *  2. 启动服务，确认该实例被恢复为 lost
 *  3. 调用 shutdown()，确认哑子进程被 taskkill /F /T 终止
 */
process.env.NO_BROWSER = '1'
process.env.PORT = '18787'

const os = require('os')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')

const base = path.join(os.tmpdir(), `llama-smoke-${process.pid}`)
process.env.LLAMA_MANAGE_DATA = path.join(base, 'data')
process.env.LLAMA_MANAGE_LOGS = path.join(base, 'logs')

function pidAlive(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true, encoding: 'utf8' })
    return out.includes(`"${pid}"`)
  } catch { return false }
}

async function main() {
  // 1. 哑子进程（cmd 拉起 ping，验证 /T 进程树终止）
  const dummy = spawn('cmd', ['/c', 'ping', '-n', '300', '127.0.0.1'], { windowsHide: true })
  await new Promise((r, j) => { dummy.on('spawn', r); dummy.on('error', j) })
  const dummyPid = dummy.pid
  console.log('[1] 哑子进程 PID:', dummyPid)

  // 2. 写入隔离 runtime.json
  fs.mkdirSync(process.env.LLAMA_MANAGE_DATA, { recursive: true })
  fs.writeFileSync(
    path.join(process.env.LLAMA_MANAGE_DATA, 'runtime.json'),
    JSON.stringify({ runs: { smoke: { profileId: 'smoke', pid: dummyPid, port: 18080, startedAt: Date.now(), logFile: '' } } }, null, 2)
  )

  // 3. 启动服务
  const m = require('../server/index.js')
  await m.listing
  console.log('[2] 服务已监听端口', m.getPort())

  const runs = await (await fetch(`http://localhost:${m.getPort()}/api/runs`)).json()
  console.log('[3] runs:', JSON.stringify(runs))
  if (!runs.some(r => r.pid === dummyPid && r.status === 'lost')) {
    throw new Error('lost 实例未正确恢复')
  }

  // 4. shutdown
  await m.shutdown()
  await new Promise(r => setTimeout(r, 800))

  // 5. 断言
  if (pidAlive(dummyPid)) {
    throw new Error(`shutdown 后哑子进程 ${dummyPid} 仍存活`)
  }
  console.log('[4] shutdown 后哑子进程已终止 ✓')
  console.log('PASS')
  fs.rmSync(base, { recursive: true, force: true })
  process.exit(0)
}

main().catch(err => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
