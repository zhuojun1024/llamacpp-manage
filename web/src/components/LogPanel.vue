<template>
  <div :class="['log-panel', { fullscreen }]">
    <el-empty v-if="!runList.length" description="No running instance. Hit START and logs will stream here." :image-size="80" />

    <div v-else class="run-panel">
      <!-- 关键信息卡片（左侧实例信息 + 右侧 GPU 显存/利用率） -->
      <div class="keyinfo-bar">
        <div class="keyinfo" v-if="activeKeyInfo.listenPort || activeKeyInfo.loadTimeMs">
          <el-tag v-if="activeKeyInfo.listenPort" type="success" size="small">
            LISTEN {{ activeKeyInfo.listenHost || 'localhost' }}:{{ activeKeyInfo.listenPort }}
          </el-tag>
          <!-- <el-tag v-if="activeKeyInfo.loadTimeMs" type="info" size="small">load {{ activeKeyInfo.loadTimeMs }} ms</el-tag>
          <el-tag v-if="activeKeyInfo.nCtx" type="info" size="small">n_ctx {{ activeKeyInfo.nCtx }}</el-tag>
          <el-tag v-if="activeKeyInfo.nGpuLayers" type="info" size="small">ngl {{ activeKeyInfo.nGpuLayers }}</el-tag>
          <el-tag :type="activeRun.status === 'running' ? 'success' : activeRun.status === 'starting' ? 'warning' : 'danger'" size="small">
            {{ statusText(activeRun.status) }}
          </el-tag> -->
        </div>
        <div class="keyinfo lost-tip" v-else-if="activeRun.status === 'lost'">
          <el-tag type="danger" size="small">LOST: process alive but not started by manager, no log stream (PID {{ activeRun.pid }}). STOP still works.</el-tag>
        </div>
        <div class="gpu-tags" v-if="gpuList.length">
          <div class="gpu-item" v-for="g in gpuList" :key="g.index">
            <div class="gpu-idx">GPU {{ g.index }}</div>
            <div class="gpu-metric">
              <span class="gpu-metric-label">VRAM</span>
              <span class="gpu-meter"><i class="gpu-meter-fill" :style="{ width: g.memPct + '%', background: barColor(g.memPct) }"></i></span>
              <span class="gpu-metric-value">{{ g.memUsedGb.toFixed(2) }} GB</span>
            </div>
            <div class="gpu-metric">
              <span class="gpu-metric-label">UTIL</span>
              <span class="gpu-meter"><i class="gpu-meter-fill" :style="{ width: g.util + '%', background: barColor(g.util) }"></i></span>
              <span class="gpu-metric-value">{{ g.util }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 日志区：只渲染最近 RENDER_LIMIT 行，DOM 节点数恒定；向上滚到顶加载更早日志 -->
      <div ref="boxRef" class="logbox" @scroll="onScroll" @wheel="onWheel" @touchmove="onTouchMove">
        <div v-if="viewStart > 0" class="line dim">… {{ viewStart }} more lines above, scroll up to load</div>
        <div v-for="l in visibleLines" :key="l.id" :class="['line', 'lv-' + l.level]">{{ l.line }}</div>
        <div v-if="!totalLines" class="line dim">(no logs)</div>
        <div v-else-if="!visibleLines.length" class="line dim">(no matching logs)</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { state, logBuf } from '../store'
import { api } from '../api'

const RENDER_LIMIT = 500 // 单次渲染的日志行数上限（完整日志可点「下载」获取）

// 过滤 / 自动滚动 / 全屏由 App 的 tab 栏控制，经 props 传入
const props = defineProps({
  filter: { type: String, default: '' },
  autoScroll: { type: Boolean, default: true },
  fullscreen: { type: Boolean, default: false }
})
const emit = defineEmits(['update:fullscreen'])
const gpuList = ref([]) // 本机 NVIDIA 显卡（显存/利用率）

function onKeydown(e) {
  if (e.key === 'Escape' && props.fullscreen) emit('update:fullscreen', false)
}
async function pollGpus() {
  try {
    const data = await api.gpus()
    gpuList.value = data.gpus || []
  } catch { gpuList.value = [] }
}
function barColor(pct) {
  return pct >= 90 ? '#ff5252' : pct >= 70 ? '#ffb000' : '#00e676'
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
let atBottom = true // 手动模式下：用户是否停留在底部（决定渲染窗口是否跟随最新）
let extending = false

// 自动滚动模式下检测到手动滚动：提示并限流（3 秒内只提示一次）
let warnTimer = null
function warnManualScroll() {
  if (warnTimer) return
  warnTimer = setTimeout(() => { warnTimer = null }, 3000)
  ElMessage.warning('Turn off AUTO-SCROLL to scroll manually')
}
// 自动滚动模式：拦截滚轮/触摸，禁止手动滚动
function onWheel(e) {
  if (props.autoScroll) { e.preventDefault(); warnManualScroll() }
}
function onTouchMove(e) {
  if (props.autoScroll) { e.preventDefault(); warnManualScroll() }
}

const runList = computed(() => Object.values(state.runs))
const activeRun = computed(() => runList.value[0] || null) // 同时只运行一个模型
const activeBuf = computed(() => (activeRun.value ? logBuf(activeRun.value.profileId) : null))
const activeKeyInfo = computed(() => (activeBuf.value ? activeBuf.value.keyInfo : {}))
const totalLines = computed(() => (activeBuf.value ? activeBuf.value.lines.length : 0))

function statusText(s) {
  return { starting: 'STARTING', running: 'RUNNING', lost: 'LOST' }[s] || (s || '').toUpperCase()
}

// 渲染窗口 [viewStart, viewStart+RENDER_LIMIT)：位于底部时跟随最新行；
// 用户向上滚动后起点冻结，新日志追加在下方，不打断阅读
const viewStartRef = ref(0)
const viewStart = computed(() => Math.min(viewStartRef.value, Math.max(0, totalLines.value - RENDER_LIMIT)))
const visibleLines = computed(() => {
  const lines = activeBuf.value ? activeBuf.value.lines : []
  const slice = lines.slice(viewStart.value, viewStart.value + RENDER_LIMIT)
  const f = props.filter.trim().toLowerCase()
  return f ? slice.filter(l => l.line.toLowerCase().includes(f)) : slice
})

function activeBox() {
  return boxRef.value
}

// 新日志到达：自动滚动模式始终跟随最新；手动模式仅在用户停留在底部时跟随
watch(totalLines, async () => {
  if (props.autoScroll) {
    viewStartRef.value = Math.max(0, totalLines.value - RENDER_LIMIT)
    await scrollBottom()
    return
  }
  if (!atBottom) return
  viewStartRef.value = Math.max(0, totalLines.value - RENDER_LIMIT)
  await scrollBottom()
})
// 切换自动滚动：开启时立即回到底部；关闭时保持当前位置
watch(() => props.autoScroll, async (v) => {
  if (v) {
    atBottom = true
    viewStartRef.value = Math.max(0, totalLines.value - RENDER_LIMIT)
    await scrollBottom()
  }
})
// 运行实例变化（启动/停止）时重置滚动状态并回到最新日志
watch(() => activeRun.value && activeRun.value.profileId, async () => {
  atBottom = true
  lastTop = -1
  viewStartRef.value = 0
  if (props.autoScroll) await scrollBottom()
})
async function scrollBottom() {
  await nextTick()
  const el = activeBox()
  if (el) el.scrollTop = el.scrollHeight
}
let lastTop = -1 // 上次 scrollTop，用于判断滚动方向（仅手动模式使用）
function onScroll() {
  const el = activeBox()
  if (!el) return
  const top = el.scrollTop
  // 自动滚动模式：滚轮/触摸已被拦截，scrollTop 变化只来自程序性滚动，不改变跟随状态
  if (props.autoScroll) { lastTop = top; return }
  const goingDown = top >= lastTop
  lastTop = top
  const atEnd = el.scrollHeight - top - el.clientHeight < 30
  if (atEnd) {
    if (goingDown) {
      // 向下滚回/拖回底部：恢复跟随，窗口跳到最新（一次性显示被跳过的日志）
      if (!atBottom) viewStartRef.value = Math.max(0, totalLines.value - RENDER_LIMIT)
      atBottom = true
      scrollBottom()
    } else {
      // 向上滚轮落在 30px 判定区内：同样视为离开底部，不恢复跟随（否则小位移滚轮会被反复拽回）
      atBottom = false
    }
  } else {
    // 向上滚动：冻结窗口起点，新日志追加在下方，不打断阅读
    atBottom = false
    viewStartRef.value = Math.min(viewStartRef.value, Math.max(0, totalLines.value - RENDER_LIMIT))
    if (top < 30 && viewStart.value > 0) extendUp(el)
  }
}
// 滚到窗口顶部且缓冲中还有更早日志：向前扩展窗口并保持阅读位置
async function extendUp(el) {
  if (extending) return
  extending = true
  try {
    const prevHeight = el.scrollHeight
    viewStartRef.value = Math.max(0, viewStartRef.value - RENDER_LIMIT)
    await nextTick()
    el.scrollTop += el.scrollHeight - prevHeight
  } finally {
    extending = false
  }
}

</script>

<style scoped>
.log-panel { height: 100%; display: flex; flex-direction: column; }
.log-panel.fullscreen {
  position: fixed; inset: 0; z-index: 3000; background: var(--term-bg);
  /* 覆盖整个 Electron 窗口（viewport），非显示器全屏 */
}
.run-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.keyinfo-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.keyinfo { display: flex; gap: 6px; flex-wrap: wrap; }
.lost-tip { margin-bottom: 0; }
.gpu-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; align-items: center; }
.gpu-item {
  display: flex; flex-direction: column; gap: 0 5px;
  padding: 6px 10px; background: var(--term-bg-3); border: 1px solid var(--term-border); border-radius: 2px;
}
.gpu-idx { font-size: 11px; font-weight: 600; color: var(--term-green); letter-spacing: 0.4px; line-height: 1; }
.gpu-metric { display: flex; align-items: center; gap: 8px; }
.gpu-metric-label { flex: none; width: 36px; font-size: 12px; color: var(--term-text-2); }
.gpu-meter { flex: none; width: 72px; height: 4px; border-radius: 2px; background: var(--term-border-2); overflow: hidden; }
.gpu-meter-fill { display: block; height: 100%; border-radius: 2px; transition: width 0.3s ease; box-shadow: 0 0 6px rgba(0, 230, 118, 0.4); }
.gpu-metric-value { font-size: 12px; font-weight: 600; color: var(--term-text); font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; }
.logbox {
  flex: 1; overflow-y: auto; background: #030705;
  border: 1px solid var(--term-border); border-radius: 2px;
  box-shadow: inset 0 0 24px rgba(0, 230, 118, 0.05);
  padding: 8px; font-family: var(--term-mono); font-size: 12px; line-height: 1.5;
}
.line { white-space: pre-wrap; word-break: break-all; color: #a8e6c0; }
.lv-error { color: #ff5252; text-shadow: 0 0 6px rgba(255, 82, 82, 0.4); }
.lv-warn { color: #ffb000; }
.lv-ready { color: #39ffb0; font-weight: 700; text-shadow: 0 0 8px rgba(57, 255, 176, 0.5); }
.dim { color: var(--term-text-3); }
</style>
