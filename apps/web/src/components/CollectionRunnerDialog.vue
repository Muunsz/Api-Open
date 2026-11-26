<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AuthConfig, BodyConfig } from '@api-open/shared';
import { Delete, Download, Upload, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { executeProxyRequest } from '../api/proxy';
import type { ApiRequestDto } from '../api/workspace';
import { downloadBlobFile } from '../services/exportService';
import { useTabsStore } from '../stores/tabs';
import { type CollectionTreeNode, useWorkspaceStore } from '../stores/workspace';
import { runScriptInSandbox, type TestCaseResult } from '../utils/scriptRunner';
import { applyPathParamsToUrl } from '../utils/urlSync';
import { resolveVariables } from '../utils/variables';

const props = defineProps<{
  visible: boolean;
  collectionNode: CollectionTreeNode | null;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

interface RunItemResult {
  id: string;
  iteration: number;
  name: string;
  method: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
  tests: TestCaseResult[];
}

const ws = useWorkspaceStore();
const tabsStore = useTabsStore();
const running = ref(false);
const results = ref<RunItemResult[]>([]);
const dataFileInput = ref<HTMLInputElement | null>(null);
const dataFileName = ref('');
const dataRows = ref<Array<Record<string, string>>>([]);
const delayMs = ref(0);
const repeatCount = ref(1);
const persistResponses = ref(false);
const excludedIds = ref<Set<string>>(new Set());
const loadTestMode = ref(false);
const virtualUsers = ref(5);
const loadDurationSec = ref(5);
const loadStats = ref<{
  total: number;
  errors: number;
  rps: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
} | null>(null);

async function runLoadTest() {
  const activeReqs = requestsList.value.filter(
    (req) => !excludedIds.value.has(req.id),
  );
  if (!activeReqs.length || running.value) return;
  running.value = true;
  loadStats.value = null;
  const latencies: number[] = [];
  let errors = 0;
  const startAt = performance.now();
  const endAt = startAt + Math.max(1, loadDurationSec.value) * 1000;
  const env = { ...ws.activeVariablesMap, ...tabsStore.runtimeEnvOverrides };

  const worker = async () => {
    while (performance.now() < endAt) {
      for (const req of activeReqs) {
        if (performance.now() >= endAt) break;
        const t0 = performance.now();
        try {
          const res = await executeProxyRequest({
            method: req.method,
            url: applyPathParamsToUrl(resolveVariables(req.url, env), req.pathParams ?? [], (v) => resolveVariables(v, env)),
            body: req.body,
          });
          latencies.push(Math.round(performance.now() - t0));
          if (res.statusCode >= 400) errors++;
        } catch {
          latencies.push(Math.round(performance.now() - t0));
          errors++;
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(50, Math.max(1, virtualUsers.value)) }, () => worker()),
  );

  const elapsedSec = Math.max(0.1, (performance.now() - startAt) / 1000);
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  loadStats.value = {
    total: sorted.length,
    errors,
    rps: Math.round((sorted.length / elapsedSec) * 10) / 10,
    avgMs: sorted.length ? Math.round(sum / sorted.length) : 0,
    p95Ms: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
    p99Ms: sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0,
  };
  running.value = false;
}

function toggleRequestSelected(id: string, checked: boolean) {
  const next = new Set(excludedIds.value);
  if (checked) next.delete(id);
  else next.add(id);
  excludedIds.value = next;
}

function exportGitHubActionsCi() {
  const colName = props.collectionNode?.label || 'api-collection';
  const safeName = colName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const yml = `name: API Tests (${colName})

on:
  push:
    branches: [ main ]
  pull_request:
  schedule:
    - cron: '0 */6 * * *'

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install Newman
        run: npm install -g newman
      - name: Run ${colName} Collection
        run: newman run ./collections/${safeName}.postman_collection.json --reporters cli,json
`;
  downloadBlobFile(yml, `api-test-${safeName}.yml`, 'text/yaml');
  ElMessage.success('Exported GitHub Actions workflow (.yml)');
}

function flattenRequests(node: CollectionTreeNode | null): ApiRequestDto[] {
  if (!node) return [];
  const list: ApiRequestDto[] = [];
  for (const child of node.children ?? []) {
    if (child.kind === 'request' && child.request) {
      list.push(child.request);
    } else if (child.kind === 'collection') {
      list.push(...flattenRequests(child));
    }
  }
  return list;
}

const requestsList = computed(() => flattenRequests(props.collectionNode));

const summary = computed(() => {
  let passed = 0;
  let failed = 0;
  for (const r of results.value) {
    for (const t of r.tests) {
      if (t.passed) passed++;
      else failed++;
    }
  }
  return { passed, failed, totalRequests: results.value.length };
});

function parseCsvRows(csvText: string): Array<Record<string, string>> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const splitCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cols[idx] ?? '';
    });
    return row;
  });
}

