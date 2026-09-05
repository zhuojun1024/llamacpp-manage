<template>
  <el-dialog v-model="vis" :title="isEdit ? 'EDIT PROFILE' : 'NEW PROFILE'" width="880px" top="4vh" destroy-on-close>
    <div v-if="metaLoaded" class="form-body">
      <!-- 粘贴命令解析 -->
      <el-collapse class="paste">
        <el-collapse-item title="PASTE CMD TO PARSE (will overwrite current form)">
          <el-input v-model="pasteCmd" placeholder='e.g. C:\llama\llama-server.exe -m "D:\LLM\xxx.gguf" -ngl 99 ...' />
          <el-button link type="primary" style="margin-top: 6px" @click="onPasteParse">PARSE & FILL</el-button>
        </el-collapse-item>
      </el-collapse>

      <el-form label-width="150px" label-position="right" size="default">
        <el-divider content-position="left">BASIC</el-divider>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="NAME" required>
              <el-input v-model="form.name" placeholder="profile name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="DESC">
              <el-input v-model="form.description" placeholder="notes (speed, use case...)" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="llama-server">
          <el-input v-model="form.exe" placeholder="empty = use default path from settings" />
        </el-form-item>

        <template v-for="g in groups" :key="g.key">
          <el-divider content-position="left">{{ g.label }}</el-divider>
          <el-row :gutter="12">
            <el-col v-for="f in groupFields[g.key]" :key="f.name" :span="12">
              <el-form-item :label="f.label">
                <!-- 布尔开关 -->
                <el-switch v-if="f.bool" :model-value="fieldValue(f.name) === 'true'" @change="v => setField(f.name, v)" />
                <!-- 带选项的下拉（可自定义输入） -->
                <el-select v-else-if="f.options" :model-value="fieldValue(f.name)" filterable allow-create default-first-option
                  clearable placeholder="select or type" style="width: 100%" @change="v => setField(f.name, v)">
                  <el-option v-for="o in f.options" :key="o" :label="o" :value="o" />
                </el-select>
                <!-- 数值滑杆（如上下文长度） -->
                <div v-else-if="f.slider" class="slider-row">
                  <el-slider :model-value="sliderValue(f.name)" :min="f.slider.min" :max="f.slider.max" :step="f.slider.step"
                    :format-tooltip="v => fmtK(v)" @input="v => setField(f.name, v)" />
                  <span class="slider-val">{{ fmtK(sliderValue(f.name)) }}</span>
                </div>
                <!-- 模型/模板路径：目录自动补全 -->
                <el-autocomplete v-else-if="isPathField(f.name)" :model-value="fieldValue(f.name)"
                  :fetch-suggestions="qs => pathSuggestions(f.name, qs)" clearable
                  placeholder="path, .gguf autocomplete" style="width: 100%"
                  @input="v => setField(f.name, v)" @select="it => setField(f.name, it.value)" />
                <!-- 普通输入 -->
                <el-input v-else :model-value="fieldValue(f.name)" clearable
                  :placeholder="f.type === 'int' || f.type === 'float' ? 'number' : ''"
                  @input="v => setField(f.name, v)" />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <el-divider content-position="left">ENV (set before llama-server starts)</el-divider>
        <el-form-item label="env">
          <el-input v-model="form.env" type="textarea" :rows="3"
            placeholder="one KEY=VALUE per line, e.g. CUDA_VISIBLE_DEVICES=0 or HF_TOKEN=*** # = comment; empty = none" />
        </el-form-item>

        <el-divider content-position="left">EXTRA ARGS (appended to command as-is)</el-divider>
        <el-form-item label="extra">
          <el-input v-model="extraText" type="textarea" :rows="3"
            placeholder="one per line, e.g. --log-disable or --foo bar; quote values with spaces/special chars (JSON); empty = none" />
        </el-form-item>
      </el-form>

      <el-divider />
      <div class="preview">
        <div class="preview-head">
          <span class="preview-label">CMD PREVIEW</span>
          <el-button link type="primary" @click="onCopyCmd">COPY</el-button>
        </div>
        <pre class="mono">{{ preview }}</pre>
      </div>
    </div>

    <template #footer>
      <el-button link @click="vis = false">CANCEL</el-button>
      <el-button link type="primary" :loading="saving" @click="onSave">SAVE</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'

const props = defineProps({
  visible: Boolean,
  profile: Object // null = 新建
})
const emit = defineEmits(['update:visible', 'saved'])

