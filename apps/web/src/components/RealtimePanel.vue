<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Delete, FolderAdd } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { executeNativeGrpc, executeProxyRequest, reflectGrpcServer } from '../api/proxy';
import { workspaceApi } from '../api/workspace';
import { useWorkspaceStore } from '../stores/workspace';
import { resolveVariables } from '../utils/variables';

interface RealtimeLog {
  id: string;
  direction: 'sent' | 'received' | 'system';
  data: string;
  timestamp: string;
}

type RealtimeMode = 'ws' | 'sse' | 'socketio' | 'mqtt' | 'grpc-web' | 'grpc' | 'graphql-ws';

const props = defineProps<{
  protocol: 'ws' | 'sse';
}>();

const wsStore = useWorkspaceStore();

const mode = ref<RealtimeMode>(props.protocol);
const url = ref('');

watch(
  () => props.protocol,
  (nextProto) => {
    if (!connected.value && !connecting.value) {
      mode.value = nextProto;
    }
  },
);
const mqttTopic = ref('api-open/test');
const socketioEvent = ref('message');
const grpcContentType = ref<'application/grpc-web+proto' | 'application/grpc-web-text' | 'application/json'>('application/json');
const grpcUseTls = ref(false);
const grpcProtoText = ref('');
const grpcSelectedService = ref('');
const grpcSelectedMethod = ref('');
const protoFileInput = ref<HTMLInputElement | null>(null);
const protoMethods = ref<Array<{ service: string; name: string }>>([]);
const reflectingGrpc = ref(false);
const saveDialogVisible = ref(false);
const saveRequestName = ref('');
const saveCollectionId = ref('');

const savedRealtimeRequests = computed(() => {
  const items: Array<{ id: string; name: string; colName: string; url: string; bodyRaw: string; mode: RealtimeMode }> = [];
  for (const col of wsStore.collections) {
    for (const r of col.requests ?? []) {
      const m = r.settings && typeof r.settings === 'object' ? (r.settings as Record<string, unknown>).realtimeMode : undefined;
      if (typeof m === 'string' || /^wss?:\/\//i.test(r.url)) {
        items.push({
          id: r.id,
          name: r.name,
          colName: col.name,
          url: r.url,
          bodyRaw: r.body?.raw ?? '',
          mode: (typeof m === 'string' ? m : 'ws') as RealtimeMode,
        });
      }
    }
  }
  return items;
});

async function handleGrpcReflect() {
  const target = resolveVariables(url.value.trim(), wsStore.activeVariablesMap);
  if (!target) {
    ElMessage.warning('Enter a gRPC host:port first (e.g. localhost:50051)');
    return;
  }
  reflectingGrpc.value = true;
  try {
    const res = await reflectGrpcServer({ target, useTls: grpcUseTls.value });
    grpcProtoText.value = res.protoText;
    protoMethods.value = res.methods;
    if (res.methods[0]) {
      grpcSelectedService.value = res.methods[0].service;
      grpcSelectedMethod.value = res.methods[0].name;
    }
    ElMessage.success(`Reflected ${res.methods.length} RPC method(s)`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'gRPC reflection failed');
  } finally {
    reflectingGrpc.value = false;
  }
}

function openSaveRealtimeDialog() {
  if (!wsStore.accessToken || !wsStore.collections.length) {
    ElMessage.warning('Sign in and create a collection first');
    return;
  }
  saveCollectionId.value = wsStore.collections[0].id;
  saveRequestName.value = `${mode.value.toUpperCase()} ${url.value.slice(0, 32)}`;
  saveDialogVisible.value = true;
}

async function confirmSaveRealtime() {
  if (!wsStore.accessToken || !saveCollectionId.value || !saveRequestName.value.trim()) return;
  await workspaceApi.createRequest(wsStore.accessToken, saveCollectionId.value, {
    name: saveRequestName.value.trim(),
    method: 'GET',
    url: url.value.trim(),
    headers: [],
    queryParams: [],
    body: { mode: 'raw', raw: messageInput.value, rawType: 'json' },
    settings: {
      realtimeMode: mode.value,
      grpcService: grpcSelectedService.value,
      grpcMethod: grpcSelectedMethod.value,
      mqttTopic: mqttTopic.value,
      socketioEvent: socketioEvent.value,
    } as Record<string, unknown>,
  });
  await wsStore.refreshCollections();
  saveDialogVisible.value = false;
  ElMessage.success('Realtime endpoint saved to collection');
}

