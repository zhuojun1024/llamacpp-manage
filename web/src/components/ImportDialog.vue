<template>
  <el-dialog v-model="vis" title="IMPORT PROFILES" width="640px" destroy-on-close>
    <el-alert type="info" :closable="false" style="margin-bottom: 12px"
      title="Two sources: pick an existing llama-server.txt file, or paste command text. `#` comment lines become descriptions; commands identical to existing profiles are skipped." />

    <el-radio-group v-model="mode" style="margin-bottom: 12px">
      <el-radio-button value="file">FILE</el-radio-button>
      <el-radio-button value="paste">PASTE</el-radio-button>
    </el-radio-group>

    <el-upload v-if="mode === 'file'" drag :auto-upload="false" :limit="1" accept=".txt"
      :on-change="onFileChange" :on-remove="() => (fileText = '')">
      <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
      <div class="el-upload__text">Drag file here, or <em>click to browse</em></div>
    </el-upload>

    <el-input v-else v-model="fileText" type="textarea" :rows="10"
      placeholder="Paste llama-server.txt content (# desc lines + command lines)" />

    <template #footer>
      <el-button link @click="vis = false">CANCEL</el-button>
      <el-button link type="primary" :loading="importing" :disabled="!fileText" @click="onImport">IMPORT</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['update:visible', 'done'])

const vis = computed({ get: () => props.visible, set: v => emit('update:visible', v) })
const mode = ref('file')
const fileText = ref('')
const importing = ref(false)

function onFileChange(uploadFile) {
  const reader = new FileReader()
  reader.onload = () => { fileText.value = String(reader.result || '') }
  reader.readAsText(uploadFile.raw, 'utf-8')
}

async function onImport() {
  importing.value = true
  try {
    const r = await api.importProfiles({ text: fileText.value })
    ElMessage.success(`Import done: ${r.added} added, ${r.skipped} dup skipped${r.failed ? `, ${r.failed} failed` : ''}`)
    emit('done')
    vis.value = false
  } catch (e) {
    ElMessage.error('Import failed: ' + e.message)
  } finally {
    importing.value = false
  }
}
</script>
