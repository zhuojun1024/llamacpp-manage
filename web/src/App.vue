<template>
  <div class="app">
    <!-- 自定义标题栏（无边框窗口）：可拖拽 + 终端风窗口控制按钮 -->
    <div class="titlebar" @dblclick="onTitlebarDblClick">
      <div class="tb-left">
        <span class="term-prompt">root@llama:~$</span>
        <span class="cmd term-glow-text">./llama-manage --ui</span>
        <!-- <span class="term-cursor"></span> -->
      </div>
      <div class="tb-right">
        <el-tag :type="state.connected ? 'success' : 'danger'" size="small" class="conn">
          {{ state.connected ? '● LINK' : '○ LOST' }}
        </el-tag>
        <el-button link @click="showImport = true">IMPORT</el-button>
        <el-button link @click="onExport">EXPORT</el-button>
        <el-button link @click="showSettings = true">SETTINGS</el-button>
        <el-button link type="primary" @click="onNew">NEW</el-button>
        <span v-if="isElectron" class="win-btns">
          <button class="win-btn" title="Minimize" @click="win.minimize()">─</button>
          <button class="win-btn" title="Maximize" @click="win.maximize()">□</button>
          <button class="win-btn win-btn-close" title="Close" @click="win.close()">✕</button>
        </span>
      </div>
    </div>

    <!-- tab 栏：左侧切换面板，右侧显示当前面板的工具（原卡片标题栏功能） -->
    <div class="tabbar">
      <el-tabs v-model="tab" class="tabs">
        <el-tab-pane :label="`[01] PROFILES (${state.profiles.length})`" name="profiles" />
        <el-tab-pane label="[02] LOGS" name="logs" />
      </el-tabs>
      <div class="tab-actions" v-if="tab === 'profiles'">
        <el-input v-model="filter" placeholder="search name / model / desc" size="small" clearable style="width: 240px" />
      </div>
      <div class="tab-actions" v-else-if="activeView">
        <el-input v-model="logFilter" placeholder="filter logs" size="small" clearable style="width: 160px" />
        <el-checkbox v-model="autoScroll" size="small">AUTO-SCROLL</el-checkbox>
        <el-button link @click="onDownload">LOG</el-button>
        <el-button link @click="fullscreen = !fullscreen">{{ fullscreen ? 'EXIT FULL' : 'FULL' }}</el-button>
      </div>
    </div>

    <div class="tab-body">
      <ProfileTable v-show="tab === 'profiles'" :filter="filter" @new="onNew" @edit="onEdit" @started="tab = 'logs'" />
      <LogPanel v-show="tab === 'logs'" :filter="logFilter" :auto-scroll="autoScroll" v-model:fullscreen="fullscreen" @show-logs="tab = 'logs'" />
    </div>

    <ProfileForm v-model:visible="formVisible" :profile="editing" @saved="refreshProfiles" />
    <ImportDialog v-model:visible="showImport" @done="refreshProfiles" />
    <SettingsDialog v-model:visible="showSettings" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { state, refreshProfiles } from './store'
import { downloadExport } from './api'
import ProfileTable from './components/ProfileTable.vue'
import ProfileForm from './components/ProfileForm.vue'
import LogPanel from './components/LogPanel.vue'
import ImportDialog from './components/ImportDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'

const isElectron = computed(() => !!(window.electronAPI))
const win = window.electronAPI || { minimize() {}, maximize() {}, close() {} }
function onTitlebarDblClick() { if (isElectron.value) win.maximize() }

const formVisible = ref(false)
const editing = ref(null)
const showImport = ref(false)
const showSettings = ref(false)

// tab 及两个面板的工具状态（原卡片标题栏，现置于 tab 右侧）
const tab = ref('profiles')
const filter = ref('') // 启动配置：搜索
const logFilter = ref('') // 实时日志：过滤
const autoScroll = ref(true)
const fullscreen = ref(false)
// 当前日志视图：运行中的 run，或最近退出的 run（保留日志供查看报错）
const activeView = computed(() => {
  const run = Object.values(state.runs)[0] || null
  if (run) return { profileId: run.profileId, exited: false, code: null, logFile: run.logFile }
  const le = state.lastExited
  if (le && state.logs[le.profileId]) return { profileId: le.profileId, exited: true, code: le.code, logFile: le.logFile }
  return null
})

function onNew() {
  editing.value = null
  formVisible.value = true
}
function onEdit(p) {
  editing.value = p
  formVisible.value = true
}
async function onExport() {
  try {
    await downloadExport()
    ElMessage.success('Exported llama-server.txt')
  } catch (e) {
    ElMessage.error('Export failed: ' + e.message)
  }
}
// 下载当前实例（运行中或最近退出）的日志文件
async function onDownload() {
  const view = activeView.value
  if (!view) return
  try {
    const resp = await fetch(`/api/runs/${view.profileId}/logfile`)
    if (!resp.ok) throw new Error('Log file not found')
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = view.logFile ? view.logFile.split('\\').pop() : 'run.log'
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

onMounted(refreshProfiles)
</script>

<style>
html, body, #app { height: 100%; margin: 0; }
.app { height: 100%; display: flex; flex-direction: column; background: var(--term-bg); }
/* 自定义标题栏 */
.titlebar {
  flex: none; height: 34px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px 0 12px;
  background: var(--term-bg-2);
  border-bottom: 1px solid var(--term-border);
  box-shadow: inset 0 -1px 12px rgba(0, 230, 118, 0.05);
  -webkit-app-region: drag; /* 整条可拖拽移动窗口 */
  user-select: none;
}
.titlebar .tb-left { display: flex; align-items: center; gap: 8px; font-size: 13px; font-family: var(--term-mono); }
.titlebar .tb-right { display: flex; align-items: center; gap: 8px; -webkit-app-region: no-drag; }
.titlebar .conn { margin-right: 4px; }
.win-btns { display: flex; align-items: center; }
.win-btn {
  width: 34px; height: 26px;
  border: none; background: transparent;
  color: var(--term-text-3); font-size: 12px; line-height: 1;
  font-family: var(--term-mono); cursor: pointer;
  border-radius: 2px;
}
.win-btn:hover { background: rgba(0, 230, 118, 0.10); color: var(--term-green); }
.win-btn-close:hover { background: rgba(255, 82, 82, 0.15); color: var(--term-red); }
.tabbar { flex: none; display: flex; align-items: center; gap: 12px; padding: 0 12px; background: var(--term-bg-2); border-bottom: 1px solid var(--term-border-2); }
.tabs { flex: 1; min-width: 0; }
.tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.tabs :deep(.el-tabs__content) { display: none; } /* 只用作 tab 栏，面板渲染在下方 tab-body */
.tab-actions { flex: none; display: flex; align-items: center; gap: 10px; }
.tab-body { flex: 1; min-height: 0; padding: 12px; }
.tab-body > * { height: 100%; }
</style>
