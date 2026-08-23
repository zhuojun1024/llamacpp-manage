'use strict'
/**
 * parser.js — 命令行分词 / flag↔字段映射 / txt 导入 / 命令生成
 *
 * 无损设计：profile.args 是"有序参数条目"数组，保留原始 flag 拼写、引号与顺序：
 *   已知 flag → { flag: '-m', value: 'D:\\...gguf', quoted: true }
 *   未知 flag → { raw: '--foo bar' }（原样保留，含其取值）
 * 结构化字段（model/alias/ctxSize...）是从 args 派生的视图，供表单读写。
 * 重新生成命令时按 args 原顺序输出，保证"导入 → 生成"token 级完全一致
 * （空白统一为单空格，不影响命令语义）。
 */

// field → { canonical, aliases, takesValue, type }
// canonical 为表单新增参数时使用的拼写（贴合用户书写习惯：常用短 flag）
const FIELDS = {
  model:            { canonical: '-m',  aliases: ['-m', '--model'],            takesValue: true },
  alias:            { canonical: '-a',  aliases: ['-a', '--alias'],            takesValue: true },
  mmproj:           { canonical: '-mm', aliases: ['-mm', '--mmproj'],          takesValue: true },
  draftModel:       { canonical: '-md', aliases: ['-md', '--draft-model'],     takesValue: true },
  nGpuLayers:       { canonical: '-ngl', aliases: ['-ngl', '--n-gpu-layers'],  takesValue: true, type: 'int' },
  ctxSize:          { canonical: '-c',  aliases: ['-c', '--ctx-size'],         takesValue: true, type: 'int' },
  flashAttn:        { canonical: '-fa', aliases: ['-fa', '--flash-attn'],      takesValue: true },
  cacheTypeK:       { canonical: '-ctk', aliases: ['-ctk', '--cache-type-k'],  takesValue: true },
  cacheTypeV:       { canonical: '-ctv', aliases: ['-ctv', '--cache-type-v'],  takesValue: true },
  splitMode:        { canonical: '-sm', aliases: ['-sm', '--split-mode'],      takesValue: true },
  tensorSplit:      { canonical: '-ts', aliases: ['-ts', '--tensor-split'],    takesValue: true },
  cacheRam:         { canonical: '-cram', aliases: ['-cram', '--cache-ram'],   takesValue: true, type: 'int' },
  kvUnswap:         { canonical: '-kvu', aliases: ['-kvu', '--kv-unswap'],     takesValue: false },
  noMmap:           { canonical: '--no-mmap', aliases: ['--no-mmap'],          takesValue: false },
  parallel:         { canonical: '-np', aliases: ['-np', '--parallel'],        takesValue: true, type: 'int' },
  batchSize:        { canonical: '-b',  aliases: ['-b', '--batch'],            takesValue: true, type: 'int' },
  ubatchSize:       { canonical: '-ub', aliases: ['-ub', '--ubatch'],          takesValue: true, type: 'int' },
  threads:          { canonical: '-t',  aliases: ['-t', '--threads'],          takesValue: true, type: 'int' },
  temp:             { canonical: '--temp', aliases: ['--temp'],                takesValue: true, type: 'float' },
  topK:             { canonical: '--top-k', aliases: ['--top-k'],              takesValue: true, type: 'int' },
  topP:             { canonical: '--top-p', aliases: ['--top-p'],              takesValue: true, type: 'float' },
  repeatPenalty:    { canonical: '--repeat-penalty', aliases: ['--repeat-penalty'], takesValue: true, type: 'float' },
  specType:         { canonical: '--spec-type', aliases: ['--spec-type'],      takesValue: true },
  specDraftNMax:    { canonical: '--spec-draft-n-max', aliases: ['--spec-draft-n-max'], takesValue: true, type: 'int' },
  specDraftPMin:    { canonical: '--spec-draft-p-min', aliases: ['--spec-draft-p-min'], takesValue: true, type: 'float' },
  jinja:            { canonical: '--jinja', aliases: ['--jinja'],              takesValue: false },
  chatTemplateFile: { canonical: '--chat-template-file', aliases: ['--chat-template-file'], takesValue: true },
  reasoningEffort:  { canonical: '--reasoning-effort', aliases: ['--reasoning-effort'], takesValue: true },
  ropeScaling:      { canonical: '--rope-scaling', aliases: ['--rope-scaling'], takesValue: true },
  ropeScale:        { canonical: '--rope-scale', aliases: ['--rope-scale'],    takesValue: true, type: 'float' },
  yarnOrigCtx:      { canonical: '--yarn-orig-ctx', aliases: ['--yarn-orig-ctx'], takesValue: true, type: 'int' },
  noMmprojOffload:  { canonical: '--no-mmproj-offload', aliases: ['--no-mmproj-offload'], takesValue: false },
  host:             { canonical: '--host', aliases: ['--host'],                takesValue: true },
  port:             { canonical: '--port', aliases: ['--port'],                takesValue: true, type: 'int' }
}

