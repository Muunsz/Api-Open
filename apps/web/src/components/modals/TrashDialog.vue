<script setup lang="ts">
import { Delete, RefreshLeft } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useWorkspaceStore } from '../../stores/workspace';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'update:visible', val: boolean): void }>();

const ws = useWorkspaceStore();

async function restore(id: string) {
  try {
    await ws.restoreTrashItem(id);
    ElMessage.success('Restored from Trash');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Restore failed');
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Trash / Recycle Bin"
    width="min(94vw, 640px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div style="display: flex; justify-content: space-between; margin-bottom: 10px">
      <el-text size="small" type="info">
        Deleted collections, requests, and environments can be restored here.
      </el-text>
      <el-button
        v-if="ws.trashItems.length"
        size="small"
        type="danger"
        plain
        :icon="Delete"
        @click="ws.emptyTrash()"
      >
        Empty Trash
      </el-button>
    </div>
    <el-empty v-if="!ws.trashItems.length" description="Trash is empty" :image-size="48" />
    <el-table v-else :data="ws.trashItems" size="small" border max-height="320">
      <el-table-column prop="kind" label="Type" width="110" />
      <el-table-column prop="name" label="Name" />
      <el-table-column label="Deleted" width="160">
        <template #default="{ row }">{{ new Date(row.deletedAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="Action" width="110" align="center">
        <template #default="{ row }">
          <el-button size="small" type="primary" plain :icon="RefreshLeft" @click="restore(row.id)">
            Restore
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>
