<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  CopyDocument,
  Delete,
  DocumentAdd,
  Download,
  Search,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import { useWorkspaceStore } from '../stores/workspace';
import { aiExplainError } from '../utils/aiAssistant';
import { validateJsonAgainstSchema } from '../utils/schemaValidator';
import { exportResponseToHar } from '../services/exportService';
import type {
  ResponseCookieItem,
  ResponseHeaderItem,
  ResponseViewMode,
} from '../types/app';
import JsonTreeNode from './JsonTreeNode.vue';
import Base64ImageDialog from './modals/Base64ImageDialog.vue';

defineEmits<{
  (e: 'copy-response'): void;
  (e: 'download-response'): void;
}>();

const store = useTabsStore();
const settings = useSettingsStore();
const ws = useWorkspaceStore();

const tab = computed(() => store.activeTab);
const activeResponseTab = ref('body');
const responseViewMode = ref<ResponseViewMode>('pretty');
const jsonFilter = ref('');
const wordWrap = ref(true);
const diffTarget = ref<string>('previous');
const selectedSchemaId = ref('');
const customSchemaText = ref('');
const aiExplanation = ref('');
const explainingError = ref(false);
const base64ImageDialogVisible = ref(false);

const detectedBase64ImageUrl = computed(() => {
  const res = tab.value?.response;
  if (!res || res.isBase64) return '';
  const body = res.body ?? '';
  const dataUriMatch = /data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+/i.exec(body);
  if (dataUriMatch) return dataUriMatch[0];
  const rawMatch = /"(iVBORw0KGgo[A-Za-z0-9+/=]{20,}|\/9j\/[A-Za-z0-9+/=]{20,}|R0lGOD[A-Za-z0-9+/=]{20,}|UklGR[A-Za-z0-9+/=]{20,})"/.exec(body);
  if (rawMatch) {
    const b64 = rawMatch[1];
    const mime = b64.startsWith('iVBORw0KGgo')
      ? 'image/png'
      : b64.startsWith('/9j/')
        ? 'image/jpeg'
        : b64.startsWith('R0lGOD')
          ? 'image/gif'
          : 'image/webp';
    return `data:${mime};base64,${b64}`;
  }
  const trimmed = body.trim();
  if (/^(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)[A-Za-z0-9+/=\s]{20,}$/.test(trimmed)) {
    const clean = trimmed.replace(/\s+/g, '');
    const mime = clean.startsWith('iVBORw0KGgo')
      ? 'image/png'
      : clean.startsWith('/9j/')
        ? 'image/jpeg'
        : clean.startsWith('R0lGOD')
          ? 'image/gif'
          : 'image/webp';
    return `data:${mime};base64,${clean}`;
  }
  return '';
});

const schemaValidationResult = computed(() => {
  const res = tab.value?.response;
  if (!res || res.isBase64) return null;
  const schemaObj = ws.schemas.find((s) => s.id === selectedSchemaId.value);
  const schemaText = schemaObj?.jsonSchema || customSchemaText.value;
  if (!schemaText.trim()) return null;
  return validateJsonAgainstSchema(res.body, schemaText);
});

async function handleExplainError() {
  const res = tab.value?.response;
  if (!res) return;
  explainingError.value = true;
  try {
    aiExplanation.value = await aiExplainError(
      res.statusCode,
      res.body,
      settings.aiConfig,
    );
  } finally {
    explainingError.value = false;
  }
}

const parsedJsonBody = computed<unknown | undefined>(() => {
  const res = tab.value?.response;
  if (!res || res.isBase64) return undefined;
  try {
    return JSON.parse(res.body);
  } catch {
    return undefined;
  }
});

const isPdfResponse = computed(() => {
  const res = tab.value?.response;
  if (!res?.isBase64) return false;
  const ctKey = Object.keys(res.headers).find(
    (k) => k.toLowerCase() === 'content-type',
  );
  return (ctKey ? res.headers[ctKey] : '').toLowerCase().includes('application/pdf');
});

const pdfDataUrl = computed(() =>
  isPdfResponse.value && tab.value?.response
    ? `data:application/pdf;base64,${tab.value.response.body}`
    : '',
);

const isSvgResponse = computed(() => {
  const res = tab.value?.response;
  if (!res || res.isBase64) return false;
  const ctKey = Object.keys(res.headers).find(
    (k) => k.toLowerCase() === 'content-type',
  );
  const ct = (ctKey ? res.headers[ctKey] : '').toLowerCase();
  return ct.includes('image/svg+xml') || /^\s*<svg[\s>]/i.test(res.body);
});