// flag 拼写 → field 名
const ALIAS_TO_FIELD = {}
for (const [field, def] of Object.entries(FIELDS)) {
  for (const a of def.aliases) ALIAS_TO_FIELD[a] = field
}

// 字段元数据：中文标签 / 分组 / 控件类型（供前端表单渲染与 /api/fields）
const FIELD_META = {
  model:            { label: '模型路径', group: 'basic' },
  alias:            { label: '别名 (-a)', group: 'basic' },
  mmproj:           { label: '视觉投影 mmproj', group: 'basic' },
  draftModel:       { label: '草稿模型 (-md)', group: 'spec' },
  host:             { label: '主机 (--host)', group: 'basic' },
  port:             { label: '端口 (--port)', group: 'basic' },
  ctxSize:          { label: '上下文长度 (-c)', group: 'perf', slider: { min: 32768, max: 262144, step: 4096 } },
  nGpuLayers:       { label: 'GPU 层数 (-ngl)', group: 'perf' },
  flashAttn:        { label: 'Flash Attention (-fa)', group: 'perf', options: ['on', 'off', 'auto'] },
  cacheTypeK:       { label: 'K 缓存类型 (-ctk)', group: 'perf', options: ['f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'] },
  cacheTypeV:       { label: 'V 缓存类型 (-ctv)', group: 'perf', options: ['f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'] },
  splitMode:        { label: '分割模式 (-sm)', group: 'perf', options: ['layer', 'tensor'] },
  tensorSplit:      { label: '张量分割 (-ts)', group: 'perf' },
  noMmap:           { label: '禁用 mmap (--no-mmap)', group: 'perf', bool: true },
  cacheRam:         { label: '缓存 RAM (-cram)', group: 'perf' },
  kvUnswap:         { label: 'KV 不交换 (-kvu)', group: 'perf', bool: true },
  parallel:         { label: '并行数 (-np)', group: 'perf' },
  batchSize:        { label: '批大小 (-b)', group: 'perf' },
  ubatchSize:       { label: '微批大小 (-ub)', group: 'perf' },
  threads:          { label: '线程数 (-t)', group: 'perf' },
  specType:         { label: '推测解码类型', group: 'spec', options: ['draft-mtp', 'draft-dflash'] },
  specDraftNMax:    { label: '草稿最大 n', group: 'spec' },
  specDraftPMin:    { label: '草稿最小 p', group: 'spec' },
  temp:             { label: '温度 (--temp)', group: 'sample' },
  topK:             { label: 'Top-K', group: 'sample' },
  topP:             { label: 'Top-P', group: 'sample' },
  repeatPenalty:    { label: '重复惩罚', group: 'sample' },
  reasoningEffort:  { label: '推理强度', group: 'sample', options: ['low', 'medium', 'high', 'xhigh'] },
  jinja:            { label: '启用 Jinja 模板', group: 'template', bool: true },
  chatTemplateFile: { label: '对话模板文件', group: 'template' },
  ropeScaling:      { label: 'RoPE 缩放方式', group: 'rope', options: ['linear', 'yarn', 'rope'] },
  ropeScale:        { label: 'RoPE 缩放值', group: 'rope' },
  yarnOrigCtx:      { label: 'YaRN 原始上下文', group: 'rope' },
  noMmprojOffload:  { label: '禁用 mmproj 卸载', group: 'other', bool: true }
}

const GROUPS = [
  { key: 'basic', label: '基础' },
  { key: 'perf', label: '性能 / 显存' },
  { key: 'spec', label: '推测解码' },
  { key: 'sample', label: '采样' },
  { key: 'template', label: '模板' },
  { key: 'rope', label: 'RoPE' },
  { key: 'other', label: '其他' }
]

/** 分词：处理双引号；引号内的空格不切分，引号本身被剥离（quoted 标记记录） */
function tokenize(line) {
  const tokens = []
  let cur = ''
  let inQ = false
  let quoted = false
  for (const ch of line) {
    if (ch === '"') {
      inQ = !inQ
      quoted = true
    } else if (!inQ && /\s/.test(ch)) {
      if (cur !== '') { tokens.push({ text: cur, quoted }); cur = ''; quoted = false }
    } else {
      cur += ch
    }
  }
  if (cur !== '') tokens.push({ text: cur, quoted })
  return tokens
}

/** 判断一个 token 是否"看起来像 flag"（用于给未知 flag 归组取值） */
function looksLikeFlag(t) {
  if (!t.startsWith('-')) return false
  if (/^-\d/.test(t)) return false // 负数，如 -0.5
  return true
}

/**
 * 把 flag token 序列解析为有序条目数组
 * 已知 flag → { flag, value, quoted }；未知 flag → { raw }
 */