async function handleDataFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    let parsedRows: Array<Record<string, string>> = [];
    if (file.name.toLowerCase().endsWith('.json')) {
      const json = JSON.parse(text) as unknown;
      if (!Array.isArray(json)) {
        throw new Error('JSON data file must be an array of objects');
      }
      parsedRows = json.map((item) => {
        const row: Record<string, string> = {};
        if (item && typeof item === 'object') {
          for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
            row[k] = v === null || v === undefined ? '' : String(v);
          }
        }
        return row;
      });
    } else {
      parsedRows = parseCsvRows(text);
    }
    dataRows.value = parsedRows;
    dataFileName.value = file.name;
    ElMessage.success(`Loaded ${parsedRows.length} data row(s)`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Failed to parse data file');
  } finally {
    input.value = '';
  }
}

function clearDataFile() {
  dataRows.value = [];
  dataFileName.value = '';
}

async function startRun() {
  if (!requestsList.value.length || running.value) return;
  running.value = true;
  results.value = [];

  const baseIterations = dataRows.value.length ? dataRows.value : [{}];
  const iterations: Array<Record<string, string>> = [];
  for (let rep = 0; rep < Math.max(1, repeatCount.value); rep++) {
    iterations.push(...baseIterations);
  }
  const activeReqs = requestsList.value.filter(
    (req) => !excludedIds.value.has(req.id),
  );
  let baseEnv = { ...ws.activeVariablesMap, ...tabsStore.runtimeEnvOverrides };

  for (let iterIdx = 0; iterIdx < iterations.length; iterIdx++) {
    let env = { ...baseEnv, ...iterations[iterIdx] };

    for (const req of activeReqs) {
      if (delayMs.value > 0) {
        await new Promise((res) => setTimeout(res, delayMs.value));
      }
      const r = (val: string) => resolveVariables(val, env);

      if (req.preRequestScript?.trim()) {
        const pre = await runScriptInSandbox({
          script: req.preRequestScript,
          env,
        });
        if (Object.keys(pre.envUpdates).length) {
          env = { ...env, ...pre.envUpdates };
          baseEnv = { ...baseEnv, ...pre.envUpdates };
          tabsStore.runtimeEnvOverrides = {
            ...tabsStore.runtimeEnvOverrides,
            ...pre.envUpdates,
          };
        }
      }

      const resolvedUrl = applyPathParamsToUrl(
        r(req.url),
        req.pathParams ?? [],
        r,
      );
      const queryParams: Record<string, string> = {};
      for (const row of req.queryParams ?? []) {
        if (row.enabled && row.key.trim()) {
          queryParams[r(row.key.trim())] = r(row.value);
        }
      }

      const inherited = ws.getEffectiveCollectionAuthAndHeaders(req.collectionId);
      const headers: Record<string, string> = {};
      for (const row of inherited.headers) {
        if (row.enabled && row.key.trim()) headers[r(row.key.trim())] = r(row.value);
      }
      for (const row of req.headers ?? []) {
        if (row.enabled && row.key.trim()) headers[r(row.key.trim())] = r(row.value);
      }

      const effectiveAuth: AuthConfig =
        req.auth?.type === 'inherit' ? inherited.auth : (req.auth ?? { type: 'none' });

      if (effectiveAuth.type === 'bearer' && effectiveAuth.token) {
        headers['Authorization'] = `Bearer ${r(effectiveAuth.token)}`;
      } else if (effectiveAuth.type === 'basic' && effectiveAuth.username) {
        headers['Authorization'] = `Basic ${btoa(`${r(effectiveAuth.username)}:${r(effectiveAuth.password ?? '')}`)}`;
      } else if (effectiveAuth.type === 'apikey' && effectiveAuth.key) {
        if (effectiveAuth.addTo === 'header') {
          headers[r(effectiveAuth.key)] = r(effectiveAuth.value);
        } else {
          queryParams[r(effectiveAuth.key)] = r(effectiveAuth.value);
        }
      }

      const body: BodyConfig = {
        ...req.body,
        raw: req.body?.raw ? r(req.body.raw) : req.body?.raw,
      };

      try {
        const res = await executeProxyRequest({
          method: req.method,
          url: resolvedUrl,
          headers,
          queryParams,
          body,
        });

        let tests: TestCaseResult[] = [];
        if (req.testScript?.trim()) {
          const testOut = await runScriptInSandbox({
            script: req.testScript,
            env,
            response: {
              statusCode: res.statusCode,
              statusText: res.statusText,
              durationMs: res.durationMs,
              headers: res.headers,
              body: res.body,
            },
          });
          tests = testOut.tests;
          if (Object.keys(testOut.envUpdates).length) {
            env = { ...env, ...testOut.envUpdates };
            baseEnv = { ...baseEnv, ...testOut.envUpdates };
            tabsStore.runtimeEnvOverrides = {
              ...tabsStore.runtimeEnvOverrides,
              ...testOut.envUpdates,
            };
          }
        }

        results.value.push({
          id: `${req.id}-${iterIdx}`,
          iteration: iterIdx + 1,
          name: req.name,
          method: req.method,
          url: resolvedUrl,
          statusCode: res.statusCode,
          durationMs: res.durationMs,
          tests,
        });
      } catch (err) {
        results.value.push({
          id: `${req.id}-${iterIdx}`,
          iteration: iterIdx + 1,
          name: req.name,
          method: req.method,
          url: resolvedUrl,
          error: err instanceof Error ? err.message : 'Request failed',
          tests: [],
        });
      }
    }
  }

  running.value = false;
}