const svgDataUrl = computed(() =>
  isSvgResponse.value && tab.value?.response
    ? `data:image/svg+xml;utf8,${encodeURIComponent(tab.value.response.body)}`
    : '',
);

const diffLines = computed(() => {
  const current = formattedBody.value;
  if (!current) return [];
  let baseline = '';
  if (diffTarget.value === 'previous') {
    baseline = tab.value?.previousResponse?.body ?? '';
    try {
      baseline = JSON.stringify(JSON.parse(baseline), null, 2);
    } catch {
      // keep raw
    }
  } else {
    const ex = tab.value?.examples?.find((e) => e.id === diffTarget.value);
    baseline = ex?.body ?? '';
    try {
      baseline = JSON.stringify(JSON.parse(baseline), null, 2);
    } catch {
      // keep raw
    }
  }
  const aLines = baseline.split('\n');
  const bLines = current.split('\n');
  const maxLen = Math.max(aLines.length, bLines.length);
  const out: Array<{ type: 'same' | 'add' | 'del'; text: string }> = [];
  for (let i = 0; i < maxLen; i++) {
    const a = aLines[i];
    const b = bLines[i];
    if (a === b) {
      if (b !== undefined) out.push({ type: 'same', text: `  ${b}` });
    } else {
      if (a !== undefined) out.push({ type: 'del', text: `- ${a}` });
      if (b !== undefined) out.push({ type: 'add', text: `+ ${b}` });
    }
  }
  return out;
});

const isResponseHorizontal = computed(
  () =>
    settings.responsePosition === 'left' ||
    settings.responsePosition === 'right',
);

const passedTestsCount = computed(
  () => tab.value?.testResults.filter((t) => t.passed).length ?? 0,
);

function evaluateJsonPath(data: unknown, expr: string): unknown {
  const cleaned = expr.trim().replace(/^\$\.?/, '');
  if (!cleaned) return data;
  const tokens: Array<string | number> = [];
  const regex = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(cleaned)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }
  let curr: unknown = data;
  for (const tok of tokens) {
    if (curr === null || curr === undefined) return undefined;
    if (typeof tok === 'number' && Array.isArray(curr)) {
      curr = curr[tok];
    } else if (typeof curr === 'object') {
      curr = (curr as Record<string, unknown>)[String(tok)];
    } else {
      return undefined;
    }
  }
  return curr;
}

const isHtmlResponse = computed(() => {
  const res = tab.value?.response;
  if (!res || res.isBase64) return false;
  const ctKey = Object.keys(res.headers).find(
    (k) => k.toLowerCase() === 'content-type',
  );
  const ct = (ctKey ? res.headers[ctKey] : '').toLowerCase();
  return (
    ct.includes('text/html') ||
    /^\s*<!doctype\s+html|^\s*<html/i.test(res.body)
  );
});

const formattedBody = computed(() => {
  const res = tab.value?.response;
  if (!res) return '';
  if (res.isBase64) return `[Binary payload: ${res.sizeBytes} bytes]`;
  if (responseViewMode.value === 'raw') return res.body;
  const q = jsonFilter.value.trim();
  try {
    const parsed = JSON.parse(res.body) as unknown;
    if (q.startsWith('$')) {
      const result = evaluateJsonPath(parsed, q);
      return result === undefined
        ? '// JSONPath matched nothing'
        : JSON.stringify(result, null, 2);
    }
    const pretty = JSON.stringify(parsed, null, 2);
    if (!q) return pretty;
    const lower = q.toLowerCase();
    const matchedLines = pretty
      .split('\n')
      .filter((line) => line.toLowerCase().includes(lower));
    return matchedLines.length
      ? matchedLines.join('\n')
      : `// No lines matching "${q}"`;
  } catch {
    if (!q) return res.body;
    const lower = q.toLowerCase();
    return res.body
      .split('\n')
      .filter((line) => line.toLowerCase().includes(lower))
      .join('\n');
  }
});

async function handleSaveExample() {
  if (!tab.value?.response) return;
  try {
    const { value } = await ElMessageBox.prompt(
      'Enter example name (e.g. 200 OK - Success)',
      'Save Response as Example',
      {
        confirmButtonText: 'Save',
        cancelButtonText: 'Cancel',
        inputValue: `${tab.value.response.statusCode} ${tab.value.response.statusText}`.trim(),
      },
    );
    await store.saveResponseAsExample(value);
    ElMessage.success('Response saved as example');
  } catch {
    // cancelled
  }
}