function loadSavedRealtime(reqId: string) {
  const found = savedRealtimeRequests.value.find((x) => x.id === reqId);
  if (!found) return;
  mode.value = found.mode;
  url.value = found.url;
  if (found.bodyRaw) messageInput.value = found.bodyRaw;
  ElMessage.success(`Loaded "${found.name}"`);
}

async function handleProtoUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  grpcProtoText.value = text;
  const pkgMatch = text.match(/package\s+([a-zA-Z0-9_.]+)\s*;/);
  const pkg = pkgMatch ? `${pkgMatch[1]}.` : '';
  const serviceMatch = text.match(/service\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/);
  if (serviceMatch) {
    const svc = `${pkg}${serviceMatch[1]}`;
    const rpcs: Array<{ service: string; name: string }> = [];
    const rpcRegex = /rpc\s+([a-zA-Z0-9_]+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = rpcRegex.exec(serviceMatch[2])) !== null) {
      rpcs.push({ service: svc, name: m[1] });
    }
    protoMethods.value = rpcs;
    if (rpcs[0]) {
      grpcSelectedService.value = rpcs[0].service;
      grpcSelectedMethod.value = rpcs[0].name;
      if (mode.value === 'grpc-web') {
        const base = url.value.replace(/\/[^/]+\/[^/]+$/, '').replace(/\/$/, '');
        url.value = base ? `${base}/${rpcs[0].service}/${rpcs[0].name}` : `/${rpcs[0].service}/${rpcs[0].name}`;
      }
    }
    ElMessage.success(`Parsed ${rpcs.length} RPC method(s) from ${file.name}`);
  } else {
    ElMessage.warning('No service definition found in .proto file');
  }
  (e.target as HTMLInputElement).value = '';
}
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

function encodeMqttString(str: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(str));
  return [(bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes];
}

function encodeMqttRemainingLength(len: number): number[] {
  const out: number[] = [];
  let x = len;
  do {
    let encoded = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encoded |= 128;
    out.push(encoded);
  } while (x > 0);
  return out;
}

function buildMqttConnectPacket(clientId: string): Uint8Array {
  const payload = encodeMqttString(clientId);
  const varHeader = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c];
  const rem = encodeMqttRemainingLength(varHeader.length + payload.length);
  return new Uint8Array([0x10, ...rem, ...varHeader, ...payload]);
}

function buildMqttSubscribePacket(topic: string): Uint8Array {
  const varHeader = [0x00, 0x01];
  const payload = [...encodeMqttString(topic), 0x00];
  const rem = encodeMqttRemainingLength(varHeader.length + payload.length);
  return new Uint8Array([0x82, ...rem, ...varHeader, ...payload]);
}

function buildMqttPublishPacket(topic: string, message: string): Uint8Array {
  const varHeader = encodeMqttString(topic);
  const msgBytes = Array.from(new TextEncoder().encode(message));
  const rem = encodeMqttRemainingLength(varHeader.length + msgBytes.length);
  return new Uint8Array([0x30, ...rem, ...varHeader, ...msgBytes]);
}

