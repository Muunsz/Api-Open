<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { HttpMethod } from '@api-open/shared';
import { FolderChecked, House, Key, Promotion } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { workspaceApi } from './api/workspace';
import AuthDialogs from './components/AuthDialogs.vue';
import AdminBackpanel from './components/AdminBackpanel.vue';
import CollectionRunnerDialog from './components/CollectionRunnerDialog.vue';
import ConsoleDrawer from './components/ConsoleDrawer.vue';
import CookiesDialog from './components/CookiesDialog.vue';
import EnvironmentDialog from './components/EnvironmentDialog.vue';
import RealtimePanel from './components/RealtimePanel.vue';
import RequestEditorPane from './components/RequestEditorPane.vue';
import ResponseViewerPane from './components/ResponseViewerPane.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import StatusFooter from './components/StatusFooter.vue';
import SupportDialog from './components/SupportDialog.vue';
import TeamWorkspaceDialog from './components/TeamWorkspaceDialog.vue';
import TopHeaderBar from './components/TopHeaderBar.vue';
import VariablesDrawer from './components/VariablesDrawer.vue';
import WorkspaceModals from './components/WorkspaceModals.vue';
import Base64ImageDialog from './components/modals/Base64ImageDialog.vue';
import WorkspaceOverviewPane from './components/WorkspaceOverviewPane.vue';
import WorkspaceSidebar from './components/WorkspaceSidebar.vue';
import DevToolboxDialog from './components/modals/DevToolboxDialog.vue';
import PluginMarketplaceDialog from './components/modals/PluginMarketplaceDialog.vue';
import TrashDialog from './components/modals/TrashDialog.vue';
import WebhookBinDialog from './components/modals/WebhookBinDialog.vue';
import { toggleCommentOnSelection } from './utils/editorComments';
import {
  downloadBlobFile,
  exportAllCollectionsAsFormat,
  exportAllCollectionsBundle,
  exportCollectionAsFormat,
  exportSingleCollectionOpenApi,
  exportSingleCollectionPostman,
  type CollectionExportFormat,
} from './services/exportService';
import { useConsoleStore } from './stores/console';
import { useSettingsStore } from './stores/settings';
import { useTabsStore } from './stores/tabs';
import {
  type CollectionDto,
  type CollectionTreeNode,
  useWorkspaceStore,
} from './stores/workspace';
import type { ClientProtocol, UrlEnvChip } from './types/app';
import { generateCollectionDocsMarkdown } from './utils/docsGenerator';
import type { GqlFieldSummary } from './utils/graphqlIntrospection';
import { resolveDynamicVariable, resolveVariables } from './utils/variables';

const store = useTabsStore();
const ws = useWorkspaceStore();
const settings = useSettingsStore();
const consoleStore = useConsoleStore();

const methods: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

const mobileSidebarVisible = ref(false);
const savedProtocol = localStorage.getItem('api_open_protocol_v1');
const clientProtocol = ref<ClientProtocol>(
  savedProtocol === 'graphql' ||
    savedProtocol === 'ws' ||
    savedProtocol === 'sse'
    ? savedProtocol
    : 'http',
);

const activeRequestTab = ref('params');

watch(clientProtocol, (val) => {
  try {
    localStorage.setItem('api_open_protocol_v1', val);
  } catch {
    // ignore
  }
  if (val === 'graphql' && store.activeTab) {
    store.activeTab.method = 'POST';
    store.activeTab.body.mode = 'graphql';
    activeRequestTab.value = 'body';
  }
});

// Dialog & drawer visibility states
const authDialogVisible = ref(false);
const setPasswordDialogVisible = ref(false);
const saveDialogVisible = ref(false);
const saveRequestName = ref('');
const saveCollectionId = ref('');
const newCollectionVisible = ref(false);
const envDialogVisible = ref(false);
const envDialogInitialId = ref<string | undefined>(undefined);
const curlDialogVisible = ref(false);
const snippetDialogVisible = ref(false);
const runnerVisible = ref(false);
const runnerTargetNode = ref<CollectionTreeNode | null>(null);
const docsVisible = ref(false);
const docsCollectionId = ref<string | undefined>(undefined);
const docsTitle = ref('');
const docsMarkdown = ref('');
const teamDialogVisible = ref(false);
const gqlSchemaVisible = ref(false);
const gqlQueries = ref<GqlFieldSummary[]>([]);
const gqlMutations = ref<GqlFieldSummary[]>([]);
const settingsVisible = ref(false);
const settingsInitialTab = ref<'layout' | 'profile'>('layout');
const searchDialogVisible = ref(false);
const shortcutsDialogVisible = ref(false);
const toolboxVisible = ref(false);
const webhookBinVisible = ref(false);
const trashVisible = ref(false);
const marketplaceVisible = ref(false);
const cookiesDialogVisible = ref(false);
const variablesDrawerVisible = ref(false);
const supportDialogVisible = ref(false);
const consoleDrawerVisible = ref(false);
const footerBase64DialogVisible = ref(false);
const downloadAppDialogVisible = ref(false);
const collectionSettingsVisible = ref(false);
const collectionSettingsTarget = ref<CollectionDto | null>(null);
const specViewerVisible = ref(false);
const monitorsVisible = ref(false);
const flowsVisible = ref(false);
const dbClientVisible = ref(false);
const schemasVisible = ref(false);
const proxyRecorderVisible = ref(false);
const snapshotsVisible = ref(false);
const snapshotsTarget = ref<CollectionDto | null>(null);

interface DesktopUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updateMode?: 'in_app' | 'reinstall';
  updateNotice?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  assetName?: string;
  error?: string;
}

interface DesktopUpdateProgress {
  percent: number;
  receivedBytes: number;
  totalBytes: number;
}

