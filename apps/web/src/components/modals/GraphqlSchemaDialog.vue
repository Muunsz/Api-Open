<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useTabsStore } from '../../stores/tabs';
import type { GqlFieldSummary } from '../../utils/graphqlIntrospection';

defineProps<{
  visible: boolean;
  queries: GqlFieldSummary[];
  mutations: GqlFieldSummary[];
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const tabsStore = useTabsStore();
const opType = ref<'query' | 'mutation'>('query');
const selectedFields = ref<string[]>([]);

function toggleField(name: string, checked: boolean) {
  if (checked && !selectedFields.value.includes(name)) {
    selectedFields.value.push(name);
  } else if (!checked) {
    selectedFields.value = selectedFields.value.filter((f) => f !== name);
  }
}

const builtQuery = computed(() => {
  if (!selectedFields.value.length) return '';
  const body = selectedFields.value.map((f) => `  ${f} {\n    id\n  }`).join('\n');
  return `${opType.value} {\n${body}\n}`;
});

function applyQueryToTab() {
  if (!tabsStore.activeTab || !builtQuery.value) return;
  tabsStore.activeTab.body.mode = 'graphql';
  tabsStore.activeTab.body.graphql = {
    query: builtQuery.value,
    variables: tabsStore.activeTab.body.graphql?.variables ?? '{}',
  };
  ElMessage.success('Applied generated GraphQL query to active tab');
  emit('update:visible', false);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="GraphQL Schema & Visual Query Builder"
    width="min(94vw, 720px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs @tab-change="(n: string | number) => { opType = n === 'mutations' ? 'mutation' : 'query'; selectedFields = []; }">
      <el-tab-pane name="queries" :label="`Queries (${queries.length})`">
        <el-table :data="queries" size="small" border max-height="260">
          <el-table-column width="46" align="center">
            <template #default="{ row }">
              <el-checkbox
                :model-value="selectedFields.includes(row.name)"
                @change="(val: boolean) => toggleField(row.name, val)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="name" label="Field" width="180" />
          <el-table-column prop="args" label="Arguments" />
          <el-table-column prop="returnType" label="Returns" width="160" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane name="mutations" :label="`Mutations (${mutations.length})`">
        <el-table :data="mutations" size="small" border max-height="260">
          <el-table-column width="46" align="center">
            <template #default="{ row }">
              <el-checkbox
                :model-value="selectedFields.includes(row.name)"
                @change="(val: boolean) => toggleField(row.name, val)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="name" label="Field" width="180" />
          <el-table-column prop="args" label="Arguments" />
          <el-table-column prop="returnType" label="Returns" width="160" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <div v-if="builtQuery" style="margin-top: 12px">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px">
        <strong style="font-size: 12px">Generated GraphQL Query</strong>
        <el-button size="small" type="primary" @click="applyQueryToTab">
          Apply to Active Tab
        </el-button>
      </div>
      <el-input :model-value="builtQuery" readonly type="textarea" :rows="5" class="code-area" />
    </div>
  </el-dialog>
</template>
