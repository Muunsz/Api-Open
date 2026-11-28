<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  Collection,
  Connection,
  CopyDocument,
  Delete,
  Document,
  Download,
  Edit,
  Folder,
  FolderAdd,
  Grid,
  Key,
  Monitor,
  MoreFilled,
  Plus,
  Refresh,
  Share,
  Upload,
  VideoPlay,
  View,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox, type ElTree } from 'element-plus';
import type { CollectionExportFormat } from '../services/exportService';
import { API_BASE } from '../services/httpClient';
import {
  readCollectionsFromLocalFolder,
  syncWorkspaceToLocalFolder,
} from '../utils/gitSync';
import { useConsoleStore } from '../stores/console';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import {
  type CollectionDto,
  type CollectionTreeNode,
  useWorkspaceStore,
} from '../stores/workspace';

defineProps<{
  workspaceSummary: string;
}>();

const emit = defineEmits<{
  (e: 'open-curl'): void;
  (e: 'share-request'): void;
  (e: 'open-snippet'): void;
  (e: 'export-all'): void;
  (e: 'export-all-format', format: CollectionExportFormat): void;
  (e: 'open-new-collection'): void;
  (e: 'open-runner', node: CollectionTreeNode): void;
  (e: 'open-docs', node: CollectionTreeNode): void;
  (e: 'export-collection', node: CollectionTreeNode): void;
  (e: 'export-openapi', node: CollectionTreeNode, format: 'json' | 'yaml'): void;
  (e: 'export-format', node: CollectionTreeNode, format: CollectionExportFormat): void;
  (e: 'open-collection-settings', col: CollectionDto): void;
  (e: 'open-snapshots', col: CollectionDto): void;
  (e: 'open-spec-viewer'): void;
  (e: 'open-monitors'): void;
  (e: 'open-flows'): void;
  (e: 'open-db-client'): void;
  (e: 'open-schemas'): void;
  (e: 'open-proxy-recorder'): void;
  (e: 'open-git-sync'): void;
  (e: 'open-env-dialog'): void;
  (e: 'open-toolbox'): void;
  (e: 'open-webhook-bin'): void;
  (e: 'open-trash'): void;
  (e: 'open-marketplace'): void;
  (e: 'open-overview'): void;
  (e: 'open-variables'): void;
  (e: 'open-auth'): void;
}>();

const ws = useWorkspaceStore();
const store = useTabsStore();
const settings = useSettingsStore();
const consoleStore = useConsoleStore();

const sidebarTab = ref<'collections' | 'history'>('collections');
const lastHistoryWsId = ref('');
const collectionTreeRef = ref<InstanceType<typeof ElTree> | null>(null);
const expandedTreeKeys = ref<string[]>([]);

const activeTreeNodeKey = computed<string | null>(() => {
  const reqId = store.activeTab?.savedRequestId;
  return reqId ? `req-${reqId}` : null;
});

function findAncestorCollectionIds(
  nodes: CollectionTreeNode[],
  targetId: string,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return trail;
    if (node.children?.length) {
      const nextTrail =
        node.kind === 'collection' ? [...trail, node.id] : trail;
      const found = findAncestorCollectionIds(node.children, targetId, nextTrail);
      if (found) return found;
    }
  }
  return null;
}

function handleNodeExpand(data: CollectionTreeNode) {
  if (data.kind === 'collection' && !expandedTreeKeys.value.includes(data.id)) {
    expandedTreeKeys.value = [...expandedTreeKeys.value, data.id];
  }
}

function handleNodeCollapse(data: CollectionTreeNode) {
  if (data.kind === 'collection') {
    expandedTreeKeys.value = expandedTreeKeys.value.filter((k) => k !== data.id);
  }
}

let lastAutoExpandedKey: string | null = null;

async function syncSidebarToActiveTab() {
  await nextTick();
  const tree = collectionTreeRef.value as unknown as {
    setCurrentKey?: (key?: string | number) => void;
    store?: { nodesMap?: Record<string, { expand?: (cb?: unknown, expandParent?: boolean) => void }> };
  } | null;
  if (!tree) return;

  const key = activeTreeNodeKey.value;
  tree.setCurrentKey?.(key ?? undefined);

  if (key && key !== lastAutoExpandedKey) {
    const ancestors = findAncestorCollectionIds(ws.collectionTree, key) ?? [];
    if (ancestors.length) {
      lastAutoExpandedKey = key;
      const merged = new Set(expandedTreeKeys.value);
      for (const id of ancestors) {
        merged.add(id);
        tree.store?.nodesMap?.[id]?.expand?.(undefined, true);
      }
      expandedTreeKeys.value = Array.from(merged);
    }
  } else if (!key) {
    lastAutoExpandedKey = null;
  }
}

