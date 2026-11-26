<script setup lang="ts">
import { computed, ref } from 'vue';
import { VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { executeDbQuery } from '../../services/proxyService';
import CodeEditor from '../CodeEditor.vue';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const connectionUrl = ref('');
const sql = ref('SELECT now() AS current_time, version() AS pg_version;');
const running = ref(false);
const rows = ref<Array<Record<string, unknown>>>([]);
const durationMs = ref<number | null>(null);

const columns = computed(() => {
  if (!rows.value.length) return [];
  return Object.keys(rows.value[0]);
});

async function runQuery() {
  if (!sql.value.trim()) return;
  running.value = true;
  try {
    const res = await executeDbQuery(connectionUrl.value || undefined, sql.value);
    rows.value = res.rows as Array<Record<string, unknown>>;
    durationMs.value = res.durationMs;
    ElMessage.success(`Returned ${rows.value.length} row(s) in ${res.durationMs}ms`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Query failed');
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Database Client / SQL Query Runner"
    width="min(95vw, 840px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div style="display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; gap: 8px; align-items: center">
        <el-input
          v-model="connectionUrl"
          size="small"
          placeholder="PostgreSQL URL (leave empty to use workspace DB)"
          clearable
        />
        <el-button
          size="small"
          type="primary"
          :icon="VideoPlay"
          :loading="running"
          @click="runQuery"
        >
          Run SQL
        </el-button>
      </div>

      <CodeEditor
        v-model="sql"
        language="text"
        :rows="5"
        placeholder="SELECT * FROM ..."
      />

      <div v-if="durationMs !== null" style="font-size: 12px; color: var(--ao-text-muted)">
        {{ rows.length }} row(s) • {{ durationMs }} ms
      </div>

      <el-table v-if="rows.length" :data="rows" size="small" border max-height="280">
        <el-table-column
          v-for="col in columns"
          :key="col"
          :prop="col"
          :label="col"
          min-width="130"
        />
      </el-table>
    </div>
  </el-dialog>
</template>
