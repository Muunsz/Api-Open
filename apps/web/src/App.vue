<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { EnvVariable, FormDataItem, HttpMethod } from '@api-open/shared';
import {
  Delete,
  Document,
  Download,
  Folder,
  Menu,
  Moon,
  Plus,
  Setting,
  Sunny,
  Upload,
  User,
  VideoPlay,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { executeProxyRequest } from './api/proxy';
import CollectionRunnerDialog from './components/CollectionRunnerDialog.vue';
import KeyValueTable from './components/KeyValueTable.vue';
import RealtimePanel from './components/RealtimePanel.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { useSettingsStore } from './stores/settings';
import { useTabsStore } from './stores/tabs';
import { type CollectionTreeNode, useWorkspaceStore } from './stores/workspace';
import { generateCollectionDocsMarkdown } from './utils/docsGenerator';
import {
  type GqlFieldSummary,
  GRAPHQL_INTROSPECTION_QUERY,
  parseIntrospectionResponse,
} from './utils/graphqlIntrospection';
import { exportPostmanCollection } from './utils/postmanConverter';
import type { SnippetLang } from './utils/snippetGenerator';
import { resolveVariables } from './utils/variables';

const store = useTabsStore();
const ws = useWorkspaceStore();
const settings = useSettingsStore();

const methods: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

const sidebarTab = ref<'collections' | 'history'>('collections');
const mobileSidebarVisible = ref(false);
const clientProtocol = ref<'http' | 'ws' | 'sse'>('http');
const activeRequestTab = ref('params');
const activeResponseTab = ref('body');
const responseViewMode = ref<'pretty' | 'raw'>('pretty');

// Auth modal state
const authDialogVisible = ref(false);
const authMode = ref<'login' | 'register'>('login');
const authEmail = ref('');
const authPassword = ref('');
const authSubmitting = ref(false);

// Save request modal state
const saveDialogVisible = ref(false);
const saveRequestName = ref('');
const saveCollectionId = ref('');

// New collection modal state
const newCollectionVisible = ref(false);
const newCollectionName = ref('');

// Environments modal state
const envDialogVisible = ref(false);
const newEnvName = ref('');
const editingEnvId = ref('');
const editingEnvVars = ref<EnvVariable[]>([]);

// Import cURL & Code Snippet modals
const curlDialogVisible = ref(false);
const curlInput = ref('');
const snippetDialogVisible = ref(false);
const snippetLang = ref<SnippetLang>('curl');

// Postman / OpenAPI Import & Collection Runner
const postmanFileInput = ref<HTMLInputElement | null>(null);
const openApiFileInput = ref<HTMLInputElement | null>(null);
const runnerVisible = ref(false);
const runnerTargetNode = ref<CollectionTreeNode | null>(null);

// API Docs Modal
const docsVisible = ref(false);
const docsTitle = ref('');
const docsMarkdown = ref('');

// Team Workspace Modal
const teamDialogVisible = ref(false);
const newTeamName = ref('');
const inviteEmail = ref('');
const inviteRole = ref<'OWNER' | 'EDITOR' | 'VIEWER'>('EDITOR');
const inviting = ref(false);

// GraphQL Introspection Modal
const gqlSchemaVisible = ref(false);
const gqlLoading = ref(false);
const gqlQueries = ref<GqlFieldSummary[]>([]);
const gqlMutations = ref<GqlFieldSummary[]>([]);

// Settings & Profile Modal
const settingsVisible = ref(false);
const settingsInitialTab = ref<'layout' | 'profile'>('layout');
const splitContainerRef = ref<HTMLElement | null>(null);

function openSettings(tabName: 'layout' | 'profile' = 'layout') {
  settingsInitialTab.value = tabName;
  settingsVisible.value = true;
}

function startSidebarResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = settings.sidebarWidth;
  const isRight = settings.sidebarPosition === 'right';

  const onMove = (ev: MouseEvent) => {
    const delta = isRight ? startX - ev.clientX : ev.clientX - startX;
    settings.sidebarWidth = Math.min(480, Math.max(200, startWidth + delta));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startResponseResize(e: MouseEvent) {
  e.preventDefault();
  const container = splitContainerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();

  const onMove = (ev: MouseEvent) => {
    if (settings.responsePosition === 'right') {
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      settings.responseSizePercent = Math.round(Math.min(75, Math.max(25, pct)));
    } else {
      const pct = ((rect.bottom - ev.clientY) / rect.height) * 100;
      settings.responseSizePercent = Math.round(Math.min(75, Math.max(25, pct)));
    }
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

let syncingUrl = false;
const tab = computed(() => store.activeTab);

const generatedCode = computed(() => {
  if (!snippetDialogVisible.value) return '';
  return store.getSnippet(snippetLang.value);
});

const passedTestsCount = computed(
  () => tab.value?.testResults.filter((t) => t.passed).length ?? 0,
);

watch(
  () => tab.value?.queryParams,
  () => {
    if (syncingUrl) return;
    syncingUrl = true;
    store.syncUrlFromParams();
    syncingUrl = false;
  },
  { deep: true },
);

function handleUrlInput() {
  if (syncingUrl) return;
  syncingUrl = true;
  store.syncParamsFromUrl();
  syncingUrl = false;
}

function handleImportCurl() {
  try {
    store.importCurl(curlInput.value);
    curlInput.value = '';
    curlDialogVisible.value = false;
    ElMessage.success('cURL imported');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Invalid cURL command');
  }
}

async function copyGeneratedCode() {
  await navigator.clipboard.writeText(generatedCode.value);
  ElMessage.success('Copied to clipboard');
}

function insertTestTemplate(kind: 'status' | 'json' | 'env') {
  if (!tab.value) return;
  const snippets: Record<string, string> = {
    status: `pm.test("Status code is 200", () => {\n  pm.expect(pm.response.code).to.equal(200);\n});\n`,
    json: `pm.test("Response has expected field", () => {\n  const data = pm.response.json();\n  pm.expect(data).to.have.property("id");\n});\n`,
    env: `const data = pm.response.json();\npm.environment.set("token", data.token);\nconsole.log("Saved token");\n`,
  };
  tab.value.testScript = (tab.value.testScript ? tab.value.testScript + '\n' : '') + snippets[kind];
}

onMounted(() => {
  ws.initAuth();
});

const formattedBody = computed(() => {
  const res = tab.value?.response;
  if (!res) return '';
  if (res.isBase64) return `[Binary payload: ${res.sizeBytes} bytes]`;
  if (responseViewMode.value === 'raw') return res.body;
  try {
    return JSON.stringify(JSON.parse(res.body), null, 2);
  } catch {
    return res.body;
  }
});

const responseHeadersList = computed(() => {
  const headers = tab.value?.response?.headers ?? {};
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
});

const responseCookiesList = computed(() => {
  const raw = tab.value?.response?.headers?.['set-cookie'];
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;=]+=[^;]+)/).map((cookieStr) => {
    const parts = cookieStr.split(';').map((p) => p.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    return {
      name: eqIdx >= 0 ? nameVal.slice(0, eqIdx) : nameVal,
      value: eqIdx >= 0 ? nameVal.slice(eqIdx + 1) : '',
      attributes: attrs.join('; '),
    };
  });
});

const isImageResponse = computed(() => {
  const ct = tab.value?.response?.headers['content-type'] ?? '';
  return tab.value?.response?.isBase64 && ct.startsWith('image/');
});

const imageDataUrl = computed(() => {
  const res = tab.value?.response;
  if (!res) return '';
  const ct = res.headers['content-type'] ?? 'image/png';
  return `data:${ct};base64,${res.body}`;
});

function statusTagType(code?: number) {
  if (!code) return 'info';
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400 && code < 500) return 'warning';
  if (code >= 500) return 'danger';
  return 'info';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatJsonBody() {
  if (!tab.value?.body.raw) return;
  try {
    tab.value.body.raw = JSON.stringify(JSON.parse(tab.value.body.raw), null, 2);
  } catch {
    // ignore invalid json
  }
}

function handleTabEdit(
  targetName: string | number | undefined,
  action: 'add' | 'remove',
) {
  if (action === 'add') {
    store.addTab();
  } else if (action === 'remove' && targetName !== undefined) {
    store.closeTab(String(targetName));
  }
}

async function handleAuthSubmit() {
  authSubmitting.value = true;
  try {
    if (authMode.value === 'login') {
      await ws.signIn(authEmail.value, authPassword.value);
      ElMessage.success('Signed in');
      authDialogVisible.value = false;
    } else {
      await ws.signUp(authEmail.value, authPassword.value);
      ElMessage.success('Registered! Check your email or sign in.');
      authMode.value = 'login';
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Auth failed');
  } finally {
    authSubmitting.value = false;
  }
}

async function handleOAuthLogin(provider: 'google' | 'github' | 'discord') {
  try {
    await ws.signInWithOAuth(provider);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'OAuth login failed');
  }
}

async function handleSaveClick() {
  if (!ws.isAuthenticated) {
    authDialogVisible.value = true;
    ElMessage.info('Sign in first to save requests to Supabase');
    return;
  }
  if (tab.value.savedRequestId) {
    await store.saveActiveTab();
    ElMessage.success('Request updated');
    return;
  }
  saveRequestName.value = tab.value.name || 'New Request';
  saveCollectionId.value = ws.collections[0]?.id ?? '';
  saveDialogVisible.value = true;
}

async function confirmSaveRequest() {
  if (!saveCollectionId.value) {
    ElMessage.warning('Create or select a collection first');
    return;
  }
  await store.saveActiveTab(saveCollectionId.value, saveRequestName.value);
  saveDialogVisible.value = false;
  ElMessage.success('Request saved');
}

async function confirmCreateCollection() {
  if (!newCollectionName.value.trim()) return;
  await ws.createCollection(newCollectionName.value);
  newCollectionName.value = '';
  newCollectionVisible.value = false;
  ElMessage.success('Collection created');
}

function handleTreeNodeClick(node: CollectionTreeNode) {
  if (node.kind === 'request' && node.request) {
    store.openSavedRequest(node.request);
    mobileSidebarVisible.value = false;
  }
}

async function handleTreeDelete(node: CollectionTreeNode) {
  if (node.kind === 'collection' && node.collection) {
    await ws.deleteCollection(node.collection.id);
    ElMessage.success('Collection deleted');
  } else if (node.kind === 'request' && node.request) {
    await ws.deleteRequest(node.request.id);
    ElMessage.success('Request deleted');
  }
}

function openRunner(node: CollectionTreeNode) {
  runnerTargetNode.value = node;
  runnerVisible.value = true;
}

function handleExportCollection(node: CollectionTreeNode) {
  const json = exportPostmanCollection(node);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${node.label.replace(/[^a-zA-Z0-9_-]/g, '_')}.postman_collection.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function triggerPostmanImport() {
  postmanFileInput.value?.click();
}

async function handlePostmanFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await ws.importPostmanJson(text);
    ElMessage.success('Postman collection imported');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Import failed');
  } finally {
    input.value = '';
  }
}

function triggerOpenApiImport() {
  openApiFileInput.value?.click();
}

async function handleOpenApiFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await ws.importOpenApiJson(text);
    ElMessage.success('OpenAPI spec imported');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'OpenAPI import failed');
  } finally {
    input.value = '';
  }
}