const responseHeadersList = computed<ResponseHeaderItem[]>(() => {
  const headers = tab.value?.response?.headers ?? {};
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
});

const responseCookiesList = computed<ResponseCookieItem[]>(() => {
  const raw = tab.value?.response?.headers?.['set-cookie'];
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;=]+=[^;]+)/).map((cookieStr) => {
    const parts = cookieStr.split(';').map((p) => p.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    return {
      name: eqIdx >= 0 ? nameVal.slice(0, eqIdx) : nameVal,
      value: eqIdx >= 0 ? nameVal.slice(eqIdx + 1) : '',
      attributes: attrs.join('; '),
    };
  });
});

const isImageResponse = computed(() => {
  const headers = tab.value?.response?.headers ?? {};
  const ctKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === 'content-type',
  );
  const ct = (ctKey ? headers[ctKey] : '').toLowerCase();
  return Boolean(tab.value?.response?.isBase64 && ct.startsWith('image/'));
});

const imageDataUrl = computed(() => {
  const res = tab.value?.response;
  if (!res) return '';
  const ctKey = Object.keys(res.headers).find(
    (k) => k.toLowerCase() === 'content-type',
  );
  const rawCt = ctKey ? res.headers[ctKey] : 'image/png';
  const mime = rawCt.split(';')[0].trim() || 'image/png';
  return `data:${mime};base64,${res.body}`;
});

function statusClass(code?: number): string {
  if (!code) return 'status-1xx';
  if (code >= 200 && code < 300) return 'status-2xx';
  if (code >= 300 && code < 400) return 'status-3xx';
  if (code >= 400 && code < 500) return 'status-4xx';
  if (code >= 500) return 'status-5xx';
  return 'status-1xx';
}

