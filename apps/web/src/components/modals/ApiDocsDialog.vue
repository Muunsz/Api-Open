<script setup lang="ts">
import { CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { downloadBlobFile } from '../../services/exportService';

const props = defineProps<{
  visible: boolean;
  collectionId?: string;
  docsTitle: string;
  docsMarkdown: string;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

function downloadDocsMarkdown() {
  const safeName = props.docsTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadBlobFile(props.docsMarkdown, `${safeName}.md`, 'text/markdown');
}

async function copyPublicDocsUrl() {
  if (!props.collectionId) return;
  const url = `${window.location.origin}/?publicDocs=${props.collectionId}`;
  await navigator.clipboard.writeText(url);
  ElMessage.success('Public Docs URL copied to clipboard');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`API Docs: ${docsTitle}`"
    width="min(94vw, 680px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="modal-toolbar">
      <el-button size="small" type="primary" @click="downloadDocsMarkdown">
        Download .md
      </el-button>
      <el-button
        v-if="collectionId"
        size="small"
        :icon="CopyDocument"
        @click="copyPublicDocsUrl"
      >
        Copy Public Docs Link
      </el-button>
    </div>
    <pre class="modal-code-pre">{{ docsMarkdown }}</pre>
  </el-dialog>
</template>