function openDocsModal(node: CollectionTreeNode) {
  docsTitle.value = node.label;
  docsMarkdown.value = generateCollectionDocsMarkdown(node);
  docsVisible.value = true;
}

function downloadDocsMarkdown() {
  const blob = new Blob([docsMarkdown.value], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${docsTitle.value.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleCreateTeam() {
  if (!newTeamName.value.trim()) return;
  await ws.createTeamWorkspace(newTeamName.value);
  newTeamName.value = '';
  ElMessage.success('Team workspace created');
}

async function handleInviteMember() {
  if (!inviteEmail.value.trim()) return;
  inviting.value = true;
  try {
    const res = await ws.inviteMember(inviteEmail.value, inviteRole.value);
    inviteEmail.value = '';
    ElMessage.success(
      res.addedImmediately
        ? 'Member added & invitation email sent'
        : 'Invitation email sent',
    );
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Invite failed');
  } finally {
    inviting.value = false;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addFormDataRow() {
  if (!tab.value) return;
  if (!tab.value.body.formData) tab.value.body.formData = [];
  tab.value.body.formData.push({
    id: Math.random().toString(36).slice(2, 10),
    key: '',
    type: 'text',
    value: '',
    enabled: true,
  });
}

async function handleFormDataFileChange(row: FormDataItem, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  row.fileName = file.name;
  row.mimeType = file.type || 'application/octet-stream';
  row.fileContentBase64 = await fileToBase64(file);
}

async function handleBinaryFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !tab.value) return;
  tab.value.body.binary = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    contentBase64: await fileToBase64(file),
  };
}

async function fetchGraphqlSchema() {
  if (!tab.value?.url.trim()) return;
  gqlLoading.value = true;
  try {
    const resolvedUrl = resolveVariables(tab.value.url.trim(), ws.activeVariablesMap);
    const res = await executeProxyRequest({
      method: 'POST',
      url: resolvedUrl,
      headers: { 'Content-Type': 'application/json' },
      body: {
        mode: 'graphql',
        graphql: { query: GRAPHQL_INTROSPECTION_QUERY, variables: '{}' },
      },
    });
    const parsed = parseIntrospectionResponse(res.body);
    gqlQueries.value = parsed.queries;
    gqlMutations.value = parsed.mutations;
    gqlSchemaVisible.value = true;
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Introspection failed');
  } finally {
    gqlLoading.value = false;
  }
}

function openEnvDialog() {
  if (!ws.isAuthenticated) {
    authDialogVisible.value = true;
    return;
  }
  if (ws.environments.length) {
    selectEnvForEdit(ws.activeEnvId || ws.environments[0].id);
  } else {
    editingEnvId.value = '';
    editingEnvVars.value = [];
  }
  envDialogVisible.value = true;
}

function selectEnvForEdit(envId: string) {
  editingEnvId.value = envId;
  const found = ws.environments.find((e) => e.id === envId);
  editingEnvVars.value = found
    ? found.variables.map((v) => ({ ...v }))
    : [];
}

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

async function saveEnvVars() {
  if (!editingEnvId.value) return;
  await ws.updateEnvironment(editingEnvId.value, {
    variables: editingEnvVars.value,
  });
  ElMessage.success('Environment variables saved');
}
</script>

<template>
  <el-container class="app-shell">
    <el-header height="auto" class="top-bar">
      <div class="top-left">
        <el-button
          class="mobile-menu-btn"
          :icon="Menu"
          circle
          size="small"
          @click="mobileSidebarVisible = true"
        />
        <div class="brand">
          <img
            src="/API-OPEN-FULL-WARNA.jpg"
            alt="Api-Open"
            class="brand-full-logo"
          />
        </div>
        <el-radio-group v-model="clientProtocol" size="small">
          <el-radio-button value="http">HTTP</el-radio-button>
          <el-radio-button value="ws">WebSocket</el-radio-button>
          <el-radio-button value="sse">SSE</el-radio-button>
        </el-radio-group>
      </div>

      <div class="top-actions">
        <el-button size="small" @click="curlDialogVisible = true">
          Import cURL
        </el-button>
        <el-button size="small" @click="snippetDialogVisible = true">
          Code
        </el-button>
        <el-button
          size="small"
          circle
          :icon="settings.theme === 'dark' ? Sunny : Moon"
          title="Toggle Dark / Light Mode"
          @click="settings.toggleTheme"
        />
        <el-button
          size="small"
          circle
          :icon="Setting"
          title="Layout & Profile Settings"
          @click="openSettings('layout')"
        />

        <template v-if="ws.isAuthenticated">
          <el-select
            v-model="ws.activeWorkspaceId"
            size="small"
            class="top-select"
            @change="(id: string) => ws.loadWorkspaceData(id)"
          >
            <el-option
              v-for="w in ws.workspaces"
              :key="w.id"
              :label="w.name"
              :value="w.id"
            />
          </el-select>

          <el-select
            v-model="ws.activeEnvId"
            size="small"
            clearable
            placeholder="No Environment"
            class="top-select"
          >
            <el-option
              v-for="env in ws.environments"
              :key="env.id"
              :label="env.name"
              :value="env.id"
            />
          </el-select>

          <el-button size="small" :icon="Setting" @click="openEnvDialog">
            Envs
          </el-button>

          <el-button size="small" :icon="User" @click="teamDialogVisible = true">
            Team
          </el-button>

          <el-dropdown>
            <el-button size="small" plain class="user-btn">
              <el-avatar
                :size="20"
                :src="ws.profile?.avatarUrl || undefined"
                style="margin-right: 6px"
              >
                {{ (ws.profile?.name || ws.user?.email || 'U').slice(0, 1).toUpperCase() }}
              </el-avatar>
              <span>{{ ws.profile?.name || ws.user?.email }}</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openSettings('profile')">
                  Profile & Settings
                </el-dropdown-item>
                <el-dropdown-item divided @click="ws.signOut()">
                  Sign Out
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>

        <template v-else>
          <el-tag type="info" effect="plain">Guest Mode</el-tag>
          <el-button type="primary" size="small" @click="authDialogVisible = true">
            Sign In
          </el-button>
        </template>
      </div>
    </el-header>

    <el-container
      class="main-body"
      :class="{ 'sidebar-on-right': settings.sidebarPosition === 'right' }"
    >
      <el-aside
        :width="`${settings.sidebarWidth}px`"
        class="sidebar desktop-sidebar"
      >
        <el-tabs v-model="sidebarTab" stretch>
          <el-tab-pane label="Collections" name="collections">
            <template v-if="ws.isAuthenticated">
              <div class="sidebar-toolbar">
                <el-text size="small" type="info">Collections</el-text>
                <div style="display: flex; gap: 4px; align-items: center">
                  <el-dropdown trigger="click">
                    <el-button size="small" :icon="Upload" link type="primary">
                      Import
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item @click="triggerPostmanImport">
                          Postman v2.1 (.json)
                        </el-dropdown-item>
                        <el-dropdown-item @click="triggerOpenApiImport">
                          OpenAPI / Swagger (.json)
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <el-button
                    size="small"
                    :icon="Plus"
                    link
                    type="primary"
                    @click="newCollectionVisible = true"
                  >
                    New
                  </el-button>
                </div>
                <input
                  ref="postmanFileInput"
                  type="file"
                  accept=".json,application/json"
                  style="display: none"
                  @change="handlePostmanFileSelected"
                />
                <input
                  ref="openApiFileInput"
                  type="file"
                  accept=".json,application/json"
                  style="display: none"
                  @change="handleOpenApiFileSelected"
                />
              </div>
              <el-empty
                v-if="!ws.collectionTree.length"
                description="No collections yet"
                :image-size="54"
              />
              <el-tree
                v-else
                :data="ws.collectionTree"
                node-key="id"
                default-expand-all
                @node-click="handleTreeNodeClick"
              >
                <template #default="{ data }">
                  <div class="tree-row">
                    <span class="tree-label">
                      <el-icon v-if="data.kind === 'collection'"><Folder /></el-icon>
                      <el-tag v-else size="small" effect="plain">
                        {{ data.request?.method }}
                      </el-tag>
                      <span class="tree-text">{{ data.label }}</span>
                    </span>
                    <span class="tree-actions">
                      <el-button
                        v-if="data.kind === 'collection'"
                        :icon="VideoPlay"
                        link
                        type="success"
                        size="small"
                        title="Run Collection"
                        @click.stop="openRunner(data)"
                      />
                      <el-button
                        v-if="data.kind === 'collection'"
                        :icon="Document"
                        link
                        size="small"
                        title="View API Docs"
                        @click.stop="openDocsModal(data)"
                      />
                      <el-button
                        v-if="data.kind === 'collection'"
                        :icon="Download"
                        link
                        size="small"
                        title="Export Postman JSON"
                        @click.stop="handleExportCollection(data)"
                      />
                      <el-button
                        :icon="Delete"
                        link
                        type="danger"
                        size="small"
                        @click.stop="handleTreeDelete(data)"
                      />
                    </span>
                  </div>
                </template>
              </el-tree>
            </template>
            <el-empty
              v-else
              description="Sign in to sync collections"
              :image-size="54"
            >
              <el-button type="primary" size="small" @click="authDialogVisible = true">
                Sign In
              </el-button>
            </el-empty>
          </el-tab-pane>

          <el-tab-pane label="History" name="history">
            <div class="sidebar-toolbar">
              <el-text size="small" type="info">Recent requests</el-text>
              <el-button
                v-if="store.history.length"
                link
                type="danger"
                size="small"
                :icon="Delete"
                @click="store.clearHistory"
              >
                Clear
              </el-button>
            </div>
            <el-empty
              v-if="!store.history.length"
              description="No history yet"
              :image-size="54"
            />
            <div v-else class="history-list">
              <div
                v-for="item in store.history"
                :key="item.id"
                class="history-item"
                @click="store.addTab({ method: item.method, url: item.url, name: item.url })"
              >
                <el-tag size="small" effect="plain">{{ item.method }}</el-tag>
                <span class="history-url" :title="item.url">{{ item.url }}</span>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-aside>

      <div
        class="sidebar-resizer desktop-sidebar"
        title="Drag to resize sidebar"
        @mousedown="startSidebarResize"
      />

      <el-main class="workspace" v-if="tab">
        <RealtimePanel
          v-if="clientProtocol !== 'http'"
          :key="clientProtocol"
          :protocol="clientProtocol"
        />

        <template v-else>
        <el-tabs
          v-model="store.activeTabId"
          type="card"
          editable
          @edit="handleTabEdit"
          class="request-doc-tabs"
        >
          <el-tab-pane
            v-for="t in store.tabs"
            :key="t.id"
            :name="t.id"
            :label="`${t.method} ${t.savedRequestId ? t.name : t.url ? t.url.replace(/^https?:\/\//, '').slice(0, 22) : t.name}`"
          />
        </el-tabs>

        <div class="request-bar">
          <el-select v-model="tab.method" class="method-select">
            <el-option v-for="m in methods" :key="m" :label="m" :value="m" />
          </el-select>
          <el-input
            v-model="tab.url"
            class="url-input"
            placeholder="Enter URL (supports {{variable}} syntax)"
            clearable
            @input="handleUrlInput"
            @keyup.ctrl.enter="store.sendActiveRequest"
            @keyup.enter="store.sendActiveRequest"
          />
          <div class="request-bar-actions">
            <el-button
              type="primary"
              :loading="tab.loading"
              @click="store.sendActiveRequest"
            >
              Send
            </el-button>
            <el-button @click="handleSaveClick">Save</el-button>
            <el-button :icon="Plus" @click="store.addTab()">New</el-button>
          </div>
        </div>

        <div
          ref="splitContainerRef"
          class="request-response-split"
          :class="{ 'split-horizontal': settings.responsePosition === 'right' }"
        >
        <div class="request-pane">
        <el-tabs v-model="activeRequestTab" class="request-tabs">
          <el-tab-pane label="Params" name="params">
            <KeyValueTable
              :rows="tab.queryParams"
              key-placeholder="Query param"
              value-placeholder="Value"
            />
          </el-tab-pane>

          <el-tab-pane label="Authorization" name="auth">
            <el-form label-width="110px" size="small" style="max-width: 520px">
              <el-form-item label="Auth Type">
                <el-select
                  :model-value="tab.auth.type"
                  @update:model-value="
                    (val: string) => {
                      if (val === 'none') tab.auth = { type: 'none' };
                      else if (val === 'bearer') tab.auth = { type: 'bearer', token: '' };
                      else if (val === 'basic')
                        tab.auth = { type: 'basic', username: '', password: '' };
                      else if (val === 'apikey')
                        tab.auth = { type: 'apikey', key: '', value: '', addTo: 'header' };
                    }
                  "
                >
                  <el-option label="No Auth" value="none" />
                  <el-option label="Bearer Token" value="bearer" />
                  <el-option label="Basic Auth" value="basic" />
                  <el-option label="API Key" value="apikey" />
                </el-select>
              </el-form-item>

              <template v-if="tab.auth.type === 'bearer'">
                <el-form-item label="Token">
                  <el-input v-model="tab.auth.token" placeholder="Bearer token" show-password />
                </el-form-item>
              </template>

              <template v-if="tab.auth.type === 'basic'">
                <el-form-item label="Username">
                  <el-input v-model="tab.auth.username" />
                </el-form-item>
                <el-form-item label="Password">
                  <el-input v-model="tab.auth.password" show-password />
                </el-form-item>
              </template>

              <template v-if="tab.auth.type === 'apikey'">
                <el-form-item label="Key">
                  <el-input v-model="tab.auth.key" placeholder="X-API-Key" />
                </el-form-item>
                <el-form-item label="Value">
                  <el-input v-model="tab.auth.value" />
                </el-form-item>
                <el-form-item label="Add to">
                  <el-radio-group v-model="tab.auth.addTo">
                    <el-radio value="header">Header</el-radio>
                    <el-radio value="query">Query Params</el-radio>
                  </el-radio-group>
                </el-form-item>
              </template>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="Headers" name="headers">
            <KeyValueTable
              :rows="tab.headers"
              key-placeholder="Header"
              value-placeholder="Value"
            />
          </el-tab-pane>

          <el-tab-pane label="Body" name="body">
            <div class="body-controls">
              <el-radio-group v-model="tab.body.mode" size="small">
                <el-radio-button value="none">none</el-radio-button>
                <el-radio-button value="form-data">form-data</el-radio-button>
                <el-radio-button value="urlencoded">x-www-form-urlencoded</el-radio-button>
                <el-radio-button value="raw">raw</el-radio-button>
                <el-radio-button value="binary">binary</el-radio-button>
                <el-radio-button value="graphql">GraphQL</el-radio-button>
              </el-radio-group>

              <template v-if="tab.body.mode === 'raw'">
                <el-select v-model="tab.body.rawType" size="small" style="width: 100px">
                  <el-option label="JSON" value="json" />
                  <el-option label="Text" value="text" />
                  <el-option label="XML" value="xml" />
                  <el-option label="HTML" value="html" />
                </el-select>
                <el-button
                  v-if="tab.body.rawType === 'json'"
                  size="small"
                  @click="formatJsonBody"
                >
                  Beautify JSON
                </el-button>
              </template>

              <el-button
                v-if="tab.body.mode === 'graphql'"
                size="small"
                :loading="gqlLoading"
                @click="fetchGraphqlSchema"
              >
                Fetch Schema
              </el-button>
            </div>

            <el-input
              v-if="tab.body.mode === 'raw'"
              v-model="tab.body.raw"
              type="textarea"
              :rows="7"
              class="code-area"
              placeholder="Request body..."
            />

            <div v-else-if="tab.body.mode === 'form-data'">
              <el-table :data="tab.body.formData ?? []" size="small" border>
                <el-table-column width="46" align="center">
                  <template #default="{ row }">
                    <el-checkbox v-model="row.enabled" />
                  </template>
                </el-table-column>
                <el-table-column label="Key" width="180">
                  <template #default="{ row }">
                    <el-input v-model="row.key" size="small" placeholder="field" />
                  </template>
                </el-table-column>
                <el-table-column label="Type" width="100">
                  <template #default="{ row }">
                    <el-select v-model="row.type" size="small">
                      <el-option label="Text" value="text" />
                      <el-option label="File" value="file" />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="Value">
                  <template #default="{ row }">
                    <el-input
                      v-if="row.type === 'text'"
                      v-model="row.value"
                      size="small"
                      placeholder="Value"
                    />
                    <div v-else style="display: flex; align-items: center; gap: 8px">
                      <input
                        type="file"
                        @change="(e: Event) => handleFormDataFileChange(row, e)"
                      />
                      <el-text v-if="row.fileName" size="small" type="info">
                        {{ row.fileName }}
                      </el-text>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column width="54" align="center">
                  <template #default="{ $index }">
                    <el-button
                      :icon="Delete"
                      link
                      type="danger"
                      @click="tab.body.formData?.splice($index, 1)"
                    />
                  </template>
                </el-table-column>
              </el-table>
              <el-button size="small" :icon="Plus" style="margin-top: 8px" @click="addFormDataRow">
                Add Field
              </el-button>
            </div>

            <div v-else-if="tab.body.mode === 'binary'" class="binary-box">
              <input type="file" @change="handleBinaryFileChange" />
              <el-text v-if="tab.body.binary?.fileName" type="info" size="small">
                Selected: {{ tab.body.binary.fileName }} ({{ tab.body.binary.mimeType }})
              </el-text>
            </div>

            <KeyValueTable
              v-else-if="tab.body.mode === 'urlencoded' && tab.body.urlencoded"
              :rows="tab.body.urlencoded"
            />

            <div v-else-if="tab.body.mode === 'graphql' && tab.body.graphql" class="gql-grid">
              <el-input
                v-model="tab.body.graphql.query"
                type="textarea"
                :rows="6"
                placeholder="query { ... }"
              />
              <el-input
                v-model="tab.body.graphql.variables"
                type="textarea"
                :rows="6"
                placeholder='{ "id": 1 }'
              />
            </div>
          </el-tab-pane>

          <el-tab-pane label="Pre-request" name="preRequest">
            <el-input
              v-model="tab.preRequestScript"
              type="textarea"
              :rows="6"
              class="code-area"
              placeholder='// Runs before sending request&#10;// pm.environment.set("timestamp", Date.now());'
            />
          </el-tab-pane>

          <el-tab-pane label="Tests" name="tests">
            <div class="body-controls">
              <el-text size="small" type="info">Snippets:</el-text>
              <el-button size="small" @click="insertTestTemplate('status')">
                Status 200
              </el-button>
              <el-button size="small" @click="insertTestTemplate('json')">
                Has Property
              </el-button>
              <el-button size="small" @click="insertTestTemplate('env')">
                Set Env Var
              </el-button>
            </div>
            <el-input
              v-model="tab.testScript"
              type="textarea"
              :rows="6"
              class="code-area"
              placeholder='pm.test("Status is 200", () => {&#10;  pm.expect(pm.response.code).to.equal(200);&#10;});'
            />
          </el-tab-pane>
        </el-tabs>
        </div>

        <div
          class="response-resizer"
          :class="{ 'is-vertical': settings.responsePosition === 'right' }"
          title="Drag to resize response panel"
          @mousedown="startResponseResize"
        />

        <div
          class="response-section kt-card kt-card-bordered"
          :style="
            settings.responsePosition === 'right'
              ? { width: `${settings.responseSizePercent}%`, flex: 'none' }
              : { height: `${settings.responseSizePercent}%`, flex: 'none' }
          "
        >
          <div class="response-header">
            <span>Response</span>
            <div v-if="tab.response" class="response-meta">
              <span
                class="kt-badge kt-badge-sm"
                :class="
                  tab.response.statusCode < 300
                    ? 'kt-badge-success'
                    : tab.response.statusCode < 500
                      ? 'kt-badge-warning'
                      : 'kt-badge-danger'
                "
              >
                {{ tab.response.statusCode }} {{ tab.response.statusText }}
              </span>
              <span class="kt-badge kt-badge-sm kt-badge-outline kt-badge-secondary">
                {{ tab.response.durationMs }} ms
              </span>
              <span class="kt-badge kt-badge-sm kt-badge-outline kt-badge-secondary">
                {{ formatBytes(tab.response.sizeBytes) }}
              </span>
            </div>
          </div>

          <el-alert
            v-if="tab.error"
            :title="tab.error"
            type="error"
            show-icon
            :closable="false"
            style="margin-bottom: 8px"
          />

          <el-tabs v-model="activeResponseTab">
            <el-tab-pane label="Body" name="body">
              <template v-if="tab.response">
                <div class="body-controls" v-if="!tab.response.isBase64">
                  <el-radio-group v-model="responseViewMode" size="small">
                    <el-radio-button value="pretty">Pretty</el-radio-button>
                    <el-radio-button value="raw">Raw</el-radio-button>
                  </el-radio-group>
                </div>
                <img
                  v-if="isImageResponse"
                  :src="imageDataUrl"
                  alt="Response preview"
                  class="image-preview"
                />
                <pre v-else class="response-pre">{{ formattedBody }}</pre>
              </template>
              <el-empty v-else description="Hit Send to get a response" :image-size="60">
                <template #image>
                  <img src="/API-OPEN-LOGO.png" alt="Api-Open" style="width: 56px; opacity: 0.75" />
                </template>
              </el-empty>
            </el-tab-pane>

            <el-tab-pane :label="`Headers (${responseHeadersList.length})`" name="headers">
              <el-table :data="responseHeadersList" size="small" border>
                <el-table-column prop="key" label="Header" width="240" />
                <el-table-column prop="value" label="Value" />
              </el-table>
            </el-tab-pane>

            <el-tab-pane :label="`Cookies (${responseCookiesList.length})`" name="cookies">
              <el-table :data="responseCookiesList" size="small" border>
                <el-table-column prop="name" label="Name" width="180" />
                <el-table-column prop="value" label="Value" />
                <el-table-column prop="attributes" label="Attributes" />
              </el-table>
            </el-tab-pane>

            <el-tab-pane
              :label="`Tests (${passedTestsCount}/${tab.testResults.length})`"
              name="testResults"
            >
              <el-alert
                v-if="tab.scriptError"
                :title="tab.scriptError"
                type="error"
                show-icon
                :closable="false"
                style="margin-bottom: 8px"
              />
              <div v-if="tab.testResults.length" class="test-results-list">
                <div
                  v-for="(tr, idx) in tab.testResults"
                  :key="idx"
                  class="test-result-row"
                >
                  <el-tag :type="tr.passed ? 'success' : 'danger'" size="small">
                    {{ tr.passed ? 'PASS' : 'FAIL' }}
                  </el-tag>
                  <span>{{ tr.name }}</span>
                  <el-text v-if="tr.error" type="danger" size="small">
                    — {{ tr.error }}
                  </el-text>
                </div>
              </div>
              <el-empty
                v-else-if="!tab.scriptLogs.length && !tab.scriptError"
                description="No test assertions ran"
                :image-size="54"
              />
              <pre v-if="tab.scriptLogs.length" class="response-pre" style="margin-top: 8px">{{ tab.scriptLogs.join('\n') }}</pre>
            </el-tab-pane>
          </el-tabs>
        </div>
        </div>
        </template>
      </el-main>
    </el-container>

    <!-- Auth Dialog -->
    <el-dialog v-model="authDialogVisible" title="Account" width="min(92vw, 380px)">
      <div class="auth-banner">
        <img src="/API-OPEN-FULL-WARNA.jpg" alt="Api-Open" class="auth-banner-img" />
      </div>
      <el-tabs v-model="authMode" stretch>
        <el-tab-pane label="Sign In" name="login" />
        <el-tab-pane label="Register" name="register" />
      </el-tabs>
      <el-form label-position="top" @submit.prevent="handleAuthSubmit">
        <el-form-item label="Email">
          <el-input v-model="authEmail" type="email" placeholder="you@example.com" />
        </el-form-item>
        <el-form-item label="Password">
          <el-input v-model="authPassword" type="password" show-password />
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="authSubmitting"
          style="width: 100%"
        >
          {{ authMode === 'login' ? 'Sign In' : 'Create Account' }}
        </el-button>
      </el-form>

      <el-divider>or continue with</el-divider>
      <div class="oauth-buttons">
        <el-button @click="handleOAuthLogin('google')">Google</el-button>
        <el-button @click="handleOAuthLogin('github')">GitHub</el-button>
        <el-button @click="handleOAuthLogin('discord')">Discord</el-button>
      </div>
    </el-dialog>

    <!-- Save Request Dialog -->
    <el-dialog v-model="saveDialogVisible" title="Save Request" width="min(92vw, 400px)">
      <el-form label-position="top">
        <el-form-item label="Request Name">
          <el-input v-model="saveRequestName" />
        </el-form-item>
        <el-form-item label="Collection">
          <el-select v-model="saveCollectionId" style="width: 100%">
            <el-option
              v-for="c in ws.collections"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="saveDialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="confirmSaveRequest">Save</el-button>
      </template>
    </el-dialog>

    <!-- New Collection Dialog -->
    <el-dialog v-model="newCollectionVisible" title="New Collection" width="min(92vw, 360px)">
      <el-input v-model="newCollectionName" placeholder="Collection name" />
      <template #footer>
        <el-button @click="newCollectionVisible = false">Cancel</el-button>
        <el-button type="primary" @click="confirmCreateCollection">Create</el-button>
      </template>
    </el-dialog>

    <!-- Environments Dialog -->
    <el-dialog v-model="envDialogVisible" title="Manage Environments" width="min(94vw, 680px)">
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
      </div>

      <div v-if="ws.environments.length" class="env-editor">
        <div class="env-select-row">
          <el-select
            v-model="editingEnvId"
            size="small"
            @change="selectEnvForEdit"
            style="width: 220px"
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
            @click="ws.deleteEnvironment(editingEnvId)"
          >
            Delete Env
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
          <el-button size="small" type="primary" @click="saveEnvVars">
            Save Variables
          </el-button>
        </div>
      </div>
    </el-dialog>

    <!-- Import cURL Dialog -->
    <el-dialog v-model="curlDialogVisible" title="Import cURL" width="min(94vw, 560px)">
      <el-input
        v-model="curlInput"
        type="textarea"
        :rows="7"
        class="code-area"
        placeholder="Paste cURL command here (e.g. curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{&quot;name&quot;:&quot;test&quot;}')"
      />
      <template #footer>
        <el-button @click="curlDialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="handleImportCurl">Import</el-button>
      </template>
    </el-dialog>

    <!-- Code Snippet Dialog -->
    <el-dialog v-model="snippetDialogVisible" title="Generate Code Snippet" width="min(94vw, 620px)">
      <div class="body-controls">
        <el-select v-model="snippetLang" size="small" style="width: 200px">
          <el-option label="cURL" value="curl" />
          <el-option label="JavaScript (fetch)" value="fetch" />
          <el-option label="Axios" value="axios" />
          <el-option label="Go (net/http)" value="go" />
          <el-option label="Python (requests)" value="python" />
        </el-select>
        <el-button size="small" type="primary" @click="copyGeneratedCode">
          Copy Code
        </el-button>
      </div>
      <pre class="response-pre">{{ generatedCode }}</pre>
    </el-dialog>

    <CollectionRunnerDialog
      v-model:visible="runnerVisible"
      :collection-node="runnerTargetNode"
    />

    <!-- API Documentation Modal -->
    <el-dialog v-model="docsVisible" :title="`API Docs: ${docsTitle}`" width="min(94vw, 680px)">
      <div class="body-controls">
        <el-button size="small" type="primary" @click="downloadDocsMarkdown">
          Download .md
        </el-button>
      </div>
      <pre class="response-pre">{{ docsMarkdown }}</pre>
    </el-dialog>

    <!-- Team Workspace & Invite Modal -->
    <el-dialog v-model="teamDialogVisible" title="Team Workspaces & Members" width="min(94vw, 620px)">
      <div class="env-create-row">
        <el-input
          v-model="newTeamName"
          size="small"
          placeholder="New team workspace name"
          style="max-width: 240px"
        />
        <el-button size="small" type="primary" @click="handleCreateTeam">
          Create Team Workspace
        </el-button>
      </div>

      <el-divider>Invite Member to Current Workspace</el-divider>
      <div class="env-create-row">
        <el-input
          v-model="inviteEmail"
          size="small"
          placeholder="teammate@example.com"
          style="max-width: 240px"
        />
        <el-select v-model="inviteRole" size="small" style="width: 110px">
          <el-option label="Editor" value="EDITOR" />
          <el-option label="Viewer" value="VIEWER" />
          <el-option label="Owner" value="OWNER" />
        </el-select>
        <el-button
          size="small"
          type="primary"
          :loading="inviting"
          @click="handleInviteMember"
        >
          Send Invite
        </el-button>
      </div>

      <el-table :data="ws.members" size="small" border>
        <el-table-column label="Email" prop="user.email" />
        <el-table-column label="Role" prop="role" width="100" />
        <el-table-column width="70" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.userId !== ws.user?.id"
              :icon="Delete"
              link
              type="danger"
              size="small"
              @click="ws.removeMember(row.id)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- GraphQL Schema Introspection Modal -->
    <el-dialog v-model="gqlSchemaVisible" title="GraphQL Schema" width="min(94vw, 680px)">
      <el-tabs>
        <el-tab-pane :label="`Queries (${gqlQueries.length})`">
          <el-table :data="gqlQueries" size="small" border max-height="360">
            <el-table-column prop="name" label="Field" width="180" />
            <el-table-column prop="args" label="Arguments" />
            <el-table-column prop="returnType" label="Returns" width="160" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`Mutations (${gqlMutations.length})`">
          <el-table :data="gqlMutations" size="small" border max-height="360">
            <el-table-column prop="name" label="Field" width="180" />
            <el-table-column prop="args" label="Arguments" />
            <el-table-column prop="returnType" label="Returns" width="160" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
    <!-- Mobile Sidebar Drawer -->
    <el-drawer
      v-model="mobileSidebarVisible"
      title="Workspace"
      :direction="settings.sidebarPosition === 'right' ? 'rtl' : 'ltr'"
      size="290px"
    >
      <el-tabs v-model="sidebarTab" stretch>
        <el-tab-pane label="Collections" name="collections">
          <template v-if="ws.isAuthenticated">
            <div class="sidebar-toolbar">
              <el-text size="small" type="info">Collections</el-text>
              <div style="display: flex; gap: 4px; align-items: center">
                <el-button size="small" :icon="Upload" link type="primary" @click="triggerPostmanImport">
                  Postman
                </el-button>
                <el-button size="small" :icon="Plus" link type="primary" @click="newCollectionVisible = true">
                  New
                </el-button>
              </div>
            </div>
            <el-tree
              v-if="ws.collectionTree.length"
              :data="ws.collectionTree"
              node-key="id"
              default-expand-all
              @node-click="handleTreeNodeClick"
            />
            <el-empty v-else description="No collections yet" :image-size="54" />
          </template>
          <el-empty v-else description="Sign in to sync collections" :image-size="54">
            <el-button type="primary" size="small" @click="authDialogVisible = true; mobileSidebarVisible = false">
              Sign In
            </el-button>
          </el-empty>
        </el-tab-pane>
        <el-tab-pane label="History" name="history">
          <div v-if="store.history.length" class="history-list">
            <div
              v-for="item in store.history"
              :key="item.id"
              class="history-item"
              @click="store.addTab({ method: item.method, url: item.url, name: item.url }); mobileSidebarVisible = false"
            >
              <el-tag size="small" effect="plain">{{ item.method }}</el-tag>
              <span class="history-url">{{ item.url }}</span>
            </div>
          </div>
          <el-empty v-else description="No history yet" :image-size="54" />
        </el-tab-pane>
      </el-tabs>
    </el-drawer>

    <SettingsDialog
      v-model:visible="settingsVisible"
      :initial-tab="settingsInitialTab"
    />
  </el-container>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
}
</style>

<style scoped>
.app-shell {
  height: 100vh;
  background: #ffffff;
}
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid #e4e7ed;
  padding: 8px 16px;
  min-height: 48px;
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
}
.brand-full-logo {
  height: 32px;
  width: auto;
  border-radius: 6px;
  object-fit: contain;
  display: block;
}
.auth-banner {
  background: #1b2434;
  border-radius: 8px;
  padding: 10px 16px;
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
}
.auth-banner-img {
  height: 44px;
  object-fit: contain;
}
.top-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.top-select {
  width: 160px;
}
.main-body {
  overflow: hidden;
}
.main-body.sidebar-on-right {
  flex-direction: row-reverse;
}
.sidebar {
  border-right: 1px solid #e4e7ed;
  padding: 8px 12px;
  overflow-y: auto;
  flex-shrink: 0;
}
.sidebar-on-right .sidebar {
  border-right: none;
  border-left: 1px solid #e4e7ed;
}
.sidebar-resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  flex-shrink: 0;
}
.sidebar-resizer:hover {
  background: #409eff;
}
.request-response-split {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 4px;
}
.request-response-split.split-horizontal {
  flex-direction: row;
}
.request-pane {
  flex: 1;
  min-width: 0;
  min-height: 160px;
  overflow-y: auto;
}
.response-resizer {
  height: 5px;
  cursor: row-resize;
  background: transparent;
  border-radius: 4px;
  transition: background 0.15s;
  flex-shrink: 0;
}
.response-resizer.is-vertical {
  width: 5px;
  height: auto;
  cursor: col-resize;
}
.response-resizer:hover {
  background: #409eff;
}
.sidebar-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 6px;
}
.tree-label {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.tree-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tree-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.tree-text {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #f0f2f5;
}
.history-item:hover {
  background: #f5f7fa;
}
.history-url {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  overflow-y: auto;
}
.request-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.method-select {
  width: 120px;
  flex-shrink: 0;
}
.url-input {
  flex: 1;
  min-width: 180px;
}
.request-bar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.body-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.code-area :deep(textarea) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}
.gql-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.response-section {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-width: 220px;
  min-height: 160px;
}
.response-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}
.response-meta {
  display: flex;
  gap: 6px;
}
.response-pre {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 12px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12.5px;
  max-height: 360px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.image-preview {
  max-width: 100%;
  max-height: 320px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}
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
.oauth-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.oauth-buttons :deep(.el-button + .el-button) {
  margin-left: 0;
}
.test-results-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.test-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.binary-box {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
}

@media (max-width: 900px) {
  .desktop-sidebar {
    display: none;
  }
  .mobile-menu-btn {
    display: inline-flex;
  }
  .top-select {
    width: 130px;
  }
}

@media (max-width: 640px) {
  .top-bar {
    padding: 8px 12px;
  }
  .workspace {
    padding: 10px 12px;
  }
  .request-bar {
    flex-wrap: wrap;
  }
  .method-select {
    width: 105px;
  }
  .request-bar-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .gql-grid {
    grid-template-columns: 1fr;
  }
  .response-header {
    flex-wrap: wrap;
    gap: 8px;
  }
  .env-create-row,
  .env-select-row,
  .env-actions {
    flex-wrap: wrap;
  }
  .request-response-split.split-horizontal {
    flex-direction: column;
  }
  .response-section {
    width: 100% !important;
    height: auto !important;
  }
}

:global(html.dark) .app-shell {
  background: #141414;
  color: #e5eaf3;
}
:global(html.dark) .top-bar,
:global(html.dark) .sidebar {
  border-color: #303030;
}
:global(html.dark) .response-pre {
  background: #1d1e1f;
  border-color: #363637;
  color: #e5eaf3;
}
:global(html.dark) .history-item {
  border-color: #2b2b2c;
}
:global(html.dark) .history-item:hover {
  background: #262727;
}
</style>
