<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Close, Plus, RefreshLeft } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { workspaceApi } from '../../api/workspace';
import { type CollectionDto, useWorkspaceStore } from '../../stores/workspace';
import {
  type BreakingChangeItem,
  detectCollectionBreakingChanges,
} from '../../utils/breakingChangeDetector';

interface ChangeRequestItem {
  id: string;
  collectionId: string;
  title: string;
  description: string;
  author: string;
  snapshotId?: string;
  snapshotVersion?: string;
  endpointsSummary: Array<{ method: string; name: string; url: string }>;
  status: 'open' | 'merged' | 'rejected';
  reviewedBy?: string;
  createdAt: string;
}

const props = defineProps<{
  visible: boolean;
  collection: CollectionDto | null;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const activeTab = ref<'snapshots' | 'prs'>('snapshots');
const snapshots = ref<
  Array<{ id: string; collectionId: string; version: string; note?: string | null; createdAt: string }>
>([]);
const version = ref('v1.0.0');
const note = ref('');
const loading = ref(false);

const prTitle = ref('');
const prDescription = ref('');
const prSnapshotId = ref('');
const prList = ref<ChangeRequestItem[]>([]);
const breakingChanges = ref<BreakingChangeItem[]>([]);

function runBreakingChangeCheck() {
  if (!props.collection) return;
  const currentReqs = props.collection.requests ?? [];
  const latestPr = prList.value.find((p) => p.collectionId === props.collection!.id);
  const baseline = (latestPr?.endpointsSummary ?? []).map((e, i) => ({
    id: `base-${i}`,
    collectionId: props.collection!.id,
    name: e.name,
    method: e.method as 'GET',
    url: e.url,
    headers: [],
    queryParams: [],
    auth: { type: 'none' as const },
    body: { mode: 'none' as const },
  }));
  breakingChanges.value = detectCollectionBreakingChanges(baseline, currentReqs);
  ElMessage.info(`Detected ${breakingChanges.value.length} API change(s)`);
}

const PR_STORAGE_KEY = 'api_open_collection_prs_v1';

function loadPrs() {
  try {
    const raw = localStorage.getItem(PR_STORAGE_KEY);
    prList.value = raw ? (JSON.parse(raw) as ChangeRequestItem[]) : [];
  } catch {
    prList.value = [];
  }
}

function savePrs() {
  try {
    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(prList.value));
  } catch {
    // ignore
  }
}

const collectionPrs = computed(() =>
  props.collection
    ? prList.value.filter((p) => p.collectionId === props.collection!.id)
    : [],
);

async function loadSnapshots() {
  if (!props.collection || !ws.accessToken) return;
  loading.value = true;
  try {
    snapshots.value = await workspaceApi.listSnapshots(
      ws.accessToken,
      props.collection.id,
    );
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.visible, props.collection] as const,
  ([vis, col]) => {
    if (vis && col) {
      loadPrs();
      loadSnapshots();
    }
  },
  { immediate: true },
);

async function createSnapshot() {
  if (!props.collection || !ws.accessToken) return;
  await workspaceApi.createSnapshot(ws.accessToken, props.collection.id, {
    version: version.value,
    note: note.value,
  });
  note.value = '';
  ElMessage.success('Snapshot created');
  await loadSnapshots();
}

async function restore(snapshotId: string) {
  if (!ws.accessToken || !ws.activeWorkspaceId) return;
  await workspaceApi.restoreSnapshot(ws.accessToken, snapshotId);
  await ws.refreshCollections(ws.activeWorkspaceId);
  ElMessage.success('Collection restored from snapshot');
  emit('update:visible', false);
}

