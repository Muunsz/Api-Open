<script setup lang="ts">
import { ref } from 'vue';
import type { KeyValueItem } from '@api-open/shared';
import { Delete, Edit, Grid, Plus } from '@element-plus/icons-vue';

const props = defineProps<{
  rows: KeyValueItem[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}>();

const bulkMode = ref(false);
const bulkText = ref('');

function makeRow(partial?: Partial<KeyValueItem>): KeyValueItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    key: '',
    value: '',
    description: '',
    enabled: true,
    ...partial,
  };
}

function addRow() {
  props.rows.push(makeRow());
}

function removeRow(index: number) {
  if (props.rows.length === 1) {
    props.rows[0].key = '';
    props.rows[0].value = '';
    props.rows[0].description = '';
    props.rows[0].enabled = true;
    return;
  }
  props.rows.splice(index, 1);
}

function rowsToBulkText(): string {
  return props.rows
    .filter((r) => r.key.trim() || r.value.trim())
    .map((r) => `${r.enabled ? '' : '// '}${r.key}:${r.value}`)
    .join('\n');
}

function applyBulkTextToRows(text: string) {
  const lines = text.split(/\r?\n/);
  const parsed: KeyValueItem[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let enabled = true;
    let content = rawLine;
    if (trimmed.startsWith('//')) {
      enabled = false;
      content = trimmed.slice(2).replace(/^\s+/, '');
    }
    const colonIdx = content.indexOf(':');
    const key =
      colonIdx >= 0 ? content.slice(0, colonIdx).trim() : content.trim();
    const value = colonIdx >= 0 ? content.slice(colonIdx + 1).trim() : '';
    parsed.push(makeRow({ key, value, enabled }));
  }
  if (!parsed.length) {
    parsed.push(makeRow());
  }
  props.rows.splice(0, props.rows.length, ...parsed);
}

function toggleBulkMode() {
  if (!bulkMode.value) {
    bulkText.value = rowsToBulkText();
    bulkMode.value = true;
  } else {
    applyBulkTextToRows(bulkText.value);
    bulkMode.value = false;
  }
}

function rowClassName({ row }: { row: KeyValueItem }) {
  return row.enabled ? 'kv-row-enabled' : 'kv-row-disabled';
}
</script>

<template>
  <div class="kv-table">
    <div class="kv-toolbar">
      <el-button
        plain
        size="small"
        :icon="bulkMode ? Grid : Edit"
        @click="toggleBulkMode"
      >
        {{ bulkMode ? 'Key-Value Edit' : 'Bulk Edit' }}
      </el-button>
    </div>

    <el-input
      v-if="bulkMode"
      v-model="bulkText"
      type="textarea"
      :rows="7"
      class="kv-bulk-input"
      placeholder="Rows are separated by new lines&#10;Keys and values are separated by :&#10;Prepend // to any row you want to add but keep disabled"
      @input="applyBulkTextToRows(bulkText)"
    />

    <template v-else>
      <el-table
        :data="rows"
        size="small"
        border
        style="width: 100%"
        :row-class-name="rowClassName"
      >
        <el-table-column width="46" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="Key">
          <template #default="{ row }">
            <el-input
              v-model="row.key"
              size="small"
              :placeholder="keyPlaceholder ?? 'Key'"
            />
          </template>
        </el-table-column>
        <el-table-column label="Value">
          <template #default="{ row }">
            <el-input
              v-model="row.value"
              size="small"
              :placeholder="valuePlaceholder ?? 'Value'"
            />
          </template>
        </el-table-column>
        <el-table-column label="Description">
          <template #default="{ row }">
            <el-input
              v-model="row.description"
              size="small"
              placeholder="Description"
            />
          </template>
        </el-table-column>
        <el-table-column width="54" align="center">
          <template #default="{ $index }">
            <el-button
              :icon="Delete"
              link
              type="danger"
              @click="removeRow($index)"
            />
          </template>
        </el-table-column>
      </el-table>
      <div class="kv-actions">
        <el-button size="small" :icon="Plus" @click="addRow">Add Row</el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kv-table {
  width: 100%;
  overflow-x: auto;
}
.kv-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}
.kv-bulk-input :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
}
.kv-table :deep(.el-table) {
  min-width: 520px;
}
.kv-table :deep(.el-table .el-input__wrapper),
.kv-table :deep(.el-table .el-input__wrapper:hover),
.kv-table :deep(.el-table .el-input__wrapper.is-focus) {
  box-shadow: none !important;
  background-color: transparent !important;
  padding-left: 2px;
  padding-right: 2px;
}
.kv-actions {
  margin-top: 8px;
}
.kv-table :deep(.kv-row-disabled td:not(:first-child):not(:last-child)) {
  opacity: 0.42;
  transition: opacity 0.15s ease;
}
.kv-table :deep(.kv-row-enabled td) {
  opacity: 1;
  transition: opacity 0.15s ease;
}
</style>
