<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  adminService,
  getStoredAdminToken,
  type AdminOverviewDto,
} from '../services/adminService';

const emit = defineEmits<{
  (e: 'exit'): void;
}>();

const checkingSession = ref(true);
const isAdminAuthenticated = ref(false);
const adminEmail = ref('');

const loginIdentifier = ref('');
const loginPassword = ref('');
const loggingIn = ref(false);
const loginError = ref('');

type BackpanelTab =
  | 'overview'
  | 'users'
  | 'workspaces'
  | 'collections'
  | 'histories'
  | 'activities'
  | 'emails'
  | 'monitors'
  | 'comments';

const activeTab = ref<BackpanelTab>('overview');
const loadingTab = ref(false);
const autoRefreshSec = ref<0 | 10 | 30>(0);
let refreshTimer: number | null = null;

const overview = ref<AdminOverviewDto | null>(null);
const users = ref<Awaited<ReturnType<typeof adminService.listUsers>>>([]);
const workspaces = ref<Awaited<ReturnType<typeof adminService.listWorkspaces>>>([]);
const collections = ref<Awaited<ReturnType<typeof adminService.listCollections>>>([]);
const requests = ref<Awaited<ReturnType<typeof adminService.listRequests>>>([]);
const histories = ref<Awaited<ReturnType<typeof adminService.listHistories>>>([]);
const activities = ref<Awaited<ReturnType<typeof adminService.listActivities>>>([]);
const emails = ref<Awaited<ReturnType<typeof adminService.listEmails>>>([]);
const monitors = ref<Awaited<ReturnType<typeof adminService.listMonitors>>>([]);
const environments = ref<Awaited<ReturnType<typeof adminService.listEnvironments>>>([]);
const comments = ref<Awaited<ReturnType<typeof adminService.listComments>>>([]);
const snapshots = ref<Awaited<ReturnType<typeof adminService.listSnapshots>>>([]);

const searchQuery = ref('');
const workspaceTypeFilter = ref('');
const methodFilter = ref('');
const statusGroupFilter = ref('');
const activityTypeFilter = ref('');
const emailCategoryFilter = ref('');
const emailStatusFilter = ref('');
const collectionSubTab = ref<'collections' | 'requests'>('collections');
const infraSubTab = ref<'monitors' | 'environments'>('monitors');
const auditSubTab = ref<'comments' | 'snapshots'>('comments');
const revealEnvSecrets = ref(false);

const snapshotModalVisible = ref(false);
const inspectedSnapshotJson = ref('');