watch(
  [activeTreeNodeKey, () => ws.collectionTree],
  () => {
    syncSidebarToActiveTab();
  },
  { immediate: true },
);

watch(sidebarTab, (tab) => {
  if (
    tab === 'history' &&
    ws.isAuthenticated &&
    ws.activeWorkspaceId &&
    lastHistoryWsId.value !== ws.activeWorkspaceId
  ) {
    lastHistoryWsId.value = ws.activeWorkspaceId;
    store.syncHistoryFromServer();
  }
});
const sidebarSections = ref<string[]>(['environments']);
const postmanFileInput = ref<HTMLInputElement | null>(null);
const openApiFileInput = ref<HTMLInputElement | null>(null);
const insomniaFileInput = ref<HTMLInputElement | null>(null);
const harFileInput = ref<HTMLInputElement | null>(null);
const universalFileInput = ref<HTMLInputElement | null>(null);
const universalImportTargetParentId = ref<string | undefined>(undefined);
const historySearch = ref('');
const historyMethodFilter = ref('');

const filteredHistory = computed(() => {
  const q = historySearch.value.trim().toLowerCase();
  const m = historyMethodFilter.value;
  return store.history.filter((h) => {
    if (m && h.method !== m) return false;
    if (q && !h.url.toLowerCase().includes(q)) return false;
    return true;
  });
});

const isSidebarVertical = computed(
  () =>
    settings.sidebarPosition === 'top' || settings.sidebarPosition === 'bottom',
);

function triggerPostmanImport() {
  postmanFileInput.value?.click();
}

function triggerOpenApiImport() {
  openApiFileInput.value?.click();
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

const importTargetDialogVisible = ref(false);
const importTargetMode = ref<'current' | 'new'>('current');
const importNewWorkspaceName = ref('');
const importingCollection = ref(false);
let pendingImportAction: (() => Promise<void>) | null = null;

function openImportDestinationDialog(defaultWsName: string, action: () => Promise<void>) {
  importTargetMode.value = 'current';
  importNewWorkspaceName.value = defaultWsName.replace(/\.[^.]+$/, '') || 'Imported Workspace';
  pendingImportAction = action;
  importTargetDialogVisible.value = true;
}

async function confirmImportDestination() {
  if (!pendingImportAction) return;
  importingCollection.value = true;
  try {
    if (importTargetMode.value === 'new') {
      const wsName = importNewWorkspaceName.value.trim() || 'Imported Workspace';
      await ws.createTeamWorkspace(wsName);
    }
    await pendingImportAction();
    importTargetDialogVisible.value = false;
    pendingImportAction = null;
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Import failed');
  } finally {
    importingCollection.value = false;
  }
}

async function handleOpenApiFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  openImportDestinationDialog(file.name, async () => {
    await ws.importOpenApiJson(text);
    ElMessage.success('OpenAPI spec imported');
  });
}

async function handleInsomniaFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  openImportDestinationDialog(file.name, async () => {
    await ws.importInsomniaJson(text);
    ElMessage.success('Insomnia collection imported');
  });
}

async function handleHarFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  openImportDestinationDialog(file.name, async () => {
    await ws.importHarJson(text);
    ElMessage.success('HAR file imported');
  });
}

function triggerUniversalImport(parentId?: string) {
  universalImportTargetParentId.value = parentId;
  universalFileInput.value?.click();
}

async function handleUniversalFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  const fileName = file.name;
  const targetParent = universalImportTargetParentId.value;
  universalImportTargetParentId.value = undefined;
  input.value = '';
  openImportDestinationDialog(fileName, async () => {
    const res = await ws.importUniversalCollection(text, fileName, targetParent);
    ElMessage.success(`Imported "${res.name}" (${res.format})`);
  });
}

async function copyMockUrl(col: CollectionDto) {
  const url = `${API_BASE}/mock/${col.id}`;
  await navigator.clipboard.writeText(url);
  ElMessage.success(`Mock base URL copied: ${url}`);
}