interface DesktopBridge {
  isDesktop?: boolean;
  checkForUpdates?: () => Promise<DesktopUpdateInfo>;
  downloadUpdate?: (payload: {
    url: string;
    fileName?: string;
    mode?: 'in_app' | 'reinstall';
  }) => Promise<{
    ok: boolean;
    installing?: boolean;
    requiresReinstall?: boolean;
    filePath?: string;
    openedExternal?: boolean;
    error?: string;
  }>;
  onUpdateAvailable?: (cb: (info: DesktopUpdateInfo) => void) => () => void;
  onUpdateProgress?: (cb: (progress: DesktopUpdateProgress) => void) => () => void;
  onDeepLink?: (cb: (url: string) => void) => () => void;
}

const desktopUpdateVisible = ref(false);
const desktopUpdateInfo = ref<DesktopUpdateInfo | null>(null);
const desktopUpdateDownloading = ref(false);
const desktopUpdateProgress = ref<DesktopUpdateProgress | null>(null);
let cleanupUpdateListener: (() => void) | null = null;
let cleanupUpdateProgressListener: (() => void) | null = null;
let cleanupDeepLinkListener: (() => void) | null = null;

function checkIsBackpanelUrl(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '');
  return (
    path.endsWith('/backpanel') ||
    window.location.hash.startsWith('#/backpanel')
  );
}

const isBackpanelRoute = ref(checkIsBackpanelUrl());
let endKeyPressCount = 0;
let lastEndKeyPressAt = 0;

function openBackpanel() {
  isBackpanelRoute.value = true;
  if (window.location.protocol === 'file:') {
    window.location.hash = '#/backpanel';
  } else if (!window.location.pathname.replace(/\/+$/, '').endsWith('/backpanel')) {
    window.history.pushState({}, '', '/backpanel');
  }
}

function exitBackpanel() {
  isBackpanelRoute.value = false;
  if (window.location.protocol === 'file:') {
    if (window.location.hash.startsWith('#/backpanel')) {
      window.location.hash = '';
    }
  } else if (window.location.pathname.replace(/\/+$/, '').endsWith('/backpanel')) {
    window.history.pushState({}, '', '/');
  }
}

function handleRouteChange() {
  isBackpanelRoute.value = checkIsBackpanelUrl();
}

async function handleManualCheckUpdates() {
  const bridge = (window as unknown as { apiOpenDesktop?: DesktopBridge })
    .apiOpenDesktop;
  if (!bridge?.checkForUpdates) return;
  const info = await bridge.checkForUpdates();
  if (info.updateAvailable) {
    localStorage.removeItem('api_open_skipped_update_version');
    desktopUpdateInfo.value = info;
    desktopUpdateVisible.value = true;
  } else if (info.error) {
    ElMessage.warning(`Update check failed: ${info.error}`);
  } else {
    ElMessage.success(`You're on the latest version (v${info.currentVersion})`);
  }
}

function showDesktopUpdatePrompt(info: DesktopUpdateInfo | null | undefined) {
  if (!info?.updateAvailable) return;
  const skipped = localStorage.getItem('api_open_skipped_update_version');
  if (skipped === info.latestVersion) return;
  desktopUpdateInfo.value = info;
  desktopUpdateVisible.value = true;
}

function skipDesktopUpdateVersion() {
  if (desktopUpdateInfo.value?.latestVersion) {
    localStorage.setItem(
      'api_open_skipped_update_version',
      desktopUpdateInfo.value.latestVersion,
    );
  }
  desktopUpdateVisible.value = false;
}

async function installDesktopUpdate() {
  const info = desktopUpdateInfo.value;
  if (!info?.downloadUrl) return;
  const bridge = (window as unknown as { apiOpenDesktop?: DesktopBridge })
    .apiOpenDesktop;
  if (!bridge?.downloadUpdate) {
    window.open(info.releaseUrl || info.downloadUrl, '_blank', 'noopener');
    return;
  }
  desktopUpdateDownloading.value = true;
  desktopUpdateProgress.value = { percent: 0, receivedBytes: 0, totalBytes: 0 };
  try {
    const res = await bridge.downloadUpdate({
      url: info.downloadUrl,
      fileName: info.assetName,
      mode: info.updateMode,
    });
    if (res.ok && res.installing) {
      ElMessage.success(
        'Installing update in background... Api-Open will restart automatically.',
      );
    } else if (res.ok && res.requiresReinstall) {
      ElMessage.warning(
        'Installer downloaded to Downloads. Please uninstall/close the current app, then run the new installer.',
      );
      desktopUpdateVisible.value = false;
    } else if (res.ok) {
      ElMessage.success(
        'Update downloaded! Follow the installer to finish updating.',
      );
      desktopUpdateVisible.value = false;
    } else if (res.openedExternal) {
      ElMessage.info('Opened update download in your browser.');
      desktopUpdateVisible.value = false;
    } else {
      ElMessage.error(res.error || 'Failed to download update');
    }
  } finally {
    desktopUpdateDownloading.value = false;
  }
}
const gitSyncVisible = ref(false);
const splitViewEnabled = ref(false);
const secondaryTabId = ref('');
const publicDocsData = ref<{
  id: string;
  name: string;
  requests: Array<{ id: string; name: string; method: string; url: string }>;
  folders: Array<{ id: string; name: string; requests: Array<{ id: string; name: string; method: string; url: string }> }>;
} | null>(null);
const overviewTabActive = ref(false);

const splitContainerRef = ref<HTMLElement | null>(null);
const urlInputRef = ref<{ focus?: () => void } | null>(null);
const urlFocused = ref(false);
const editingVarKey = ref<string | null>(null);
const editingVarValue = ref('');
const sidebarRef = ref<{
  triggerPostmanImport?: () => void;
  triggerOpenApiImport?: () => void;
} | null>(null);

watch(
  () => store.activeTabId,
  () => {
    overviewTabActive.value = false;
  },
);

function openOverviewTab() {
  overviewTabActive.value = true;
}

const workspaceSummary = ref(
  localStorage.getItem('api_open_workspace_summary_v1') ?? '',
);
const workspaceReadme = ref(
  localStorage.getItem('api_open_workspace_readme_v1') ?? '',
);

const tab = computed(() => store.activeTab);

