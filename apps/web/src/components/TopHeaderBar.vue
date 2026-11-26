<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ArrowDown,
  Bell,
  Download,
  Edit,
  Menu,
  Moon,
  Search,
  Setting,
  Sunny,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { resolveImageProxyUrl } from '../services/proxyService';
import { useConsoleStore } from '../stores/console';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import type { ClientProtocol, NotificationTab } from '../types/app';

defineProps<{
  protocol: ClientProtocol;
}>();

const emit = defineEmits<{
  (e: 'update:protocol', val: ClientProtocol): void;
  (e: 'open-mobile-sidebar'): void;
  (e: 'open-search'): void;
  (e: 'open-download-app'): void;
  (e: 'open-env-dialog', envId?: string): void;
  (e: 'open-settings', tab: 'layout' | 'profile'): void;
  (e: 'open-overview'): void;
  (e: 'open-team'): void;
  (e: 'open-set-password'): void;
  (e: 'open-variables'): void;
  (e: 'open-console'): void;
  (e: 'open-auth'): void;
}>();

const ws = useWorkspaceStore();
const settings = useSettingsStore();
const consoleStore = useConsoleStore();

const quickNewWorkspaceName = ref('');
const quickNewEnvName = ref('');
const notifTab = ref<NotificationTab>('all');

const filteredNotifications = computed(() => {
  if (notifTab.value === 'all') return consoleStore.logs.slice(0, 20);
  return consoleStore.logs
    .filter((entry) => entry.type === notifTab.value)
    .slice(0, 20);
});

async function handleQuickCreateWorkspace() {
  if (!quickNewWorkspaceName.value.trim()) return;
  try {
    await ws.createTeamWorkspace(quickNewWorkspaceName.value.trim());
    quickNewWorkspaceName.value = '';
    ElMessage.success('Workspace created');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to create workspace',
    );
  }
}

async function handleQuickCreateEnv() {
  if (!quickNewEnvName.value.trim()) return;
  try {
    await ws.createEnvironment(quickNewEnvName.value.trim(), []);
    quickNewEnvName.value = '';
    ElMessage.success('Environment created');
  } catch (err) {
    ElMessage.error(
      err instanceof Error ? err.message : 'Failed to create environment',
    );
  }
}
</script>

