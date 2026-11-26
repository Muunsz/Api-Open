<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { HttpMethod } from '@api-open/shared';
import { Check, Download, Edit, Upload, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { fetchRemoteSpecText } from '../../api/proxy';
import { downloadBlobFile } from '../../services/exportService';
import { useTabsStore } from '../../stores/tabs';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  generateOpenApiDocument,
  parseOpenApiDocumentText,
  validateContractAgainstSpec,
} from '../../utils/openApiConverter';
import CodeEditor from '../CodeEditor.vue';

interface SpecEndpointItem {
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  serverUrl: string;
  parameters: Array<{ name: string; in: string; required?: boolean; example?: unknown }>;
  requestBodyExample?: string;
  responses: Record<string, { description?: string; example?: string }>;
}

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const tabsStore = useTabsStore();

const selectedCollectionId = ref('');
const customSpecText = ref('');
const specUrl = ref('');
const fetchingUrl = ref(false);
const editorMode = ref(false);
const specParseError = ref('');
const contractResult = ref<{ valid: boolean; issues: string[] } | null>(null);
const specFileInput = ref<HTMLInputElement | null>(null);
const filterQuery = ref('');

watch(
  () => props.visible,
  (vis) => {
    if (vis && !selectedCollectionId.value && ws.collectionTree.length) {
      selectedCollectionId.value = ws.collectionTree[0].id;
    }
    contractResult.value = null;
  },
);

const activeSpecDoc = computed<Record<string, unknown> | null>(() => {
  if (customSpecText.value.trim()) {
    try {
      specParseError.value = '';
      return parseOpenApiDocumentText(customSpecText.value) as unknown as Record<
        string,
        unknown
      >;
    } catch (err) {
      specParseError.value =
        err instanceof Error ? err.message : 'Invalid OpenAPI syntax';
      return null;
    }
  }
  specParseError.value = '';
  const node = ws.collectionTree.find((n) => n.id === selectedCollectionId.value);
  return node ? generateOpenApiDocument(node) : null;
});

function toggleEditorMode() {
  if (!editorMode.value && !customSpecText.value.trim() && activeSpecDoc.value) {
    customSpecText.value = JSON.stringify(activeSpecDoc.value, null, 2);
  }
  editorMode.value = !editorMode.value;
}

async function fetchFromUrl() {
  if (!specUrl.value.trim()) return;
  fetchingUrl.value = true;
  try {
    customSpecText.value = await fetchRemoteSpecText(specUrl.value.trim());
    ElMessage.success('OpenAPI spec loaded from URL');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Failed to fetch spec');
  } finally {
    fetchingUrl.value = false;
  }
}

function runContractTest() {
  const tab = tabsStore.activeTab;
  if (!activeSpecDoc.value || !tab?.response) {
    ElMessage.warning('Send a request in the active tab first to run contract validation');
    return;
  }
  contractResult.value = validateContractAgainstSpec(
    activeSpecDoc.value,
    tab.method,
    tab.url,
    tab.response.statusCode,
    tab.response.body,
  );
}

const specTitle = computed(() => {
  const info = activeSpecDoc.value?.info as { title?: string; version?: string } | undefined;
  return info?.title ? `${info.title} (${info.version ?? '1.0.0'})` : 'OpenAPI 3.0 Spec';
});