const isResponseHorizontal = computed(
  () =>
    settings.responsePosition === 'left' ||
    settings.responsePosition === 'right',
);

let syncingUrl = false;
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

function startResponseResize(e: MouseEvent) {
  e.preventDefault();
  const container = splitContainerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();

  const onMove = (ev: MouseEvent) => {
    let pct = settings.responseSizePercent;
    if (settings.responsePosition === 'right') {
      pct = ((rect.right - ev.clientX) / rect.width) * 100;
    } else if (settings.responsePosition === 'left') {
      pct = ((ev.clientX - rect.left) / rect.width) * 100;
    } else if (settings.responsePosition === 'bottom') {
      pct = ((rect.bottom - ev.clientY) / rect.height) * 100;
    } else {
      pct = ((ev.clientY - rect.top) / rect.height) * 100;
    }
    settings.responseSizePercent = Math.round(Math.min(75, Math.max(25, pct)));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function cycleMethod(dir: 1 | -1) {
  if (!tab.value) return;
  const idx = methods.indexOf(tab.value.method);
  const nextIdx = (idx + dir + methods.length) % methods.length;
  tab.value.method = methods[nextIdx];
}

async function copyActiveResponse() {
  const res = tab.value?.response;
  if (!res) return;
  await navigator.clipboard.writeText(res.body);
  ElMessage.success('Response copied to clipboard');
}

function downloadActiveResponse() {
  const res = tab.value?.response;
  if (!res) return;
  downloadBlobFile(
    res.body,
    `response-${Date.now()}.json`,
    res.headers['content-type'] || 'text/plain',
  );
}

async function shareActiveRequest() {
  if (!tab.value) return;
  const payload = JSON.stringify(
    {
      name: tab.value.name,
      method: tab.value.method,
      url: tab.value.url,
      headers: tab.value.headers,
      queryParams: tab.value.queryParams,
      body: tab.value.body,
    },
    null,
    2,
  );
  await navigator.clipboard.writeText(payload);
  ElMessage.success('Request JSON copied to clipboard for sharing');
}

function openSettings(tabName: 'layout' | 'profile' = 'layout') {
  settingsInitialTab.value = tabName;
  settingsVisible.value = true;
}

function handleGlobalKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const targetTag = (e.target as HTMLElement | null)?.tagName;
  const isTyping =
    targetTag === 'INPUT' ||
    targetTag === 'TEXTAREA' ||
    (e.target as HTMLElement | null)?.isContentEditable;

  // Hidden Admin Backpanel trigger: press End 5 times consecutively
  if (!mod && !e.altKey && !e.shiftKey && e.key === 'End' && !isTyping) {
    const now = Date.now();
    if (now - lastEndKeyPressAt <= 2500) {
      endKeyPressCount += 1;
    } else {
      endKeyPressCount = 1;
    }
    lastEndKeyPressAt = now;
    if (endKeyPressCount >= 5) {
      endKeyPressCount = 0;
      e.preventDefault();
      if (isBackpanelRoute.value) exitBackpanel();
      else openBackpanel();
      return;
    }
  } else if (e.key !== 'End') {
    endKeyPressCount = 0;
  }

  if (!mod && !e.altKey && e.key === '?' && !isTyping) {
    e.preventDefault();
    shortcutsDialogVisible.value = true;
    return;
  }

  if (mod && key === 'k') {
    e.preventDefault();
    searchDialogVisible.value = true;
    return;
  }
  if (mod && key === 'enter') {
    e.preventDefault();
    if (
      clientProtocol.value === 'http' ||
      clientProtocol.value === 'graphql'
    ) {
      store.sendActiveRequest();
    }
    return;
  }
  if (mod && key === 's') {
    e.preventDefault();
    handleSaveClick();
    return;
  }
  if (mod && key === 'u') {
    e.preventDefault();
    shareActiveRequest();
    return;
  }
  if (mod && key === 'j') {
    e.preventDefault();
    downloadActiveResponse();
    return;
  }
  if (mod && e.key === '.') {
    e.preventDefault();
    copyActiveResponse();
    return;
  }
  if (mod && key === 'l') {
    e.preventDefault();
    urlInputRef.value?.focus?.();
    return;
  }
  if (mod && key === 'd') {
    e.preventDefault();
    if (tab.value) store.closeTab(tab.value.id);
    return;
  }
  if (mod && key === 'm') {
    e.preventDefault();
    if (ws.isAuthenticated) teamDialogVisible.value = true;
    else authDialogVisible.value = true;
    return;
  }
  if ((e.altKey && key === 't') || (mod && e.altKey && key === 'n')) {
    e.preventDefault();
    store.addTab();
    return;
  }
  if (mod && key === 'b') {
    e.preventDefault();
    settings.sidebarHidden = !settings.sidebarHidden;
    return;
  }
  if (mod && key === 'i') {
    e.preventDefault();
    curlDialogVisible.value = true;
    return;
  }
  if (mod && key === ',') {
    e.preventDefault();
    openSettings('layout');
    return;
  }
  if (mod && e.shiftKey && (e.key === '?' || e.key === '/' || e.code === 'Slash')) {
    e.preventDefault();
    shortcutsDialogVisible.value = true;
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && (e.key === '/' || e.code === 'Slash')) {
    const targetEl = e.target as HTMLElement | null;
    if (
      targetEl instanceof HTMLTextAreaElement ||
      (targetEl instanceof HTMLInputElement &&
        ['text', 'search', 'url', 'email', ''].includes(targetEl.type))
    ) {
      if (targetEl.readOnly || targetEl.disabled) return;
      e.preventDefault();
      const { nextValue, nextStart, nextEnd } = toggleCommentOnSelection(
        targetEl.value,
        targetEl.selectionStart ?? 0,
        targetEl.selectionEnd ?? 0,
        'text',
      );
      targetEl.value = nextValue;
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      nextTick(() => {
        targetEl.setSelectionRange(nextStart, nextEnd);
      });
    }
    return;
  }

  if (e.altKey && !mod) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cycleMethod(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cycleMethod(1);
    } else if (key === 'g' && tab.value) {
      e.preventDefault();
      tab.value.method = 'GET';
    } else if (key === 'h' && tab.value) {
      e.preventDefault();
      tab.value.method = 'HEAD';
    } else if (key === 'p' && tab.value) {
      e.preventDefault();
      tab.value.method = 'POST';
    } else if (key === 'u' && tab.value) {
      e.preventDefault();
      tab.value.method = 'PUT';
    } else if (key === 'x' && tab.value) {
      e.preventDefault();
      tab.value.method = 'DELETE';
    } else if (key === 'r') {
      e.preventDefault();
      clientProtocol.value = 'http';
    } else if (key === 'w') {
      e.preventDefault();
      clientProtocol.value = 'ws';
    } else if (key === 's') {
      e.preventDefault();
      openSettings('layout');
    } else if (key === 'm') {
      e.preventDefault();
      openSettings('profile');
    }
  }
}