function parseArgs(tokens) {
  const args = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    const field = ALIAS_TO_FIELD[tok.text]
    if (field) {
      const def = FIELDS[field]
      if (def.takesValue) {
        if (i + 1 >= tokens.length) throw new Error(`参数 ${tok.text} 缺少取值`)
        const v = tokens[i + 1]
        args.push({ flag: tok.text, value: v.text, quoted: v.quoted })
        i += 2
      } else {
        args.push({ flag: tok.text })
        i += 1
      }
    } else if (looksLikeFlag(tok.text)) {
      // 未知 flag：若下一 token 不像 flag 则视为其取值，一并原样保留
      let raw = tok.text
      if (i + 1 < tokens.length && !looksLikeFlag(tokens[i + 1].text)) {
        raw += ' ' + (tokens[i + 1].quoted ? `"${tokens[i + 1].text}"` : tokens[i + 1].text)
        i += 2
      } else {
        i += 1
      }
      args.push({ raw })
    } else {
      // 游离的非 flag token（异常输入），原样保留
      args.push({ raw: tok.quoted ? `"${tok.text}"` : tok.text })
      i += 1
    }
  }
  return args
}

/** 从 args 派生扁平字段视图（同字段多次出现取最后一次，与 llama.cpp 行为一致） */
function fieldsOf(args) {
  const out = {}
  for (const e of args || []) {
    if (e.flag && ALIAS_TO_FIELD[e.flag]) out[ALIAS_TO_FIELD[e.flag]] = e.value
  }
  return out
}

/** 渲染单个条目 */
function renderEntry(e) {
  if (e.raw) return e.raw
  const v = e.value
  if (v === undefined || v === null || v === '') return e.flag
  return e.flag + ' ' + (e.quoted ? `"${v}"` : v)
}

/** 由 profile 生成完整命令行（按 args 原顺序，无损） */
function generateCommand(profile) {
  const parts = [profile.exe]
  for (const e of profile.args || []) parts.push(renderEntry(e))
  return parts.join(' ')
}

/** 解析单条命令行 → { exe, args } */
function parseCommand(line) {
  const tokens = tokenize(line)
  if (tokens.length < 2) throw new Error('命令行不完整：' + line)
  const exe = tokens[0].text
  return { exe, args: parseArgs(tokens.slice(1)) }
}

/** 取 Windows/Unix 路径的文件名（去扩展名） */
function baseNameNoExt(p) {
  const seg = String(p).replace(/\\/g, '/').split('/').pop() || ''
  return seg.replace(/\.[^.]+$/, '')
}

/**
 * 导入 txt：`# 注释行` → 描述，命令行 → profile
 * 返回 [{ name, description, exe, args }]
 */
function importTxt(text) {
  const items = []
  let pendingDesc = ''
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) { pendingDesc = line.slice(1).trim(); continue }
    try {
      const { exe, args } = parseCommand(line)
      const f = fieldsOf(args)
      const name = f.alias || (f.model ? baseNameNoExt(f.model) : '未命名')
      items.push({ name, description: pendingDesc, exe, args })
      pendingDesc = ''
    } catch (err) {
      items.push({ error: line, message: err.message })
    }
  }
  return items
}

/** 导出 txt（兼容现有 llama-server.txt / llama-launch.ps1 格式） */
function exportTxt(profiles) {
  const blocks = []
  for (const p of profiles) {
    const lines = []
    if (p.description) lines.push('# ' + p.description)
    lines.push(generateCommand(p))
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n') + '\n'
}

/** 表单写回：设置/清除结构化字段，保留既有条目的拼写与位置 */
function setField(args, field, value) {
  const def = FIELDS[field]
  if (!def) throw new Error('未知字段: ' + field)
  const list = Array.isArray(args) ? args.slice() : []
  const idx = []
  list.forEach((e, i) => { if (e.flag && ALIAS_TO_FIELD[e.flag] === field) idx.push(i) })
  const v = value === null || value === undefined ? '' : String(value)
  if (def.takesValue) {
    if (v === '') {
      // 清空：移除全部相关条目
      return list.filter((_, i) => !idx.includes(i))
    }
    if (idx.length) {
      // 更新最后一次出现（与 llama.cpp 取值行为一致），保留原拼写/引号
      const e = list[idx[idx.length - 1]]
      list[idx[idx.length - 1]] = { ...e, value: v }
      return list
    }
    list.push({ flag: def.canonical, value: v, quoted: v.includes(' ') })
    return list
  }
  // 布尔 flag
  if (v === 'true' || v === '1' || v === true) {
    if (!idx.length) list.push({ flag: def.canonical })
    return list
  }
  return list.filter((_, i) => !idx.includes(i))
}

module.exports = {
  FIELDS,
  FIELD_META,
  GROUPS,
  tokenize,
  parseArgs,
  parseCommand,
  fieldsOf,
  generateCommand,
  importTxt,
  exportTxt,
  setField,
  baseNameNoExt
}
