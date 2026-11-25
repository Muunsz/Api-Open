<script setup lang="ts">
import { computed } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import { useConsoleStore } from '../stores/console';
import { useWorkspaceStore } from '../stores/workspace';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'open-envs': [];
}>();

const ws = useWorkspaceStore();
const consoleStore = useConsoleStore();

const activeEnv = computed(() =>
  ws.environments.find((e) => e.id === ws.activeEnvId),
);

const globalEnvs = computed(() => ws.environments.filter((e) => e.isGlobal));
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="All Variables & Local Vault"
    direction="rtl"
    size="min(92vw, 380px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="vars-section">
      <div class="vars-head">
        <span class="vars-badge env">E</span>
        <strong>Environment</strong>
        <el-button link type="primary" size="small" @click="emit('open-envs')">
          Manage
        </el-button>
      </div>
      <div v-if="activeEnv && activeEnv.variables.length" class="vars-list">
        <div
          v-for="v in activeEnv.variables"
          :key="v.id"
          class="var-row"
        >
          <code>{{ v.key }}</code>
          <span class="var-val">{{ v.isSecret ? '••••••' : v.value }}</span>
        </div>
      </div>
      <el-text v-else size="small" type="info">
        No active environment selected.
      </el-text>
    </div>

    <el-divider />

    <div class="vars-section">
      <div class="vars-head">
        <span class="vars-badge global">G</span>
        <strong>Globals</strong>
      </div>
      <div v-if="globalEnvs.length" class="vars-list">
        <template v-for="g in globalEnvs" :key="g.id">
          <div v-for="v in g.variables" :key="v.id" class="var-row">
            <code>{{ v.key }}</code>
            <span class="var-val">{{ v.isSecret ? '••••••' : v.value }}</span>
          </div>
        </template>
      </div>
      <el-text v-else size="small" type="info">
        No global variables in this workspace.
      </el-text>
    </div>

    <el-divider />

    <div class="vars-section">
      <div class="vars-head">
        <span class="vars-badge vault">V</span>
        <strong>Local Vault (Browser Only)</strong>
        <el-button
          link
          type="primary"
          size="small"
          :icon="Plus"
          @click="consoleStore.addVaultVar()"
        >
          Add
        </el-button>
      </div>
      <el-text size="small" type="info" style="display: block; margin-bottom: 8px">
        Stored locally in your browser. Never synced to the cloud.
      </el-text>

      <div v-if="consoleStore.localVault.length" class="vault-list">
        <div
          v-for="v in consoleStore.localVault"
          :key="v.id"
          class="vault-row"
        >
          <el-input v-model="v.key" size="small" placeholder="key" />
          <el-input
            v-model="v.value"
            size="small"
            type="password"
            show-password
            placeholder="secret value"
          />
          <el-button
            :icon="Delete"
            link
            type="danger"
            size="small"
            @click="consoleStore.removeVaultVar(v.id)"
          />
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.vars-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vars-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vars-badge {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.vars-badge.env {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
}
.vars-badge.global {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.14);
}
.vars-badge.vault {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.14);
}
.vars-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.var-row {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--ao-border);
}
.var-val {
  color: var(--ao-text-muted);
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vault-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.vault-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
</style>
