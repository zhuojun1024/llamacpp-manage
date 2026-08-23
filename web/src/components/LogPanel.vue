<template>
  <el-card :class="['log-card', { fullscreen }]" shadow="never">
    <template #header>
      <div class="card-head">
        <span>实时日志</span>
        <div class="log-actions" v-if="activeRun">
          <el-input v-model="search" placeholder="过滤日志" size="small" clearable style="width: 160px" />
          <el-checkbox v-model="autoScroll" size="small">自动滚动</el-checkbox>
          <el-button size="small" @click="onDownload"><el-icon><Download /></el-icon>下载</el-button>
          <el-button size="small" circle @click="fullscreen = !fullscreen" :title="fullscreen ? '退出全屏（Esc）' : '全屏'">
            <el-icon><Aim v-if="fullscreen" /><FullScreen v-else /></el-icon>
          </el-button>
        </div>
      </div>
    </template>

    <el-empty v-if="!runList.length" description="暂无运行中的实例，点击左侧「启动」后日志将实时显示在这里" :image-size="80" />

    <div v-else class="run-panel">
      <!-- 关键信息卡片（左侧实例信息 + 右侧 GPU 显存/利用率） -->
      <div class="keyinfo-bar">
        <div class="keyinfo" v-if="keyInfo(activeRun).listenPort || keyInfo(activeRun).loadTimeMs">
          <el-tag v-if="keyInfo(activeRun).listenPort" type="success" size="small">
            监听 {{ keyInfo(activeRun).listenHost || 'localhost' }}:{{ keyInfo(activeRun).listenPort }}
          </el-tag>
          <el-tag v-if="keyInfo(activeRun).loadTimeMs" type="info" size="small">load time {{ keyInfo(activeRun).loadTimeMs }} ms</el-tag>
          <el-tag v-if="keyInfo(activeRun).nCtx" type="info" size="small">n_ctx {{ keyInfo(activeRun).nCtx }}</el-tag>
          <el-tag v-if="keyInfo(activeRun).nGpuLayers" type="info" size="small">n_gpu_layers {{ keyInfo(activeRun).nGpuLayers }}</el-tag>
          <el-tag :type="activeRun.status === 'running' ? 'success' : activeRun.status === 'starting' ? 'warning' : 'danger'" size="small">
            {{ statusText(activeRun.status) }}
          </el-tag>
        </div>
        <div class="keyinfo lost-tip" v-else-if="activeRun.status === 'lost'">
          <el-tag type="danger" size="small">失联：进程在运行但非本管理器启动，无日志流（PID {{ activeRun.pid }}），可停止</el-tag>
        </div>
        <div class="gpu-tags" v-if="gpuList.length">
          <div class="gpu-item" v-for="g in gpuList" :key="g.index">
            <div class="gpu-idx">GPU {{ g.index }}</div>
            <div class="gpu-metric">
              <span class="gpu-metric-label">显存</span>
              <span class="gpu-meter"><i class="gpu-meter-fill" :style="{ width: g.memPct + '%', background: barColor(g.memPct) }"></i></span>
              <span class="gpu-metric-value">{{ g.memUsedGb.toFixed(2) }} GB</span>
            </div>
            <div class="gpu-metric">
              <span class="gpu-metric-label">利用率</span>
              <span class="gpu-meter"><i class="gpu-meter-fill" :style="{ width: g.util + '%', background: barColor(g.util) }"></i></span>
              <span class="gpu-metric-value">{{ g.util }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 日志区 -->
      <div ref="boxRef" class="logbox" @scroll="onScroll">
        <div v-for="(l, i) in visibleLines(activeRun)" :key="i" :class="['line', 'lv-' + l.level]">{{ l.line }}</div>
        <div v-if="!visibleLines(activeRun).length" class="line dim">（无日志）</div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { state, logBuf } from '../store'
import { api } from '../api'

const search = ref('')
const autoScroll = ref(true)
const fullscreen = ref(false) // 覆盖整个应用窗口（非显示器全屏）
const gpuList = ref([]) // 本机 NVIDIA 显卡（显存/利用率）

function onKeydown(e) {
  if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false
}
async function pollGpus() {
  try {
    const data = await api.gpus()
    gpuList.value = data.gpus || []
  } catch { gpuList.value = [] }
}
function barColor(pct) {
  return pct >= 90 ? '#f56c6c' : pct >= 70 ? '#e6a23c' : '#409eff'
}
let gpuTimer = null
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  pollGpus()
  gpuTimer = setInterval(pollGpus, 2000)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearInterval(gpuTimer)
})
const boxRef = ref(null) // 日志容器 DOM（同时只运行一个模型，单个 ref 即可）
let atBottom = true

