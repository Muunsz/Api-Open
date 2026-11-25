<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BodyConfig } from '@api-open/shared';
import { VideoPlay } from '@element-plus/icons-vue';
import { executeProxyRequest } from '../api/proxy';
import type { ApiRequestDto } from '../api/workspace';
import { useTabsStore } from '../stores/tabs';
import { type CollectionTreeNode, useWorkspaceStore } from '../stores/workspace';
import { runScriptInSandbox, type TestCaseResult } from '../utils/scriptRunner';
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

async function startRun() {
  if (!requestsList.value.length || running.value) return;
  running.value = true;
  results.value = [];

  let env = { ...ws.activeVariablesMap, ...tabsStore.runtimeEnvOverrides };

  for (const req of requestsList.value) {
    const r = (val: string) => resolveVariables(val, env);

    if (req.preRequestScript?.trim()) {
      const pre = await runScriptInSandbox({
        script: req.preRequestScript,
        env,
      });
      if (Object.keys(pre.envUpdates).length) {
        env = { ...env, ...pre.envUpdates };
        tabsStore.runtimeEnvOverrides = {
          ...tabsStore.runtimeEnvOverrides,
          ...pre.envUpdates,
        };
      }
    }

    const resolvedUrl = r(req.url);
    const queryParams: Record<string, string> = {};
    for (const row of req.queryParams ?? []) {
      if (row.enabled && row.key.trim()) queryParams[r(row.key.trim())] = r(row.value);
    }
    const headers: Record<string, string> = {};
    for (const row of req.headers ?? []) {
      if (row.enabled && row.key.trim()) headers[r(row.key.trim())] = r(row.value);
    }

    if (req.auth?.type === 'bearer' && req.auth.token) {
      headers['Authorization'] = `Bearer ${r(req.auth.token)}`;
    } else if (req.auth?.type === 'basic' && req.auth.username) {
      headers['Authorization'] = `Basic ${btoa(`${r(req.auth.username)}:${r(req.auth.password ?? '')}`)}`;
    } else if (req.auth?.type === 'apikey' && req.auth.key) {
      if (req.auth.addTo === 'header') headers[r(req.auth.key)] = r(req.auth.value);
      else queryParams[r(req.auth.key)] = r(req.auth.value);
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
          tabsStore.runtimeEnvOverrides = {
            ...tabsStore.runtimeEnvOverrides,
            ...testOut.envUpdates,
          };
        }
      }

      results.value.push({
        id: req.id,
        name: req.name,
        method: req.method,
        url: resolvedUrl,
        statusCode: res.statusCode,
        durationMs: res.durationMs,
        tests,
      });
    } catch (err) {
      results.value.push({
        id: req.id,
        name: req.name,
        method: req.method,
        url: resolvedUrl,
        error: err instanceof Error ? err.message : 'Request failed',
        tests: [],
      });
    }
  }

  running.value = false;
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`Collection Runner: ${collectionNode?.label ?? ''}`"
    width="min(94vw, 760px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="runner-toolbar">
      <el-text type="info" size="small">
        {{ requestsList.length }} requests in collection
      </el-text>
      <div class="runner-stats">
        <el-tag v-if="results.length" type="success" size="small">
          Passed: {{ summary.passed }}
        </el-tag>
        <el-tag v-if="results.length" type="danger" size="small">
          Failed: {{ summary.failed }}
        </el-tag>
        <el-button
          type="primary"
          size="small"
          :icon="VideoPlay"
          :loading="running"
          :disabled="!requestsList.length"
          @click="startRun"
        >
          Run Collection
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="!results.length && !running"
      description="Click Run Collection to execute all requests sequentially"
      :image-size="60"
    />

    <div v-else class="runner-list">
      <div v-for="item in results" :key="item.id" class="runner-item">
        <div class="runner-item-head">
          <div class="runner-item-title">
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
