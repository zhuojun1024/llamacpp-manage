<template>
  <el-dialog v-model="vis" title="设置" width="520px" destroy-on-close>
    <el-form label-width="140px" v-loading="loading">
      <el-form-item label="默认 llama-server">
        <el-input v-model="form.exe" placeholder="C:\llama\llama-server.exe" />
      </el-form-item>
      <el-form-item label="模型目录">
        <el-input v-model="form.modelDir" placeholder="D:\LLM" />
        <span class="tip">表单中模型 / mmproj / 草稿模型路径自动补全的扫描范围（含子目录）</span>
      </el-form-item>
      <el-form-item label="日志保留份数">
        <el-input-number v-model="form.logKeep" :min="1" :max="200" />
        <span class="tip">每个配置最多保留的日志文件数</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="vis = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible'])

const vis = computed({ get: () => props.visible, set: v => emit('update:visible', v) })
const form = ref({ exe: '', logKeep: 20, modelDir: '' })
const loading = ref(false)
const saving = ref(false)

watch(() => props.visible, async (v) => {
  if (!v) return
  loading.value = true
  try {
    const s = await api.getSettings()
    form.value = { exe: s.exe || '', logKeep: s.logKeep ?? 20, modelDir: s.modelDir || '' }
  } finally {
    loading.value = false
  }
})

async function onSave() {
  saving.value = true
  try {
    await api.putSettings(form.value)
    ElMessage.success('已保存')
    vis.value = false
  } catch (e) {
    ElMessage.error('保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.tip { color: #909399; font-size: 12px; margin-left: 8px; }
</style>