const endpoints = computed<SpecEndpointItem[]>(() => {
  const doc = activeSpecDoc.value;
  if (!doc || typeof doc.paths !== 'object' || !doc.paths) return [];
  const servers = doc.servers as Array<{ url?: string }> | undefined;
  const serverUrl = servers?.[0]?.url || '{{base_url}}';
  const items: SpecEndpointItem[] = [];
  const valid = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

  for (const [pathKey, methodsObj] of Object.entries(
    doc.paths as Record<string, Record<string, Record<string, unknown>>>,
  )) {
    for (const [rawMethod, op] of Object.entries(methodsObj ?? {})) {
      const method = rawMethod.toUpperCase() as HttpMethod;
      if (!valid.has(method) || !op) continue;
      const params = Array.isArray(op.parameters)
        ? (op.parameters as Array<{ name: string; in: string; required?: boolean; example?: unknown }>)
        : [];
      const reqBody = op.requestBody as { content?: Record<string, { example?: unknown }> } | undefined;
      const jsonExample = reqBody?.content?.['application/json']?.example;
      const responsesOut: Record<string, { description?: string; example?: string }> = {};
      if (op.responses && typeof op.responses === 'object') {
        for (const [code, rVal] of Object.entries(
          op.responses as Record<string, { description?: string; content?: Record<string, { example?: unknown }> }>,
        )) {
          const ex = rVal.content?.['application/json']?.example;
          responsesOut[code] = {
            description: rVal.description,
            example: ex !== undefined ? JSON.stringify(ex, null, 2) : undefined,
          };
        }
      }
      items.push({
        method,
        path: pathKey,
        summary: String(op.summary || op.operationId || `${method} ${pathKey}`),
        tags: Array.isArray(op.tags) ? (op.tags as string[]) : ['General'],
        serverUrl,
        parameters: params,
        requestBodyExample:
          jsonExample !== undefined ? JSON.stringify(jsonExample, null, 2) : undefined,
        responses: responsesOut,
      });
    }
  }

  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (e) =>
      e.path.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q) ||
      e.method.toLowerCase().includes(q),
  );
});

async function handleFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    customSpecText.value = await file.text();
    ElMessage.success(`Loaded ${file.name}`);
  } finally {
    (e.target as HTMLInputElement).value = '';
  }
}

function tryEndpointInTab(ep: SpecEndpointItem) {
  const fullUrl = `${ep.serverUrl.replace(/\/$/, '')}${ep.path}`;
  tabsStore.addTab({
    name: ep.summary,
    method: ep.method,
    url: fullUrl,
    queryParams: ep.parameters
      .filter((p) => p.in === 'query')
      .map((p) => ({
        id: Math.random().toString(36).slice(2, 10),
        key: p.name,
        value: p.example !== undefined ? String(p.example) : '',
        enabled: true,
      })),
    headers: ep.parameters
      .filter((p) => p.in === 'header')
      .map((p) => ({
        id: Math.random().toString(36).slice(2, 10),
        key: p.name,
        value: p.example !== undefined ? String(p.example) : '',
        enabled: true,
      })),
    body: ep.requestBodyExample
      ? { mode: 'raw', raw: ep.requestBodyExample, rawType: 'json' }
      : { mode: 'none' },
  });
  tabsStore.syncPathParamsFromUrl();
  emit('update:visible', false);
}