const vis = computed({
  get: () => props.visible,
  set: v => emit('update:visible', v)
})
const isEdit = computed(() => !!props.profile)

const meta = ref({ fields: [], groups: [] })
const metaLoaded = ref(false)
const groups = computed(() => meta.value.groups)
const groupFields = computed(() => {
  const m = {}
  for (const g of meta.value.groups) m[g.key] = []
  for (const f of meta.value.fields) (m[f.group] || (m[f.group] = [])).push(f)
  return m
})

const form = ref({ name: '', description: '', exe: '', args: [], env: '' })
const extraText = ref('')
const pasteCmd = ref('')
const saving = ref(false)
const settings = ref({}) // 全局设置（modelDir 等），打开表单时拉取

onMounted(async () => {
  meta.value = await api.getFields()
  metaLoaded.value = true
})

watch(() => props.visible, (v) => {
  if (!v) return
  if (props.profile) {
    form.value = {
      name: props.profile.name,
      description: props.profile.description || '',
      exe: props.profile.exe,
      args: JSON.parse(JSON.stringify(props.profile.args || [])),
      env: props.profile.env || ''
    }
  } else {
    form.value = { name: '', description: '', exe: '', args: [], env: '' }
  }
  extraText.value = form.value.args.filter(e => e.raw).map(e => e.raw).join('\n')
  // 拉取最新设置：模型目录（自动补全）+ 默认 exe（exe 为空时回退显示，便于预览）
  api.getSettings().then(s => {
    settings.value = s
    if (!form.value.exe.trim()) form.value.exe = s.exe || ''
  }).catch(() => {})
})

// ---------- 字段派生与写回（本地同步，与后端 parser 同算法） ----------
// flag 拼写（canonical 或别名）→ 字段名
const aliasToField = computed(() => {
  const m = {}
  for (const f of meta.value.fields) for (const a of f.aliases || [f.canonical]) m[a] = f.name
  return m
})
function entryField(e) {
  return (e.flag && aliasToField.value[e.flag]) || null
}
const args = computed(() => form.value.args)

// 派生扁平字段视图（同字段多次出现取最后一次，与 llama.cpp 行为一致）
const fieldsView = computed(() => {
  const out = {}
  for (const e of form.value.args) {
    const name = entryField(e)
    if (name) out[name] = e.value
  }
  return out
})
function fieldValue(name) {
  const f = meta.value.fields.find(x => x.name === name)
  if (f && f.bool) return form.value.args.some(e => entryField(e) === name) ? 'true' : ''
  return fieldsView.value[name] ?? ''
}

function setField(name, value) {
  const f = meta.value.fields.find(x => x.name === name)
  if (!f) return
  const list = form.value.args.slice()
  const idx = []
  list.forEach((e, i) => { if (e.flag && (entryField(e) === name || e.flag === f.canonical)) idx.push(i) })
  if (f.bool) {
    if (value) { if (!idx.length) list.push({ flag: f.canonical }) }
    else list.splice(0, list.length, ...list.filter((_, i) => !idx.includes(i)))
  } else {
    const v = value === null || value === undefined ? '' : String(value)
    if (v === '') list.splice(0, list.length, ...list.filter((_, i) => !idx.includes(i)))
    else if (idx.length) {
      const e = list[idx[idx.length - 1]]
      list[idx[idx.length - 1]] = { ...e, value: v }
    } else {
      list.push({ flag: f.canonical, value: v, quoted: v.includes(' ') })
    }
  }
  form.value.args = list
}

// ---------- 其他参数（raw 条目） ----------
watch(extraText, (txt) => {
  const lines = String(txt || '').split('\n').map(s => s.trim()).filter(Boolean)
  const kept = form.value.args.filter(e => !e.raw)
  form.value.args = [...kept, ...lines.map(raw => ({ raw }))]
})

// ---------- 命令预览 ----------
function renderEntry(e) {
  if (e.raw) return e.raw
  if (e.value === undefined || e.value === null || e.value === '') return e.flag
  return e.flag + ' ' + (e.quoted ? `"${e.value}"` : e.value)
}
function generateCommand(exe, list) {
  return [exe || '(default llama-server)', ...list.map(renderEntry)].join(' ')
}
const preview = computed(() => generateCommand(form.value.exe, form.value.args))

