<template>
  <div class="table-panel">
    <div class="table-wrap" @dragover.prevent="onDragOver" @drop.prevent>
    <el-table :data="filtered" size="small" height="100%" v-loading="state.loading" row-key="id">
      <el-table-column width="40" align="center">
        <template #default="{ row }">
          <span class="drag-handle" :class="{ disabled: !!props.filter }" :draggable="!props.filter"
            :title="props.filter ? 'Sorting disabled while filtering' : 'Drag to reorder'"
            @dragstart="onDragStart(row, $event)" @dragend="onDragEnd">
            <el-icon><Rank /></el-icon>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="NAME / DESC" min-width="180">
        <template #default="{ row }">
          <div class="name">{{ row.name }}</div>
          <div v-if="row.description" class="desc">{{ row.description }}</div>
        </template>
      </el-table-column>
      <!-- <el-table-column label="MODEL" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ modelBase(row) }}</span>
        </template>
      </el-table-column> -->
      <!-- <el-table-column label="PORT" width="70">
        <template #default="{ row }">{{ portOf(row) }}</template>
      </el-table-column> -->
      <el-table-column label="CTX" width="80">
        <template #default="{ row }">{{ ctxOf(row) || '—' }}</template>
      </el-table-column>
      <el-table-column label="STATUS" width="110">
        <template #default="{ row }">
          <el-tag v-if="!row.run" type="info" size="small">IDLE</el-tag>
          <el-tag v-else-if="row.run.status === 'starting'" type="warning" size="small">STARTING</el-tag>
          <el-tag v-else-if="row.run.status === 'running'" type="success" size="small">RUNNING</el-tag>
          <el-tag v-else type="danger" size="small">LOST</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="ACTIONS" width="210" fixed="right" align="right">
        <template #default="{ row }">
          <el-button v-if="!row.run" link type="primary"
            :disabled="!!otherRunning" :title="otherRunning ? 'A model is already running, only one at a time, stop it first' : ''"
            @click="onStart(row)">START</el-button>
          <el-button v-else link type="danger" :loading="stoppingId === row.id" @click="onStop(row)">STOP</el-button>
          <el-button link @click="emit('edit', row)">EDIT</el-button>
          <el-button link type="danger" @click="onDelete(row)">DEL</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Rank } from '@element-plus/icons-vue'
import { state, refreshProfiles } from '../store'
import { api } from '../api'

const emit = defineEmits(['new', 'edit', 'started'])
// 搜索框已移至 App 的 tab 栏，经 prop 传入
const props = defineProps({ filter: { type: String, default: '' } })
const stoppingId = ref('')
const dragId = ref('') // 拖拽中的配置 id，空串表示未在拖拽

// 当前运行中的配置（每次只能运行一个模型，服务端同样强制限制）
const otherRunning = computed(() => state.profiles.find(p => p.run) || null)

const filtered = computed(() => {
  const f = props.filter.trim().toLowerCase()
  if (!f) return state.profiles
  return state.profiles.filter(p =>
    (p.name || '').toLowerCase().includes(f) ||
    (p.description || '').toLowerCase().includes(f) ||
    (modelBase(p) || '').toLowerCase().includes(f)
  )
})

function modelBase(p) {
  const f = fieldsOf(p)
  return f.model ? f.model.split(/[\\/]/).pop().replace(/\.gguf$/i, '') : ''
}
function portOf(p) {
  const f = fieldsOf(p)
  return f.port || 8080
}
function ctxOf(p) {
  const v = Number(fieldsOf(p).ctxSize)
  if (!v) return ''
  const k = v / 1024
  return (Number.isInteger(k) ? k : k.toFixed(1)) + 'k'
}
// 与后端 parser 相同的字段派生（轻量版，仅取展示所需）
function fieldsOf(p) {
  const map = {
    '-m': 'model', '--model': 'model', '-a': 'alias', '--alias': 'alias',
    '-c': 'ctxSize', '--ctx-size': 'ctxSize',
    '--port': 'port', '--host': 'host'
  }
  const out = {}
  for (const e of p.args || []) {
    if (e.flag && map[e.flag]) out[map[e.flag]] = e.value
  }
  return out
}

// 拖拽排序（仅无搜索过滤时可用，避免局部顺序映射到全量列表出错）
function onDragStart(row, e) {
  dragId.value = row.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', row.id) // 不调 setData 部分浏览器不会真正开始拖拽
}
function onDragOver(e) {
  if (!dragId.value) return
  e.dataTransfer.dropEffect = 'move'
  const tr = e.target.closest('.el-table__row')
  if (!tr) return
  // 按 tr 在表体中的位置定位目标行（fixed 列同表体，索引一致）
  const to = Array.from(tr.parentElement.querySelectorAll('.el-table__row')).indexOf(tr)
  const target = filtered.value[to]
  if (!target || target.id === dragId.value) return
  // 拖拽中位置持续变化，每次按 id 重新查找下标
  const from = state.profiles.findIndex(p => p.id === dragId.value)
  const ti = state.profiles.findIndex(p => p.id === target.id)
  if (from < 0 || ti < 0 || from === ti) return
  const list = state.profiles
  const [moved] = list.splice(from, 1)
  list.splice(ti, 0, moved)
}
async function onDragEnd() {
  if (!dragId.value) return
  dragId.value = ''
  try {
    await api.reorderProfiles(state.profiles.map(p => p.id))
  } catch (e) {
    ElMessage.error(e.message)
    refreshProfiles() // 持久化失败，回滚到服务端顺序
  }
}

async function onStart(row) {
  try {
    await api.startProfile(row.id)
    ElMessage.success(`Started ${row.name}`)
    emit('started') // 切到实时日志 tab 查看启动过程
    refreshProfiles()
  } catch (e) {
    ElMessage.error(e.message)
  }
}
async function onStop(row) {
  try {
    await ElMessageBox.confirm(`Stop "${row.name}"?`, 'STOP INSTANCE', { type: 'warning', confirmButtonText: 'STOP', cancelButtonText: 'CANCEL' })
  } catch { return }
  stoppingId.value = row.id
  try {
    await api.stopRun(row.id)
    ElMessage.success('Stop command sent')
    refreshProfiles()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    stoppingId.value = ''
  }
}
async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`Delete profile "${row.name}"?`, 'DELETE', { type: 'warning', confirmButtonText: 'DEL', cancelButtonText: 'CANCEL' })
  } catch { return }
  try {
    await api.deleteProfile(row.id)
    ElMessage.success('Deleted')
    refreshProfiles()
  } catch (e) {
    ElMessage.error(e.message)
  }
}
</script>

<style scoped>
.table-panel { height: 100%; display: flex; flex-direction: column; }
.table-wrap { flex: 1; min-height: 0; }
.drag-handle { cursor: grab; color: var(--term-text-3); }
.drag-handle:active { cursor: grabbing; }
.drag-handle.disabled { cursor: not-allowed; color: var(--term-border); }
.name { font-weight: 600; color: var(--term-green); }
.desc { color: var(--term-text-3); font-size: 12px; }
.mono { font-family: var(--term-mono); font-size: 12px; }
</style>