function submitChangeRequest() {
  if (!props.collection) return;
  if (!prTitle.value.trim()) {
    ElMessage.warning('Enter a Pull Request title');
    return;
  }
  const selectedSnap = snapshots.value.find((s) => s.id === prSnapshotId.value);
  const endpoints = (props.collection.requests ?? []).map((r) => ({
    method: r.method,
    name: r.name,
    url: r.url,
  }));
  prList.value.unshift({
    id: `pr-${Math.random().toString(36).slice(2, 10)}`,
    collectionId: props.collection.id,
    title: prTitle.value.trim(),
    description: prDescription.value.trim(),
    author: ws.user?.email ?? ws.profile?.name ?? 'Team Member',
    snapshotId: selectedSnap?.id,
    snapshotVersion: selectedSnap?.version,
    endpointsSummary: endpoints,
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  savePrs();
  prTitle.value = '';
  prDescription.value = '';
  prSnapshotId.value = '';
  ElMessage.success('Change Request (PR) submitted for team review');
}

async function approveAndMergePr(pr: ChangeRequestItem) {
  if (pr.snapshotId && ws.accessToken && ws.activeWorkspaceId) {
    await workspaceApi.restoreSnapshot(ws.accessToken, pr.snapshotId);
    await ws.refreshCollections(ws.activeWorkspaceId);
  }
  pr.status = 'merged';
  pr.reviewedBy = ws.user?.email ?? ws.profile?.name ?? 'Reviewer';
  savePrs();
  ElMessage.success(`Approved & merged PR "${pr.title}"`);
}

function rejectPr(pr: ChangeRequestItem) {
  pr.status = 'rejected';
  pr.reviewedBy = ws.user?.email ?? ws.profile?.name ?? 'Reviewer';
  savePrs();
  ElMessage.info(`Rejected PR "${pr.title}"`);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`Version Snapshots & Team Review: ${collection?.name ?? ''}`"
    width="min(94vw, 720px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs v-model="activeTab" class="compact-tabs">
      <el-tab-pane label="Snapshots" name="snapshots">
        <div class="modal-toolbar" style="margin-bottom: 12px">
          <el-input v-model="version" size="small" placeholder="v1.0.0" style="width: 120px" />
          <el-input v-model="note" size="small" placeholder="Release note..." style="flex: 1" />
          <el-button size="small" type="primary" :icon="Plus" @click="createSnapshot">
            Save Snapshot
          </el-button>
        </div>

        <el-empty v-if="!snapshots.length && !loading" description="No snapshots yet" :image-size="48" />

        <el-table v-else v-loading="loading" :data="snapshots" size="small" border>
          <el-table-column prop="version" label="Version" width="120" />
          <el-table-column prop="note" label="Note" />
          <el-table-column label="Created" width="170">
            <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="Action" width="110" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                type="warning"
                plain
                :icon="RefreshLeft"
                @click="restore(row.id)"
              >
                Restore
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="`Change Requests (${collectionPrs.length})`" name="prs">
        <div class="modal-toolbar" style="margin-bottom: 8px; flex-wrap: wrap">
          <el-input v-model="prTitle" size="small" placeholder="PR Title (e.g. Add v2 Auth endpoints)" style="flex: 1; min-width: 180px" />
          <el-select v-model="prSnapshotId" size="small" clearable placeholder="Target Snapshot (optional)" style="width: 190px">
            <el-option v-for="s in snapshots" :key="s.id" :label="s.version" :value="s.id" />
          </el-select>
          <el-button size="small" type="primary" :icon="Plus" @click="submitChangeRequest">
            Propose PR
          </el-button>
          <el-button size="small" @click="runBreakingChangeCheck">
            Check Breaking Changes
          </el-button>
        </div>
        <div v-if="breakingChanges.length" style="margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px">
          <el-tag
            v-for="(bc, idx) in breakingChanges"
            :key="idx"
            size="small"
            :type="bc.severity === 'breaking' ? 'danger' : bc.severity === 'warning' ? 'warning' : 'info'"
          >
            [{{ bc.severity.toUpperCase() }}] {{ bc.endpoint }} — {{ bc.message }}
          </el-tag>
        </div>
        <el-input
          v-model="prDescription"
          size="small"
          placeholder="Summary of changes for reviewers..."
          style="margin-bottom: 12px"
        />

        <el-empty v-if="!collectionPrs.length" description="No change requests yet" :image-size="48" />

        <div v-else style="display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow: auto">
          <div
            v-for="pr in collectionPrs"
            :key="pr.id"
            style="border: 1px solid var(--border); border-radius: 6px; padding: 10px"
          >
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
              <div style="display: flex; align-items: center; gap: 8px">
                <strong>{{ pr.title }}</strong>
                <el-tag
                  size="small"
                  :type="pr.status === 'merged' ? 'success' : pr.status === 'rejected' ? 'danger' : 'warning'"
                >
                  {{ pr.status.toUpperCase() }}
                </el-tag>
                <el-tag v-if="pr.snapshotVersion" size="small" type="info">
                  {{ pr.snapshotVersion }}
                </el-tag>
              </div>
              <div v-if="pr.status === 'open' && ws.canEdit" style="display: flex; gap: 6px">
                <el-button size="small" type="success" :icon="Check" @click="approveAndMergePr(pr)">
                  Approve &amp; Merge
                </el-button>
                <el-button size="small" type="danger" plain :icon="Close" @click="rejectPr(pr)">
                  Reject
                </el-button>
              </div>
            </div>
            <div v-if="pr.description" style="font-size: 12px; opacity: 0.85; margin-top: 4px">
              {{ pr.description }}
            </div>
            <div style="font-size: 11px; opacity: 0.65; margin-top: 4px">
              By {{ pr.author }} • {{ new Date(pr.createdAt).toLocaleString() }}
              <span v-if="pr.reviewedBy"> • Reviewed by {{ pr.reviewedBy }}</span>
              • {{ pr.endpointsSummary.length }} endpoint(s)
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>