<template>
  <el-header height="auto" class="top-bar">
    <div class="top-left">
      <el-button
        class="mobile-menu-btn"
        :icon="Menu"
        circle
        size="small"
        @click="emit('open-mobile-sidebar')"
      />
      <div class="brand">
        <img
          :src="
            settings.effectiveTheme === 'dark'
              ? '/API-OPEN-FULL.png'
              : '/API-OPEN-FULL-HITAM.png'
          "
          alt="Api-Open"
          class="brand-full-logo"
        />
      </div>
      <el-dropdown
        size="small"
        trigger="click"
        @command="(val: ClientProtocol) => emit('update:protocol', val)"
      >
        <button type="button" class="protocol-badge-btn" title="Switch Protocol">
          <span class="protocol-dot" :class="`proto-${protocol}`" />
          <span>{{
            protocol === 'http'
              ? 'HTTP'
              : protocol === 'graphql'
                ? 'GraphQL'
                : protocol === 'ws'
                  ? 'WS'
                  : 'SSE'
          }}</span>
          <el-icon style="font-size: 11px; opacity: 0.75"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="http">HTTP / REST</el-dropdown-item>
            <el-dropdown-item command="graphql">GraphQL</el-dropdown-item>
            <el-dropdown-item command="ws">WebSocket / gRPC / MQTT</el-dropdown-item>
            <el-dropdown-item command="sse">Server-Sent Events (SSE)</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="top-search-group">
      <button
        type="button"
        class="top-search-bar"
        title="Search API (Ctrl+K)"
        @click="emit('open-search')"
      >
        <el-icon><Search /></el-icon>
        <span class="top-search-placeholder">Search API...</span>
        <kbd class="kbd-key">Ctrl+K</kbd>
      </button>
      <el-button
        size="small"
        circle
        :icon="Download"
        title="Download / Install Desktop App"
        @click="emit('open-download-app')"
      />
    </div>

    <div class="top-actions">
      <template v-if="ws.isAuthenticated">
        <el-select
          v-model="ws.activeWorkspaceId"
          size="small"
          class="top-select top-select-ws"
          popper-class="top-select-popper"
          @change="(id: string) => ws.loadWorkspaceData(id)"
        >
          <template #label="{ value }">
            <span class="top-select-label-text">
              {{
                ws.workspaces.find((w) => w.id === value)?.name ?? 'Workspace'
              }}
            </span>
          </template>
          <el-option
            v-for="w in ws.workspaces"
            :key="w.id"
            :label="w.name"
            :value="w.id"
          >
            <div class="select-opt-row">
              <span class="select-opt-name">{{ w.name }}</span>
              <el-tag size="small" effect="plain">{{ w.type }}</el-tag>
            </div>
          </el-option>
          <template #footer>
            <div class="select-footer-box" @click.stop>
              <el-input
                v-model="quickNewWorkspaceName"
                size="small"
                placeholder="New workspace..."
                @keyup.enter="handleQuickCreateWorkspace"
              />
              <el-button
                size="small"
                type="primary"
                @click="handleQuickCreateWorkspace"
              >
                Add
              </el-button>
            </div>
          </template>
        </el-select>
      </template>

      <el-select
        v-model="ws.activeEnvId"
        size="small"
        clearable
        placeholder="No Env"
        class="top-select top-select-env"
        popper-class="top-select-popper"
      >
        <template #label="{ value }">
          <span class="top-select-label-text">
            {{
              ws.environments.find((e) => e.id === value)?.name ?? 'No Env'
            }}
          </span>
        </template>
        <el-option
          v-for="env in ws.environments"
          :key="env.id"
          :label="env.name"
          :value="env.id"
        >
          <div class="select-opt-row">
            <span class="select-opt-name">{{ env.name }}</span>
            <span class="select-opt-actions">
              <span class="select-opt-count">
                {{ env.variables.length }} vars
              </span>
              <el-button
                size="small"
                link
                type="primary"
                :icon="Edit"
                title="View & edit environment variables"
                @click.stop="emit('open-env-dialog', env.id)"
              />
            </span>
          </div>
        </el-option>
        <template #footer>
          <div class="select-footer-stack" @click.stop>
            <div class="select-footer-box">
              <el-input
                v-model="quickNewEnvName"
                size="small"
                placeholder="New environment..."
                @keyup.enter="handleQuickCreateEnv"
              />
              <el-button
                size="small"
                type="primary"
                @click="handleQuickCreateEnv"
              >
                Add
              </el-button>
            </div>
            <el-button
              size="small"
              plain
              style="width: 100%"
              :icon="Edit"
              @click="emit('open-env-dialog')"
            >
              View &amp; Edit Env Details
            </el-button>
          </div>
        </template>
      </el-select>

      <el-button
        size="small"
        circle
        :icon="settings.effectiveTheme === 'dark' ? Sunny : Moon"
        title="Toggle Dark / Light Mode"
        @click="settings.toggleTheme"
      />
      <el-popover placement="bottom-end" :width="340" trigger="click">
        <template #reference>
          <el-badge
            :value="consoleStore.logs.length"
            :hidden="!consoleStore.logs.length"
            :max="99"
          >
            <el-button
              size="small"
              circle
              :icon="Bell"
              title="Notifications & Activity"
            />
          </el-badge>
        </template>
        <div class="notif-header">
          <span style="font-weight: 600">Notifications</span>
          <el-button
            v-if="consoleStore.logs.length"
            size="small"
            link
            type="danger"
            @click="consoleStore.clearLogs"
          >
            Clear
          </el-button>
        </div>
        <el-radio-group
          v-model="notifTab"
          size="small"
          style="margin-bottom: 10px"
        >
          <el-radio-button value="all">All</el-radio-button>
          <el-radio-button value="activity">Activity</el-radio-button>
          <el-radio-button value="error">Errors</el-radio-button>
        </el-radio-group>
        <div v-if="filteredNotifications.length" class="notif-list">
          <div
            v-for="item in filteredNotifications"
            :key="item.id"
            class="notif-item"
          >
            <div style="display: flex; justify-content: space-between; gap: 6px">
              <el-tag
                size="small"
                :type="
                  item.type === 'error'
                    ? 'danger'
                    : item.type === 'http'
                      ? 'success'
                      : 'info'
                "
              >
                {{ item.type.toUpperCase() }}
              </el-tag>
              <span style="font-size: 11px; opacity: 0.6">
                {{ item.timestamp.slice(11, 19) }}
              </span>
            </div>
            <div class="notif-msg">{{ item.message }}</div>
          </div>
        </div>
        <el-empty v-else description="No notifications" :image-size="42" />
      </el-popover>

      <el-dropdown trigger="click">
        <el-button size="small" circle :icon="Setting" title="Settings" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="emit('open-settings', 'layout')">
              App settings
            </el-dropdown-item>
            <el-dropdown-item @click="emit('open-overview')">
              Workspace settings &amp; overview
            </el-dropdown-item>
            <el-dropdown-item
              v-if="ws.isAuthenticated"
              @click="emit('open-team')"
            >
              Team settings
            </el-dropdown-item>
            <el-dropdown-item
              v-if="ws.isAuthenticated"
              @click="emit('open-settings', 'profile')"
            >
              Account settings
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <template v-if="ws.isAuthenticated">
        <el-dropdown trigger="click">
          <button type="button" class="user-btn">
            <el-avatar
              :size="22"
              :src="resolveImageProxyUrl(ws.profile?.avatarUrl)"
              class="user-avatar"
            >
              {{
                (ws.profile?.name || ws.user?.email || 'U')
                  .slice(0, 1)
                  .toUpperCase()
              }}
            </el-avatar>
            <span class="user-name-text">
              {{ ws.profile?.name || ws.user?.email }}
            </span>
            <el-icon class="user-caret"><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>
                <div style="line-height: 1.3">
                  <div style="font-weight: 600">
                    {{ ws.profile?.name || 'User' }}
                  </div>
                  <div style="font-size: 11px; opacity: 0.7">
                    {{ ws.user?.email }}
                  </div>
                </div>
              </el-dropdown-item>
              <el-dropdown-item
                divided
                @click="emit('open-settings', 'profile')"
              >
                Profile &amp; Settings
              </el-dropdown-item>
              <el-dropdown-item @click="emit('open-set-password')">
                Set / Change Password
              </el-dropdown-item>
              <el-dropdown-item @click="emit('open-variables')">
                Local Vault &amp; Keys
              </el-dropdown-item>
              <el-dropdown-item @click="emit('open-console')">
                Audit &amp; Console Logs
              </el-dropdown-item>
              <el-dropdown-item divided @click="ws.signOut()">
                Sign Out
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>

      <template v-else>
        <el-button type="primary" size="small" @click="emit('open-auth')">
          Sign In
        </el-button>
      </template>
    </div>
  </el-header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  background: var(--ao-surface);
  border-bottom: 1px solid var(--ao-border);
  padding: 8px 16px;
  min-height: 58px;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mobile-menu-btn {
  display: none;
}
.brand {
  display: flex;
  align-items: center;
  background: transparent;
  padding: 0;
}
.brand-full-logo {
  width: 140px;
  height: 42px;
  object-fit: contain;
  display: block;
}
.top-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.top-select {
  width: auto;
  min-width: 155px;
  max-width: 240px;
}
.top-select-ws {
  min-width: 175px;
}
.top-select-env {
  min-width: 145px;
}
.top-select-label-text {
  display: inline-block;
  white-space: nowrap;
}
.select-opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}
.select-opt-name {
  white-space: nowrap;
}
.select-opt-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.select-opt-count {
  font-size: 11px;
  opacity: 0.65;
}
.select-footer-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 6px;
}
.select-footer-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.top-search-group {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  max-width: 340px;
}
.top-search-group > :deep(.el-button) {
  flex-shrink: 0;
}
.top-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
  color: var(--ao-text-muted);
  cursor: pointer;
  font-size: 13px;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.top-search-bar:hover {
  border-color: var(--ao-accent);
  background: var(--ao-hover);
}
.top-search-placeholder {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kbd-key {
  font-family: Consolas, Monaco, monospace;
  font-size: 11.5px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
}
.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 2px 11px 2px 4px;
  border-radius: 9999px;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
  color: var(--ao-text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  line-height: 1;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
.user-btn:hover {
  border-color: var(--el-color-primary);
  background: var(--ao-hover);
}
.user-avatar {
  flex-shrink: 0;
  background: var(--el-color-primary);
  color: #fff;
  font-weight: 700;
  font-size: 11px;
}
.user-caret {
  font-size: 11px;
  opacity: 0.7;
  margin-left: 1px;
}
.user-name-text {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}
.notif-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.notif-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
}
.notif-item {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--ao-surface-2);
  font-size: 12px;
}
.notif-msg {
  margin-top: 4px;
  word-break: break-word;
}
@media (max-width: 900px) {
  .mobile-menu-btn {
    display: inline-flex;
  }
  .top-select {
    width: 110px;
  }
  .top-search-bar {
    min-width: 150px;
  }
}
@media (max-width: 640px) {
  .top-bar {
    padding: 8px 12px;
  }
  .top-search-group {
    order: 3;
    max-width: 100%;
    width: 100%;
    flex-basis: 100%;
  }
}
.protocol-badge-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-2);
  color: var(--ao-text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.protocol-badge-btn:hover {
  border-color: var(--ao-accent);
}
.protocol-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.protocol-dot.proto-http {
  background: #3b82f6;
}
.protocol-dot.proto-graphql {
  background: #ec4899;
}
.protocol-dot.proto-ws {
  background: #10b981;
}
.protocol-dot.proto-sse {
  background: #f59e0b;
}
</style>
