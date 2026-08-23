'use strict'
/**
 * dummy.js — 哑进程：模拟 llama-server 的日志输出并真实绑定端口（不加载模型）
 * 用法: node test/dummy.js <port>
 * 对任意 HTTP 请求返回 200（模拟 /health）。
 */
const net = require('net')
const port = Number(process.argv[2] || 8091)

console.log(`dummy: starting pid=${process.pid}`)
console.log('llama_model_loader: loaded weights')
console.log('  - n_gpu_layers      = 99')
console.log('llama_context: n_ctx = 4096')
console.log('slot [0]: load time = 1234.56 ms')

const srv = net.createServer((sock) => {
  sock.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
})
srv.on('error', (e) => {
  console.error(`dummy: port bind error: ${e.message}`)
  process.exit(1)
})
srv.listen(port, '127.0.0.1', () => {
  console.log(`server: listening on http://127.0.0.1:${port}`)
})

let tick = 0
setInterval(() => {
  tick++
  console.log(`dummy: tick ${tick}`)
  if (tick % 3 === 0) console.log('dummy: warning: simulated warn line')
}, 1000)

process.on('SIGTERM', () => {
  console.log('dummy: SIGTERM received, exiting')
  process.exit(0)
})
