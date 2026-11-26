<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Collection,
  Download,
  Edit,
  Folder,
  Key,
  Plus,
  UserFilled,
  View,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useConsoleStore } from '../stores/console';
import { useTabsStore } from '../stores/tabs';
import {
  type CollectionTreeNode,
  useWorkspaceStore,
} from '../stores/workspace';
import type { OverviewSubTab } from '../types/app';

defineProps<{
  summary: string;
  readme: string;
}>();

const emit = defineEmits<{
  (e: 'update:summary', val: string): void;
  (e: 'update:readme', val: boolean | string): void;
  (e: 'close-overview'): void;
  (e: 'export-all'): void;
  (e: 'open-runner', node: CollectionTreeNode): void;
  (e: 'open-docs', node: CollectionTreeNode): void;
  (e: 'export-collection', node: CollectionTreeNode): void;
  (e: 'open-envs'): void;
  (e: 'open-vars'): void;
  (e: 'open-team'): void;
}>();

const ws = useWorkspaceStore();
const store = useTabsStore();
const consoleStore = useConsoleStore();
const overviewSubTab = ref<OverviewSubTab>('docs');
const previewReadme = ref(false);

const analyticsSummary = computed(() => {
  const httpLogs = consoleStore.logs.filter((l) => l.type === 'http');
  const total = httpLogs.length;
  const successes = httpLogs.filter((l) => (l.statusCode ?? 0) >= 200 && (l.statusCode ?? 0) < 400).length;
  const durations = httpLogs.map((l) => l.durationMs ?? 0).sort((a, b) => a - b);
  const avgMs = total ? Math.round(durations.reduce((s, d) => s + d, 0) / total) : 0;
  const p95Ms = total ? durations[Math.floor(total * 0.95)] ?? durations[total - 1] : 0;
  return {
    total,
    successRate: total ? Math.round((successes / total) * 100) : 100,
    avgMs,
    p95Ms,
    recent: httpLogs.slice(0, 10),
  };
});

const activeWorkspace = computed(() =>
  ws.workspaces.find((w) => w.id === ws.activeWorkspaceId),
);

const totalRequestsCount = computed(() =>
  ws.collections.reduce((acc, col) => acc + (col.requests?.length ?? 0), 0),
);

const activeEnvName = computed(
  () =>
    ws.environments.find((e) => e.id === ws.activeEnvId)?.name ||
    'No Environment',
);

let workspaceMetaSyncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWorkspaceMetaSync(nextSummary: string, nextReadme: string) {
  if (!ws.isAuthenticated || !ws.activeWorkspaceId) return;
  if (workspaceMetaSyncTimer) clearTimeout(workspaceMetaSyncTimer);
  workspaceMetaSyncTimer = setTimeout(() => {
    ws.updateWorkspaceMeta({
      summary: nextSummary,
      readme: nextReadme,
    }).catch(() => undefined);
  }, 500);
}

function onSummaryInput(val: string) {
  localStorage.setItem('api_open_workspace_summary_v1', val);
  emit('update:summary', val);
  scheduleWorkspaceMetaSync(
    val,
    localStorage.getItem('api_open_workspace_readme_v1') ?? '',
  );
}

function onReadmeInput(val: string) {
  localStorage.setItem('api_open_workspace_readme_v1', val);
  emit('update:readme', val);
  scheduleWorkspaceMetaSync(
    localStorage.getItem('api_open_workspace_summary_v1') ?? '',
    val,
  );
}

watch(
  activeWorkspace,
  (activeWs) => {
    if (activeWs) {
      if (activeWs.summary !== undefined && activeWs.summary !== null) {
        emit('update:summary', activeWs.summary);
      }
      if (activeWs.readme !== undefined && activeWs.readme !== null) {
        emit('update:readme', activeWs.readme);
      }
    }
  },
  { immediate: true },
);

async function handleDeleteActiveWorkspace() {
  const current = activeWorkspace.value;
  if (!current) return;
  try {
    await ElMessageBox.confirm(
      `Delete workspace "${current.name}" and all its collections, environments, and history?`,
      'Delete Workspace',
      {
        type: 'warning',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
      },
    );
    await ws.deleteWorkspace(current.id);
    ElMessage.success(`Workspace "${current.name}" deleted`);
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(
        err instanceof Error ? err.message : 'Failed to delete workspace',
      );
    }
  }
}
</script>

