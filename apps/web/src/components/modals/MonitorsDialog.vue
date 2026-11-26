<script setup lang="ts">
import { ref, watch } from 'vue';
import { Delete, Plus, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();

watch(
  () => props.visible,
  (vis) => {
    if (vis) ws.ensureMonitorsLoaded();
  },
);
const name = ref('');
const collectionId = ref('');
const intervalMinutes = ref(60);
const creating = ref(false);

async function createMonitor() {
  if (!collectionId.value) {
    ElMessage.warning('Select a collection');
    return;
  }
  creating.value = true;
  try {
    await ws.createMonitor({
      collectionId: collectionId.value,
      name: name.value.trim() || 'API Health Monitor',
      intervalMinutes: intervalMinutes.value,
    });
    name.value = '';
    ElMessage.success('Monitor created');
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Scheduled Monitors (Cron Health Checks)"
    width="min(94vw, 720px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="modal-toolbar" style="margin-bottom: 12px">
      <el-input
        v-model="name"
        size="small"
        placeholder="Monitor name"
        style="width: 180px"
      />
      <el-select
        v-model="collectionId"
        size="small"
        placeholder="Select Collection"
        style="width: 180px"
      >
        <el-option
          v-for="c in ws.collections"
          :key="c.id"
          :label="c.name"
          :value="c.id"
        />
      </el-select>
      <el-select v-model="intervalMinutes" size="small" style="width: 140px">
        <el-option label="Every 5 min" :value="5" />
        <el-option label="Every 15 min" :value="15" />
        <el-option label="Every 60 min" :value="60" />
        <el-option label="Every 24 hours" :value="1440" />
      </el-select>
      <el-button
        size="small"
        type="primary"
        :icon="Plus"
        :loading="creating"
        @click="createMonitor"
      >
        Create Monitor
      </el-button>
    </div>

    <el-empty
      v-if="!ws.monitors.length"
      description="No scheduled monitors yet"
      :image-size="50"
    />

    <el-table v-else :data="ws.monitors" size="small" border>
      <el-table-column prop="name" label="Monitor" />
      <el-table-column label="Interval" width="110">
        <template #default="{ row }">{{ row.intervalMinutes }} min</template>
      </el-table-column>
      <el-table-column label="Last Result" width="150">
        <template #default="{ row }">
          <el-tag
            v-if="row.lastStatus"
            :type="row.lastStatus === 'healthy' ? 'success' : 'danger'"
            size="small"
          >
            {{ row.lastPassed }} pass / {{ row.lastFailed }} fail
          </el-tag>
          <span v-else style="color: var(--ao-text-muted)">Never run</span>
        </template>
      </el-table-column>
      <el-table-column label="Enabled" width="80" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            size="small"
            @change="ws.toggleMonitor(row.id, Boolean($event))"
          />
        </template>
      </el-table-column>
      <el-table-column label="Actions" width="110" align="center">
        <template #default="{ row }">
          <el-button
            :icon="VideoPlay"
            link
            type="primary"
            size="small"
            title="Run Now"
            @click="ws.runMonitorNow(row.id)"
          />
          <el-button
            :icon="Delete"
            link
            type="danger"
            size="small"
            @click="ws.deleteMonitor(row.id)"
          />
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>
