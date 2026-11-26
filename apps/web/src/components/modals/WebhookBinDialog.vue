<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { CopyDocument, Delete, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { API_BASE } from '../../services/httpClient';

interface WebhookEventItem {
  id: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: string;
  timestamp: string;
}

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const binId = ref(
  localStorage.getItem('api_open_webhook_bin_id') ||
    `bin-${Math.random().toString(36).slice(2, 10)}`,
);
localStorage.setItem('api_open_webhook_bin_id', binId.value);

const webhookUrl = computed(() => `${API_BASE}/proxy/webhook/${binId.value}`);
const events = ref<WebhookEventItem[]>([]);
const loading = ref(false);
let pollTimer: number | null = null;

async function fetchEvents() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/proxy/webhook/${binId.value}/events`);
    if (res.ok) {
      events.value = (await res.json()) as WebhookEventItem[];
    }
  } finally {
    loading.value = false;
  }
}

async function clearEvents() {
  await fetch(`${API_BASE}/proxy/webhook/${binId.value}/events`, { method: 'DELETE' });
  events.value = [];
}

async function copyUrl() {
  await navigator.clipboard.writeText(webhookUrl.value);
  ElMessage.success('Webhook URL copied');
}

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      fetchEvents();
      pollTimer = window.setInterval(fetchEvents, 3000);
    } else if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  },
);

onUnmounted(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
});
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Webhook Receiver / Request Bin"
    width="min(94vw, 760px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center">
      <el-input :model-value="webhookUrl" readonly size="small" style="flex: 1" />
      <el-button size="small" :icon="CopyDocument" @click="copyUrl">Copy URL</el-button>
      <el-button size="small" :icon="Refresh" :loading="loading" @click="fetchEvents">Refresh</el-button>
      <el-button size="small" type="danger" plain :icon="Delete" @click="clearEvents">Clear</el-button>
    </div>

    <el-empty v-if="!events.length" description="Waiting for incoming webhooks (auto-polling every 3s)..." :image-size="48" />

    <div v-else style="display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow: auto">
      <div
        v-for="ev in events"
        :key="ev.id"
        style="border: 1px solid var(--ao-border); border-radius: 6px; padding: 10px"
      >
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px">
          <el-tag size="small">{{ ev.method }}</el-tag>
          <span style="font-size: 11px; opacity: 0.7">{{ new Date(ev.timestamp).toLocaleString() }}</span>
        </div>
        <pre v-if="ev.body" style="margin: 0; font-size: 12px; white-space: pre-wrap; max-height: 140px; overflow: auto">{{ ev.body }}</pre>
        <div v-else style="font-size: 12px; opacity: 0.6">(Empty body)</div>
      </div>
    </div>
  </el-dialog>
</template>