async function handleSyncGitFolder() {
  try {
    const res = await syncWorkspaceToLocalFolder(
      ws.collectionTree,
      ws.environments,
    );
    ElMessage.success(
      `Synced ${res.filesWritten} file(s) to "${res.folderName}" (Git-ready)`,
    );
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Folder sync failed');
  }
}

async function handleImportGitFolder() {
  try {
    const files = await readCollectionsFromLocalFolder();
    let count = 0;
    for (const f of files) {
      try {
        await ws.importUniversalCollection(f.content, f.name);
        count++;
      } catch {
        // skip non-collection files
      }
    }
    ElMessage.success(`Loaded ${count} collection file(s) from folder`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Folder import failed');
  }
}

function allowTreeDrop(
  draggingNode: { data: CollectionTreeNode },
  dropNode: { data: CollectionTreeNode },
  type: 'prev' | 'next' | 'inner',
) {
  if (type === 'inner' && dropNode.data.kind !== 'collection') return false;
  if (draggingNode.data.kind === 'collection' && dropNode.data.kind === 'request') {
    return false;
  }
  if (draggingNode.data.kind === 'request' && dropNode.data.kind === 'collection' && type !== 'inner') {
    return false;
  }
  return true;
}

async function handleTreeDrop(
  draggingNode: { data: CollectionTreeNode },
  dropNode: { data: CollectionTreeNode },
  dropType: 'before' | 'after' | 'inner',
) {
  const drag = draggingNode.data;
  const drop = dropNode.data;
  if (drag.kind === 'request' && drag.request) {
    const targetColId =
      dropType === 'inner' && drop.collection
        ? drop.collection.id
        : drop.request?.collectionId;
    if (!targetColId) return;
    const dropOrder = drop.request?.order ?? 0;
    const nextOrder =
      dropType === 'inner' ? 0 : dropType === 'before' ? Math.max(0, dropOrder - 1) : dropOrder + 1;
    await ws.moveOrReorderRequest(drag.request.id, targetColId, nextOrder);
  } else if (drag.kind === 'collection' && drag.collection) {
    const nextParentId =
      dropType === 'inner' && drop.collection
        ? drop.collection.id
        : (drop.collection?.parentId ?? null);
    const dropOrder = drop.collection?.order ?? 0;
    const nextOrder =
      dropType === 'inner' ? 0 : dropType === 'before' ? Math.max(0, dropOrder - 1) : dropOrder + 1;
    await ws.moveOrReorderCollection(drag.collection.id, nextParentId, nextOrder);
  }
}

function handleTreeNodeClick(node: CollectionTreeNode) {
  if (node.kind === 'request' && node.request) {
    store.openSavedRequest(node.request);
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

async function handleCreateSubfolder(col: CollectionDto) {
  try {
    const { value } = await ElMessageBox.prompt(
      'Enter sub-folder name',
      `New Sub-folder in "${col.name}"`,
      {
        confirmButtonText: 'Create',
        cancelButtonText: 'Cancel',
        inputPlaceholder: 'Folder name',
      },
    );
    if (!value?.trim()) return;
    await ws.createCollection(value.trim(), col.id);
    ElMessage.success('Sub-folder created');
  } catch {
    // cancelled
  }
}

async function handleRenameNode(node: CollectionTreeNode) {
  try {
    const { value } = await ElMessageBox.prompt('Enter new name', 'Rename', {
      confirmButtonText: 'Save',
      cancelButtonText: 'Cancel',
      inputValue: node.label,
    });
    if (!value?.trim()) return;
    if (node.kind === 'collection' && node.collection) {
      await ws.updateCollection(node.collection.id, { name: value.trim() });
    } else if (node.kind === 'request' && node.request) {
      await ws.renameRequest(node.request.id, value.trim());
    }
    ElMessage.success('Renamed');
  } catch {
    // cancelled
  }
}

async function handleDuplicateNode(node: CollectionTreeNode) {
  if (node.kind === 'collection' && node.collection) {
    await ws.duplicateCollection(node.collection.id);
    ElMessage.success('Collection duplicated');
  } else if (node.kind === 'request' && node.request) {
    await ws.duplicateRequest(node.request);
    ElMessage.success('Request duplicated');
  }
}

function statusClass(code?: number): string {
  if (!code) return 'status-1xx';
  if (code >= 200 && code < 300) return 'status-2xx';
  if (code >= 300 && code < 400) return 'status-3xx';
  if (code >= 400 && code < 500) return 'status-4xx';
  if (code >= 500) return 'status-5xx';
  return 'status-1xx';
}

function startSidebarResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = settings.sidebarWidth;
  const startHeight = settings.sidebarHeight;

  const onMove = (ev: MouseEvent) => {
    if (settings.sidebarPosition === 'left') {
      settings.sidebarWidth = Math.min(
        480,
        Math.max(200, startWidth + (ev.clientX - startX)),
      );
    } else if (settings.sidebarPosition === 'right') {
      settings.sidebarWidth = Math.min(
        480,
        Math.max(200, startWidth + (startX - ev.clientX)),
      );
    } else if (settings.sidebarPosition === 'top') {
      settings.sidebarHeight = Math.min(
        420,
        Math.max(140, startHeight + (ev.clientY - startY)),
      );
    } else {
      settings.sidebarHeight = Math.min(
        420,
        Math.max(140, startHeight + (startY - ev.clientY)),
      );
    }
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

defineExpose({
  triggerPostmanImport,
  triggerOpenApiImport,
});
</script>

<template>
  <!-- Quick Action Rail (docked next to Sidebar) -->
  <aside class="quick-rail desktop-sidebar">
    <button
      type="button"
      class="rail-btn"
      title="Import cURL (Ctrl+I)"
      @click="emit('open-curl')"
    >
      <el-icon><Upload /></el-icon>
    </button>
    <button
      type="button"
      class="rail-btn"
      title="Share Request (Ctrl+U)"
      @click="emit('share-request')"
    >
      <el-icon><Share /></el-icon>
    </button>
    <button
      type="button"
      class="rail-btn"
      title="Code Snippet"
      @click="emit('open-snippet')"
    >
      <span style="font-size: 11px; font-weight: 700">&lt;/&gt;</span>
    </button>
    <button
      type="button"
      class="rail-btn"
      title="API Flows (Chaining)"
      @click="emit('open-flows')"
    >
      <el-icon><Connection /></el-icon>
    </button>
    <button
      type="button"
      class="rail-btn"
      title="Data Schemas / Models"
      @click="emit('open-schemas')"
    >
      <el-icon><Grid /></el-icon>
    </button>
    <button
      type="button"
      class="rail-btn"
      title="Database SQL Client"
      @click="emit('open-db-client')"
    >
      <el-icon><Monitor /></el-icon>
    </button>
    <button
      type="button"
      class="rail-btn"
      title="Proxy Recorder / Sniffer"
      @click="emit('open-proxy-recorder')"
    >
      <el-icon><Refresh /></el-icon>
    </button>
    <el-dropdown
      placement="right-start"
      trigger="click"
      @command="
        (cmd: string) => {
          if (cmd === 'toolbox') emit('open-toolbox');
          else if (cmd === 'webhook') emit('open-webhook-bin');
          else if (cmd === 'trash') emit('open-trash');
          else if (cmd === 'plugins') emit('open-marketplace');
        }
      "
    >
      <button type="button" class="rail-btn" title="Developer Tools &amp; Utilities">
        <el-icon><MoreFilled /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="toolbox">Dev Toolbox (JWT / TS / Hash)</el-dropdown-item>
          <el-dropdown-item command="webhook">Webhook Receiver / Bin</el-dropdown-item>
          <el-dropdown-item command="trash">Trash / Recycle Bin</el-dropdown-item>
          <el-dropdown-item command="plugins">Plugins &amp; Themes</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </aside>

  <el-aside
    v-show="!settings.sidebarHidden"
    :width="isSidebarVertical ? '100%' : `${settings.sidebarWidth}px`"
    :style="isSidebarVertical ? { height: `${settings.sidebarHeight}px` } : {}"
    class="sidebar desktop-sidebar"
  >
    <el-tabs v-model="sidebarTab" stretch>
      <el-tab-pane v-loading="ws.isBusy" label="Collections" name="collections">
        <template v-if="ws.isAuthenticated">
          <div class="sidebar-toolbar">
            <el-text size="small" type="info" style="font-weight: 600">
              Collections
            </el-text>
            <div style="display: flex; gap: 6px; align-items: center">
              <el-dropdown trigger="click">
                <el-button
                  size="small"
                  circle
                  :icon="Upload"
                  title="Import Collection / OpenAPI / cURL"
                />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="triggerUniversalImport()">
                      Auto-Detect Any Collection
                    </el-dropdown-item>
                    <el-dropdown-item divided @click="triggerPostmanImport">
                      Postman v2.1 (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="triggerUniversalImport()">
                      Hoppscotch (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="triggerOpenApiImport">
                      OpenAPI / Swagger (.json / .yaml)
                    </el-dropdown-item>
                    <el-dropdown-item @click="insomniaFileInput?.click()">
                      Insomnia v4 (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="triggerUniversalImport()">
                      Thunder Client (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="triggerUniversalImport()">
                      Bruno Collection (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="harFileInput?.click()">
                      Network HAR (.har)
                    </el-dropdown-item>
                    <el-dropdown-item @click="triggerUniversalImport()">
                      SOAP / WSDL (.wsdl / .xml)
                    </el-dropdown-item>
                    <el-dropdown-item divided @click="emit('open-curl')">
                      cURL Command (Ctrl+I)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('open-git-sync')">
                      Import from Git Repo / Folder...
                    </el-dropdown-item>
                    <el-dropdown-item @click="handleImportGitFolder">
                      Load from Local Git Folder
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-dropdown trigger="click">
                <el-button
                  size="small"
                  circle
                  :icon="Download"
                  title="Export All Collections (Any Format)"
                />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="emit('open-git-sync')">
                      Git Repo &amp; Local Folder Sync...
                    </el-dropdown-item>
                    <el-dropdown-item @click="handleSyncGitFolder">
                      Quick Sync to Local Git Folder
                    </el-dropdown-item>
                    <el-dropdown-item divided @click="emit('export-all')">
                      Api-Open Bundle (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'postman')">
                      Postman v2.1 (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'hoppscotch')">
                      Hoppscotch (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'openapi-json')">
                      OpenAPI 3.0 (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'openapi-yaml')">
                      OpenAPI 3.0 (.yaml)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'insomnia')">
                      Insomnia v4 (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'thunder')">
                      Thunder Client (.json)
                    </el-dropdown-item>
                    <el-dropdown-item @click="emit('export-all-format', 'bruno')">
                      Bruno Collection (.json)
                    </el-dropdown-item>
                    <el-dropdown-item divided @click="emit('export-all-format', 'markdown')">
                      Markdown Docs (.md)
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button
                v-if="ws.canEdit"
                size="small"
                circle
                type="primary"
                plain
                :icon="Plus"
                title="New Collection"
                @click="emit('open-new-collection')"
              />
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
              accept=".json,.yaml,.yml,application/json,text/yaml"
              style="display: none"
              @change="handleOpenApiFileSelected"
            />
            <input
              ref="insomniaFileInput"
              type="file"
              accept=".json,application/json"
              style="display: none"
              @change="handleInsomniaFileSelected"
            />
            <input
              ref="harFileInput"
              type="file"
              accept=".har,.json,application/json"
              style="display: none"
              @change="handleHarFileSelected"
            />
            <input
              ref="universalFileInput"
              type="file"
              accept=".json,.yaml,.yml,.har,.sh,.txt,.bru,.wsdl,.xml,application/json,text/yaml,text/plain,text/xml"
              style="display: none"
              @change="handleUniversalFileSelected"
            />
          </div>
          <div class="sidebar-tree-scroll">
            <el-empty
              v-if="!ws.collectionTree.length"
              description="No collections yet"
              :image-size="54"
            />
            <el-tree
              v-else
              ref="collectionTreeRef"
              :data="ws.collectionTree"
              node-key="id"
              highlight-current
              :draggable="ws.canEdit"
              :allow-drop="allowTreeDrop"
              @node-click="handleTreeNodeClick"
              @node-drop="handleTreeDrop"
              @node-expand="handleNodeExpand"
              @node-collapse="handleNodeCollapse"
            >
              <template #default="{ data }">
                <div
                  class="tree-row"
                  :class="{ 'is-active-node': data.id === activeTreeNodeKey }"
                >
                  <span class="tree-label">
                    <el-icon v-if="data.kind === 'collection'">
                      <Folder />
                    </el-icon>
                    <span
                      v-else
                      class="method-badge"
                      :class="`method-${data.request?.method}`"
                    >
                      {{ data.request?.method }}
                    </span>
                    <span class="tree-text" :title="data.label">{{ data.label }}</span>
                  </span>
                  <span class="tree-actions">
                    <el-button
                      v-if="data.kind === 'collection'"
                      :icon="VideoPlay"
                      link
                      type="success"
                      size="small"
                      title="Run Collection"
                      @click.stop="emit('open-runner', data)"
                    />
                    <el-dropdown trigger="click" @click.stop>
                      <el-button
                        :icon="MoreFilled"
                        link
                        size="small"
                        title="More Actions"
                        @click.stop
                      />
                      <template #dropdown>
                        <el-dropdown-menu
                          v-if="data.kind === 'collection' && data.collection"
                          class="tree-node-dropdown-menu"
                        >
                          <el-dropdown-item
                            :icon="FolderAdd"
                            @click="handleCreateSubfolder(data.collection)"
                          >
                            New Sub-folder
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Collection"
                            @click="emit('open-collection-settings', data.collection)"
                          >
                            Auth &amp; Headers
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Edit"
                            @click="handleRenameNode(data)"
                          >
                            Rename
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="CopyDocument"
                            @click="handleDuplicateNode(data)"
                          >
                            Duplicate
                          </el-dropdown-item>
                          <el-dropdown-item
                            divided
                            :icon="VideoPlay"
                            @click="emit('open-runner', data)"
                          >
                            Run Collection
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Document"
                            @click="emit('open-docs', data)"
                          >
                            View API Docs
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Refresh"
                            @click="emit('open-snapshots', data.collection)"
                          >
                            Version Snapshots
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="CopyDocument"
                            @click="copyMockUrl(data.collection)"
                          >
                            Copy Mock Server URL
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Upload"
                            @click="triggerUniversalImport(data.collection.id)"
                          >
                            Import Into Folder...
                          </el-dropdown-item>
                          <el-dropdown-item
                            divided
                            :icon="Download"
                            @click="emit('export-format', data, 'postman')"
                          >
                            Export Postman (.json)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'hoppscotch')"
                          >
                            Export Hoppscotch (.json)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'openapi-json')"
                          >
                            Export OpenAPI 3.0 (.json)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'openapi-yaml')"
                          >
                            Export OpenAPI 3.0 (.yaml)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'insomnia')"
                          >
                            Export Insomnia v4 (.json)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'thunder')"
                          >
                            Export Thunder Client (.json)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'bruno')"
                          >
                            Export Bruno (.json)
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="Download"
                            @click="emit('export-format', data, 'markdown')"
                          >
                            Export Markdown Docs (.md)
                          </el-dropdown-item>
                          <el-dropdown-item
                            divided
                            :icon="Delete"
                            @click="handleTreeDelete(data)"
                          >
                            Delete
                          </el-dropdown-item>
                        </el-dropdown-menu>
                        <el-dropdown-menu v-else>
                          <el-dropdown-item
                            :icon="Edit"
                            @click="handleRenameNode(data)"
                          >
                            Rename
                          </el-dropdown-item>
                          <el-dropdown-item
                            :icon="CopyDocument"
                            @click="handleDuplicateNode(data)"
                          >
                            Duplicate
                          </el-dropdown-item>
                          <el-dropdown-item
                            divided
                            :icon="Delete"
                            @click="handleTreeDelete(data)"
                          >
                            Delete
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </span>
                </div>
              </template>
            </el-tree>
          </div>

          <el-collapse v-model="sidebarSections" class="sidebar-sections">
            <el-collapse-item title="ENVIRONMENTS" name="environments">
              <div v-if="ws.environments.length" class="sidebar-section-list">
                <button
                  v-for="env in ws.environments"
                  :key="env.id"
                  type="button"
                  class="sidebar-section-item"
                  :class="{ active: ws.activeEnvId === env.id }"
                  @click="ws.activeEnvId = env.id"
                >
                  <span>{{ env.name }}</span>
                  <span class="sidebar-item-meta">
                    {{ env.variables.length }} vars
                  </span>
                </button>
              </div>
              <el-text v-else size="small" type="info">
                No environments yet
              </el-text>
              <div style="margin-top: 6px">
                <el-button
                  size="small"
                  :icon="Plus"
                  @click="emit('open-env-dialog')"
                >
                  Manage
                </el-button>
              </div>
            </el-collapse-item>

            <el-collapse-item title="DOCUMENTS" name="documents">
              <el-text size="small" type="info">
                {{ workspaceSummary || 'No workspace summary yet.' }}
              </el-text>
              <div style="margin-top: 6px">
                <el-button
                  size="small"
                  :icon="Document"
                  @click="emit('open-overview')"
                >
                  Edit README
                </el-button>
              </div>
            </el-collapse-item>

            <el-collapse-item title="SPECS" name="specs">
              <el-text size="small" type="info">
                Import or interactively browse OpenAPI 3.0 Specs
              </el-text>
              <div style="margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap">
                <el-button
                  size="small"
                  :icon="Upload"
                  @click="triggerOpenApiImport"
                >
                  Import
                </el-button>
                <el-button
                  size="small"
                  :icon="View"
                  @click="emit('open-spec-viewer')"
                >
                  View Spec
                </el-button>
              </div>
            </el-collapse-item>

            <el-collapse-item title="LOCAL VAULT" name="vault">
              <el-text size="small" type="info">
                {{ consoleStore.localVault.length }} secret(s) stored locally
              </el-text>
              <div style="margin-top: 6px">
                <el-button
                  size="small"
                  :icon="Key"
                  @click="emit('open-variables')"
                >
                  Open Vault
                </el-button>
              </div>
            </el-collapse-item>

            <el-collapse-item title="MONITORS" name="monitors">
              <el-text size="small" type="info">
                {{ ws.monitors.length }} scheduled monitor(s)
              </el-text>
              <div style="margin-top: 6px">
                <el-button
                  size="small"
                  :icon="VideoPlay"
                  @click="emit('open-monitors')"
                >
                  Manage Monitors
                </el-button>
              </div>
            </el-collapse-item>
          </el-collapse>
        </template>
        <el-empty
          v-else
          description="Sign in to sync collections"
          :image-size="54"
        >
          <el-button
            type="primary"
            size="small"
            @click="emit('open-auth')"
          >
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
        <div style="display: flex; gap: 6px; margin-bottom: 8px">
          <el-input
            v-model="historySearch"
            size="small"
            placeholder="Filter URL..."
            clearable
          />
          <el-select
            v-model="historyMethodFilter"
            size="small"
            placeholder="All"
            clearable
            style="width: 90px"
          >
            <el-option label="GET" value="GET" />
            <el-option label="POST" value="POST" />
            <el-option label="PUT" value="PUT" />
            <el-option label="DELETE" value="DELETE" />
          </el-select>
        </div>
        <el-empty
          v-if="!filteredHistory.length"
          description="No matching history"
          :image-size="54"
        />
        <div v-else class="history-list">
          <div
            v-for="item in filteredHistory"
            :key="item.id"
            class="history-item"
            @click="
              store.addTab({
                method: item.method,
                url: item.url,
                name: item.url,
              })
            "
          >
            <span class="method-badge" :class="`method-${item.method}`">
              {{ item.method }}
            </span>
            <span class="history-url" :title="item.url">{{ item.url }}</span>
            <span
              v-if="item.statusCode"
              class="status-badge"
              :class="statusClass(item.statusCode)"
              style="margin-left: auto; font-size: 11px; padding: 1px 6px"
            >
              {{ item.statusCode }}
            </span>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-aside>

  <el-dialog
    v-model="importTargetDialogVisible"
    title="Import Collection Destination"
    width="min(92vw, 420px)"
    :close-on-click-modal="!importingCollection"
    :close-on-press-escape="!importingCollection"
    :show-close="!importingCollection"
  >
    <el-radio-group
      v-model="importTargetMode"
      :disabled="importingCollection"
      style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start"
    >
      <el-radio value="current">
        Import ke Workspace Ini ({{ ws.workspaces.find((w) => w.id === ws.activeWorkspaceId)?.name || 'Current' }})
      </el-radio>
      <el-radio value="new">Buat Workspace Baru &amp; Import</el-radio>
    </el-radio-group>
    <el-input
      v-if="importTargetMode === 'new'"
      v-model="importNewWorkspaceName"
      :disabled="importingCollection"
      size="small"
      placeholder="New workspace name..."
      style="margin-top: 10px"
    />
    <div v-if="importingCollection && ws.operationProgress.active" style="margin-top: 14px">
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; color: var(--ao-text-muted)">
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%">
          {{ ws.operationProgress.detail || ws.operationProgress.label }}
        </span>
        <span>{{ ws.operationProgress.percent }}% ({{ ws.operationProgress.current }}/{{ ws.operationProgress.total }})</span>
      </div>
      <el-progress
        :percentage="ws.operationProgress.percent"
        :stroke-width="10"
        :show-text="false"
        striped
        striped-flow
      />
    </div>
    <template #footer>
      <el-button size="small" :disabled="importingCollection" @click="importTargetDialogVisible = false">Cancel</el-button>
      <el-button size="small" type="primary" :loading="importingCollection" @click="confirmImportDestination">
        {{ importingCollection ? `Importing ${ws.operationProgress.percent}%` : 'Import' }}
      </el-button>
    </template>
  </el-dialog>

  <div
    v-show="!settings.sidebarHidden"
    class="sidebar-resizer desktop-sidebar"
    :class="{ 'is-horizontal': isSidebarVertical }"
    title="Drag to resize sidebar"
    @mousedown="startSidebarResize"
  />
</template>

<style scoped>
.quick-rail {
  width: 40px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  background: var(--ao-surface);
  border-right: 1px solid var(--ao-border);
}
.sidebar-pos-right .quick-rail {
  border-right: none;
  border-left: 1px solid var(--ao-border);
}
.rail-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ao-text-muted);
  cursor: pointer;
}
.rail-btn:hover,
.rail-btn.active {
  color: var(--ao-accent);
  background: var(--ao-hover);
}
.sidebar {
  background: var(--ao-surface);
  border-right: 1px solid var(--ao-border);
  padding: 8px 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar > :deep(.el-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.sidebar :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}
.sidebar :deep(.el-tab-pane) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.sidebar-tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.sidebar-pos-right .sidebar {
  border-right: none;
  border-left: 1px solid var(--ao-border);
}
.sidebar-pos-top .sidebar {
  border-right: none;
  border-bottom: 1px solid var(--ao-border);
}
.sidebar-pos-bottom .sidebar {
  border-right: none;
  border-top: 1px solid var(--ao-border);
}
.sidebar-resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  flex-shrink: 0;
}
.sidebar-resizer.is-horizontal {
  width: 100%;
  height: 4px;
  cursor: row-resize;
}
.sidebar-resizer:hover {
  background: var(--ao-accent);
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
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding-right: 4px;
}
.tree-row.is-active-node .tree-text {
  color: var(--el-color-primary);
  font-weight: 600;
}
:deep(.el-tree-node__content) {
  height: 30px;
  border-radius: 5px;
  margin: 1px 0;
  transition: background-color 0.12s;
}
:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  border-radius: 5px;
}
.tree-label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.tree-label :deep(.method-badge) {
  flex-shrink: 0;
  min-width: 42px;
  text-align: center;
}
.tree-actions {
  display: none;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
}
:deep(.el-tree-node__content:hover) .tree-actions,
:deep(.el-tree-node__content:focus-within) .tree-actions,
.tree-row:hover .tree-actions {
  display: flex;
}
.tree-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.tree-text {
  flex: 1;
  min-width: 0;
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
  padding: 7px 9px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
  transition: background 0.15s;
}
.history-item:hover {
  background: var(--ao-hover);
}
.history-url {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-sections {
  margin-top: auto;
  padding-top: 2px;
  flex-shrink: 0;
  border-top: 1px solid var(--ao-border);
  --el-collapse-header-height: 24px;
}
.sidebar-sections :deep(.el-collapse-item__header) {
  height: 24px;
  min-height: 24px;
  line-height: 24px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: transparent;
  color: var(--ao-text-muted);
}
.sidebar-sections :deep(.el-collapse-item__arrow) {
  font-size: 10px;
}
.sidebar-sections :deep(.el-collapse-item__wrap) {
  background: transparent;
}
.sidebar-sections :deep(.el-collapse-item__content) {
  padding-bottom: 6px;
  font-size: 11px;
}
.sidebar-section-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar-section-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ao-text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.sidebar-section-item:hover {
  background: var(--ao-surface-2);
}
.sidebar-section-item.active {
  border-color: var(--el-color-primary);
  background: var(--ao-surface-2);
}
.sidebar-item-meta {
  font-size: 11px;
  opacity: 0.65;
}
@media (max-width: 900px) {
  .desktop-sidebar {
    display: none;
  }
}
</style>
