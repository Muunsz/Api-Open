<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AuthConfig, EnvVariable, KeyValueItem } from '@api-open/shared';
import { Delete, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { type CollectionDto, useWorkspaceStore } from '../../stores/workspace';
import KeyValueTable from '../KeyValueTable.vue';

const props = defineProps<{
  visible: boolean;
  collection: CollectionDto | null;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const name = ref('');
const auth = ref<AuthConfig>({ type: 'none' });
const headers = ref<KeyValueItem[]>([]);
const variables = ref<EnvVariable[]>([]);
const saving = ref(false);

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

watch(
  () => [props.visible, props.collection] as const,
  ([vis, col]) => {
    if (!vis || !col) return;
    name.value = col.name;
    auth.value = col.auth
      ? (JSON.parse(JSON.stringify(col.auth)) as AuthConfig)
      : { type: 'none' };
    headers.value = col.headers?.length
      ? col.headers.map((h) => ({ ...h }))
      : [{ id: uid(), key: '', value: '', description: '', enabled: true }];
    variables.value = col.variables?.length
      ? col.variables.map((v) => ({ ...v }))
      : [];
  },
  { immediate: true },
);

function addVariableRow() {
  variables.value.push({
    id: uid(),
    key: '',
    value: '',
    isSecret: false,
    enabled: true,
  });
}

function handleAuthTypeChange(val: string) {
  if (val === 'none') auth.value = { type: 'none' };
  else if (val === 'bearer') auth.value = { type: 'bearer', token: '' };
  else if (val === 'basic')
    auth.value = { type: 'basic', username: '', password: '' };
  else if (val === 'apikey')
    auth.value = { type: 'apikey', key: '', value: '', addTo: 'header' };
}

async function save() {
  if (!props.collection) return;
  if (!name.value.trim()) {
    ElMessage.warning('Collection name cannot be empty');
    return;
  }
  saving.value = true;
  try {
    await ws.updateCollection(props.collection.id, {
      name: name.value.trim(),
      auth: auth.value,
      headers: headers.value.filter((h) => h.key.trim() || h.value.trim()),
      variables: variables.value.filter((v) => v.key.trim() || v.value.trim()),
    });
    ElMessage.success('Collection settings saved');
    emit('update:visible', false);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`Collection Settings: ${collection?.name ?? ''}`"
    width="min(94vw, 600px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-width="110px" size="small">
      <el-form-item label="Name">
        <el-input v-model="name" placeholder="Collection / Folder name" />
      </el-form-item>

      <el-divider content-position="left">
        Inherited Authorization
      </el-divider>
      <el-form-item label="Auth Type">
        <el-select
          :model-value="auth.type"
          style="width: 240px"
          @update:model-value="handleAuthTypeChange(String($event))"
        >
          <el-option label="No Auth" value="none" />
          <el-option label="Bearer Token" value="bearer" />
          <el-option label="Basic Auth" value="basic" />
          <el-option label="API Key" value="apikey" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="auth.type === 'bearer'" label="Token">
        <el-input
          v-model="auth.token"
          placeholder="Bearer token (supports {{variable}})"
          show-password
        />
      </el-form-item>

      <template v-if="auth.type === 'basic'">
        <el-form-item label="Username">
          <el-input v-model="auth.username" />
        </el-form-item>
        <el-form-item label="Password">
          <el-input v-model="auth.password" show-password />
        </el-form-item>
      </template>

      <template v-if="auth.type === 'apikey'">
        <el-form-item label="Key">
          <el-input v-model="auth.key" placeholder="X-API-Key" />
        </el-form-item>
        <el-form-item label="Value">
          <el-input v-model="auth.value" />
        </el-form-item>
        <el-form-item label="Add to">
          <el-radio-group v-model="auth.addTo">
            <el-radio value="header">Header</el-radio>
            <el-radio value="query">Query Params</el-radio>
          </el-radio-group>
        </el-form-item>
      </template>

      <el-divider content-position="left">Inherited Headers</el-divider>
      <KeyValueTable
        :rows="headers"
        key-placeholder="Header"
        value-placeholder="Value"
      />

      <el-divider content-position="left">Collection Variables</el-divider>
      <el-table :data="variables" size="small" border>
        <el-table-column width="46" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="Variable">
          <template #default="{ row }">
            <el-input v-model="row.key" size="small" placeholder="collection_var" />
          </template>
        </el-table-column>
        <el-table-column label="Value">
          <template #default="{ row }">
            <el-input
              v-model="row.value"
              size="small"
              :type="row.isSecret ? 'password' : 'text'"
              show-password
            />
          </template>
        </el-table-column>
        <el-table-column width="50" align="center">
          <template #default="{ $index }">
            <el-button
              :icon="Delete"
              link
              type="danger"
              @click="variables.splice($index, 1)"
            />
          </template>
        </el-table-column>
      </el-table>
      <el-button
        size="small"
        :icon="Plus"
        style="margin-top: 8px"
        @click="addVariableRow"
      >
        Add Collection Variable
      </el-button>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:visible', false)">Cancel</el-button>
      <el-button type="primary" :loading="saving" @click="save">Save</el-button>
    </template>
  </el-dialog>
</template>
