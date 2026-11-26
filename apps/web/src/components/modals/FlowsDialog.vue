<script setup lang="ts">
import { computed, ref } from 'vue';
import { Delete, Plus, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { executeProxyRequest } from '../../api/proxy';
import { useTabsStore } from '../../stores/tabs';
import { type ApiRequestDto, useWorkspaceStore } from '../../stores/workspace';
import { resolveVariables } from '../../utils/variables';

interface FlowStep {
  id: string;
  type: 'request' | 'condition' | 'delay';
  requestId?: string;
  extractVarName?: string;
  extractJsonPath?: string;
  conditionExpr?: string;
  delayMs?: number;
  status?: 'idle' | 'running' | 'ok' | 'fail' | 'skipped';
  log?: string;
}

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const tabsStore = useTabsStore();
const steps = ref<FlowStep[]>([]);
const running = ref(false);

const allRequests = computed<ApiRequestDto[]>(() =>
  ws.collections.flatMap((c) => c.requests ?? []),
);

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function addStep(type: FlowStep['type']) {
  steps.value.push({
    id: uid(),
    type,
    requestId: type === 'request' ? allRequests.value[0]?.id : undefined,
    extractVarName: '',
    extractJsonPath: '$.token',
    conditionExpr: 'status == 200',
    delayMs: 500,
    status: 'idle',
  });
}

function extractByPath(obj: unknown, path: string): unknown {
  const cleaned = path.trim().replace(/^\$\.?/, '');
  if (!cleaned) return obj;
  let curr: unknown = obj;
  for (const part of cleaned.split('.')) {
    if (curr && typeof curr === 'object') {
      curr = (curr as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return curr;
}

async function runFlow() {
  if (!steps.value.length || running.value) return;
  running.value = true;
  let env = { ...ws.activeVariablesMap, ...tabsStore.runtimeEnvOverrides };
  let lastStatus = 200;
  let skipNext = false;

  for (const step of steps.value) {
    step.status = 'idle';
    step.log = '';
  }

  for (const step of steps.value) {
    if (skipNext) {
      step.status = 'skipped';
      step.log = 'Skipped by previous condition';
      skipNext = false;
      continue;
    }
    step.status = 'running';
    if (step.type === 'delay') {
      await new Promise((r) => setTimeout(r, step.delayMs ?? 500));
      step.status = 'ok';
      step.log = `Waited ${step.delayMs ?? 500}ms`;
    } else if (step.type === 'condition') {
      const targetCode = Number((step.conditionExpr || '200').replace(/\D/g, '') || 200);
      const pass = lastStatus === targetCode;
      step.status = pass ? 'ok' : 'fail';
      step.log = `Checked status (${lastStatus}) == ${targetCode} → ${pass ? 'TRUE' : 'FALSE'}`;
      if (!pass) skipNext = true;
    } else if (step.type === 'request') {
      const req = allRequests.value.find((r) => r.id === step.requestId);
      if (!req) {
        step.status = 'fail';
        step.log = 'Request not found';
        continue;
      }
      try {
        const res = await executeProxyRequest({
          method: req.method,
          url: resolveVariables(req.url, env),
          body: req.body,
        });
        lastStatus = res.statusCode;
        step.status = res.statusCode < 400 ? 'ok' : 'fail';
        step.log = `${req.method} ${res.statusCode} (${res.durationMs}ms)`;
        if (step.extractVarName?.trim() && step.extractJsonPath?.trim()) {
          try {
            const parsed = JSON.parse(res.body);
            const val = extractByPath(parsed, step.extractJsonPath);
            if (val !== undefined) {
              env[step.extractVarName.trim()] = String(val);
              tabsStore.runtimeEnvOverrides = {
                ...tabsStore.runtimeEnvOverrides,
                [step.extractVarName.trim()]: String(val),
              };
              step.log += ` | {{${step.extractVarName.trim()}}} = ${String(val).slice(0, 20)}`;
            }
          } catch {
            // ignore non-json
          }
        }
      } catch (err) {
        step.status = 'fail';
        step.log = err instanceof Error ? err.message : 'Failed';
      }
    }
  }
  running.value = false;
  ElMessage.success('Flow execution finished');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Visual API Workflow / Chaining Flows"
    width="min(95vw, 840px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="modal-toolbar" style="margin-bottom: 12px">
      <el-button size="small" :icon="Plus" @click="addStep('request')">
        + Request Node
      </el-button>
      <el-button size="small" :icon="Plus" @click="addStep('condition')">
        + Condition Node
      </el-button>
      <el-button size="small" :icon="Plus" @click="addStep('delay')">
        + Delay Node
      </el-button>
      <el-button
        size="small"
        type="primary"
        :icon="VideoPlay"
        :loading="running"
        :disabled="!steps.length"
        style="margin-left: auto"
        @click="runFlow"
      >
        Run Flow
      </el-button>
    </div>

    <el-empty
      v-if="!steps.length"
      description="Add Request, Condition, or Delay nodes to chain API workflows"
      :image-size="52"
    />

    <div v-else style="display: flex; flex-direction: column; gap: 10px; max-height: 440px; overflow-y: auto">
      <div
        v-for="(step, idx) in steps"
        :key="step.id"
        style="
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--ao-border);
          background: var(--ao-surface-2);
          display: flex;
          flex-direction: column;
          gap: 8px;
        "
      >
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
          <el-tag size="small" effect="dark">#{{ idx + 1 }} {{ step.type.toUpperCase() }}</el-tag>
          <el-tag
            v-if="step.status && step.status !== 'idle'"
            size="small"
            :type="step.status === 'ok' ? 'success' : step.status === 'fail' ? 'danger' : 'info'"
          >
            {{ step.status.toUpperCase() }}
          </el-tag>
          <span v-if="step.log" style="font-size: 12px; color: var(--ao-text-muted)">
            {{ step.log }}
          </span>
          <el-button
            :icon="Delete"
            link
            type="danger"
            size="small"
            style="margin-left: auto"
            @click="steps.splice(idx, 1)"
          />
        </div>

        <div v-if="step.type === 'request'" style="display: flex; gap: 8px; flex-wrap: wrap">
          <el-select v-model="step.requestId" size="small" style="flex: 1; min-width: 220px">
            <el-option
              v-for="r in allRequests"
              :key="r.id"
              :label="`${r.method} ${r.name}`"
              :value="r.id"
            />
          </el-select>
          <el-input
            v-model="step.extractJsonPath"
            size="small"
            placeholder="Extract JSONPath (e.g. $.token)"
            style="width: 190px"
          />
          <el-input
            v-model="step.extractVarName"
            size="small"
            placeholder="Save to {{var}}"
            style="width: 150px"
          />
        </div>

        <div v-else-if="step.type === 'condition'">
          <el-input
            v-model="step.conditionExpr"
            size="small"
            placeholder="status == 200"
            style="max-width: 240px"
          />
        </div>

        <div v-else-if="step.type === 'delay'">
          <el-input-number
            v-model="step.delayMs"
            size="small"
            :min="100"
            :max="10000"
            :step="100"
          />
          <span style="margin-left: 8px; font-size: 12px">ms</span>
        </div>
      </div>
    </div>
  </el-dialog>
</template>
