<script setup lang="ts">
import type { KeyValueItem } from '@api-open/shared';
import { Delete, Plus } from '@element-plus/icons-vue';

const props = defineProps<{
  rows: KeyValueItem[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}>();

function addRow() {
  props.rows.push({
    id: Math.random().toString(36).slice(2, 10),
    key: '',
    value: '',
    description: '',
    enabled: true,
  });
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
</script>

<template>
  <div class="kv-table">
    <el-table :data="rows" size="small" border style="width: 100%">
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
  </div>
</template>

<style scoped>
.kv-actions {
  margin-top: 8px;
}
</style>