const runList = computed(() => Object.values(state.runs))
const activeRun = computed(() => runList.value[0] || null) // 同时只运行一个模型

function keyInfo(run) {
  return logBuf(run.profileId).keyInfo
}
function statusText(s) {
  return { starting: '启动中', running: '运行中', lost: '失联' }[s] || s
}
function visibleLines(run) {
  const buf = logBuf(run.profileId)
  const f = search.value.trim().toLowerCase()
  if (!f) return buf.lines
  return buf.lines.filter(l => l.line.toLowerCase().includes(f))
}

function activeBox() {
  return boxRef.value
}

// 自动滚动
watch(() => {
  const run = activeRun.value
  return run ? logBuf(run.profileId).lines.length : 0
}, async () => {
  if (autoScroll.value && atBottom) await scrollBottom()
})
// 运行实例变化（启动/停止）时重置滚动状态并回到最新日志
watch(() => activeRun.value && activeRun.value.profileId, async () => {
  atBottom = true
  if (autoScroll.value) await scrollBottom()
})
async function scrollBottom() {
  await nextTick()
  const el = activeBox()
  if (el) el.scrollTop = el.scrollHeight
}
function onScroll() {
  const el = activeBox()
  if (!el) return
  atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
}

async function onDownload() {
  const run = activeRun.value
  if (!run) return
  try {
    const resp = await fetch(`/api/runs/${run.profileId}/logfile`)
    if (!resp.ok) throw new Error('日志文件不存在')
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = run.logFile ? run.logFile.split('\\').pop() : 'run.log'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error(e.message)
  }
}
</script>

<style scoped>
.log-card { height: 100%; display: flex; flex-direction: column; }
.log-card.fullscreen {
  position: fixed; inset: 0; z-index: 3000;
  border-radius: 0; /* 覆盖整个 Electron 窗口（viewport），非显示器全屏 */
}
.log-card :deep(.el-card__body) { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.log-actions { display: flex; align-items: center; gap: 10px; }
.run-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.keyinfo-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.keyinfo { display: flex; gap: 6px; flex-wrap: wrap; }
.lost-tip { margin-bottom: 0; }
.gpu-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; align-items: center; }
.gpu-item {
  display: flex; flex-direction: column; gap: 0 5px;
  padding: 6px 10px; background: #f7f8fa; border: 1px solid #ebeef5; border-radius: 6px;
}
.gpu-idx { font-size: 11px; font-weight: 600; color: #909399; letter-spacing: 0.4px; line-height: 1; }
.gpu-metric { display: flex; align-items: center; gap: 8px; }
.gpu-metric-label { flex: none; width: 36px; font-size: 12px; color: #606266; }
.gpu-meter { flex: none; width: 72px; height: 4px; border-radius: 2px; background: #e4e7ed; overflow: hidden; }
.gpu-meter-fill { display: block; height: 100%; border-radius: 2px; transition: width 0.3s ease; }
.gpu-metric-value { font-size: 12px; font-weight: 600; color: #303133; font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; }
.logbox {
  flex: 1; overflow-y: auto; background: #10161f; border-radius: 6px;
  padding: 8px; font-family: Consolas, monospace; font-size: 12px; line-height: 1.5;
}
.line { white-space: pre-wrap; word-break: break-all; color: #c9d4e0; }
.lv-error { color: #ff7875; }
.lv-warn { color: #ffd666; }
.lv-ready { color: #73d13d; font-weight: 700; }
.dim { color: #5c6b7a; }
</style>