function connect() {
  disconnect();
  const resolved = resolveVariables(url.value.trim(), wsStore.activeVariablesMap);
  if (!resolved) {
    ElMessage.warning('Please enter a valid URL');
    return;
  }

  if (mode.value === 'grpc-web' || mode.value === 'grpc') {
    connected.value = true;
    pushLog('system', `${mode.value.toUpperCase()} target ready: ${resolved}`);
    return;
  }

  connecting.value = true;

  if (mode.value === 'graphql-ws') {
    try {
      socket = new WebSocket(resolved, 'graphql-transport-ws');
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'connection_init', payload: {} }));
        connecting.value = false;
        connected.value = true;
        pushLog('system', `GraphQL Subscription (graphql-ws) connected: ${resolved}`);
      };
      socket.onmessage = (event) => pushLog('received', String(event.data));
      socket.onerror = () => {
        connecting.value = false;
        pushLog('system', 'GraphQL Subscription error');
      };
      socket.onclose = (event) => {
        connecting.value = false;
        connected.value = false;
        pushLog('system', `GraphQL Subscription closed (${event.code})`);
      };
    } catch (err) {
      connecting.value = false;
      ElMessage.error(err instanceof Error ? err.message : 'GraphQL WS failed');
    }
  } else if (mode.value === 'ws') {
    try {
      socket = new WebSocket(resolved);
      socket.onopen = () => {
        connecting.value = false;
        connected.value = true;
        pushLog('system', `Connected to ${resolved}`);
      };
      socket.onmessage = (event) => pushLog('received', String(event.data));
      socket.onerror = () => {
        connecting.value = false;
        pushLog('system', 'WebSocket error occurred');
      };
      socket.onclose = (event) => {
        connecting.value = false;
        connected.value = false;
        pushLog('system', `Disconnected (code: ${event.code})`);
      };
    } catch (err) {
      connecting.value = false;
      ElMessage.error(err instanceof Error ? err.message : 'Failed to connect');
    }
  } else if (mode.value === 'socketio') {
    try {
      const wsUrl = resolved.replace(/^http/, 'ws').replace(/\/$/, '');
      const target = wsUrl.includes('EIO=')
        ? wsUrl
        : `${wsUrl}/socket.io/?EIO=4&transport=websocket`;
      socket = new WebSocket(target);
      socket.onopen = () => {
        connecting.value = false;
        connected.value = true;
        pushLog('system', `Socket.IO transport connected: ${target}`);
      };
      socket.onmessage = (event) => {
        const msg = String(event.data);
        if (msg.startsWith('0')) {
          socket?.send('40');
          pushLog('system', 'Socket.IO handshake (40) sent');
        } else if (msg === '2') {
          socket?.send('3');
        } else {
          pushLog('received', msg);
        }
      };
      socket.onerror = () => {
        connecting.value = false;
        pushLog('system', 'Socket.IO connection error');
      };
      socket.onclose = () => {
        connecting.value = false;
        connected.value = false;
        pushLog('system', 'Socket.IO disconnected');
      };
    } catch (err) {
      connecting.value = false;
      ElMessage.error(err instanceof Error ? err.message : 'Socket.IO failed');
    }
  } else if (mode.value === 'mqtt') {
    try {
      socket = new WebSocket(resolved, 'mqtt');
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        socket?.send(buildMqttConnectPacket(`api-open-${Date.now()}`));
        socket?.send(buildMqttSubscribePacket(mqttTopic.value || 'api-open/test'));
        connecting.value = false;
        connected.value = true;
        pushLog('system', `MQTT connected & subscribed to "${mqttTopic.value}"`);
      };
      socket.onmessage = (event) => {
        const buf = new Uint8Array(event.data as ArrayBuffer);
        if ((buf[0] & 0xf0) === 0x30) {
          const text = new TextDecoder().decode(buf.slice(4));
          pushLog('received', text);
        } else {
          pushLog('system', `MQTT control packet (0x${buf[0]?.toString(16)})`);
        }
      };
      socket.onerror = () => {
        connecting.value = false;
        pushLog('system', 'MQTT WebSocket error');
      };
      socket.onclose = () => {
        connecting.value = false;
        connected.value = false;
        pushLog('system', 'MQTT disconnected');
      };
    } catch (err) {
      connecting.value = false;
      ElMessage.error(err instanceof Error ? err.message : 'MQTT failed');
    }
  } else {
    try {
      eventSource = new EventSource(resolved);
      eventSource.onopen = () => {
        connecting.value = false;
        connected.value = true;
        pushLog('system', `SSE stream opened: ${resolved}`);
      };
      eventSource.onmessage = (event) => pushLog('received', event.data);
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

async function sendMessage() {
  const resolvedMsg = resolveVariables(
    messageInput.value,
    wsStore.activeVariablesMap,
  );
  if (mode.value === 'grpc') {
    const resolvedTarget = resolveVariables(url.value.trim(), wsStore.activeVariablesMap);
    try {
      pushLog('sent', resolvedMsg);
      const res = await executeNativeGrpc({
        target: resolvedTarget,
        service: grpcSelectedService.value,
        method: grpcSelectedMethod.value,
        protoText: grpcProtoText.value,
        payloadJson: resolvedMsg,
        useTls: grpcUseTls.value,
      });
      pushLog('received', `[gRPC OK • ${res.durationMs}ms]\n${res.body}`);
    } catch (err) {
      pushLog('system', err instanceof Error ? err.message : 'Native gRPC failed');
    }
    return;
  }

  if (mode.value === 'graphql-ws') {
    if (!socket || !connected.value) return;
    const msg = JSON.stringify({
      id: 'sub-1',
      type: 'subscribe',
      payload: { query: resolvedMsg },
    });
    socket.send(msg);
    pushLog('sent', msg);
    return;
  }

  if (mode.value === 'grpc-web') {
    const resolvedUrl = resolveVariables(url.value.trim(), wsStore.activeVariablesMap);
    try {
      pushLog('sent', resolvedMsg);
      const res = await executeProxyRequest({
        method: 'POST',
        url: resolvedUrl,
        headers: {
          'Content-Type': grpcContentType.value,
          'X-Grpc-Web': '1',
        },
        body: { mode: 'raw', raw: resolvedMsg, rawType: 'json' },
      });
      pushLog('received', `[${res.statusCode}] ${res.body}`);
    } catch (err) {
      pushLog('system', err instanceof Error ? err.message : 'gRPC-Web call failed');
    }
    return;
  }

  if (!socket || !connected.value) return;
  if (mode.value === 'socketio') {
    let parsedPayload: unknown = resolvedMsg;
    try {
      parsedPayload = JSON.parse(resolvedMsg);
    } catch {
      // keep string
    }
    const frame = `42${JSON.stringify([socketioEvent.value || 'message', parsedPayload])}`;
    socket.send(frame);
    pushLog('sent', frame);
    return;
  }
  if (mode.value === 'mqtt') {
    socket.send(buildMqttPublishPacket(mqttTopic.value || 'api-open/test', resolvedMsg));
    pushLog('sent', `[${mqttTopic.value}] ${resolvedMsg}`);
    return;
  }
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
      <el-select v-model="mode" style="width: 170px; flex-shrink: 0" @change="disconnect()">
        <el-option label="WebSocket" value="ws" />
        <el-option label="SSE" value="sse" />
        <el-option label="GraphQL Sub" value="graphql-ws" />
        <el-option label="Socket.IO" value="socketio" />
        <el-option label="MQTT (WS)" value="mqtt" />
        <el-option label="gRPC-Web" value="grpc-web" />
        <el-option label="gRPC (HTTP/2)" value="grpc" />
      </el-select>
      <el-input
        v-model="url"
        placeholder="Enter WebSocket / SSE / gRPC URL"
        clearable
      />
      <el-button
        v-if="!connected"
        type="primary"
        :loading="connecting"
        @click="connect"
      >
        Connect
      </el-button>
      <el-button v-else type="danger" @click="disconnect">Disconnect</el-button>
    </div>

    <div
      v-if="mode === 'mqtt' || mode === 'socketio' || mode === 'grpc-web' || mode === 'grpc'"
      style="display: flex; gap: 8px; margin-bottom: 10px; align-items: center; flex-wrap: wrap"
    >
      <el-input
        v-if="mode === 'mqtt'"
        v-model="mqttTopic"
        size="small"
        style="max-width: 280px"
        placeholder="MQTT Topic (e.g. sensors/temp)"
      />
      <el-input
        v-if="mode === 'socketio'"
        v-model="socketioEvent"
        size="small"
        style="max-width: 240px"
        placeholder="Socket.IO Event Name"
      />
      <el-select
        v-if="mode === 'grpc-web'"
        v-model="grpcContentType"
        size="small"
        style="width: 240px"
      >
        <el-option label="application/json (gRPC Gateway)" value="application/json" />
        <el-option label="application/grpc-web+proto" value="application/grpc-web+proto" />
        <el-option label="application/grpc-web-text" value="application/grpc-web-text" />
      </el-select>
      <template v-if="mode === 'grpc-web' || mode === 'grpc'">
        <el-button size="small" @click="protoFileInput?.click()">
          Load .proto
        </el-button>
        <el-button
          v-if="mode === 'grpc'"
          size="small"
          :loading="reflectingGrpc"
          @click="handleGrpcReflect"
        >
          Reflect
        </el-button>
        <el-checkbox v-if="mode === 'grpc'" v-model="grpcUseTls" size="small">
          Use TLS
        </el-checkbox>
        <el-select
          v-if="protoMethods.length"
          size="small"
          placeholder="Select RPC"
          style="width: 220px"
          @change="
            (val: string) => {
              const [svc, rpc] = val.split('/');
              grpcSelectedService = svc;
              grpcSelectedMethod = rpc;
              if (mode === 'grpc-web') {
                const base = url.replace(/\/[^/]+\/[^/]+$/, '').replace(/\/$/, '');
                url = base ? `${base}/${val}` : `/${val}`;
              }
            }
          "
        >
          <el-option
            v-for="rpc in protoMethods"
            :key="`${rpc.service}/${rpc.name}`"
            :label="`${rpc.service}/${rpc.name}`"
            :value="`${rpc.service}/${rpc.name}`"
          />
        </el-select>
        <input
          ref="protoFileInput"
          type="file"
          accept=".proto,text/plain"
          style="display: none"
          @change="handleProtoUpload"
        />
      </template>
      <el-select
        v-if="savedRealtimeRequests.length"
        size="small"
        placeholder="Load saved..."
        style="width: 170px"
        @change="(val: string) => loadSavedRealtime(val)"
      >
        <el-option
          v-for="item in savedRealtimeRequests"
          :key="item.id"
          :label="`${item.name} (${item.colName})`"
          :value="item.id"
        />
      </el-select>
      <el-button size="small" :icon="FolderAdd" @click="openSaveRealtimeDialog">
        Save
      </el-button>
    </div>

    <el-dialog v-model="saveDialogVisible" title="Save Realtime Request" width="400px">
      <el-form label-position="top" size="small">
        <el-form-item label="Request Name">
          <el-input v-model="saveRequestName" />
        </el-form-item>
        <el-form-item label="Collection">
          <el-select v-model="saveCollectionId" style="width: 100%">
            <el-option
              v-for="c in wsStore.collections"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="saveDialogVisible = false">Cancel</el-button>
        <el-button size="small" type="primary" @click="confirmSaveRealtime">Save</el-button>
      </template>
    </el-dialog>

    <div class="realtime-grid">
      <div v-if="mode !== 'sse'" class="realtime-card kt-card kt-card-bordered">
        <div class="realtime-head">
          <span>Message / Payload</span>
          <el-button
            type="primary"
            size="small"
            :disabled="!connected"
            @click="sendMessage"
          >
            Send
          </el-button>
        </div>
        <el-input
          v-model="messageInput"
          type="textarea"
          :rows="8"
          class="code-area"
        />
      </div>

      <div class="realtime-card kt-card kt-card-bordered">
        <div class="realtime-head">
          <span>Messages ({{ logs.length }})</span>
          <el-button
            size="small"
            link
            type="danger"
            :icon="Delete"
            @click="logs = []"
          >
            Clear
          </el-button>
        </div>
        <div class="realtime-logs">
          <div
            v-for="item in logs"
            :key="item.id"
            class="realtime-log-row"
            :class="`dir-${item.direction}`"
          >
            <span class="log-dir">{{ item.direction.toUpperCase() }}</span>
            <span class="log-time">{{ item.timestamp }}</span>
            <pre class="log-data">{{ item.data }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.realtime-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.request-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.realtime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.realtime-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--ao-surface);
  min-height: 0;
}
.realtime-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 8px;
}
.realtime-logs {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.realtime-log-row {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--ao-border);
  background: var(--ao-code-bg);
  font-size: 12px;
}
.log-dir {
  font-weight: 700;
  margin-right: 8px;
}
.dir-sent .log-dir {
  color: #3b82f6;
}
.dir-received .log-dir {
  color: #10b981;
}
.dir-system .log-dir {
  color: #f59e0b;
}
.log-time {
  color: var(--ao-text-muted);
  font-size: 11px;
}
.log-data {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