onMounted(async () => {
  const pubId = new URLSearchParams(window.location.search).get('publicDocs');
  if (pubId) {
    try {
      publicDocsData.value = await workspaceApi.getPublicDocs(pubId);
    } catch {
      ElMessage.error('Public documentation not found');
    }
  }
  ws.initAuth();
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('popstate', handleRouteChange);
  window.addEventListener('hashchange', handleRouteChange);

  const desktopBridge = (window as unknown as { apiOpenDesktop?: DesktopBridge })
    .apiOpenDesktop;
  if (desktopBridge?.isDesktop) {
    if (desktopBridge.onUpdateAvailable) {
      cleanupUpdateListener = desktopBridge.onUpdateAvailable((info) => {
        showDesktopUpdatePrompt(info);
      });
    }
    if (desktopBridge.onUpdateProgress) {
      cleanupUpdateProgressListener = desktopBridge.onUpdateProgress((progress) => {
        desktopUpdateProgress.value = progress;
      });
    }
    if (desktopBridge.onDeepLink) {
      cleanupDeepLinkListener = desktopBridge.onDeepLink((url) => {
        ws.handleDeepLinkCallback(url);
      });
    }
    if (desktopBridge.checkForUpdates) {
      desktopBridge.checkForUpdates().then((info) => {
        showDesktopUpdatePrompt(info);
      }).catch(() => {});
    }
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('popstate', handleRouteChange);
  window.removeEventListener('hashchange', handleRouteChange);
  cleanupUpdateListener?.();
  cleanupUpdateListener = null;
  cleanupUpdateProgressListener?.();
  cleanupUpdateProgressListener = null;
  cleanupDeepLinkListener?.();
  cleanupDeepLinkListener = null;
});

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

async function handleSaveClick() {
  if (!ws.isAuthenticated) {
    authDialogVisible.value = true;
    ElMessage.info('Sign in first to save requests to Supabase');
    return;
  }
  if (tab.value?.savedRequestId) {
    await store.saveActiveTab();
    ElMessage.success('Request updated');
    return;
  }
  saveRequestName.value = tab.value?.name || 'New Request';
  saveCollectionId.value = ws.collections[0]?.id ?? '';
  saveDialogVisible.value = true;
}

function openRunner(node: CollectionTreeNode) {
  runnerTargetNode.value = node;
  runnerVisible.value = true;
}

function handleExportCollection(node: CollectionTreeNode) {
  exportSingleCollectionPostman(node);
  consoleStore.addLog({
    type: 'activity',
    message: `Exported collection "${node.label}"`,
  });
}

function handleExportOpenApi(node: CollectionTreeNode, format: 'json' | 'yaml') {
  exportSingleCollectionOpenApi(node, format);
  consoleStore.addLog({
    type: 'activity',
    message: `Exported OpenAPI 3.0 (${format.toUpperCase()}) for "${node.label}"`,
  });
}

function handleExportFormat(node: CollectionTreeNode, format: CollectionExportFormat) {
  exportCollectionAsFormat(node, format);
  consoleStore.addLog({
    type: 'activity',
    message: `Exported "${node.label}" as ${format}`,
  });
}

function handleExportAllFormat(format: CollectionExportFormat) {
  if (!ws.collectionTree.length) {
    ElMessage.warning('No collections to export');
    return;
  }
  const workspaceName =
    ws.workspaces.find((w) => w.id === ws.activeWorkspaceId)?.name ??
    'Workspace';
  exportAllCollectionsAsFormat(workspaceName, ws.collectionTree, format);
  ElMessage.success(`Exported all collections as ${format}`);
}

function openCollectionSettings(col: CollectionDto) {
  collectionSettingsTarget.value = col;
  collectionSettingsVisible.value = true;
}

function exportAllCollections() {
  if (!ws.collectionTree.length) {
    ElMessage.warning('No collections to export');
    return;
  }
  const workspaceName =
    ws.workspaces.find((w) => w.id === ws.activeWorkspaceId)?.name ??
    'Workspace';
  exportAllCollectionsBundle(workspaceName, ws.collectionTree);
  consoleStore.addLog({
    type: 'activity',
    message: `Exported ${ws.collectionTree.length} collection(s)`,
  });
  ElMessage.success(`Exported ${ws.collectionTree.length} collection(s)`);
}

function openDocsModal(node: CollectionTreeNode) {
  docsCollectionId.value = node.collection?.id;
  docsTitle.value = node.label;
  docsMarkdown.value = generateCollectionDocsMarkdown(node);
  docsVisible.value = true;
}

function openSnapshots(col: CollectionDto) {
  snapshotsTarget.value = col;
  snapshotsVisible.value = true;
}

function toggleSplitView() {
  splitViewEnabled.value = !splitViewEnabled.value;
  if (splitViewEnabled.value && !secondaryTabId.value) {
    const other = store.tabs.find((t) => t.id !== store.activeTabId);
    secondaryTabId.value = other?.id ?? store.activeTabId;
  }
}

const secondaryTab = computed(() =>
  store.tabs.find((t) => t.id === secondaryTabId.value) ?? store.tabs[0],
);

function handleOpenGqlSchema(payload: {
  queries: GqlFieldSummary[];
  mutations: GqlFieldSummary[];
}) {
  gqlQueries.value = payload.queries;
  gqlMutations.value = payload.mutations;
  gqlSchemaVisible.value = true;
}

const effectiveVariablesMap = computed<Record<string, string>>(() => {
  const vaultMap: Record<string, string> = {};
  for (const v of consoleStore.localVault) {
    if (v.enabled && v.key.trim()) {
      vaultMap[v.key.trim()] = v.value ?? '';
    }
  }
  return {
    ...ws.activeVariablesMap,
    ...vaultMap,
    ...store.runtimeEnvOverrides,
  };
});

const showUrlEnvPreview = computed(() =>
  Boolean(tab.value?.url && /\{\{.+?\}\}/.test(tab.value.url)),
);

const resolvedUrlPreview = computed(() => {
  if (!tab.value?.url) return '';
  return resolveVariables(tab.value.url.trim(), effectiveVariablesMap.value);
});

const hasUnresolvedUrlVars = computed(() =>
  /\{\{.+?\}\}/.test(resolvedUrlPreview.value),
);

interface UrlSegment {
  text: string;
  isVar: boolean;
  key: string;
  value: string;
  found: boolean;
  isDynamic: boolean;
}

const urlSegments = computed<UrlSegment[]>(() => {
  const url = tab.value?.url ?? '';
  if (!url) return [];
  const parts = url.split(/(\{\{\s*\$?[a-zA-Z0-9_.-]+\s*\}\})/g);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      const m = part.match(/^\{\{\s*(\$?[a-zA-Z0-9_.-]+)\s*\}\}$/);
      if (!m) {
        return {
          text: part,
          isVar: false,
          key: '',
          value: '',
          found: false,
          isDynamic: false,
        };
      }
      const key = m[1];
      const hasStatic = Object.prototype.hasOwnProperty.call(
        effectiveVariablesMap.value,
        key,
      );
      if (hasStatic) {
        return {
          text: part,
          isVar: true,
          key,
          value: effectiveVariablesMap.value[key],
          found: true,
          isDynamic: false,
        };
      }
      if (key.startsWith('$')) {
        const dynVal = resolveDynamicVariable(key);
        if (dynVal !== undefined) {
          return {
            text: part,
            isVar: true,
            key,
            value: `${dynVal} (dynamic)`,
            found: true,
            isDynamic: true,
          };
        }
      }
      return {
        text: part,
        isVar: true,
        key,
        value: '',
        found: false,
        isDynamic: false,
      };
    });
});

