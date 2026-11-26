<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useWorkspaceStore } from '../../stores/workspace';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const newCollectionName = ref('');

async function confirmCreateCollection() {
  if (!newCollectionName.value.trim()) return;
  await ws.createCollection(newCollectionName.value);
  newCollectionName.value = '';
  emit('update:visible', false);
  ElMessage.success('Collection created');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="New Collection"
    width="min(92vw, 360px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-input
      v-model="newCollectionName"
      placeholder="Collection name"
      @keyup.enter="confirmCreateCollection"
    />
    <template #footer>
      <el-button @click="emit('update:visible', false)">Cancel</el-button>
      <el-button type="primary" @click="confirmCreateCollection">
        Create
      </el-button>
    </template>
  </el-dialog>
</template>
