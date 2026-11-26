<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useTabsStore } from '../../stores/tabs';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const store = useTabsStore();
const curlInput = ref('');

function handleImportCurl() {
  try {
    store.importCurl(curlInput.value);
    curlInput.value = '';
    emit('update:visible', false);
    ElMessage.success('cURL imported');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Invalid cURL command',
    );
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Import cURL"
    width="min(94vw, 560px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-input
      v-model="curlInput"
      type="textarea"
      :rows="7"
      class="code-area"
      placeholder="Paste cURL command here (e.g. curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{&quot;name&quot;:&quot;test&quot;}')"
    />
    <template #footer>
      <el-button @click="emit('update:visible', false)">Cancel</el-button>
      <el-button type="primary" @click="handleImportCurl">Import</el-button>
    </template>
  </el-dialog>
</template>