function focusUrlInput() {
  urlFocused.value = true;
  nextTick(() => {
    urlInputRef.value?.focus?.();
  });
}

function openInlineVarEdit(key: string) {
  editingVarKey.value = key;
  editingVarValue.value = effectiveVariablesMap.value[key] ?? '';
}

async function saveInlineVarEdit() {
  const key = editingVarKey.value?.trim();
  if (!key) return;
  const val = editingVarValue.value;

  const activeEnv = ws.environments.find((e) => e.id === ws.activeEnvId);
  if (activeEnv) {
    const nextVars = activeEnv.variables.map((v) => ({ ...v }));
    const existing = nextVars.find((v) => v.key.trim() === key);
    if (existing) {
      existing.value = val;
      existing.enabled = true;
    } else {
      nextVars.push({
        id: Math.random().toString(36).slice(2, 10),
        key,
        value: val,
        isSecret: false,
        enabled: true,
      });
    }
    await ws.updateEnvironment(activeEnv.id, { variables: nextVars });
  } else {
    const existingVault = consoleStore.localVault.find(
      (v) => v.key.trim() === key,
    );
    if (existingVault) {
      existingVault.value = val;
      existingVault.enabled = true;
    } else {
      consoleStore.localVault.push({
        id: Math.random().toString(36).slice(2, 10),
        key,
        value: val,
        isSecret: false,
        enabled: true,
      });
    }
    store.runtimeEnvOverrides = {
      ...store.runtimeEnvOverrides,
      [key]: val,
    };
  }

  editingVarKey.value = null;
  ElMessage.success(`Updated {{${key}}}`);
}

async function openEnvDialog(envId?: string) {
  if (ws.isAuthenticated && ws.activeWorkspaceId && !ws.environments.length) {
    try {
      await ws.loadWorkspaceData(ws.activeWorkspaceId);
    } catch {
      // ignore
    }
  }
  envDialogInitialId.value = envId;
  envDialogVisible.value = true;
}
</script>