function downloadJson() {
  if (!activeSpecDoc.value) return;
  downloadBlobFile(
    JSON.stringify(activeSpecDoc.value, null, 2),
    'openapi-spec.json',
    'application/json',
  );
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`Interactive OpenAPI Viewer — ${specTitle}`"
    width="min(96vw, 900px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="modal-toolbar">
      <el-select
        v-model="selectedCollectionId"
        size="small"
        style="width: 180px"
        placeholder="Select Collection"
        @change="customSpecText = ''"
      >
        <el-option
          v-for="col in ws.collectionTree"
          :key="col.id"
          :label="col.label"
          :value="col.id"
        />
      </el-select>
      <el-input
        v-model="specUrl"
        size="small"
        placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
        style="flex: 1; min-width: 200px"
      >
        <template #append>
          <el-button :loading="fetchingUrl" @click="fetchFromUrl">Fetch URL</el-button>
        </template>
      </el-input>
      <el-button size="small" :icon="Upload" @click="specFileInput?.click()">
        File (JSON/YAML)
      </el-button>
      <el-button
        size="small"
        :icon="Edit"
        :type="editorMode ? 'primary' : 'default'"
        @click="toggleEditorMode"
      >
        {{ editorMode ? 'Preview' : 'Edit Spec' }}
      </el-button>
      <el-button
        size="small"
        :icon="Check"
        :disabled="!activeSpecDoc"
        @click="runContractTest"
      >
        Contract Test
      </el-button>
      <el-button
        size="small"
        :icon="Download"
        :disabled="!activeSpecDoc"
        @click="downloadJson"
      >
        JSON
      </el-button>
      <input
        ref="specFileInput"
        type="file"
        accept=".json,.yaml,.yml,application/json,text/yaml"
        style="display: none"
        @change="handleFileSelected"
      />
    </div>

    <el-alert
      v-if="specParseError"
      :title="specParseError"
      type="error"
      show-icon
      :closable="false"
      style="margin-bottom: 8px"
    />

    <el-alert
      v-if="contractResult"
      :title="
        contractResult.valid
          ? 'Contract Valid: Active response matches OpenAPI schema!'
          : `Contract Mismatch (${contractResult.issues.length} issue(s))`
      "
      :description="contractResult.issues.join(' | ')"
      :type="contractResult.valid ? 'success' : 'warning'"
      show-icon
      style="margin-bottom: 8px"
      @close="contractResult = null"
    />

    <CodeEditor
      v-if="editorMode"
      v-model="customSpecText"
      language="yaml"
      :rows="16"
      placeholder="Paste or edit OpenAPI 3.0 JSON or YAML..."
    />

    <template v-else>
      <el-input
        v-model="filterQuery"
        size="small"
        placeholder="Filter endpoints..."
        clearable
        style="margin-bottom: 8px"
      />
      <el-empty
        v-if="!endpoints.length"
        description="Select a collection, fetch an OpenAPI URL, or upload JSON/YAML"
        :image-size="56"
      />

      <el-collapse v-else style="max-height: 440px; overflow-y: auto">
        <el-collapse-item
          v-for="(ep, idx) in endpoints"
          :key="`${ep.method}-${ep.path}-${idx}`"
          :name="idx"
        >
          <template #title>
            <div style="display: flex; align-items: center; gap: 10px; width: 100%; padding-right: 12px">
              <span class="method-badge" :class="`method-${ep.method}`">
                {{ ep.method }}
              </span>
              <code style="font-size: 12.5px; font-weight: 600">{{ ep.path }}</code>
              <span style="font-size: 12px; color: var(--ao-text-muted); overflow: hidden; text-overflow: ellipsis">
                {{ ep.summary }}
              </span>
            </div>
          </template>

          <div style="display: flex; flex-direction: column; gap: 8px; padding: 4px 0">
            <div style="display: flex; justify-content: space-between; align-items: center">
              <el-tag size="small" effect="plain">{{ ep.tags.join(', ') }}</el-tag>
              <el-button
                size="small"
                type="primary"
                :icon="VideoPlay"
                @click="tryEndpointInTab(ep)"
              >
                Try in New Tab
              </el-button>
            </div>

            <div v-if="ep.parameters.length">
              <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px">Parameters</div>
              <el-table :data="ep.parameters" size="small" border>
                <el-table-column prop="name" label="Name" width="160" />
                <el-table-column prop="in" label="In" width="90" />
                <el-table-column prop="example" label="Example" />
              </el-table>
            </div>

            <div v-if="ep.requestBodyExample">
              <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px">Request Body Example</div>
              <pre class="modal-code-pre" style="max-height: 160px">{{ ep.requestBodyExample }}</pre>
            </div>

            <div v-for="(resVal, code) in ep.responses" :key="code">
              <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px">
                Response {{ code }} — {{ resVal.description }}
              </div>
              <pre v-if="resVal.example" class="modal-code-pre" style="max-height: 160px">{{ resVal.example }}</pre>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </template>
  </el-dialog>
</template>