function exportReport(format: 'json' | 'html') {
  if (!results.value.length) return;
  const colName = props.collectionNode?.label || 'collection';
  const safeName = colName.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (format === 'json') {
    const report = {
      collection: colName,
      generatedAt: new Date().toISOString(),
      summary: summary.value,
      iterations: dataRows.value.length || 1,
      results: results.value,
    };
    downloadBlobFile(
      JSON.stringify(report, null, 2),
      `${safeName}-report.json`,
      'application/json',
    );
    return;
  }

  const rowsHtml = results.value
    .map((item) => {
      const testsHtml = item.tests
        .map(
          (t) =>
            `<li style="color:${t.passed ? '#10b981' : '#ef4444'}">${t.passed ? 'PASS' : 'FAIL'}: ${t.name}${t.error ? ` — ${t.error}` : ''}</li>`,
        )
        .join('');
      return `<tr>
        <td>#${item.iteration}</td>
        <td><strong>${item.method}</strong></td>
        <td>${item.name}</td>
        <td><code>${item.url}</code></td>
        <td>${item.statusCode ?? 'ERR'}</td>
        <td>${item.durationMs ?? '-'} ms</td>
        <td>${item.error ? `<span style="color:#ef4444">${item.error}</span>` : `<ul>${testsHtml}</ul>`}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Test Report — ${colName}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;background:#0f172a;color:#e2e8f0}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #334155;padding:8px 10px;text-align:left;font-size:13px}
th{background:#1e293b}ul{margin:0;padding-left:18px}</style></head>
<body>
<h1>Collection Test Report: ${colName}</h1>
<p>Generated: ${new Date().toLocaleString()} | Requests: ${summary.value.totalRequests} | Passed: ${summary.value.passed} | Failed: ${summary.value.failed}</p>
<table><thead><tr><th>Iter</th><th>Method</th><th>Request</th><th>URL</th><th>Status</th><th>Time</th><th>Tests</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
</body></html>`;

  downloadBlobFile(html, `${safeName}-report.html`, 'text/html');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`Collection Runner: ${collectionNode?.label ?? ''}`"
    width="min(94vw, 820px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="runner-toolbar">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
        <el-text type="info" size="small">
          {{ requestsList.length }} requests
        </el-text>
        <el-button
          size="small"
          :icon="Upload"
          @click="dataFileInput?.click()"
        >
          {{ dataFileName ? `Data: ${dataFileName} (${dataRows.length} rows)` : 'Data File (CSV/JSON)' }}
        </el-button>
        <el-button
          v-if="dataRows.length"
          size="small"
          :icon="Delete"
          link
          type="danger"
          @click="clearDataFile"
        />
        <input
          ref="dataFileInput"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          style="display: none"
          @change="handleDataFileSelected"
        />
      </div>
      <div class="runner-stats">
        <el-tag v-if="results.length" type="success" size="small">
          Passed: {{ summary.passed }}
        </el-tag>
        <el-tag v-if="results.length" type="danger" size="small">
          Failed: {{ summary.failed }}
        </el-tag>
        <el-dropdown v-if="results.length" trigger="click">
          <el-button size="small" :icon="Download">Export Report</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="exportReport('json')">
                Export JSON Report
              </el-dropdown-item>
              <el-dropdown-item @click="exportReport('html')">
                Export HTML Report
              </el-dropdown-item>
              <el-dropdown-item divided @click="exportGitHubActionsCi">
                Export GitHub Actions CI (.yml)
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button
          v-else
          size="small"
          :icon="Download"
          @click="exportGitHubActionsCi"
        >
          CI (.yml)
        </el-button>
        <el-button
          type="primary"
          size="small"
          :icon="VideoPlay"
          :loading="running"
          :disabled="!requestsList.length"
          @click="loadTestMode ? runLoadTest() : startRun()"
        >
          {{ loadTestMode ? 'Start Load Test' : 'Run Collection' }}
        </el-button>
      </div>
    </div>

    <div
      style="
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 10px;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid var(--ao-border);
        background: var(--ao-surface-2);
        font-size: 12px;
      "
    >
      <div style="display: flex; align-items: center; gap: 6px">
        <span>Iterations:</span>
        <el-input-number v-model="repeatCount" size="small" :min="1" :max="50" style="width: 90px" />
      </div>
      <div style="display: flex; align-items: center; gap: 6px">
        <span>Delay (ms):</span>
        <el-input-number v-model="delayMs" size="small" :min="0" :max="10000" :step="100" style="width: 100px" />
      </div>
      <el-checkbox v-model="persistResponses" size="small">
        Persist responses
      </el-checkbox>
      <el-checkbox v-model="loadTestMode" size="small">
        Load Test Mode
      </el-checkbox>
      <template v-if="loadTestMode">
        <div style="display: flex; align-items: center; gap: 6px">
          <span>VUs:</span>
          <el-input-number v-model="virtualUsers" size="small" :min="1" :max="50" style="width: 85px" />
        </div>
        <div style="display: flex; align-items: center; gap: 6px">
          <span>Duration (s):</span>
          <el-input-number v-model="loadDurationSec" size="small" :min="1" :max="60" style="width: 85px" />
        </div>
      </template>
    </div>

    <div
      v-if="loadStats"
      style="
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
        padding: 10px;
        border-radius: 6px;
        border: 1px solid var(--ao-border);
        background: var(--ao-surface-elevated);
      "
    >
      <el-tag type="info">Requests: {{ loadStats.total }}</el-tag>
      <el-tag type="success">RPS: {{ loadStats.rps }}/s</el-tag>
      <el-tag>Avg: {{ loadStats.avgMs }}ms</el-tag>
      <el-tag type="warning">p95: {{ loadStats.p95Ms }}ms</el-tag>
      <el-tag type="warning">p99: {{ loadStats.p99Ms }}ms</el-tag>
      <el-tag :type="loadStats.errors ? 'danger' : 'success'">
        Errors: {{ loadStats.errors }}
      </el-tag>
    </div>

    <div
      v-if="requestsList.length && !results.length"
      style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px"
    >
      <el-checkbox
        v-for="req in requestsList"
        :key="req.id"
        :model-value="!excludedIds.has(req.id)"
        size="small"
        @change="toggleRequestSelected(req.id, Boolean($event))"
      >
        {{ req.method }} {{ req.name }}
      </el-checkbox>
    </div>

    <el-empty
      v-if="!results.length && !running"
      description="Click Run Collection to execute all requests sequentially (supports CSV/JSON data-driven iterations)"
      :image-size="60"
    />

    <div v-else class="runner-list">
      <div v-for="item in results" :key="item.id" class="runner-item">
        <div class="runner-item-head">
          <div class="runner-item-title">
            <el-tag v-if="dataRows.length" size="small" effect="plain">
              #{{ item.iteration }}
            </el-tag>
            <span class="method-badge" :class="`method-${item.method}`">
              {{ item.method }}
            </span>
            <strong>{{ item.name }}</strong>
            <el-text size="small" type="info">{{ item.url }}</el-text>
          </div>
          <div class="runner-item-meta">
            <span
              v-if="item.statusCode"
              class="status-badge"
              :class="
                item.statusCode < 300
                  ? 'status-2xx'
                  : item.statusCode < 400
                    ? 'status-3xx'
                    : item.statusCode < 500
                      ? 'status-4xx'
                      : 'status-5xx'
              "
            >
              {{ item.statusCode }}
            </span>
            <span
              v-if="item.durationMs !== undefined"
              class="status-badge status-1xx"
            >
              {{ item.durationMs }} ms
            </span>
          </div>
        </div>
        <el-text v-if="item.error" type="danger" size="small">
          {{ item.error }}
        </el-text>
        <div v-if="item.tests.length" class="runner-tests">
          <div v-for="(t, i) in item.tests" :key="i" class="runner-test-row">
            <el-tag :type="t.passed ? 'success' : 'danger'" size="small">
              {{ t.passed ? 'PASS' : 'FAIL' }}
            </el-tag>
            <span>{{ t.name }}</span>
            <el-text v-if="t.error" type="danger" size="small">
              — {{ t.error }}
            </el-text>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.runner-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.runner-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.runner-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
}
.runner-item {
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
  border-radius: 6px;
  padding: 10px 12px;
}
.runner-item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.runner-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.runner-item-meta {
  display: flex;
  gap: 6px;
}
.runner-tests {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.runner-test-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
</style>
