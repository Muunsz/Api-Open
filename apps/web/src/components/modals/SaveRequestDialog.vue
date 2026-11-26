<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useTabsStore } from '../../stores/tabs';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{
  visible: boolean;
  initialRequestName?: string;
  initialCollectionId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const store = useTabsStore();

const saveRequestName = ref('');
const saveCollectionId = ref('');

watch(
  () =>
    [
      props.visible,
      props.initialRequestName,
      props.initialCollectionId,
    ] as const,
  ([vis, name, colId]) => {
    if (vis) {
      saveRequestName.value = name || store.activeTab?.name || 'New Request';
      saveCollectionId.value = colId || ws.collections[0]?.id || '';
    }
  },
  { immediate: true },
);

async function confirmSaveRequest() {
  if (!saveCollectionId.value) {
    ElMessage.warning('Create or select a collection first');
    return;
  }
  await store.saveActiveTab(saveCollectionId.value, saveRequestName.value);
  emit('update:visible', false);
  ElMessage.success('Request saved');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Save Request"
    width="min(92vw, 400px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-position="top">
      <el-form-item label="Request Name">
        <el-input v-model="saveRequestName" />
      </el-form-item>
      <el-form-item label="Collection">
        <el-select v-model="saveCollectionId" style="width: 100%">
          <el-option
            v-for="c in ws.collections"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">Cancel</el-button>
      <el-button type="primary" @click="confirmSaveRequest">Save</el-button>
    </template>
  </el-dialog>
</template>
