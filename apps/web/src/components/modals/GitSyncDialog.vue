<script setup lang="ts">
import { ref } from 'vue';
import { Download, FolderOpened, Upload } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { scanJsonPayloadForSecrets } from '../../utils/secretScanner';
import type { CollectionExportFormat } from '../../services/exportService';
import { importFromGitRepo } from '../../services/proxyService';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  readCollectionsFromFileList,
  readCollectionsFromLocalFolder,
  syncWorkspaceToLocalFolder,
} from '../../utils/gitSync';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const activeTab = ref<'git' | 'folder'>('git');

// Git Repo Import
const repoUrl = ref('');
const branch = ref('');
const subPath = ref('');
const fetchingGit = ref(false);
const gitFiles = ref<Array<{ path: string; name: string; content: string }>>([]);

// Local Folder Sync
const exportFormat = ref<CollectionExportFormat | 'bru-tree'>('postman');
const maskSecrets = ref(true);
const dirInputRef = ref<HTMLInputElement | null>(null);
const importingFolder = ref(false);

async function fetchGitFiles() {
  if (!repoUrl.value.trim()) {
    ElMessage.warning('Enter a GitHub repository URL or raw file URL');
    return;
  }
  fetchingGit.value = true;
  try {
    gitFiles.value = await importFromGitRepo(
      repoUrl.value,
      branch.value || undefined,
      subPath.value || undefined,
    );
    if (!gitFiles.value.length) {
      ElMessage.warning('No collection/OpenAPI files found in repository');
    } else {
      ElMessage.success(`Found ${gitFiles.value.length} file(s)`);
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Git fetch failed');
  } finally {
    fetchingGit.value = false;
  }
}

async function importSelectedGitFiles() {
  if (!gitFiles.value.length) return;
  fetchingGit.value = true;
  let imported = 0;
  try {
    for (const f of gitFiles.value) {
      try {
        await ws.importUniversalCollection(f.content, f.name);
        imported++;
      } catch {
        // skip non-collection JSON/YAML files
      }
    }
    ElMessage.success(`Imported ${imported} collection(s) from Git`);
    if (imported > 0) emit('update:visible', false);
  } finally {
    fetchingGit.value = false;
  }
}

async function exportToLocalFolder() {
  try {
    if (!maskSecrets.value) {
      const findings = scanJsonPayloadForSecrets(
        JSON.stringify(ws.collectionTree),
        'Collections',
      );
      if (findings.length) {
        try {
          await ElMessageBox.confirm(
            `Detected ${findings.length} potential secret(s) (e.g. ${findings[0].pattern}: ${findings[0].preview}). Export anyway without masking?`,
            'Secret Scanner Warning',
            {
              confirmButtonText: 'Export Anyway',
              cancelButtonText: 'Cancel',
              type: 'warning',
            },
          );
        } catch {
          return;
        }
      }
    }
    const res = await syncWorkspaceToLocalFolder(
      ws.collectionTree,
      ws.environments,
      exportFormat.value,
      maskSecrets.value,
    );
    ElMessage.success(
      `Exported ${res.filesWritten} file(s) to folder "${res.folderName}"`,
    );
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Folder export failed');
  }
}

async function importFilesArray(
  files: Array<{ path: string; name: string; content: string }>,
) {
  importingFolder.value = true;
  let imported = 0;
  try {
    for (const f of files) {
      try {
        await ws.importUniversalCollection(f.content, f.name);
        imported++;
      } catch {
        // skip unrelated files
      }
    }
    ElMessage.success(`Imported ${imported} collection(s) from folder`);
    if (imported > 0) emit('update:visible', false);
  } finally {
    importingFolder.value = false;
  }
}

async function importFromLocalFolderPicker() {
  try {
    const files = await readCollectionsFromLocalFolder();
    await importFilesArray(files);
  } catch (err) {
    if (err instanceof Error && err.message.includes('File System Access')) {
      dirInputRef.value?.click();
    } else {
      ElMessage.error(err instanceof Error ? err.message : 'Folder import failed');
    }
  }
}

async function handleDirectoryFallbackChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  const files = await readCollectionsFromFileList(input.files);
  await importFilesArray(files);
  input.value = '';
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Git Repository & Local Folder Sync"
    width="min(94vw, 680px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs v-model="activeTab">
      <el-tab-pane label="Import from Git Repo" name="git">
        <el-form label-position="top" size="small">
          <el-form-item label="GitHub Repository URL or Raw File URL">
            <el-input
              v-model="repoUrl"
              placeholder="https://github.com/owner/repo or https://github.com/owner/repo/tree/main/collections"
            />
          </el-form-item>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
            <el-form-item label="Branch (Optional)">
              <el-input v-model="branch" placeholder="main (auto-detected)" />
            </el-form-item>
            <el-form-item label="Subfolder Path (Optional)">
              <el-input v-model="subPath" placeholder="e.g. docs/api or collections" />
            </el-form-item>
          </div>
          <div style="display: flex; gap: 8px">
            <el-button
              type="primary"
              :loading="fetchingGit"
              :icon="Download"
              @click="fetchGitFiles"
            >
              Scan Repository
            </el-button>
            <el-button
              v-if="gitFiles.length"
              type="success"
              :loading="fetchingGit"
              :icon="Upload"
              @click="importSelectedGitFiles"
            >
              Import {{ gitFiles.length }} File(s)
            </el-button>
          </div>
        </el-form>

        <div
          v-if="gitFiles.length"
          style="
            margin-top: 12px;
            max-height: 220px;
            overflow-y: auto;
            border: 1px solid var(--ao-border);
            border-radius: 6px;
            padding: 8px;
          "
        >
          <div
            v-for="f in gitFiles"
            :key="f.path"
            style="font-size: 12px; padding: 4px 6px; border-bottom: 1px solid var(--ao-border)"
          >
            <code>{{ f.path }}</code>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Local Folder Sync (Git-Ready)" name="folder">
        <div style="display: flex; flex-direction: column; gap: 14px">
          <div
            style="
              padding: 12px;
              border-radius: 8px;
              border: 1px solid var(--ao-border);
              background: var(--ao-surface-2);
            "
          >
            <div style="font-weight: 600; margin-bottom: 6px">
              Export / Sync Workspace to Local Folder
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 10px">
              <el-select v-model="exportFormat" size="small" style="width: 240px">
                <el-option label="Postman v2.1 (.json)" value="postman" />
                <el-option label="Hoppscotch (.json)" value="hoppscotch" />
                <el-option label="OpenAPI 3.0 (.yaml)" value="openapi-yaml" />
                <el-option label="OpenAPI 3.0 (.json)" value="openapi-json" />
                <el-option label="Insomnia v4 (.json)" value="insomnia" />
                <el-option label="Bruno Nested Folders (.bru)" value="bru-tree" />
                <el-option label="Bruno Bundle (.json)" value="bruno" />
              </el-select>
              <el-checkbox v-model="maskSecrets" size="small">
                Mask Secrets ({{ '{' }}{SECRET_MASKED}}{{ '}' }})
              </el-checkbox>
            </div>
            <el-button
              type="primary"
              size="small"
              :icon="FolderOpened"
              @click="exportToLocalFolder"
            >
              Choose Folder &amp; Export
            </el-button>
          </div>

          <div
            style="
              padding: 12px;
              border-radius: 8px;
              border: 1px solid var(--ao-border);
              background: var(--ao-surface-2);
            "
          >
            <div style="font-weight: 600; margin-bottom: 6px">
              Import Collections from Local Folder
            </div>
            <div style="font-size: 12px; color: var(--ao-text-muted); margin-bottom: 10px">
              Recursively scans a local folder for Postman, Hoppscotch, OpenAPI (JSON/YAML), Insomnia, Thunder Client, Bruno (.bru/.json), and HAR files.
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <el-button
                size="small"
                type="primary"
                plain
                :loading="importingFolder"
                :icon="Upload"
                @click="importFromLocalFolderPicker"
              >
                Select Folder &amp; Import
              </el-button>
              <el-button
                size="small"
                :loading="importingFolder"
                @click="dirInputRef?.click()"
              >
                Browse Directory (Fallback)
              </el-button>
            </div>
            <input
              ref="dirInputRef"
              type="file"
              webkitdirectory
              multiple
              style="display: none"
              @change="handleDirectoryFallbackChange"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>
