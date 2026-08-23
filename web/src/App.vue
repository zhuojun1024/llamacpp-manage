<template>
  <el-container class="app">
    <el-header class="header">
      <div class="title">
        <el-icon :size="20"><Cpu /></el-icon>
        <span>llama.cpp 模型管理器</span>
      </div>
      <div class="actions">
        <el-tag :type="state.connected ? 'success' : 'danger'" size="small" class="conn">
          {{ state.connected ? '实时连接' : '连接断开' }}
        </el-tag>
        <el-button size="small" @click="showImport = true"><el-icon><Upload /></el-icon>导入</el-button>
        <el-button size="small" @click="onExport"><el-icon><Download /></el-icon>导出</el-button>
        <el-button size="small" @click="showSettings = true"><el-icon><Setting /></el-icon>设置</el-button>
        <el-button size="small" type="primary" @click="onNew"><el-icon><Plus /></el-icon>新建配置</el-button>
      </div>
    </el-header>

    <el-main class="main">
      <el-row :gutter="12" class="row">
        <el-col :xs="24" :md="12" class="col-left">
          <ProfileTable
            @new="onNew"
            @edit="onEdit"
          />
        </el-col>
        <el-col :xs="24" :md="12" class="col-right">
        <LogPanel />
        </el-col>
      </el-row>
    </el-main>

    <ProfileForm v-model:visible="formVisible" :profile="editing" @saved="refreshProfiles" />
    <ImportDialog v-model:visible="showImport" @done="refreshProfiles" />
    <SettingsDialog v-model:visible="showSettings" />
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { state, refreshProfiles } from './store'
import { downloadExport } from './api'
import ProfileTable from './components/ProfileTable.vue'
import ProfileForm from './components/ProfileForm.vue'
import LogPanel from './components/LogPanel.vue'
import ImportDialog from './components/ImportDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'

const formVisible = ref(false)
const editing = ref(null)
const showImport = ref(false)
const showSettings = ref(false)

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
    ElMessage.success('已导出 llama-server.txt')
  } catch (e) {
    ElMessage.error('导出失败：' + e.message)
  }
}

onMounted(refreshProfiles)
</script>

<style>
html, body, #app { height: 100%; margin: 0; }
.app { height: 100%; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  background: #1d2939; color: #fff;
}
.header .title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }
.header .actions { display: flex; align-items: center; gap: 8px; }
.header .actions .el-button { --el-button-bg-color: transparent; --el-button-border-color: #4a5a6a; --el-button-text-color: #dce3ea; --el-button-hover-bg-color: #2c3e50; }
.header .actions .el-button--primary { --el-button-bg-color: #409eff; --el-button-border-color: #409eff; --el-button-text-color: #fff; }
.header .conn { margin-right: 4px; }
.main { padding: 12px; }
.row { height: 100%; }
.col-left, .col-right { height: 100%; }
</style>