// ---------- 路径自动补全 ----------
const isPathField = (name) => ['model', 'mmproj', 'draftModel', 'chatTemplateFile'].includes(name)
// 模型目录（设置可配，默认 D:\LLM）内按字段的关键字规则（匹配文件名，不区分大小写）
const MODEL_DIR_RULES = {
  model:      { include: null,              exclude: ['mmproj', 'dflash'] },
  mmproj:     { include: ['mmproj'],        exclude: null },
  draftModel: { include: ['mtp', 'dflash'], exclude: null }
  // chatTemplateFile 无规则：回退为扫描当前值所在目录
}
async function pathSuggestions(name, query) {
  let files = []
  const rule = MODEL_DIR_RULES[name]
  if (rule) {
    const dir = String(settings.value.modelDir || 'D:\\LLM').trim()
    if (dir) {
      try { files = (await api.browse(dir, true)).files || [] } catch { files = [] }
    }
  } else {
    const cur = fieldValue(name) || ''
    const dir = cur.split(/[\\/]/).slice(0, -1).join('\\')
    if (!dir) return []
    try { files = (await api.browse(dir)).files || [] } catch { files = [] }
  }
  const q = (query || '').toLowerCase()
  return files
    .filter(f => {
      const n = f.split(/[\\/]/).pop().toLowerCase()
      if (rule.include && !rule.include.some(k => n.includes(k))) return false
      if (rule.exclude && rule.exclude.some(k => n.includes(k))) return false
      return !q || n.includes(q)
    })
    .map(f => ({ value: f }))
}

// ---------- 滑杆（上下文长度等） ----------
function sliderValue(name) {
  const f = meta.value.fields.find(x => x.name === name)
  if (!f || !f.slider) return 0
  const v = Number(fieldValue(name))
  if (!Number.isFinite(v) || v <= 0) return f.slider.min
  return Math.min(f.slider.max, Math.max(f.slider.min, v))
}
function fmtK(v) {
  const k = Number(v) / 1024
  return (Number.isInteger(k) ? k : k.toFixed(1)) + 'k'
}

// ---------- 粘贴解析 ----------
async function onPasteParse() {
  const cmd = pasteCmd.value.trim()
  if (!cmd) return
  try {
    const r = await api.parseCommand(cmd)
    await ElMessageBox.confirm('Parsed OK. This will overwrite the current exe & all args.', 'CONFIRM OVERWRITE', { type: 'info', confirmButtonText: 'OK', cancelButtonText: 'CANCEL' })
    form.value.exe = r.exe
    form.value.args = r.args
    const f = r.fields
    if (f.alias) form.value.name = f.alias
    extraText.value = form.value.args.filter(e => e.raw).map(e => e.raw).join('\n')
    ElMessage.success('Parsed & filled')
  } catch (e) {
    ElMessage.error('Parse failed: ' + e.message)
  }
}

// ---------- 复制命令 ----------
async function onCopyCmd() {
  try {
    await navigator.clipboard.writeText(preview.value)
    ElMessage.success('Copied to clipboard')
  } catch {
    ElMessage.error('Copy failed')
  }
}

// ---------- 保存 ----------
async function onSave() {
  if (!form.value.name.trim()) return ElMessage.warning('NAME required')
  if (!form.value.args.some(e => e.flag === '-m' || e.flag === '--model')) {
    return ElMessage.warning('Model path (-m) is required')
  }
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      exe: form.value.exe.trim(),
      env: form.value.env.trim(),
      args: form.value.args
    }
    if (isEdit.value) await api.updateProfile(props.profile.id, payload)
    else await api.createProfile(payload)
    ElMessage.success('SAVED')
    emit('saved')
    vis.value = false
  } catch (e) {
    ElMessage.error('Save failed: ' + e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.form-body { max-height: 62vh; overflow-y: auto; padding-right: 6px; }
.paste { margin-bottom: 4px; }
.slider-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.slider-row :deep(.el-slider) { flex: 1; }
.slider-val { min-width: 44px; text-align: right; color: var(--term-text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.preview-head { display: flex; align-items: center; justify-content: space-between; }
.preview-label { color: var(--term-text-3); font-size: 12px; margin-bottom: 4px; }
pre.mono {
  margin: 0; padding: 10px; background: #030705; color: var(--term-green);
  border: 1px solid var(--term-border); border-radius: 2px;
  font-family: var(--term-mono); font-size: 12px;
  white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto;
}
</style>
