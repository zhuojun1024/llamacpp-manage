'use strict'
/**
 * integration.js — 集成测试（哑进程全链路，不碰真实 llama-server）
 * 流程：启动服务 → REST/WS/静态检查 → 导入 → 启动哑进程 → 日志流/关键信息/落盘
 *       → 端口冲突 409 → 停止 → 进程确已退出 → 关闭服务
 * 用法: node test/integration.js
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { WebSocket } = require('ws')

const ROOT = path.join(__dirname, '..')
const PORT = 8799 // 测试专用端口，避开 8787
const DUMMY_PORT = 8091
const BASE = `http://127.0.0.1:${PORT}`
// 隔离的数据/日志目录（不污染真实 data/）
const TEST_DATA = path.join(ROOT, '.test-data')
const TEST_LOGS = path.join(ROOT, '.test-logs')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  [OK] ${name}`) }
  else { failed++; console.error(`  [FAIL] ${name} ${extra}`) }
}
async function getJson(u) {
  const r = await fetch(BASE + u)
  return { status: r.status, body: await r.json().catch(() => null) }
}
async function postJson(u, body) {
  const r = await fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  // 清理上次的测试数据目录
  for (const d of [TEST_DATA, TEST_LOGS]) {
    fs.rmSync(d, { recursive: true, force: true })
  }
  console.log('== 启动服务 ==')
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env, NO_BROWSER: '1', PORT: String(PORT),
      LLAMA_MANAGE_DATA: TEST_DATA, LLAMA_MANAGE_LOGS: TEST_LOGS
    },
    windowsHide: true
  })
  let serverOut = ''
  server.stdout.on('data', d => { serverOut += d.toString() })
  server.stderr.on('data', d => { serverOut += d.toString() })

  // 等待服务就绪
  let ready = false
  for (let i = 0; i < 50; i++) {
    await sleep(200)
    try { await fetch(BASE + '/api/settings'); ready = true; break } catch { /* 未就绪 */ }
  }
  ok('服务启动', ready, serverOut)
  if (!ready) { server.kill(); process.exit(1) }

  try {
    console.log('== 基础 API ==')
    const settings = await getJson('/api/settings')
    ok('GET /api/settings', settings.status === 200 && settings.body && settings.body.exe)

    const fields = await getJson('/api/fields')
    ok('GET /api/fields (≥30 字段)', fields.status === 200 && fields.body.fields.length >= 30,
      `实际 ${fields.body && fields.body.fields.length}`)

    const staticResp = await fetch(BASE + '/')
    const staticHtml = await staticResp.text()
    ok('静态首页 200 且含 app 容器', staticResp.status === 200 && staticHtml.includes('id="app"'))

    console.log('== 导入 ==')
    const txt = fs.readFileSync('C:\\Users\\zhuojun\\llama-server.txt', 'utf8')
    const imp = await postJson('/api/import', { text: txt })
    ok('导入 19 条', imp.status === 200 && imp.body.added === 19, JSON.stringify(imp.body))

    const imp2 = await postJson('/api/import', { text: txt })
    ok('重复导入全部跳过', imp2.status === 200 && imp2.body.added === 0 && imp2.body.skipped === 19, JSON.stringify(imp2.body))

    const profiles = await getJson('/api/profiles')
    ok('配置列表 19 条且均无 run', profiles.body.length === 19 && profiles.body.every(p => p.run === null))

    const exp = await fetch(BASE + '/api/export')
    const expText = await exp.text()
    ok('导出含 19 条命令', exp.status === 200 && expText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length === 19)

    const parse = await postJson('/api/parse', { command: 'C:\\llama\\llama-server.exe -m "D:\\LLM\\x.gguf" -ngl 99 --temp 0.7' })
    ok('单条解析', parse.status === 200 && parse.body.fields.model === 'D:\\LLM\\x.gguf' && parse.body.fields.nGpuLayers === '99')

    console.log('== 启动哑进程 ==')
    const dummyPath = path.join(ROOT, 'test', 'dummy.js').replace(/\//g, '\\')
    const created = await postJson('/api/profiles', {
      name: 'dummy-test', exe: process.execPath,
      args: [{ raw: dummyPath }, { raw: String(DUMMY_PORT) }, { flag: '--port', value: String(DUMMY_PORT) }]
    })
    ok('创建哑配置', created.status === 200 && created.body.id)
    const pid = created.body.id

    const started = await postJson(`/api/profiles/${pid}/start`)
    ok('启动成功', started.status === 200 && started.body.pid, JSON.stringify(started.body))
    const childPid = started.body && started.body.pid

    // 等待 ready（listening 行触发）
    let run = null
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      const runs = await getJson('/api/runs')
      run = runs.body.find(r => r.profileId === pid)
      if (run && run.status === 'running') break
    }
    ok('状态转 running', run && run.status === 'running', JSON.stringify(run))
    ok('关键信息提取 (listenPort/nCtx/loadTime)', run &&
      run.keyInfo.listenPort === String(DUMMY_PORT) && run.keyInfo.nCtx === '4096' && run.keyInfo.loadTimeMs === '1234.56',
      JSON.stringify(run && run.keyInfo))

    console.log('== WebSocket 日志流 ==')
    const wsEvents = []
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    ws.on('message', (d) => {
      try { wsEvents.push(JSON.parse(d.toString())) } catch { /* 忽略 */ }
    })
    // 动态等待：直到收到 ≥2 条日志且含 1 条 warn（最多 12s）
    const t0 = Date.now()
    while (Date.now() - t0 < 12000) {
      const lg = wsEvents.filter(e => e.type === 'log')
      if (lg.length >= 2 && lg.some(e => e.level === 'warn')) break
      await sleep(300)
    }
    ws.close()
    const hello = wsEvents.find(e => e.type === 'hello')
    const logs = wsEvents.filter(e => e.type === 'log')
    const warnLine = logs.find(e => e.level === 'warn')
    ok('WS hello 含 runs', hello && Array.isArray(hello.runs))
    ok('WS 收到日志行', logs.length >= 2, `实际 ${logs.length}`)
    ok('WS warn 行分类', !!warnLine)

    const catchUp = await getJson(`/api/runs/${pid}/log?after=0`)
    ok('日志补拉 API', catchUp.status === 200 && catchUp.body.length >= 2, `实际 ${catchUp.body && catchUp.body.length}`)
    // ready 行在 WS 连接前打印，经补拉 API 验证其分类
    ok('ready 行分类（补拉）', catchUp.body.some(l => l.level === 'ready'))

    const logFiles = fs.readdirSync(TEST_LOGS).filter(f => f.startsWith(`run-${pid}-`))
    ok('日志落盘', logFiles.length === 1)
    if (logFiles.length) {
      const logContent = fs.readFileSync(path.join(TEST_LOGS, logFiles[0]), 'utf8')
      ok('日志内容含 listening 行', logContent.includes(`listening on http://127.0.0.1:${DUMMY_PORT}`))
    } else {
      ok('日志内容含 listening 行', false, '无日志文件')
    }

    console.log('== 端口冲突 ==')
    const created2 = await postJson('/api/profiles', {
      name: 'dummy-conflict', exe: process.execPath,
      args: [{ raw: dummyPath }, { raw: String(DUMMY_PORT) }, { flag: '--port', value: String(DUMMY_PORT) }]
    })
    const conflict = await postJson(`/api/profiles/${created2.body.id}/start`)
    ok('同端口启动返回 409', conflict.status === 409, JSON.stringify(conflict.body))
    // 清理冲突配置
    await fetch(BASE + `/api/profiles/${created2.body.id}`, { method: 'DELETE' })

    console.log('== 健康检查（降级 TCP） ==')
    const hc = await getJson(`/api/health-check?host=127.0.0.1&port=${DUMMY_PORT}`)
    ok('哑进程端口 TCP 可达 → online', hc.status === 200 && hc.body.online === true, JSON.stringify(hc.body))

    console.log('== 停止 ==')
    const stop = await postJson(`/api/runs/${pid}/stop`)
    ok('停止指令成功', stop.status === 200, JSON.stringify(stop.body))
    let gone = false
    for (let i = 0; i < 20; i++) {
      await sleep(300)
      const runs = await getJson('/api/runs')
      if (!runs.body.find(r => r.profileId === pid)) { gone = true; break }
    }
    ok('run 记录已移除', gone)
    // 确认进程确已退出（按 PID 探测，不发信号）
    let alive = false
    if (childPid) { try { process.kill(childPid, 0); alive = true } catch { alive = false } }
    ok('哑进程已退出', !alive)

    const hc2 = await getJson(`/api/health-check?host=127.0.0.1&port=${DUMMY_PORT}`)
    ok('停止后端口不可达', hc2.body.online === false, JSON.stringify(hc2.body))

    // 清理哑配置
    await fetch(BASE + `/api/profiles/${pid}`, { method: 'DELETE' })
  } finally {
    server.kill()
    await sleep(300)
    for (const d of [TEST_DATA, TEST_LOGS]) {
      fs.rmSync(d, { recursive: true, force: true })
    }
  }

  console.log(`\n集成测试：${passed} 通过，${failed} 失败 ${failed ? '✗' : '✓'}`)
  process.exit(failed ? 1 : 0)
}

main().catch(err => {
  console.error('测试异常：', err)
  process.exit(1)
})
