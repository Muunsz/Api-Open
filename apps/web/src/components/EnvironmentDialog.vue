<script setup lang="ts">
import { ref, watch } from 'vue';
import type { EnvVariable } from '@api-open/shared';
import { Download, Plus, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { downloadBlobFile } from '../services/exportService';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{
  visible: boolean;
  initialEnvId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const newEnvName = ref('');
const editingEnvId = ref('');
const deletingEnv = ref(false);
const editingEnvVars = ref<EnvVariable[]>([]);
const envFileInput = ref<HTMLInputElement | null>(null);

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function handleImportEnvFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    let envName = file.name.replace(/\.(postman_environment\.json|json|env)$/i, '') || 'Imported Env';
    let vars: EnvVariable[] = [];

    if (file.name.endsWith('.json')) {
      const parsed = JSON.parse(text) as {
        name?: string;
        values?: Array<{ key?: string; value?: string; enabled?: boolean; type?: string }>;
      };
      if (parsed.name) envName = parsed.name;
      if (Array.isArray(parsed.values)) {
        vars = parsed.values
          .filter((v) => v.key)
          .map((v) => ({
            id: uid(),
            key: String(v.key),
            value: String(v.value ?? ''),
            isSecret: v.type === 'secret',
            enabled: v.enabled !== false,
          }));
      }
    } else {
      // Parse .env key=value lines
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        vars.push({
          id: uid(),
          key,
          value: val,
          isSecret: /secret|token|password|key/i.test(key),
          enabled: true,
        });
      }
    }

    await ws.createEnvironment(envName, vars);
    if (ws.activeEnvId) selectEnvForEdit(ws.activeEnvId);
    ElMessage.success(`Imported "${envName}" (${vars.length} variables)`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Import failed');
  } finally {
    input.value = '';
  }
}

function exportCurrentEnv(format: 'postman' | 'dotenv') {
  const found = ws.environments.find((e) => e.id === editingEnvId.value);
  if (!found) return;
  const safeName = found.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (format === 'dotenv') {
    const content = editingEnvVars.value
      .filter((v) => v.enabled && v.key.trim())
      .map((v) => `${v.key.trim()}=${JSON.stringify(v.value ?? '')}`)
      .join('\n');
    downloadBlobFile(`${content}\n`, `${safeName}.env`, 'text/plain');
    return;
  }
  const postmanEnv = {
    id: found.id,
    name: found.name,
    values: editingEnvVars.value.map((v) => ({
      key: v.key,
      value: v.value,
      type: v.isSecret ? 'secret' : 'default',
      enabled: v.enabled,
    })),
    _postman_variable_scope: 'environment',
  };
  downloadBlobFile(
    JSON.stringify(postmanEnv, null, 2),
    `${safeName}.postman_environment.json`,
    'application/json',
  );
}

function selectEnvForEdit(envId: string) {
  editingEnvId.value = envId;
  const found = ws.environments.find((e) => e.id === envId);
  editingEnvVars.value = found
    ? found.variables.map((v) => ({ ...v }))
    : [];
}

watch(
  () => [props.visible, props.initialEnvId, ws.environments] as const,
  ([vis, initId, envs]) => {
    if (!vis) return;
    if (!envs.length) {
      editingEnvId.value = '';
      editingEnvVars.value = [];
      return;
    }
    const targetId =
      initId && envs.some((e) => e.id === initId)
        ? initId
        : editingEnvId.value && envs.some((e) => e.id === editingEnvId.value)
          ? editingEnvId.value
          : ws.activeEnvId && envs.some((e) => e.id === ws.activeEnvId)
            ? ws.activeEnvId
            : envs[0].id;
    selectEnvForEdit(targetId);
  },
  { immediate: true, deep: true },
);

async function handleCreateEnv() {
  if (!newEnvName.value.trim()) return;
  await ws.createEnvironment(newEnvName.value, []);
  newEnvName.value = '';
  if (ws.activeEnvId) selectEnvForEdit(ws.activeEnvId);
}

function addEnvVarRow() {
  editingEnvVars.value.push({
    id: Math.random().toString(36).slice(2, 10),
    key: '',
    value: '',
    isSecret: false,
    enabled: true,
  });
}

async function handleDeleteEnv() {
  if (!editingEnvId.value) return;
  deletingEnv.value = true;
  try {
    await ws.deleteEnvironment(editingEnvId.value);
    ElMessage.success('Environment deleted');
    emit('update:visible', false);
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to delete environment',
    );
  } finally {
    deletingEnv.value = false;
  }
}

async function saveEnvVars() {
  if (!editingEnvId.value) return;
  try {
    await ws.updateEnvironment(editingEnvId.value, {
      variables: editingEnvVars.value,
    });
    ElMessage.success('Environment variables saved');
    emit('update:visible', false);
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to save environment variables',
    );
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Manage Environments"
    width="min(94vw, 680px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="env-create-row">
      <el-input
        v-model="newEnvName"
        size="small"
        placeholder="New environment name (e.g. Production)"
        style="max-width: 260px"
      />
      <el-button size="small" type="primary" @click="handleCreateEnv">
        Create Environment
      </el-button>
      <el-button size="small" :icon="Upload" @click="envFileInput?.click()">
        Import (.env / Postman)
      </el-button>
      <input
        ref="envFileInput"
        type="file"
        accept=".env,.json,application/json,text/plain"
        style="display: none"
        @change="handleImportEnvFile"
      />
    </div>

    <div v-if="ws.environments.length" class="env-editor">
      <div class="env-select-row">
        <el-select
          v-model="editingEnvId"
          size="small"
          style="width: 220px"
          @change="selectEnvForEdit"
        >
          <el-option
            v-for="env in ws.environments"
            :key="env.id"
            :label="env.name"
            :value="env.id"
          />
        </el-select>
        <el-button
          size="small"
          type="danger"
          plain
          :loading="deletingEnv"
          @click="handleDeleteEnv"
        >
          Delete Env
        </el-button>
        <el-button
          v-if="ws.currentUserRole === 'OWNER'"
          size="small"
          :type="ws.protectedEnvIds.includes(editingEnvId) ? 'warning' : 'default'"
          plain
          @click="ws.toggleEnvProtection(editingEnvId)"
        >
          {{ ws.protectedEnvIds.includes(editingEnvId) ? 'Unlock Env' : 'Lock (OWNER only)' }}
        </el-button>
      </div>

      <el-table :data="editingEnvVars" size="small" border>
        <el-table-column width="46" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.enabled" />
          </template>
        </el-table-column>
        <el-table-column label="Variable">
          <template #default="{ row }">
            <el-input v-model="row.key" size="small" placeholder="base_url" />
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
        <el-table-column label="Secret" width="70" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.isSecret" />
          </template>
        </el-table-column>
      </el-table>

      <div class="env-actions">
        <el-button size="small" :icon="Plus" @click="addEnvVarRow">
          Add Variable
        </el-button>
        <el-button
          size="small"
          :icon="Download"
          @click="exportCurrentEnv('dotenv')"
        >
          Export .env
        </el-button>
        <el-button
          size="small"
          :icon="Download"
          @click="exportCurrentEnv('postman')"
        >
          Export Postman Env
        </el-button>
        <el-button size="small" type="primary" @click="saveEnvVars">
          Save Variables
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.env-create-row,
.env-select-row,
.env-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.env-actions {
  margin-top: 10px;
  justify-content: space-between;
}
</style>
