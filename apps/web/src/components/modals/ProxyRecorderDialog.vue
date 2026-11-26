<script setup lang="ts">
import { computed, ref } from 'vue';
import type { HttpMethod } from '@api-open/shared';
import { CopyDocument, Delete, Refresh, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { API_BASE } from '../../services/httpClient';
import {
  clearRecordedTraffic,
  getRecordedTraffic,
} from '../../services/proxyService';
import { useTabsStore } from '../../stores/tabs';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const tabsStore = useTabsStore();
const sessionId = ref('rec-' + Math.random().toString(36).slice(2, 8));
const targetBase = ref('https://jsonplaceholder.typicode.com');
const entries = ref<
  Array<{
    id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
    statusCode: number;
    durationMs: number;
    responseBody: string;
    timestamp: string;
  }>
>([]);

const recorderUrl = computed(
  () => `${API_BASE}/proxy/record/${sessionId.value}/todos/1?target=${encodeURIComponent(targetBase.value)}`,
);

async function copyRecorderUrl() {
  await navigator.clipboard.writeText(recorderUrl.value);
  ElMessage.success('Recorder proxy URL copied');
}

async function refreshTraffic() {
  entries.value = await getRecordedTraffic(sessionId.value);
}

async function clearTraffic() {
  await clearRecordedTraffic(sessionId.value);
  entries.value = [];
}

function openCapturedInTab(entry: (typeof entries.value)[number]) {
  tabsStore.addTab({
    name: `${entry.method} ${entry.url}`,
    method: entry.method as HttpMethod,
    url: entry.url,
    body: entry.body
      ? { mode: 'raw', raw: entry.body, rawType: 'json' }
      : { mode: 'none' },
  });
  emit('update:visible', false);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Proxy Recorder / HTTP Traffic Sniffer"
    width="min(95vw, 820px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div style="display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <el-input
          v-model="targetBase"
          size="small"
          placeholder="Target Base URL (e.g. https://api.example.com)"
          style="flex: 1; min-width: 220px"
        />
        <el-button size="small" :icon="CopyDocument" @click="copyRecorderUrl">
          Copy Recorder URL
        </el-button>
        <el-button size="small" type="primary" :icon="Refresh" @click="refreshTraffic">
          Refresh ({{ entries.length }})
        </el-button>
        <el-button size="small" type="danger" plain :icon="Delete" @click="clearTraffic">
          Clear
        </el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        :title="`Send client traffic to: ${API_BASE}/proxy/record/${sessionId}/<path>?target=${targetBase}`"
      />

      <el-empty
        v-if="!entries.length"
        description="No captured requests yet. Route requests through the recorder URL above and click Refresh."
        :image-size="48"
      />

      <div v-else style="display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto">
        <div
          v-for="item in entries"
          :key="item.id"
          style="
            padding: 8px 10px;
            border: 1px solid var(--ao-border);
            border-radius: 6px;
            background: var(--ao-surface-2);
            display: flex;
            align-items: center;
            gap: 8px;
          "
        >
          <span class="method-badge" :class="`method-${item.method}`">{{ item.method }}</span>
          <code style="flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis">{{ item.url }}</code>
          <el-tag size="small" :type="item.statusCode < 400 ? 'success' : 'danger'">
            {{ item.statusCode }}
          </el-tag>
          <span style="font-size: 11px; color: var(--ao-text-muted)">{{ item.durationMs }}ms</span>
          <el-button size="small" :icon="Upload" @click="openCapturedInTab(item)">
            Open Tab
          </el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>
