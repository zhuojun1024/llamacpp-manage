'use strict'
/**
 * 解析往返测试：逐行解析真实 llama-server.txt 的命令行 → 重新生成 → token 级 diff
 * 通过标准：每条命令的 token 序列（含引号标记）与原命令完全一致（空白归一为单空格）
 * 另验证 importTxt 的命名/描述提取。
 */
const fs = require('fs')
const P = require('../server/parser')

const FILE = process.argv[2] || 'C:\\Users\\zhuojun\\llama-server.txt'
const text = fs.readFileSync(FILE, 'utf8')

// ---------- 1. 逐行往返 ----------
let commands = 0, failed = 0
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  commands++
  let parsed
  try {
    parsed = P.parseCommand(line)
  } catch (err) {
    failed++
    console.error(`[FAIL] 解析异常: ${line}\n       ${err.message}`)
    continue
  }
  const regen = P.generateCommand(parsed)
  const mark = (t) => (t.quoted ? '"' : '') + t.text + (t.quoted ? '"' : '')
  const before = P.tokenize(line).map(mark)
  const after = P.tokenize(regen).map(mark)
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    failed++
    console.error(`[FAIL] ${parsed.exe.split(/[\\/]/).pop()}`)
    console.error(`  原: ${line}`)
    console.error(`  新: ${regen}`)
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (before[i] !== after[i]) {
        console.error(`  首个差异 token[${i}]: 原=${JSON.stringify(before[i])} 新=${JSON.stringify(after[i])}`)
        break
      }
    }
  } else {
    console.log(`[OK] token 级一致（${before.length} tokens）`)
  }
}

// ---------- 2. importTxt 命名/描述 ----------
const items = P.importTxt(text)
const errs = items.filter(i => i.error)
console.log(`\nimportTxt: ${items.length - errs.length} 条配置, ${errs.length} 条错误`)
for (const it of items) {
  if (it.error) console.error(`  [FAIL] ${it.error}: ${it.message}`)
  else console.log(`  ${it.name}  ←  ${it.description || '(无描述)'}`)
}
const named = items.filter(i => !i.error && i.name && i.name !== '未命名')
if (named.length !== items.length - errs.length) {
  console.error('[FAIL] 存在未正确命名的配置')
  failed++
}

console.log(`\n共 ${commands} 条命令，${failed} 处不一致${failed ? '（失败 ✗）' : '（全部通过 ✓）'}`)
process.exit(failed ? 1 : 0)