<template>
  <div class="workspace-overview-page">
    <div class="overview-layout">
      <!-- Main Left Column -->
      <div class="overview-main">
        <div class="overview-page-header">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
              <h2 class="overview-title">
                {{ activeWorkspace?.name ?? 'Personal Workspace' }}
              </h2>
              <el-tag size="small" effect="plain">
                {{ activeWorkspace?.type ?? 'PERSONAL' }}
              </el-tag>
              <el-tag
                v-if="ws.isAuthenticated"
                size="small"
                type="info"
                effect="plain"
              >
                {{ ws.currentUserRole }}
              </el-tag>
            </div>
            <div class="overview-meta">
              <span>{{ ws.profile?.name || ws.user?.email || 'Local User' }}</span>
              <span>•</span>
              <span>{{ ws.collectionTree.length }} collection(s)</span>
              <span>•</span>
              <span>{{ totalRequestsCount }} request(s)</span>
              <span>•</span>
              <span>{{ ws.environments.length }} environment(s)</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
            <el-button size="small" :icon="Download" @click="emit('export-all')">
              Export Collections
            </el-button>
            <el-button
              v-if="ws.isAuthenticated && ws.currentUserRole === 'OWNER' && activeWorkspace"
              size="small"
              type="danger"
              plain
              @click="handleDeleteActiveWorkspace"
            >
              Delete Workspace
            </el-button>
            <el-button
              size="small"
              type="primary"
              :icon="Plus"
              @click="
                store.addTab();
                emit('close-overview');
              "
            >
              New Request
            </el-button>
          </div>
        </div>

        <el-input
          :model-value="summary"
          placeholder="Add a short summary for this workspace..."
          class="overview-summary-input"
          @update:model-value="onSummaryInput"
        />

        <el-tabs v-model="overviewSubTab" class="overview-subtabs">
          <el-tab-pane label="Docs" name="docs">
            <div class="overview-docs-section">
              <div class="overview-section-head">
                <span class="overview-section-label">Workspace README</span>
                <el-button
                  size="small"
                  link
                  :icon="previewReadme ? Edit : View"
                  @click="previewReadme = !previewReadme"
                >
                  {{ previewReadme ? 'Edit' : 'Preview' }}
                </el-button>
              </div>
              <pre v-if="previewReadme" class="overview-readme-preview">{{
                readme || 'No README content yet.'
              }}</pre>
              <el-input
                v-else
                :model-value="readme"
                type="textarea"
                :rows="8"
                placeholder="Write workspace documentation, base URLs, auth notes, or onboarding instructions..."
                @update:model-value="onReadmeInput"
              />
            </div>

            <div class="overview-docs-section" style="margin-top: 20px">
              <div class="overview-section-label">Collections in Workspace</div>
              <div v-if="ws.collectionTree.length" class="overview-collections-grid">
                <div
                  v-for="col in ws.collectionTree"
                  :key="col.id"
                  class="overview-collection-card"
                >
                  <div style="display: flex; align-items: center; gap: 8px; overflow: hidden">
                    <el-icon><Folder /></el-icon>
                    <span class="overview-col-name">{{ col.label }}</span>
                  </div>
                  <div style="display: flex; gap: 4px; flex-shrink: 0">
                    <el-button
                      size="small"
                      link
                      type="success"
                      @click="emit('open-runner', col)"
                    >
                      Run
                    </el-button>
                    <el-button
                      size="small"
                      link
                      @click="emit('open-docs', col)"
                    >
                      Docs
                    </el-button>
                    <el-button
                      size="small"
                      link
                      @click="emit('export-collection', col)"
                    >
                      Export
                    </el-button>
                  </div>
                </div>
              </div>
              <el-empty
                v-else
                description="No collections in this workspace yet"
                :image-size="48"
              />
            </div>
          </el-tab-pane>

          <el-tab-pane label="Updates" name="updates">
            <div v-if="consoleStore.logs.length" class="overview-updates-list">
              <div
                v-for="entry in consoleStore.logs"
                :key="entry.id"
                class="overview-update-row"
              >
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0">
                  <el-tag
                    size="small"
                    :type="
                      entry.type === 'error'
                        ? 'danger'
                        : entry.type === 'http'
                          ? 'success'
                          : 'info'
                    "
                  >
                    {{ entry.type.toUpperCase() }}
                  </el-tag>
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                    {{ entry.message }}
                  </span>
                </div>
                <span style="font-size: 11px; opacity: 0.6; white-space: nowrap">
                  {{ entry.timestamp.slice(11, 19) }}
                </span>
              </div>
            </div>
            <el-empty
              v-else
              description="No recent updates or activity"
              :image-size="48"
            />
          </el-tab-pane>

          <el-tab-pane label="Analytics" name="analytics">
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
              <el-tag type="info">Total Requests: {{ analyticsSummary.total }}</el-tag>
              <el-tag type="success">Success Rate: {{ analyticsSummary.successRate }}%</el-tag>
              <el-tag>Avg Latency: {{ analyticsSummary.avgMs }} ms</el-tag>
              <el-tag type="warning">p95 Latency: {{ analyticsSummary.p95Ms }} ms</el-tag>
            </div>
            <div v-if="analyticsSummary.recent.length" style="display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="item in analyticsSummary.recent"
                :key="item.id"
                style="display: grid; grid-template-columns: 60px 1fr 70px 120px; gap: 8px; align-items: center; font-size: 12px"
              >
                <el-tag size="small">{{ item.method || 'GET' }}</el-tag>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ item.url }}</span>
                <span>{{ item.durationMs ?? 0 }}ms</span>
                <el-progress
                  :percentage="Math.min(100, Math.round(((item.durationMs ?? 0) / Math.max(1, analyticsSummary.p95Ms || 500)) * 100))"
                  :show-text="false"
                  :status="(item.statusCode ?? 200) >= 400 ? 'exception' : 'success'"
                />
              </div>
            </div>
            <el-empty v-else description="Send some requests to populate latency & error analytics" :image-size="48" />
          </el-tab-pane>

          <el-tab-pane label="Settings" name="settings">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; padding-top: 6px">
              <el-button :icon="Collection" @click="emit('open-envs')">
                Manage Environments
              </el-button>
              <el-button :icon="Key" @click="emit('open-vars')">
                Local Vault &amp; All Variables
              </el-button>
              <el-button
                v-if="ws.isAuthenticated"
                :icon="UserFilled"
                @click="emit('open-team')"
              >
                Team &amp; Members
              </el-button>
              <el-button
                type="primary"
                plain
                :icon="Download"
                @click="emit('export-all')"
              >
                Export All Collections
              </el-button>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <!-- Right About / Quick Info Sidebar -->
      <aside class="overview-aside">
        <div class="overview-aside-card">
          <div class="overview-aside-title">About Workspace</div>
          <div class="overview-stat-list">
            <div class="overview-stat-row">
              <span>Active Environment</span>
              <el-tag size="small" effect="plain">{{ activeEnvName }}</el-tag>
            </div>
            <div class="overview-stat-row">
              <span>Collections</span>
              <strong>{{ ws.collectionTree.length }}</strong>
            </div>
            <div class="overview-stat-row">
              <span>Total Requests</span>
              <strong>{{ totalRequestsCount }}</strong>
            </div>
            <div class="overview-stat-row">
              <span>Team Members</span>
              <strong>{{ ws.members.length || 1 }}</strong>
            </div>
            <div class="overview-stat-row">
              <span>Monitors</span>
              <strong>{{ ws.monitors.length }}</strong>
            </div>
            <div class="overview-stat-row">
              <span>Data Schemas</span>
              <strong>{{ ws.schemas.length }}</strong>
            </div>
          </div>
        </div>

        <div class="overview-aside-card">
          <div class="overview-aside-title">Quick Actions</div>
          <div class="overview-quick-actions">
            <el-button
              size="small"
              :icon="Collection"
              style="justify-content: flex-start"
              @click="emit('open-envs')"
            >
              Manage Environments
            </el-button>
            <el-button
              size="small"
              :icon="Key"
              style="justify-content: flex-start"
              @click="emit('open-vars')"
            >
              Variables &amp; Local Vault
            </el-button>
            <el-button
              v-if="ws.isAuthenticated"
              size="small"
              :icon="UserFilled"
              style="justify-content: flex-start"
              @click="emit('open-team')"
            >
              Team &amp; Members
            </el-button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.workspace-overview-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--ao-surface);
  border: 1px solid var(--ao-border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  padding: 20px 24px;
}
.overview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: start;
}
.overview-main {
  min-width: 0;
}
.overview-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
.overview-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
.overview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--ao-text-muted);
  margin-top: 6px;
}
.overview-summary-input {
  margin-bottom: 16px;
}
.overview-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.overview-section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ao-text-muted);
  margin-bottom: 6px;
}
.overview-section-head .overview-section-label {
  margin-bottom: 0;
}
.overview-readme-preview {
  background: var(--ao-code-bg);
  border: 1px solid var(--ao-border);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  min-height: 140px;
}
.overview-collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.overview-collection-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--ao-border);
  border-radius: 8px;
  background: var(--ao-surface-2);
}
.overview-col-name {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-updates-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.overview-update-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--ao-surface-2);
  font-size: 12px;
}
.overview-aside {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.overview-aside-card {
  padding: 14px 16px;
  border: 1px solid var(--ao-border);
  border-radius: 8px;
  background: var(--ao-surface-2);
}
.overview-aside-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--ao-text-muted);
  margin-bottom: 10px;
}
.overview-stat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.overview-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  color: var(--ao-text-muted);
}
.overview-stat-row strong {
  color: var(--ao-text);
}
.overview-quick-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.overview-quick-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
@media (max-width: 960px) {
  .overview-layout {
    grid-template-columns: 1fr;
  }
}
</style>
