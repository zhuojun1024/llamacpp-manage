<template>
  <el-card class="table-card" shadow="never">
    <template #header>
      <div class="card-head">
        <span>启动配置（{{ state.profiles.length }}）</span>
        <el-input v-model="filter" placeholder="搜索名称 / 模型 / 描述" size="small" clearable style="width: 240px" />
      </div>
    </template>

    <div class="table-wrap" @dragover.prevent="onDragOver" @drop.prevent>
    <el-table :data="filtered" size="small" height="100%" v-loading="state.loading" row-key="id">
      <el-table-column width="40" align="center">
        <template #default="{ row }">
          <span class="drag-handle" :class="{ disabled: !!filter }" :draggable="!filter"
            :title="filter ? '搜索时不可排序' : '拖拽排序'"
            @dragstart="onDragStart(row, $event)" @dragend="onDragEnd">
            <el-icon><Rank /></el-icon>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="名称 / 描述" min-width="180">
        <template #default="{ row }">
          <div class="name">{{ row.name }}</div>
          <div v-if="row.description" class="desc">{{ row.description }}</div>
        </template>
      </el-table-column>
      <!-- <el-table-column label="模型" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ modelBase(row) }}</span>
        </template>
      </el-table-column> -->
      <!-- <el-table-column label="端口" width="70">
        <template #default="{ row }">{{ portOf(row) }}</template>
      </el-table-column> -->
      <el-table-column label="上下文" width="80">
        <template #default="{ row }">{{ ctxOf(row) || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag v-if="!row.run" type="info" size="small">已停止</el-tag>
          <el-tag v-else-if="row.run.status === 'starting'" type="warning" size="small">启动中</el-tag>
          <el-tag v-else-if="row.run.status === 'running'" type="success" size="small">运行中</el-tag>
          <el-tag v-else type="danger" size="small">失联</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button v-if="!row.run" size="small" type="success"
            :disabled="!!otherRunning" :title="otherRunning ? '已有模型在运行，每次只能运行一个，请先停止' : ''"
            @click="onStart(row)">
            <el-icon><VideoPlay /></el-icon>启动
          </el-button>
          <el-button v-else size="small" type="danger" :loading="stoppingId === row.id" @click="onStop(row)">
            <el-icon><VideoPause /></el-icon>停止
          </el-button>
          <el-button size="small" @click="emit('edit', row)"><el-icon><Edit /></el-icon></el-button>
          <el-button size="small" type="danger" plain @click="onDelete(row)"><el-icon><Delete /></el-icon></el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { state, refreshProfiles } from '../store'
import { api } from '../api'

const emit = defineEmits(['new', 'edit'])
const filter = ref('')
const stoppingId = ref('')
const dragId = ref('') // 拖拽中的配置 id，空串表示未在拖拽

// 当前运行中的配置（每次只能运行一个模型，服务端同样强制限制）
const otherRunning = computed(() => state.profiles.find(p => p.run) || null)

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
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
    ElMessage.success(`已启动 ${row.name}`)
    refreshProfiles()
  } catch (e) {
    ElMessage.error(e.message)
  }
}
async function onStop(row) {
  try {
    await ElMessageBox.confirm(`确定停止「${row.name}」？`, '确认停止', { type: 'warning' })
  } catch { return }
  stoppingId.value = row.id
  try {
    await api.stopRun(row.id)
    ElMessage.success('已发送停止指令')
    refreshProfiles()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    stoppingId.value = ''
  }
}
async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除配置「${row.name}」？`, '确认删除', { type: 'warning' })
  } catch { return }
  try {
    await api.deleteProfile(row.id)
    ElMessage.success('已删除')
    refreshProfiles()
  } catch (e) {
    ElMessage.error(e.message)
  }
}
</script>

<style scoped>
.table-card { height: 100%; display: flex; flex-direction: column; }
.table-card :deep(.el-card__body) { flex: 1; overflow: hidden; }
.table-wrap { height: 100%; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.drag-handle { cursor: grab; color: #909399; }
.drag-handle:active { cursor: grabbing; }
.drag-handle.disabled { cursor: not-allowed; color: #c0c4cc; }
.name { font-weight: 600; }
.desc { color: #909399; font-size: 12px; }
.mono { font-family: Consolas, monospace; font-size: 12px; }
</style>
