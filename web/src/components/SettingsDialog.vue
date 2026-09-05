<template>
  <el-dialog v-model="vis" title="SETTINGS" width="520px" destroy-on-close>
    <el-form label-width="140px" v-loading="loading">
      <el-form-item label="DEFAULT llama-server">
        <el-input v-model="form.exe" placeholder="C:\llama\llama-server.exe" />
      </el-form-item>
      <el-form-item label="MODEL DIR">
        <el-input v-model="form.modelDir" placeholder="D:\LLM" />
        <span class="tip">Scan scope (incl. subdirs) for auto-completing model / mmproj / draft paths in forms</span>
      </el-form-item>
      <el-form-item label="LOG KEEP">
        <el-input-number v-model="form.logKeep" :min="1" :max="200" />
        <span class="tip">Max log files kept per profile</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button link @click="vis = false">CANCEL</el-button>
      <el-button link type="primary" :loading="saving" @click="onSave">SAVE</el-button>
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
    ElMessage.success('SAVED')
    vis.value = false
  } catch (e) {
    ElMessage.error('Save failed: ' + e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.tip { color: var(--term-text-3); font-size: 12px; margin-left: 8px; }
</style>