function fmtDate(val?: string | null): string {
  if (!val) return '-';
  try {
    return new Date(val).toLocaleString();
  } catch {
    return val;
  }
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

async function verifyExistingSession() {
  checkingSession.value = true;
  try {
    if (!getStoredAdminToken()) {
      isAdminAuthenticated.value = false;
      return;
    }
    const res = await adminService.me();
    adminEmail.value = res.admin.sub;
    isAdminAuthenticated.value = true;
    await loadCurrentTab();
  } catch {
    adminService.logout();
    isAdminAuthenticated.value = false;
  } finally {
    checkingSession.value = false;
  }
}

async function handleAdminLogin() {
  if (!loginIdentifier.value.trim() || !loginPassword.value) {
    loginError.value = 'Enter admin email/username and password';
    return;
  }
  loginError.value = '';
  loggingIn.value = true;
  try {
    const res = await adminService.login(
      loginIdentifier.value.trim(),
      loginPassword.value,
    );
    adminEmail.value = res.admin.email;
    loginPassword.value = '';
    isAdminAuthenticated.value = true;
    await loadCurrentTab();
    ElMessage.success('Signed in to Api-Open Backpanel');
  } catch (err) {
    loginError.value =
      err instanceof Error ? err.message : 'Admin authentication failed';
  } finally {
    loggingIn.value = false;
  }
}

function handleAdminLogout() {
  adminService.logout();
  isAdminAuthenticated.value = false;
  adminEmail.value = '';
  overview.value = null;
}

async function loadCurrentTab() {
  if (!isAdminAuthenticated.value) return;
  loadingTab.value = true;
  try {
    if (activeTab.value === 'overview') {
      overview.value = await adminService.getOverview();
    } else if (activeTab.value === 'users') {
      users.value = await adminService.listUsers(searchQuery.value);
    } else if (activeTab.value === 'workspaces') {
      workspaces.value = await adminService.listWorkspaces(
        searchQuery.value,
        workspaceTypeFilter.value,
      );
    } else if (activeTab.value === 'collections') {
      const [cols, reqs] = await Promise.all([
        adminService.listCollections(searchQuery.value),
        adminService.listRequests(searchQuery.value, methodFilter.value),
      ]);
      collections.value = cols;
      requests.value = reqs;
    } else if (activeTab.value === 'histories') {
      histories.value = await adminService.listHistories(
        searchQuery.value,
        methodFilter.value,
        statusGroupFilter.value,
      );
    } else if (activeTab.value === 'activities') {
      activities.value = await adminService.listActivities(
        searchQuery.value,
        activityTypeFilter.value,
      );
    } else if (activeTab.value === 'emails') {
      emails.value = await adminService.listEmails(
        searchQuery.value,
        emailCategoryFilter.value,
        emailStatusFilter.value,
      );
    } else if (activeTab.value === 'monitors') {
      const [mons, envs] = await Promise.all([
        adminService.listMonitors(searchQuery.value),
        adminService.listEnvironments(searchQuery.value),
      ]);
      monitors.value = mons;
      environments.value = envs;
    } else if (activeTab.value === 'comments') {
      const [coms, snaps] = await Promise.all([
        adminService.listComments(searchQuery.value),
        adminService.listSnapshots(searchQuery.value),
      ]);
      comments.value = coms;
      snapshots.value = snaps;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load data';
    if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('unauthorized')) {
      handleAdminLogout();
    }
    ElMessage.error(msg);
  } finally {
    loadingTab.value = false;
  }
}

function switchTab(tab: BackpanelTab) {
  activeTab.value = tab;
  searchQuery.value = '';
  loadCurrentTab();
}

async function handleDeleteUser(id: string, email: string) {
  try {
    await ElMessageBox.confirm(
      `Delete user ${email} permanently (Supabase Auth + DB)?`,
      'Delete User',
      { type: 'error', confirmButtonText: 'Delete' },
    );
    await adminService.deleteUser(id);
    ElMessage.success(`Deleted user ${email}`);
    await loadCurrentTab();
  } catch {
    // canceled or error shown
  }
}

async function handleDeleteWorkspace(id: string, name: string) {
  try {
    await ElMessageBox.confirm(
      `Delete workspace "${name}" and all its collections/environments?`,
      'Delete Workspace',
      { type: 'error', confirmButtonText: 'Delete' },
    );
    await adminService.deleteWorkspace(id);
    ElMessage.success(`Deleted workspace ${name}`);
    await loadCurrentTab();
  } catch {
    // canceled
  }
}

async function handleToggleMonitor(id: string) {
  try {
    await adminService.toggleMonitor(id);
    await loadCurrentTab();
    ElMessage.success('Monitor status updated');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Toggle failed');
  }
}

async function handleDeleteComment(id: string) {
  try {
    await adminService.deleteComment(id);
    ElMessage.success('Comment deleted');
    await loadCurrentTab();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Delete failed');
  }
}

function inspectSnapshot(snap: unknown) {
  inspectedSnapshotJson.value = JSON.stringify(snap, null, 2);
  snapshotModalVisible.value = true;
}

function resetAutoRefresh() {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (autoRefreshSec.value > 0 && isAdminAuthenticated.value) {
    refreshTimer = window.setInterval(() => {
      loadCurrentTab();
    }, autoRefreshSec.value * 1000);
  }
}

watch([autoRefreshSec, isAdminAuthenticated], resetAutoRefresh);

onMounted(() => {
  verifyExistingSession();
});

onUnmounted(() => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
});
</script>

