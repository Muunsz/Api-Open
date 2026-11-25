<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useWorkspaceStore } from '../stores/workspace';
import { resolveVariables } from '../utils/variables';

interface RealtimeLog {
  id: string;
  direction: 'sent' | 'received' | 'system';
  data: string;
  timestamp: string;
}

const props = defineProps<{
  protocol: 'ws' | 'sse';
}>();

const wsStore = useWorkspaceStore();

const url = ref(
  props.protocol === 'ws'
    ? 'wss://echo.websocket.events'
    : 'https://stream.wikimedia.org/v2/stream/recentchange',
);
const connected = ref(false);
const connecting = ref(false);
const messageInput = ref('{\n  "hello": "api-open"\n}');
const logs = ref<RealtimeLog[]>([]);

let socket: WebSocket | null = null;
let eventSource: EventSource | null = null;

function pushLog(direction: RealtimeLog['direction'], data: string) {
  logs.value.unshift({
    id: Math.random().toString(36).slice(2, 10),
    direction,
    data,
    timestamp: new Date().toLocaleTimeString(),
  });
  if (logs.value.length > 200) {
    logs.value = logs.value.slice(0, 200);
  }
}

function connect() {
  disconnect();
  const resolved = resolveVariables(url.value.trim(), wsStore.activeVariablesMap);
  if (!resolved) {
    ElMessage.warning('Please enter a valid URL');
    return;
  }

  connecting.value = true;

  if (props.protocol === 'ws') {
    try {
      socket = new WebSocket(resolved);
      socket.onopen = () => {
        connecting.value = false;
        connected.value = true;
        pushLog('system', `Connected to ${resolved}`);
      };
      socket.onmessage = (event) => {
        pushLog('received', String(event.data));
      };
      socket.onerror = () => {
        connecting.value = false;
        pushLog('system', 'WebSocket error occurred');
      };
      socket.onclose = (event) => {
        connecting.value = false;
        connected.value = false;
        pushLog(
          'system',
          `Disconnected (code: ${event.code}${event.reason ? `, reason: ${event.reason}` : ''})`,
        );
      };
    } catch (err) {
      connecting.value = false;
      ElMessage.error(err instanceof Error ? err.message : 'Failed to connect');
    }
  } else {
    try {
      eventSource = new EventSource(resolved);
      eventSource.onopen = () => {
        connecting.value = false;
        connected.value = true;
        pushLog('system', `SSE stream opened: ${resolved}`);
      };
      eventSource.onmessage = (event) => {
        pushLog('received', event.data);
      };
      eventSource.onerror = () => {
        connecting.value = false;
        connected.value = false;
        pushLog('system', 'SSE connection error or closed');
      };
    } catch (err) {
      connecting.value = false;
      ElMessage.error(err instanceof Error ? err.message : 'Failed to open SSE');
    }
  }
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  connected.value = false;
  connecting.value = false;
}

function sendMessage() {
  if (!socket || !connected.value) return;
  const resolvedMsg = resolveVariables(
    messageInput.value,
    wsStore.activeVariablesMap,
  );
  socket.send(resolvedMsg);
  pushLog('sent', resolvedMsg);
}

onUnmounted(() => {
  disconnect();
});
</script>

<template>
  <div class="realtime-panel">
    <div class="request-bar">
      <el-tag
        :type="connected ? 'success' : 'info'"
        size="large"
        effect="plain"
      >
        {{ protocol.toUpperCase() }}
      </el-tag>
      <el-input
        v-model="url"
        :placeholder="
          protocol === 'ws'
            ? 'wss://echo.websocket.events'
            : 'https://example.com/events'
        "
        :disabled="connected"
      />
      <el-button
        v-if="!connected"
        type="primary"
        :loading="connecting"
        @click="connect"
      >
        Connect
      </el-button>
      <el-button v-else type="danger" @click="disconnect">
        Disconnect
      </el-button>
    </div>

    <div v-if="protocol === 'ws'" class="ws-composer">
      <el-input
        v-model="messageInput"
        type="textarea"
        :rows="4"
        class="code-area"
        placeholder="Message to send over WebSocket..."
      />
      <div class="ws-send-row">
        <el-button
          type="primary"
          size="small"
          :disabled="!connected"
          @click="sendMessage"
        >
          Send Message
        </el-button>
      </div>
    </div>

    <div class="logs-section">
      <div class="logs-header">
        <span>Messages ({{ logs.length }})</span>
        <el-button
          v-if="logs.length"
          link
          type="danger"
          size="small"
          :icon="Delete"
          @click="logs = []"
        >
          Clear
        </el-button>
      </div>

      <el-empty
        v-if="!logs.length"
        description="Connect to start streaming messages"
        :image-size="54"
      />

      <div v-else class="logs-list">
        <div v-for="log in logs" :key="log.id" class="log-row">
          <div class="log-meta">
            <el-tag
              size="small"
              :type="
                log.direction === 'sent'
                  ? 'primary'
                  : log.direction === 'received'
                    ? 'success'
                    : 'info'
              "
            >
              {{ log.direction.toUpperCase() }}
            </el-tag>
            <el-text size="small" type="info">{{ log.timestamp }}</el-text>
          </div>
          <pre class="log-data">{{ log.data }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.realtime-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}
.request-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.request-bar :deep(.el-input) {
  flex: 1;
  min-width: 200px;
}
.ws-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ws-send-row {
  display: flex;
  justify-content: flex-end;
}
.code-area :deep(textarea) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}
.logs-section {
  border-top: 1px solid #e4e7ed;
  padding-top: 10px;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 8px;
}
.logs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
}
.log-row {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 8px 10px;
  background: #fafafa;
}
.log-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.log-data {
  margin: 0;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