<template>
  <AdminBackpanel v-if="isBackpanelRoute" @exit="exitBackpanel" />
  <div
    v-else-if="publicDocsData"
    style="min-height: 100vh; padding: 32px; max-width: 960px; margin: 0 auto; background: var(--ao-bg); color: var(--ao-text)"
  >
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <h1 style="margin: 0">{{ publicDocsData.name }} — API Documentation</h1>
      <el-button size="small" @click="publicDocsData = null">Open App</el-button>
    </div>
    <div
      v-for="req in publicDocsData.requests"
      :key="req.id"
      style="padding: 12px 16px; border: 1px solid var(--ao-border); border-radius: 8px; margin-bottom: 10px; background: var(--ao-surface)"
    >
      <div style="display: flex; align-items: center; gap: 10px">
        <span class="method-badge" :class="`method-${req.method}`">{{ req.method }}</span>
        <strong>{{ req.name }}</strong>
        <code>{{ req.url }}</code>
      </div>
    </div>
    <div v-for="fld in publicDocsData.folders" :key="fld.id" style="margin-top: 20px">
      <h3>{{ fld.name }}</h3>
      <div
        v-for="req in fld.requests"
        :key="req.id"
        style="padding: 12px 16px; border: 1px solid var(--ao-border); border-radius: 8px; margin-bottom: 10px; background: var(--ao-surface)"
      >
        <div style="display: flex; align-items: center; gap: 10px">
          <span class="method-badge" :class="`method-${req.method}`">{{ req.method }}</span>
          <strong>{{ req.name }}</strong>
          <code>{{ req.url }}</code>
        </div>
      </div>
    </div>
  </div>

  <el-container v-else class="app-shell">
    <div v-if="ws.isBusy || tab?.loading" class="global-loading-bar" />
    <div v-if="ws.operationProgress.active" class="global-progress-toast">
      <div class="global-progress-header">
        <span class="global-progress-title">{{ ws.operationProgress.label }}</span>
        <span class="global-progress-pct">{{ ws.operationProgress.percent }}%</span>
      </div>
      <el-progress
        :percentage="ws.operationProgress.percent"
        :stroke-width="8"
        :show-text="false"
        striped
        striped-flow
      />
      <div class="global-progress-detail">
        <span>{{ ws.operationProgress.detail }}</span>
        <span>{{ ws.operationProgress.current }}/{{ ws.operationProgress.total }}</span>
      </div>
    </div>
    <div
      class="shell-content"
      :class="{ 'navbar-bottom': settings.navbarPosition === 'bottom' }"
    >
      <TopHeaderBar
        v-model:protocol="clientProtocol"
        @open-mobile-sidebar="mobileSidebarVisible = true"
        @open-search="searchDialogVisible = true"
        @open-download-app="downloadAppDialogVisible = true"
        @open-env-dialog="openEnvDialog"
        @open-settings="openSettings"
        @open-overview="openOverviewTab"
        @open-team="teamDialogVisible = true"
        @open-set-password="setPasswordDialogVisible = true"
        @open-variables="variablesDrawerVisible = true"
        @open-console="consoleDrawerVisible = true"
        @open-auth="authDialogVisible = true"
      />

      <el-container
        class="main-body"
        :class="`sidebar-pos-${settings.sidebarPosition}`"
      >
        <WorkspaceSidebar
          ref="sidebarRef"
          :workspace-summary="workspaceSummary"
          @open-curl="curlDialogVisible = true"
          @share-request="shareActiveRequest"
          @open-snippet="snippetDialogVisible = true"
          @export-all="exportAllCollections"
          @export-all-format="handleExportAllFormat"
          @open-new-collection="newCollectionVisible = true"
          @open-runner="openRunner"
          @open-docs="openDocsModal"
          @export-collection="handleExportCollection"
          @export-openapi="handleExportOpenApi"
          @export-format="handleExportFormat"
          @open-collection-settings="openCollectionSettings"
          @open-snapshots="openSnapshots"
          @open-spec-viewer="specViewerVisible = true"
          @open-monitors="monitorsVisible = true"
          @open-flows="flowsVisible = true"
          @open-db-client="dbClientVisible = true"
          @open-schemas="schemasVisible = true"
          @open-proxy-recorder="proxyRecorderVisible = true"
          @open-git-sync="gitSyncVisible = true"
          @open-env-dialog="openEnvDialog()"
          @open-overview="openOverviewTab"
          @open-variables="variablesDrawerVisible = true"
          @open-auth="authDialogVisible = true"
          @open-toolbox="toolboxVisible = true"
          @open-webhook-bin="webhookBinVisible = true"
          @open-trash="trashVisible = true"
          @open-marketplace="marketplaceVisible = true"
        />

        <el-main v-if="tab" class="workspace">
          <RealtimePanel
            v-show="clientProtocol === 'ws' || clientProtocol === 'sse'"
            :protocol="clientProtocol === 'sse' ? 'sse' : 'ws'"
          />

          <div v-show="clientProtocol === 'http'" class="workspace-http-wrap">
            <div class="workspace-tab-header">
              <button
                type="button"
                class="overview-pill-btn"
                :class="{ active: overviewTabActive }"
                title="Workspace Overview"
                @click="openOverviewTab"
              >
                <el-icon><House /></el-icon>
                <span>Overview</span>
              </button>

              <el-tabs
                v-model="store.activeTabId"
                type="card"
                editable
                class="request-doc-tabs"
                :class="{ 'overview-is-active': overviewTabActive }"
                @edit="handleTabEdit"
                @tab-click="overviewTabActive = false"
              >
                <el-tab-pane
                  v-for="t in store.tabs"
                  :key="t.id"
                  :name="t.id"
                >
                  <template #label>
                    <span
                      style="
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                      "
                    >
                      <span class="method-badge" :class="`method-${t.method}`">
                        {{ t.method }}
                      </span>
                      <span>
                        {{
                          t.savedRequestId
                            ? t.name
                            : t.url
                              ? t.url.replace(/^https?:\/\//, '').slice(0, 20)
                              : t.name
                        }}
                      </span>
                    </span>
                  </template>
                </el-tab-pane>
              </el-tabs>

              <div class="workspace-tab-right">
                <el-tag
                  v-if="!ws.isOnline || ws.offlineQueue.length"
                  size="small"
                  :type="ws.isOnline ? 'warning' : 'danger'"
                >
                  {{ ws.isOnline ? `Syncing (${ws.offlineQueue.length})` : 'Offline' }}
                </el-tag>
                <el-button
                  size="small"
                  :type="splitViewEnabled ? 'primary' : 'default'"
                  plain
                  title="Multi-Tab Split View (Side-by-Side)"
                  @click="toggleSplitView"
                >
                  Split
                </el-button>
                <el-button
                  size="small"
                  plain
                  :icon="Key"
                  title="All Variables & Local Vault"
                  @click="variablesDrawerVisible = true"
                >
                  Vars
                </el-button>
              </div>
            </div>

            <WorkspaceOverviewPane
              v-if="overviewTabActive"
              :summary="workspaceSummary"
              :readme="workspaceReadme"
              @update:summary="workspaceSummary = $event"
              @update:readme="workspaceReadme = String($event)"
              @close-overview="overviewTabActive = false"
              @export-all="exportAllCollections"
              @open-runner="openRunner"
              @open-docs="openDocsModal"
              @export-collection="handleExportCollection"
              @open-envs="openEnvDialog()"
              @open-vars="variablesDrawerVisible = true"
              @open-team="teamDialogVisible = true"
            />

            <div v-else class="request-workspace-body">
              <div class="request-bar">
                <el-select
                  v-model="tab.method"
                  class="method-select"
                  popper-class="method-select-popper"
                  :class="`method-select-${tab.method}`"
                >
                  <template #label="{ value }">
                    <span
                      :class="`method-color-${value}`"
                      style="font-weight: 700"
                    >
                      {{ value }}
                    </span>
                  </template>
                  <el-option
                    v-for="m in methods"
                    :key="m"
                    :label="m"
                    :value="m"
                  >
                    <span
                      :class="`method-color-${m}`"
                      style="
                        font-weight: 700;
                        font-size: 12px;
                        letter-spacing: 0.03em;
                      "
                    >
                      {{ m }}
                    </span>
                  </el-option>
                </el-select>
                <div class="url-input-wrap" @click="focusUrlInput">
                  <el-input
                    v-show="urlFocused || !tab.url"
                    ref="urlInputRef"
                    v-model="tab.url"
                    class="url-input"
                    placeholder="Enter URL (supports {{variable}} syntax)"
                    clearable
                    @focus="urlFocused = true"
                    @blur="urlFocused = false"
                    @input="handleUrlInput"
                    @keyup.ctrl.enter="store.sendActiveRequest"
                    @keyup.enter="store.sendActiveRequest"
                  />
                  <div
                    v-if="!urlFocused && tab.url"
                    class="url-badge-display"
                    title="Click to edit URL"
                  >
                    <template v-for="(seg, idx) in urlSegments" :key="idx">
                      <el-tooltip
                        v-if="seg.isVar"
                        placement="top"
                        :content="
                          seg.found
                            ? `{{${seg.key}}} = ${seg.value}`
                            : `{{${seg.key}}} is not set`
                        "
                      >
                        <span
                          class="url-inline-var-badge"
                          :class="seg.found ? 'found' : 'missing'"
                        >
                          {{ seg.text }}
                        </span>
                      </el-tooltip>
                      <span v-else class="url-inline-text">{{ seg.text }}</span>
                    </template>
                  </div>
                </div>
                <div class="request-bar-actions">
                  <el-button
                    type="primary"
                    class="send-action-btn"
                    :icon="Promotion"
                    :loading="tab.loading"
                    @click="store.sendActiveRequest"
                  >
                    Send
                  </el-button>
                  <el-button
                    class="save-action-btn"
                    :icon="FolderChecked"
                    :disabled="!ws.canEdit"
                    :title="ws.canEdit ? 'Save Request (Ctrl+S)' : 'Viewer role cannot edit'"
                    @click="handleSaveClick"
                  >
                    Save
                  </el-button>
                </div>
              </div>

              <div v-if="showUrlEnvPreview" class="env-url-preview">
                <span class="env-url-label">→</span>
                <div class="env-full-url-inline">
                  <span class="env-url-plain-part">{{ resolvedUrlPreview }}</span>
                </div>
              </div>

              <div
                ref="splitContainerRef"
                class="request-response-split"
                :class="`split-${settings.responsePosition}`"
              >
                <RequestEditorPane
                  v-model:active-tab-name="activeRequestTab"
                  :effective-variables-map="effectiveVariablesMap"
                  @open-gql-schema="handleOpenGqlSchema"
                />

                <div
                  class="response-resizer"
                  :class="{ 'is-vertical': isResponseHorizontal }"
                  title="Drag to resize response panel"
                  @mousedown="startResponseResize"
                />

                <ResponseViewerPane
                  @copy-response="copyActiveResponse"
                  @download-response="downloadActiveResponse"
                />
              </div>

              <div
                v-if="splitViewEnabled && secondaryTab"
                style="
                  margin-top: 8px;
                  padding: 10px;
                  border: 1px solid var(--ao-border);
                  border-radius: 8px;
                  background: var(--ao-surface);
                  display: flex;
                  flex-direction: column;
                  gap: 6px;
                "
              >
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
                  <div style="display: flex; align-items: center; gap: 8px">
                    <el-tag size="small" effect="plain">Split View</el-tag>
                    <el-select v-model="secondaryTabId" size="small" style="width: 220px">
                      <el-option
                        v-for="t in store.tabs"
                        :key="t.id"
                        :label="`${t.method} ${t.name}`"
                        :value="t.id"
                      />
                    </el-select>
                  </div>
                  <el-button size="small" link @click="splitViewEnabled = false">Close</el-button>
                </div>
                <div style="display: flex; align-items: center; gap: 8px">
                  <span class="method-badge" :class="`method-${secondaryTab.method}`">
                    {{ secondaryTab.method }}
                  </span>
                  <el-input v-model="secondaryTab.url" size="small" style="flex: 1" />
                  <el-button
                    size="small"
                    type="primary"
                    @click="store.activeTabId = secondaryTab.id"
                  >
                    Focus Tab
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </el-main>
      </el-container>
    </div>

    <StatusFooter
      @open-cookies="cookiesDialogVisible = true"
      @open-base64="footerBase64DialogVisible = true"
      @toggle-console="consoleDrawerVisible = !consoleDrawerVisible"
      @open-support="supportDialogVisible = true"
      @open-shortcuts="shortcutsDialogVisible = true"
    />

    <AuthDialogs
      v-model:auth-visible="authDialogVisible"
      v-model:password-visible="setPasswordDialogVisible"
    />

    <EnvironmentDialog
      v-model:visible="envDialogVisible"
      :initial-env-id="envDialogInitialId"
    />

    <TeamWorkspaceDialog v-model:visible="teamDialogVisible" />

    <CollectionRunnerDialog
      v-model:visible="runnerVisible"
      :collection-node="runnerTargetNode"
    />

    <SettingsDialog
      v-model:visible="settingsVisible"
      :initial-tab="settingsInitialTab"
      @check-updates="handleManualCheckUpdates"
    />

    <CookiesDialog v-model:visible="cookiesDialogVisible" />

    <VariablesDrawer
      v-model:visible="variablesDrawerVisible"
      @open-envs="openEnvDialog()"
    />

    <SupportDialog
      v-model:visible="supportDialogVisible"
      @open-shortcuts="shortcutsDialogVisible = true"
      @open-team="ElMessage.info('Invite team members via Workspace settings')"
    />

    <WorkspaceModals
      v-model:save-visible="saveDialogVisible"
      :initial-save-request-name="saveRequestName"
      :initial-save-collection-id="saveCollectionId"
      v-model:new-collection-visible="newCollectionVisible"
      v-model:curl-visible="curlDialogVisible"
      v-model:snippet-visible="snippetDialogVisible"
      v-model:docs-visible="docsVisible"
      :docs-collection-id="docsCollectionId"
      :docs-title="docsTitle"
      :docs-markdown="docsMarkdown"
      v-model:gql-schema-visible="gqlSchemaVisible"
      :gql-queries="gqlQueries"
      :gql-mutations="gqlMutations"
      v-model:mobile-sidebar-visible="mobileSidebarVisible"
      v-model:search-visible="searchDialogVisible"
      v-model:shortcuts-visible="shortcutsDialogVisible"
      v-model:download-app-visible="downloadAppDialogVisible"
      v-model:collection-settings-visible="collectionSettingsVisible"
      :collection-settings-target="collectionSettingsTarget"
      v-model:spec-viewer-visible="specViewerVisible"
      v-model:monitors-visible="monitorsVisible"
      v-model:flows-visible="flowsVisible"
      v-model:db-client-visible="dbClientVisible"
      v-model:schemas-visible="schemasVisible"
      v-model:proxy-recorder-visible="proxyRecorderVisible"
      v-model:snapshots-visible="snapshotsVisible"
      :snapshots-target="snapshotsTarget"
      v-model:git-sync-visible="gitSyncVisible"
      @trigger-postman-import="sidebarRef?.triggerPostmanImport?.()"
      @open-auth="authDialogVisible = true"
    />

    <ConsoleDrawer v-model:visible="consoleDrawerVisible" />
    <DevToolboxDialog v-model:visible="toolboxVisible" />
    <WebhookBinDialog v-model:visible="webhookBinVisible" />
    <TrashDialog v-model:visible="trashVisible" />
    <PluginMarketplaceDialog v-model:visible="marketplaceVisible" />
    <Base64ImageDialog v-model:visible="footerBase64DialogVisible" />

    <el-dialog
      v-model="desktopUpdateVisible"
      title="Update Available — Api-Open Desktop"
      width="min(94vw, 460px)"
      align-center
    >
      <div v-if="desktopUpdateInfo" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="font-size: 13.5px; color: var(--ao-text);">
          A new version of <strong>Api-Open Desktop</strong> is available:
          <strong>v{{ desktopUpdateInfo.latestVersion }}</strong>
          <span style="color: var(--ao-text-muted); font-size: 12px;">
            (installed: v{{ desktopUpdateInfo.currentVersion }})
          </span>
        </div>
        <el-alert
          :type="desktopUpdateInfo.updateMode === 'reinstall' ? 'warning' : 'info'"
          :closable="false"
          show-icon
          :title="
            desktopUpdateInfo.updateMode === 'reinstall'
              ? 'Clean Reinstall Required (Uninstall Old First)'
              : 'Direct In-App Update (No Uninstall Needed)'
          "
          :description="
            desktopUpdateInfo.updateNotice ||
            (desktopUpdateInfo.updateMode === 'reinstall'
              ? 'Download the new installer, uninstall/close the current app, then install the new version.'
              : 'The update will install directly inside the app and restart automatically.')
          "
        />
        <pre
          v-if="desktopUpdateInfo.releaseNotes"
          style="margin: 0; max-height: 150px; overflow: auto; padding: 10px 12px; border-radius: 8px; background: var(--ao-surface-2, rgba(255,255,255,0.04)); border: 1px solid var(--ao-border); font-size: 12px; white-space: pre-wrap; color: var(--ao-text-muted);"
        >{{ desktopUpdateInfo.releaseNotes }}</pre>
        <div
          v-if="desktopUpdateDownloading && desktopUpdateProgress"
          style="display: flex; flex-direction: column; gap: 6px; padding-top: 4px;"
        >
          <el-progress
            :percentage="desktopUpdateProgress.percent"
            :stroke-width="10"
          />
          <div style="font-size: 12px; color: var(--ao-text-muted);">
            <template v-if="desktopUpdateProgress.percent >= 100">
              Installing update & restarting app...
            </template>
            <template v-else>
              Downloading inside app:
              {{ (desktopUpdateProgress.receivedBytes / 1048576).toFixed(1) }} MB
              <template v-if="desktopUpdateProgress.totalBytes > 0">
                / {{ (desktopUpdateProgress.totalBytes / 1048576).toFixed(1) }} MB
              </template>
            </template>
          </div>
        </div>
      </div>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          <el-button size="small" @click="skipDesktopUpdateVersion">
            Skip Version
          </el-button>
          <el-button size="small" @click="desktopUpdateVisible = false">
            Later
          </el-button>
          <el-button
            type="primary"
            size="small"
            :loading="desktopUpdateDownloading"
            @click="installDesktopUpdate"
          >
            {{
              desktopUpdateDownloading
                ? 'Downloading...'
                : desktopUpdateInfo?.updateMode === 'reinstall'
                  ? 'Download Installer'
                  : 'Update Inside App'
            }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.global-progress-toast {
  position: fixed;
  right: 16px;
  bottom: 36px;
  z-index: 3000;
  width: min(320px, calc(100vw - 32px));
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--ao-surface);
  border: 1px solid var(--ao-border);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.global-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ao-text);
}
.global-progress-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.global-progress-pct {
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
}
.global-progress-detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--ao-text-muted);
}
.global-progress-detail span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
