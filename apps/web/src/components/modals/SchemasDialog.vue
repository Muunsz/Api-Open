<script setup lang="ts">
import { ref } from 'vue';
import { Delete, Plus, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useTabsStore } from '../../stores/tabs';
import { useWorkspaceStore } from '../../stores/workspace';
import CodeEditor from '../CodeEditor.vue';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const tabsStore = useTabsStore();

const schemaName = ref('');
const schemaJson = ref(
  JSON.stringify(
    {
      type: 'object',
      properties: {
        id: { type: 'integer', example: 1 },
        name: { type: 'string', example: 'Api-Open' },
        active: { type: 'boolean', example: true },
      },
    },
    null,
    2,
  ),
);

function addSchema() {
  if (!schemaName.value.trim()) {
    ElMessage.warning('Enter schema name');
    return;
  }
  try {
    JSON.parse(schemaJson.value);
  } catch {
    ElMessage.error('Schema must be valid JSON');
    return;
  }
  ws.schemas.push({
    id: Math.random().toString(36).slice(2, 10),
    name: schemaName.value.trim(),
    jsonSchema: schemaJson.value,
  });
  schemaName.value = '';
  ElMessage.success('Schema saved');
}

function generateMockAndOpen(rawSchema: string, name: string) {
  try {
    const parsed = JSON.parse(rawSchema) as {
      properties?: Record<string, { type?: string; example?: unknown }>;
    };
    const mock: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.properties ?? {})) {
      mock[k] =
        v.example !== undefined
          ? v.example
          : v.type === 'integer' || v.type === 'number'
            ? 0
            : v.type === 'boolean'
              ? false
              : '';
    }
    tabsStore.addTab({
      name: `${name} Request`,
      method: 'POST',
      url: '{{base_url}}/' + name.toLowerCase(),
      body: { mode: 'raw', raw: JSON.stringify(mock, null, 2), rawType: 'json' },
    });
    emit('update:visible', false);
  } catch {
    ElMessage.error('Invalid schema JSON');
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Data Schemas & Reusable DTO Models"
    width="min(94vw, 760px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div style="display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; gap: 8px">
        <el-input
          v-model="schemaName"
          size="small"
          placeholder="Model Name (e.g. User, Order, ErrorResponse)"
          style="max-width: 300px"
        />
        <el-button size="small" type="primary" :icon="Plus" @click="addSchema">
          Save Model
        </el-button>
      </div>

      <CodeEditor v-model="schemaJson" language="json" :rows="7" />

      <el-divider v-if="ws.schemas.length">Saved Models ({{ ws.schemas.length }})</el-divider>

      <div
        v-for="(s, idx) in ws.schemas"
        :key="s.id"
        style="
          padding: 8px 12px;
          border: 1px solid var(--ao-border);
          border-radius: 6px;
          background: var(--ao-surface-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <strong>{{ s.name }}</strong>
        <div style="display: flex; gap: 6px">
          <el-button
            size="small"
            :icon="VideoPlay"
            @click="generateMockAndOpen(s.jsonSchema, s.name)"
          >
            Use in Request
          </el-button>
          <el-button
            size="small"
            type="danger"
            link
            :icon="Delete"
            @click="ws.schemas.splice(idx, 1)"
          />
        </div>
      </div>
    </div>
  </el-dialog>
</template>