function durationClass(ms: number): string {
  if (ms < 300) return 'status-2xx';
  if (ms < 1000) return 'status-4xx';
  return 'status-5xx';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

const responseSectionClasses = computed(() => [
  isResponseHorizontal.value ? 'is-horizontal' : 'is-vertical',
  tab.value?.error
    ? 'resp-accent-error'
    : tab.value?.response
      ? `resp-accent-${statusClass(tab.value.response.statusCode)}`
      : '',
]);
</script>

<template>
  <div
    v-if="tab"
    v-loading="tab.loading"
    element-loading-text="Sending request..."
    class="response-section"
    :class="responseSectionClasses"
    :style="
      isResponseHorizontal
        ? {
            width: `${settings.responseSizePercent}%`,
            flex: 'none',
          }
        : {
            height: `${settings.responseSizePercent}%`,
            flex: 'none',
          }
    "
  >
    <div class="response-header">
      <span>Response</span>
      <div v-if="tab.response" class="response-meta">
        <span
          class="status-badge"
          :class="statusClass(tab.response.statusCode)"
        >
          {{ tab.response.statusCode }}
          {{ tab.response.statusText }}
        </span>
        <span
          class="status-badge"
          :class="durationClass(tab.response.durationMs)"
        >
          {{ tab.response.durationMs }} ms
        </span>
        <span
          class="kt-badge kt-badge-sm kt-badge-outline kt-badge-secondary"
        >
          {{ formatBytes(tab.response.sizeBytes) }}
        </span>
        <el-button
          size="small"
          circle
          :icon="DocumentAdd"
          title="Save Response as Example"
          @click="handleSaveExample"
        />
        <el-button
          size="small"
          circle
          :icon="CopyDocument"
          title="Copy Response (Ctrl+.)"
          @click="$emit('copy-response')"
        />
        <el-button
          size="small"
          circle
          :icon="Download"
          title="Download Response (Ctrl+J)"
          @click="$emit('download-response')"
        />
      </div>
      <div v-else-if="tab.error" class="response-meta">
        <span class="status-badge status-5xx">Error</span>
      </div>
    </div>

    <el-alert
      v-if="tab.error"
      :title="tab.error"
      type="error"
      show-icon
      :closable="false"
      style="margin-bottom: 8px"
    />

    <el-tabs v-model="activeResponseTab">
      <el-tab-pane label="Body" name="body">
        <template v-if="tab.response">
          <div v-if="!tab.response.isBase64" class="body-controls">
            <el-radio-group v-model="responseViewMode" size="small">
              <el-radio-button value="pretty">Pretty</el-radio-button>
              <el-radio-button value="tree" :disabled="parsedJsonBody === undefined">
                Tree
              </el-radio-button>
              <el-radio-button value="raw">Raw</el-radio-button>
              <el-radio-button value="preview">Preview</el-radio-button>
            </el-radio-group>
            <el-button
              size="small"
              :type="wordWrap ? 'primary' : 'default'"
              plain
              @click="wordWrap = !wordWrap"
            >
              Wrap
            </el-button>
            <el-input
              v-if="responseViewMode === 'pretty'"
              v-model="jsonFilter"
              size="small"
              :prefix-icon="Search"
              placeholder="Filter text or JSONPath (e.g. $.data.id)"
              clearable
              style="max-width: 260px"
            />
            <el-button
              size="small"
              plain
              @click="base64ImageDialogVisible = true"
            >
              Base64 → Image
            </el-button>
          </div>
          <img
            v-if="isImageResponse"
            :src="imageDataUrl"
            alt="Response preview"
            class="image-preview"
          />
          <iframe
            v-else-if="isPdfResponse"
            :src="pdfDataUrl"
            class="html-preview-frame"
          />
          <img
            v-else-if="responseViewMode === 'preview' && isSvgResponse"
            :src="svgDataUrl"
            alt="SVG preview"
            class="image-preview"
          />
          <img
            v-else-if="responseViewMode === 'preview' && detectedBase64ImageUrl"
            :src="detectedBase64ImageUrl"
            alt="Base64 image preview"
            class="image-preview"
          />
          <iframe
            v-else-if="responseViewMode === 'preview' && isHtmlResponse"
            sandbox=""
            :srcdoc="tab.response.body"
            class="html-preview-frame"
          />
          <div
            v-else-if="responseViewMode === 'tree' && parsedJsonBody !== undefined"
            class="response-pre"
          >
            <JsonTreeNode :value="parsedJsonBody" />
          </div>
          <pre
            v-else
            class="response-pre"
            :class="{ 'no-wrap': !wordWrap }"
            >{{ formattedBody }}</pre
          >
        </template>
        <el-empty
          v-else
          description="Hit Send to get a response"
          :image-size="60"
        >
          <template #image>
            <img
              src="/API-OPEN-LOGO.png"
              alt="Api-Open"
              style="width: 56px; opacity: 0.75"
            />
          </template>
        </el-empty>
      </el-tab-pane>

      <el-tab-pane
        :label="`Headers (${responseHeadersList.length})`"
        name="headers"
      >
        <el-table :data="responseHeadersList" size="small" border>
          <el-table-column prop="key" label="Header" width="240" />
          <el-table-column prop="value" label="Value" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane
        :label="`Cookies (${responseCookiesList.length})`"
        name="cookies"
      >
        <el-table :data="responseCookiesList" size="small" border>
          <el-table-column prop="name" label="Name" width="180" />
          <el-table-column prop="value" label="Value" />
          <el-table-column prop="attributes" label="Attributes" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane
        :label="`Tests (${passedTestsCount}/${tab.testResults.length})`"
        name="testResults"
      >
        <el-alert
          v-if="tab.scriptError"
          :title="tab.scriptError"
          type="error"
          show-icon
          :closable="false"
          style="margin-bottom: 8px"
        />
        <div v-if="tab.testResults.length" class="test-results-list">
          <div
            v-for="(tr, idx) in tab.testResults"
            :key="idx"
            class="test-result-row"
          >
            <el-tag :type="tr.passed ? 'success' : 'danger'" size="small">
              {{ tr.passed ? 'PASS' : 'FAIL' }}
            </el-tag>
            <span>{{ tr.name }}</span>
            <el-text v-if="tr.error" type="danger" size="small">
              — {{ tr.error }}
            </el-text>
          </div>
        </div>
        <el-empty
          v-else-if="!tab.scriptLogs.length && !tab.scriptError"
          description="No test assertions ran"
          :image-size="54"
        />
        <pre
          v-if="tab.scriptLogs.length"
          class="response-pre"
          style="margin-top: 8px"
          >{{ tab.scriptLogs.join('\n') }}</pre
        >
      </el-tab-pane>

      <el-tab-pane
        :label="`Examples (${tab.examples?.length ?? 0})`"
        name="examples"
      >
        <div v-if="tab.examples?.length" class="test-results-list">
          <div
            v-for="(ex, idx) in tab.examples"
            :key="ex.id"
            style="border: 1px solid var(--ao-border); border-radius: 6px; padding: 8px 10px"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px">
              <div style="display: flex; align-items: center; gap: 8px">
                <span class="status-badge" :class="statusClass(ex.statusCode)">
                  {{ ex.statusCode }} {{ ex.statusText }}
                </span>
                <strong style="font-size: 13px">{{ ex.name }}</strong>
              </div>
              <el-button
                :icon="Delete"
                link
                type="danger"
                size="small"
                @click="tab.examples.splice(idx, 1)"
              />
            </div>
            <pre class="response-pre" style="max-height: 160px">{{ ex.body }}</pre>
          </div>
        </div>
        <el-empty
          v-else
          description="No saved examples yet. Click the Save Example icon after sending a request."
          :image-size="54"
        />
      </el-tab-pane>

      <el-tab-pane label="Timing" name="timing">
        <div v-if="tab.response?.timing" class="timing-panel">
          <div class="timing-row">
            <span>DNS Lookup</span>
            <el-progress
              :percentage="Math.min(100, Math.round((tab.response.timing.dnsMs / Math.max(1, tab.response.timing.totalMs)) * 100))"
              :format="() => `${tab.response!.timing!.dnsMs} ms`"
            />
          </div>
          <div class="timing-row">
            <span>TCP Connect</span>
            <el-progress
              :percentage="Math.min(100, Math.round((tab.response.timing.tcpMs / Math.max(1, tab.response.timing.totalMs)) * 100))"
              :format="() => `${tab.response!.timing!.tcpMs} ms`"
            />
          </div>
          <div class="timing-row">
            <span>TLS Handshake</span>
            <el-progress
              :percentage="Math.min(100, Math.round((tab.response.timing.tlsMs / Math.max(1, tab.response.timing.totalMs)) * 100))"
              :format="() => `${tab.response!.timing!.tlsMs} ms`"
            />
          </div>
          <div class="timing-row">
            <span>Waiting (TTFB)</span>
            <el-progress
              status="success"
              :percentage="Math.min(100, Math.round((tab.response.timing.ttfbMs / Math.max(1, tab.response.timing.totalMs)) * 100))"
              :format="() => `${tab.response!.timing!.ttfbMs} ms`"
            />
          </div>
          <div class="timing-row">
            <span>Content Download</span>
            <el-progress
              :percentage="Math.min(100, Math.round((tab.response.timing.downloadMs / Math.max(1, tab.response.timing.totalMs)) * 100))"
              :format="() => `${tab.response!.timing!.downloadMs} ms`"
            />
          </div>
          <div class="timing-meta">
            <el-tag size="small" effect="plain">
              Total: {{ tab.response.timing.totalMs }} ms
            </el-tag>
            <el-tag v-if="tab.response.timing.remoteIp" size="small" effect="plain">
              Remote IP: {{ tab.response.timing.remoteIp }}
            </el-tag>
            <el-tag v-if="tab.response.timing.tlsProtocol" size="small" effect="plain">
              TLS: {{ tab.response.timing.tlsProtocol }}
            </el-tag>
            <el-tag v-if="tab.response.redirectedUrl" size="small" effect="plain" type="warning">
              Redirected: {{ tab.response.redirectedUrl }}
            </el-tag>
            <el-button
              size="small"
              plain
              :icon="Download"
              @click="
                exportResponseToHar({
                  method: tab.method,
                  url: tab.url,
                  requestHeaders: Object.fromEntries(tab.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, h.value])),
                  statusCode: tab.response.statusCode,
                  statusText: tab.response.statusText,
                  responseHeaders: tab.response.headers,
                  responseBody: tab.response.body,
                  durationMs: tab.response.durationMs,
                  timing: tab.response.timing,
                })
              "
            >
              Export .har
            </el-button>
          </div>
        </div>
        <el-empty
          v-else
          description="Send a request via Proxy mode to view DNS/TCP/TLS/TTFB breakdown"
          :image-size="48"
        />
      </el-tab-pane>

      <el-tab-pane label="Diff" name="diff">
        <div class="body-controls">
          <el-text size="small" type="info">Compare current response with:</el-text>
          <el-select v-model="diffTarget" size="small" style="width: 240px">
            <el-option label="Previous Response" value="previous" />
            <el-option
              v-for="ex in tab.examples ?? []"
              :key="ex.id"
              :label="`Example: ${ex.name}`"
              :value="ex.id"
            />
          </el-select>
        </div>
        <pre v-if="diffLines.length" class="response-pre">
          <div
            v-for="(line, i) in diffLines"
            :key="i"
            :class="`diff-line-${line.type}`"
          >{{ line.text }}</div>
        </pre>
        <el-empty
          v-else
          description="Send at least 2 requests or save an Example to compare diffs"
          :image-size="48"
        />
      </el-tab-pane>

      <el-tab-pane label="Schema" name="schema">
        <div class="body-controls" style="flex-wrap: wrap">
          <el-select
            v-model="selectedSchemaId"
            size="small"
            clearable
            placeholder="Select Workspace Schema (or paste below)"
            style="width: 280px"
          >
            <el-option
              v-for="sc in ws.schemas"
              :key="sc.id"
              :label="sc.name"
              :value="sc.id"
            />
          </el-select>
          <el-tag
            v-if="schemaValidationResult"
            size="small"
            :type="schemaValidationResult.valid ? 'success' : 'danger'"
          >
            {{
              schemaValidationResult.valid
                ? 'Valid JSON Schema'
                : `${schemaValidationResult.errors.length} Validation Error(s)`
            }}
          </el-tag>
          <el-button
            v-if="tab.response && tab.response.statusCode >= 400"
            size="small"
            type="warning"
            plain
            :loading="explainingError"
            @click="handleExplainError"
          >
            AI Explain Error
          </el-button>
        </div>
        <el-alert
          v-if="aiExplanation"
          type="info"
          :title="aiExplanation"
          closable
          style="margin-bottom: 8px; white-space: pre-wrap"
          @close="aiExplanation = ''"
        />
        <el-input
          v-if="!selectedSchemaId"
          v-model="customSchemaText"
          type="textarea"
          :rows="4"
          class="code-area"
          placeholder='{"type": "object", "required": ["id"]}'
          style="margin-bottom: 8px"
        />
        <div v-if="schemaValidationResult && !schemaValidationResult.valid" style="font-size: 12px">
          <div
            v-for="(err, idx) in schemaValidationResult.errors"
            :key="idx"
            style="color: var(--el-color-danger); padding: 3px 0"
          >
            <code>{{ err.path }}</code>: {{ err.message }}
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
    <Base64ImageDialog
      v-model:visible="base64ImageDialogVisible"
      :initial-base64="detectedBase64ImageUrl"
    />
  </div>
