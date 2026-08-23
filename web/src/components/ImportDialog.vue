<template>
  <el-dialog v-model="vis" title="导入启动命令" width="640px" destroy-on-close>
    <el-alert type="info" :closable="false" style="margin-bottom: 12px"
      title="支持两种来源：选择现有 llama-server.txt 文件，或直接粘贴命令文本。`#` 注释行将作为描述导入；与现有配置完全相同的命令会自动跳过。" />

    <el-radio-group v-model="mode" style="margin-bottom: 12px">
      <el-radio-button value="file">选择文件</el-radio-button>
      <el-radio-button value="paste">粘贴文本</el-radio-button>
    </el-radio-group>

    <el-upload v-if="mode === 'file'" drag :auto-upload="false" :limit="1" accept=".txt"
      :on-change="onFileChange" :on-remove="() => (fileText = '')">
      <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
      <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
    </el-upload>

    <el-input v-else v-model="fileText" type="textarea" :rows="10"
      placeholder="粘贴 llama-server.txt 内容（# 描述行 + 命令行）" />

    <template #footer>
      <el-button @click="vis = false">取消</el-button>
      <el-button type="primary" :loading="importing" :disabled="!fileText" @click="onImport">导入</el-button>
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
    ElMessage.success(`导入完成：新增 ${r.added}，跳过重复 ${r.skipped}${r.failed ? `，失败 ${r.failed}` : ''}`)
    emit('done')
    vis.value = false
  } catch (e) {
    ElMessage.error('导入失败：' + e.message)
  } finally {
    importing.value = false
  }
}
</script>