<template>
  <div class="bp-shell">
    <div v-if="checkingSession" class="bp-center-box">
      <div class="bp-login-card">Verifying Backpanel session...</div>
    </div>

    <!-- Admin Login Gate -->
    <div v-else-if="!isAdminAuthenticated" class="bp-center-box">
      <div class="bp-login-card">
        <div class="bp-login-badge">Restricted Access</div>
        <h1 class="bp-login-title">Api-Open Backpanel</h1>
        <p class="bp-login-sub">
          Full system monitoring, database telemetry &amp; administration.
        </p>

        <el-alert
          v-if="loginError"
          type="error"
          :title="loginError"
          :closable="false"
          style="margin-bottom: 14px"
        />

        <el-form label-position="top" @submit.prevent="handleAdminLogin">
          <el-form-item label="Admin Email / Username">
            <el-input
              v-model="loginIdentifier"
              size="large"
              placeholder="admin@api-open.local"
              autocomplete="username"
            />
          </el-form-item>
          <el-form-item label="Admin Password">
            <el-input
              v-model="loginPassword"
              type="password"
              size="large"
              placeholder="Enter admin password"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>
          <div style="display: flex; gap: 8px; margin-top: 8px">
            <el-button size="large" @click="emit('exit')">
              Back to App
            </el-button>
            <el-button
              type="primary"
              size="large"
              native-type="submit"
              :loading="loggingIn"
              style="flex: 1"
            >
              Sign In to Backpanel
            </el-button>
          </div>
        </el-form>
      </div>
    </div>

    <!-- Authenticated Backpanel -->
    <div v-else class="bp-workspace">
      <header class="bp-topbar">
        <div class="bp-brand">
          <span class="bp-brand-dot" />
          <strong>Api-Open Backpanel</strong>
          <el-tag size="small" effect="plain" type="success">{{ adminEmail }}</el-tag>
        </div>

        <div class="bp-topbar-actions">
          <el-select
            v-model="autoRefreshSec"
            size="small"
            style="width: 120px"
            title="Auto Refresh"
          >
            <el-option :value="0" label="Auto: Off" />
            <el-option :value="10" label="Auto: 10s" />
            <el-option :value="30" label="Auto: 30s" />
          </el-select>
          <el-button size="small" :loading="loadingTab" @click="loadCurrentTab">
            Refresh
          </el-button>
          <el-button size="small" @click="emit('exit')">Back to App</el-button>
          <el-button size="small" type="danger" plain @click="handleAdminLogout">
            Sign Out
          </el-button>
        </div>
      </header>

      <nav class="bp-tabs">
        <button
          v-for="t in [
            { id: 'overview', label: 'Overview & Health' },
            { id: 'users', label: 'Users' },
            { id: 'workspaces', label: 'Workspaces' },
            { id: 'collections', label: 'Collections & Requests' },
            { id: 'histories', label: 'Traffic & History' },
            { id: 'activities', label: 'Activity Logs' },
            { id: 'emails', label: 'Email Logs' },
            { id: 'monitors', label: 'Monitors & Envs' },
            { id: 'comments', label: 'Comments & Snapshots' },
          ]"
          :key="t.id"
          type="button"
          class="bp-tab-btn"
          :class="{ active: activeTab === t.id }"
          @click="switchTab(t.id as BackpanelTab)"
        >
          {{ t.label }}
        </button>
      </nav>

      <main class="bp-content">
        <!-- OVERVIEW -->
        <template v-if="activeTab === 'overview' && overview">
          <div class="bp-kpi-grid">
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">Users</div>
              <div class="bp-kpi-val">{{ overview.counts.users }}</div>
              <div class="bp-kpi-sub">{{ overview.counts.workspaceMembers }} memberships</div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">Workspaces</div>
              <div class="bp-kpi-val">{{ overview.counts.workspaces }}</div>
              <div class="bp-kpi-sub">
                {{ overview.counts.personalWorkspaces }} personal / {{ overview.counts.teamWorkspaces }} team
              </div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">Collections &amp; APIs</div>
              <div class="bp-kpi-val">{{ overview.counts.collections }} / {{ overview.counts.apiRequests }}</div>
              <div class="bp-kpi-sub">{{ overview.counts.collectionSnapshots }} snapshots</div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">24h Traffic</div>
              <div class="bp-kpi-val">{{ overview.traffic24h.requests }}</div>
              <div class="bp-kpi-sub">
                {{ overview.traffic24h.failedRequests }} errors · avg {{ overview.traffic24h.avgDurationMs }}ms
              </div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">Emails (Total / 24h)</div>
              <div class="bp-kpi-val">{{ overview.counts.emailLogs }} / {{ overview.traffic24h.emails }}</div>
              <div class="bp-kpi-sub">
                {{ overview.counts.emailLogsSent }} sent · {{ overview.counts.emailLogsFailed }} failed
              </div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">Monitors &amp; Envs</div>
              <div class="bp-kpi-val">{{ overview.counts.monitors }} / {{ overview.counts.environments }}</div>
              <div class="bp-kpi-sub">{{ overview.counts.monitorsEnabled }} active monitors</div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">Activity &amp; Comments</div>
              <div class="bp-kpi-val">{{ overview.counts.activityLogs }} / {{ overview.counts.requestComments }}</div>
              <div class="bp-kpi-sub">{{ overview.counts.requestHistories }} total history rows</div>
            </div>
            <div class="bp-kpi-card">
              <div class="bp-kpi-label">DB &amp; Runtime</div>
              <div class="bp-kpi-val">{{ overview.system.dbLatencyMs }}ms</div>
              <div class="bp-kpi-sub">
                {{ overview.system.nodeVersion }} · RSS {{ overview.system.memoryMb.rss }}MB · up {{ fmtUptime(overview.system.uptimeSeconds) }}
              </div>
            </div>
          </div>

          <div class="bp-two-col">
            <div class="bp-panel">
              <div class="bp-panel-title">System &amp; Integration Readiness</div>
              <div class="bp-kv-list">
                <div class="bp-kv-row">
                  <span>PostgreSQL / Prisma</span>
                  <el-tag size="small" type="success">{{ overview.system.dbStatus }} ({{ overview.system.dbLatencyMs }}ms)</el-tag>
                </div>
                <div class="bp-kv-row">
                  <span>Memory (Heap Used / Total)</span>
                  <span>{{ overview.system.memoryMb.heapUsed }} MB / {{ overview.system.memoryMb.heapTotal }} MB</span>
                </div>
                <div class="bp-kv-row">
                  <span>SUPABASE_URL</span>
                  <el-tag size="small" :type="overview.system.integrations.supabaseUrl ? 'success' : 'danger'">
                    {{ overview.system.integrations.supabaseUrl ? 'Configured' : 'Missing' }}
                  </el-tag>
                </div>
                <div class="bp-kv-row">
                  <span>SUPABASE_SERVICE_ROLE_KEY</span>
                  <el-tag size="small" :type="overview.system.integrations.supabaseServiceRole ? 'success' : 'warning'">
                    {{ overview.system.integrations.supabaseServiceRole ? 'Configured' : 'Missing' }}
                  </el-tag>
                </div>
                <div class="bp-kv-row">
                  <span>Custom SMTP</span>
                  <el-tag size="small" :type="overview.system.integrations.smtpConfigured ? 'success' : 'warning'">
                    {{ overview.system.integrations.smtpConfigured ? 'Configured' : 'Not Configured' }}
                  </el-tag>
                </div>
                <div class="bp-kv-row">
                  <span>ADMIN_JWT_SECRET</span>
                  <el-tag size="small" :type="overview.system.integrations.adminCustomSecret ? 'success' : 'info'">
                    {{ overview.system.integrations.adminCustomSecret ? 'Explicit' : 'Derived' }}
                  </el-tag>
                </div>
              </div>
            </div>

            <div class="bp-panel">
              <div class="bp-panel-title">Requests by HTTP Method</div>
              <div class="bp-kv-list">
                <div
                  v-for="m in overview.requestsByMethod"
                  :key="m.method"
                  class="bp-kv-row"
                >
                  <span class="method-badge" :class="`method-${m.method}`">{{ m.method }}</span>
                  <strong>{{ m.count }}</strong>
                </div>
              </div>
            </div>
          </div>

          <div class="bp-two-col">
            <div class="bp-panel">
              <div class="bp-panel-title">Recent Executed Requests</div>
              <el-table :data="overview.recentHistories" size="small" max-height="260">
                <el-table-column prop="method" label="Method" width="80" />
                <el-table-column prop="url" label="URL" min-width="180" show-overflow-tooltip />
                <el-table-column prop="statusCode" label="Status" width="75" />
                <el-table-column prop="durationMs" label="ms" width="70" />
              </el-table>
            </div>
            <div class="bp-panel">
              <div class="bp-panel-title">Recent Emails</div>
              <el-table :data="overview.recentEmails" size="small" max-height="260">
                <el-table-column prop="to" label="To" min-width="140" show-overflow-tooltip />
                <el-table-column prop="category" label="Category" width="130" />
                <el-table-column prop="status" label="Status" width="80" />
              </el-table>
            </div>
          </div>
        </template>

        <!-- USERS -->
        <template v-else-if="activeTab === 'users'">
          <div class="bp-toolbar">
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search user email or name..."
              clearable
              style="max-width: 300px"
              @keyup.enter="loadCurrentTab"
            />
            <el-button size="small" type="primary" @click="loadCurrentTab">Search</el-button>
          </div>
          <el-table :data="users" size="small" v-loading="loadingTab">
            <el-table-column prop="email" label="Email" min-width="200" />
            <el-table-column prop="name" label="Name" min-width="140" />
            <el-table-column label="Workspaces" width="100">
              <template #default="{ row }">{{ row._count.memberships }}</template>
            </el-table-column>
            <el-table-column label="Histories" width="90">
              <template #default="{ row }">{{ row._count.histories }}</template>
            </el-table-column>
            <el-table-column label="Activities" width="90">
              <template #default="{ row }">{{ row._count.activityLogs }}</template>
            </el-table-column>
            <el-table-column label="Created" width="170">
              <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="Actions" width="100">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  link
                  @click="handleDeleteUser(row.id, row.email)"
                >
                  Delete
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <!-- WORKSPACES -->
        <template v-else-if="activeTab === 'workspaces'">
          <div class="bp-toolbar">
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search workspace name..."
              clearable
              style="max-width: 260px"
              @keyup.enter="loadCurrentTab"
            />
            <el-select v-model="workspaceTypeFilter" size="small" style="width: 140px" @change="loadCurrentTab">
              <el-option value="" label="All Types" />
              <el-option value="PERSONAL" label="PERSONAL" />
              <el-option value="TEAM" label="TEAM" />
            </el-select>
            <el-button size="small" type="primary" @click="loadCurrentTab">Filter</el-button>
          </div>
          <el-table :data="workspaces" size="small" v-loading="loadingTab">
            <el-table-column prop="name" label="Workspace" min-width="180" />
            <el-table-column prop="type" label="Type" width="100" />
            <el-table-column label="Members" min-width="180">
              <template #default="{ row }">
                {{ row.members.map((m: any) => `${m.user.email} (${m.role})`).join(', ') }}
              </template>
            </el-table-column>
            <el-table-column label="Cols / Envs / Mons" width="140">
              <template #default="{ row }">
                {{ row._count.collections }} / {{ row._count.environments }} / {{ row._count.monitors }}
              </template>
            </el-table-column>
            <el-table-column label="Updated" width="170">
              <template #default="{ row }">{{ fmtDate(row.updatedAt) }}</template>
            </el-table-column>
            <el-table-column label="Actions" width="90">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  link
                  @click="handleDeleteWorkspace(row.id, row.name)"
                >
                  Delete
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <!-- COLLECTIONS & REQUESTS -->
        <template v-else-if="activeTab === 'collections'">
          <div class="bp-toolbar">
            <el-radio-group v-model="collectionSubTab" size="small">
              <el-radio-button value="collections">Collections ({{ collections.length }})</el-radio-button>
              <el-radio-button value="requests">API Requests ({{ requests.length }})</el-radio-button>
            </el-radio-group>
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search name or URL..."
              clearable
              style="max-width: 260px"
              @keyup.enter="loadCurrentTab"
            />
            <el-select
              v-if="collectionSubTab === 'requests'"
              v-model="methodFilter"
              size="small"
              style="width: 120px"
              @change="loadCurrentTab"
            >
              <el-option value="" label="All Methods" />
              <el-option v-for="m in ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']" :key="m" :value="m" :label="m" />
            </el-select>
            <el-button size="small" type="primary" @click="loadCurrentTab">Search</el-button>
          </div>
          <el-table v-if="collectionSubTab === 'collections'" :data="collections" size="small" v-loading="loadingTab">
            <el-table-column prop="name" label="Collection" min-width="180" />
            <el-table-column label="Workspace" min-width="150">
              <template #default="{ row }">{{ row.workspace?.name || '-' }}</template>
            </el-table-column>
            <el-table-column label="Requests / Subfolders / Snaps" width="210">
              <template #default="{ row }">
                {{ row._count.requests }} / {{ row._count.children }} / {{ row._count.snapshots }}
              </template>
            </el-table-column>
            <el-table-column label="Updated" width="170">
              <template #default="{ row }">{{ fmtDate(row.updatedAt) }}</template>
            </el-table-column>
          </el-table>
          <el-table v-else :data="requests" size="small" v-loading="loadingTab">
            <el-table-column prop="method" label="Method" width="90" />
            <el-table-column prop="name" label="Name" min-width="160" />
            <el-table-column prop="url" label="URL" min-width="240" show-overflow-tooltip />
            <el-table-column label="Collection" min-width="140">
              <template #default="{ row }">{{ row.collection?.name || '-' }}</template>
            </el-table-column>
            <el-table-column label="Comments" width="90">
              <template #default="{ row }">{{ row._count.comments }}</template>
            </el-table-column>
          </el-table>
        </template>

        <!-- HISTORIES -->
        <template v-else-if="activeTab === 'histories'">
          <div class="bp-toolbar">
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search URL..."
              clearable
              style="max-width: 240px"
              @keyup.enter="loadCurrentTab"
            />
            <el-select v-model="methodFilter" size="small" style="width: 120px" @change="loadCurrentTab">
              <el-option value="" label="All Methods" />
              <el-option v-for="m in ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']" :key="m" :value="m" :label="m" />
            </el-select>
            <el-select v-model="statusGroupFilter" size="small" style="width: 120px" @change="loadCurrentTab">
              <el-option value="" label="All Status" />
              <el-option value="2xx" label="2xx OK" />
              <el-option value="4xx" label="4xx Client" />
              <el-option value="5xx" label="5xx Server" />
              <el-option value="error" label="Errors" />
            </el-select>
            <el-button size="small" type="primary" @click="loadCurrentTab">Filter</el-button>
          </div>
          <el-table :data="histories" size="small" v-loading="loadingTab">
            <el-table-column prop="method" label="Method" width="85" />
            <el-table-column prop="url" label="URL" min-width="240" show-overflow-tooltip />
            <el-table-column prop="statusCode" label="Status" width="75" />
            <el-table-column prop="durationMs" label="ms" width="70" />
            <el-table-column label="User" min-width="150">
              <template #default="{ row }">{{ row.user?.email || '-' }}</template>
            </el-table-column>
            <el-table-column label="Time" width="165">
              <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="Snapshot" width="90">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="inspectSnapshot(row.requestSnapshot)">
                  Inspect
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <!-- ACTIVITIES -->
        <template v-else-if="activeTab === 'activities'">
          <div class="bp-toolbar">
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search activity message or URL..."
              clearable
              style="max-width: 260px"
              @keyup.enter="loadCurrentTab"
            />
            <el-input
              v-model="activityTypeFilter"
              size="small"
              placeholder="Type (e.g. http, auth)"
              clearable
              style="max-width: 160px"
              @keyup.enter="loadCurrentTab"
            />
            <el-button size="small" type="primary" @click="loadCurrentTab">Filter</el-button>
          </div>
          <el-table :data="activities" size="small" v-loading="loadingTab">
            <el-table-column prop="type" label="Type" width="100" />
            <el-table-column prop="message" label="Message" min-width="240" show-overflow-tooltip />
            <el-table-column label="User" min-width="150">
              <template #default="{ row }">{{ row.user?.email || '-' }}</template>
            </el-table-column>
            <el-table-column prop="statusCode" label="Status" width="75" />
            <el-table-column label="Time" width="165">
              <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </template>

        <!-- EMAILS -->
        <template v-else-if="activeTab === 'emails'">
          <div class="bp-toolbar">
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search recipient or subject..."
              clearable
              style="max-width: 240px"
              @keyup.enter="loadCurrentTab"
            />
            <el-select v-model="emailCategoryFilter" size="small" style="width: 170px" @change="loadCurrentTab">
              <el-option value="" label="All Categories" />
              <el-option value="auth_verification" label="auth_verification" />
              <el-option value="auth_magic_link" label="auth_magic_link" />
              <el-option value="auth_password_reset" label="auth_password_reset" />
              <el-option value="general" label="general" />
            </el-select>
            <el-select v-model="emailStatusFilter" size="small" style="width: 120px" @change="loadCurrentTab">
              <el-option value="" label="All Status" />
              <el-option value="sent" label="sent" />
              <el-option value="failed" label="failed" />
            </el-select>
            <el-button size="small" type="primary" @click="loadCurrentTab">Filter</el-button>
          </div>
          <el-table :data="emails" size="small" v-loading="loadingTab">
            <el-table-column prop="to" label="To" min-width="170" />
            <el-table-column prop="subject" label="Subject" min-width="190" show-overflow-tooltip />
            <el-table-column prop="category" label="Category" width="150" />
            <el-table-column prop="status" label="Status" width="85" />
            <el-table-column prop="error" label="Error" min-width="180" show-overflow-tooltip />
            <el-table-column label="Time" width="165">
              <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </template>

        <!-- MONITORS & ENVIRONMENTS -->
        <template v-else-if="activeTab === 'monitors'">
          <div class="bp-toolbar">
            <el-radio-group v-model="infraSubTab" size="small">
              <el-radio-button value="monitors">Monitors ({{ monitors.length }})</el-radio-button>
              <el-radio-button value="environments">Environments ({{ environments.length }})</el-radio-button>
            </el-radio-group>
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search name..."
              clearable
              style="max-width: 240px"
              @keyup.enter="loadCurrentTab"
            />
            <el-switch
              v-if="infraSubTab === 'environments'"
              v-model="revealEnvSecrets"
              active-text="Reveal Secrets"
            />
            <el-button size="small" type="primary" @click="loadCurrentTab">Search</el-button>
          </div>
          <el-table v-if="infraSubTab === 'monitors'" :data="monitors" size="small" v-loading="loadingTab">
            <el-table-column prop="name" label="Monitor" min-width="170" />
            <el-table-column label="Workspace" min-width="140">
              <template #default="{ row }">{{ row.workspace?.name || '-' }}</template>
            </el-table-column>
            <el-table-column prop="intervalMinutes" label="Interval (m)" width="105" />
            <el-table-column prop="lastStatus" label="Last Status" width="110" />
            <el-table-column label="Pass / Fail" width="100">
              <template #default="{ row }">{{ row.lastPassed }} / {{ row.lastFailed }}</template>
            </el-table-column>
            <el-table-column label="Enabled" width="100">
              <template #default="{ row }">
                <el-switch :model-value="row.enabled" @change="handleToggleMonitor(row.id)" />
              </template>
            </el-table-column>
          </el-table>
          <el-table v-else :data="environments" size="small" v-loading="loadingTab">
            <el-table-column prop="name" label="Environment" min-width="160" />
            <el-table-column label="Workspace" min-width="140">
              <template #default="{ row }">{{ row.workspace?.name || '-' }}</template>
            </el-table-column>
            <el-table-column label="Global" width="80">
              <template #default="{ row }">{{ row.isGlobal ? 'Yes' : 'No' }}</template>
            </el-table-column>
            <el-table-column label="Variables" min-width="260">
              <template #default="{ row }">
                {{
                  (row.variables || [])
                    .map((v: any) => `${v.key}=${v.isSecret && !revealEnvSecrets ? '***' : v.value}`)
                    .join(', ')
                }}
              </template>
            </el-table-column>
          </el-table>
        </template>

        <!-- COMMENTS & SNAPSHOTS -->
        <template v-else-if="activeTab === 'comments'">
          <div class="bp-toolbar">
            <el-radio-group v-model="auditSubTab" size="small">
              <el-radio-button value="comments">Request Comments ({{ comments.length }})</el-radio-button>
              <el-radio-button value="snapshots">Collection Snapshots ({{ snapshots.length }})</el-radio-button>
            </el-radio-group>
            <el-input
              v-model="searchQuery"
              size="small"
              placeholder="Search..."
              clearable
              style="max-width: 240px"
              @keyup.enter="loadCurrentTab"
            />
            <el-button size="small" type="primary" @click="loadCurrentTab">Search</el-button>
          </div>
          <el-table v-if="auditSubTab === 'comments'" :data="comments" size="small" v-loading="loadingTab">
            <el-table-column label="User" min-width="150">
              <template #default="{ row }">{{ row.user?.email || '-' }}</template>
            </el-table-column>
            <el-table-column label="Request" min-width="170">
              <template #default="{ row }">{{ row.request?.method }} {{ row.request?.name }}</template>
            </el-table-column>
            <el-table-column prop="content" label="Comment" min-width="240" show-overflow-tooltip />
            <el-table-column label="Time" width="165">
              <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="Actions" width="90">
              <template #default="{ row }">
                <el-button size="small" type="danger" link @click="handleDeleteComment(row.id)">
                  Delete
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-table v-else :data="snapshots" size="small" v-loading="loadingTab">
            <el-table-column prop="version" label="Version" width="110" />
            <el-table-column label="Collection" min-width="180">
              <template #default="{ row }">{{ row.collection?.name || '-' }}</template>
            </el-table-column>
            <el-table-column label="Workspace" min-width="160">
              <template #default="{ row }">{{ row.collection?.workspace?.name || '-' }}</template>
            </el-table-column>
            <el-table-column prop="note" label="Note" min-width="200" show-overflow-tooltip />
            <el-table-column label="Created" width="170">
              <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </template>
      </main>
    </div>

    <el-dialog v-model="snapshotModalVisible" title="Request Snapshot JSON" width="min(94vw, 680px)">
      <pre class="bp-json-pre">{{ inspectedSnapshotJson }}</pre>
    </el-dialog>
  </div>