</template>

<style scoped>
.response-section {
  background: var(--ao-surface);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 240px;
  min-height: 220px;
  border-radius: 0;
  border: none;
}
.response-section.is-vertical {
  border-top: 1px solid var(--ao-border);
}
.response-section.is-horizontal {
  border-left: 1px solid var(--ao-border);
}
.response-section :deep(.el-tabs__header) {
  margin: 0 0 6px;
}
.response-section :deep(.el-tabs__item) {
  height: 30px;
  line-height: 30px;
  padding: 0 10px;
  font-size: 12.5px;
}
.response-section > :deep(.el-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.response-section :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.response-section :deep(.el-tab-pane) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.resp-accent-status-2xx {
  border-top: 3px solid #10b981;
}
.resp-accent-status-3xx {
  border-top: 3px solid #06b6d4;
}
.resp-accent-status-4xx {
  border-top: 3px solid #f59e0b;
}
.resp-accent-status-5xx,
.resp-accent-error {
  border-top: 3px solid #ef4444;
}
.response-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}
.response-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.response-meta :deep(.el-button + .el-button) {
  margin-left: 0;
}
.body-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.response-pre {
  background: var(--ao-code-bg);
  border: 1px solid var(--ao-border);
  color: var(--ao-text);
  border-radius: 6px;
  padding: 10px 12px;
  flex: 1;
  min-height: 120px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12.5px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.image-preview {
  max-width: 100%;
  max-height: 320px;
  border: 1px solid var(--ao-border);
  border-radius: 6px;
}
.response-pre.no-wrap {
  white-space: pre;
  word-break: normal;
}
.timing-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.timing-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}
.timing-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.diff-line-add {
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
}
.diff-line-del {
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
}
.html-preview-frame {
  width: 100%;
  flex: 1;
  min-height: 220px;
  border: 1px solid var(--ao-border);
  border-radius: 6px;
  background: #ffffff;
}
.test-results-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.test-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
@media (max-width: 640px) {
  .response-header {
    flex-wrap: wrap;
    gap: 8px;
  }
  .response-section {
    width: 100% !important;
    height: auto !important;
  }
}
</style>