</template>

<style scoped>
.bp-shell {
  min-height: 100vh;
  background: var(--ao-bg);
  color: var(--ao-text);
  display: flex;
  flex-direction: column;
}
.bp-center-box {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.bp-login-card {
  width: min(94vw, 420px);
  padding: 28px;
  border-radius: 14px;
  background: var(--ao-surface);
  border: 1px solid var(--ao-border);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
}
.bp-login-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.14);
  padding: 3px 10px;
  border-radius: 999px;
  margin-bottom: 10px;
}
.bp-login-title {
  margin: 0 0 6px;
  font-size: 20px;
}
.bp-login-sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--ao-text-muted);
}
.bp-workspace {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.bp-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  background: var(--ao-surface);
  border-bottom: 1px solid var(--ao-border);
  flex-wrap: wrap;
}
.bp-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}
.bp-brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
}
.bp-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bp-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 20px;
  background: var(--ao-surface-2, var(--ao-surface));
  border-bottom: 1px solid var(--ao-border);
  overflow-x: auto;
}
.bp-tab-btn {
  border: 1px solid transparent;
  background: transparent;
  color: var(--ao-text-muted);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.bp-tab-btn:hover {
  color: var(--ao-text);
  background: var(--ao-hover);
}
.bp-tab-btn.active {
  color: var(--el-color-primary);
  background: var(--ao-surface);
  border-color: var(--ao-border);
}
.bp-content {
  flex: 1;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.bp-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}
.bp-kpi-card {
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--ao-surface);
  border: 1px solid var(--ao-border);
}
.bp-kpi-label {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--ao-text-muted);
}
.bp-kpi-val {
  font-size: 22px;
  font-weight: 700;
  margin: 4px 0;
}
.bp-kpi-sub {
  font-size: 12px;
  color: var(--ao-text-muted);
}
.bp-two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 14px;
}
.bp-panel {
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--ao-surface);
  border: 1px solid var(--ao-border);
}
.bp-panel-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}
.bp-kv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bp-kv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--ao-border);
}
.bp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bp-json-pre {
  margin: 0;
  max-height: 60vh;
  overflow: auto;
  padding: 12px;
  border-radius: 8px;
  background: var(--ao-bg);
  border: 1px solid var(--ao-border);
  font-size: 12px;
}
</style>
