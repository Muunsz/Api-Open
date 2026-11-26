<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CopyDocument, Delete, Download, Picture, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const props = defineProps<{
  visible: boolean;
  initialBase64?: string;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const base64Input = ref('');
const selectedMime = ref<'auto' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml'>('auto');
const imgDimensions = ref('');
const imgValid = ref(true);
const fileInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => [props.visible, props.initialBase64] as const,
  ([vis, init]) => {
    if (vis && init && !base64Input.value) {
      base64Input.value = init;
    }
  },
);

function detectMimeFromBase64(clean: string): string {
  if (clean.startsWith('iVBORw0KGgo')) return 'image/png';
  if (clean.startsWith('/9j/')) return 'image/jpeg';
  if (clean.startsWith('R0lGOD')) return 'image/gif';
  if (clean.startsWith('UklGR')) return 'image/webp';
  if (clean.startsWith('PHN2Zy')) return 'image/svg+xml';
  return 'image/png';
}

const resolvedDataUrl = computed(() => {
  const raw = base64Input.value.trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  if (raw.startsWith('data:image/')) return raw;
  const clean = raw.replace(/\s+/g, '');
  const mime = selectedMime.value === 'auto' ? detectMimeFromBase64(clean) : selectedMime.value;
  return `data:${mime};base64,${clean}`;
});

const rawBase64Only = computed(() => {
  const url = resolvedDataUrl.value;
  const idx = url.indexOf('base64,');
  return idx >= 0 ? url.slice(idx + 7) : url;
});

const detectedMimeLabel = computed(() => {
  const m = /^data:image\/([a-z0-9+.-]+);/i.exec(resolvedDataUrl.value);
  if (!m) return 'PNG';
  return m[1] === 'svg+xml' ? 'SVG' : m[1].toUpperCase();
});

const detectedExtension = computed(() => {
  const lbl = detectedMimeLabel.value.toLowerCase();
  return lbl === 'jpeg' ? 'jpg' : lbl;
});

const estimatedSizeLabel = computed(() => {
  const b64 = rawBase64Only.value;
  if (!b64) return '0 B';
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
});

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  imgValid.value = true;
  imgDimensions.value = `${img.naturalWidth} × ${img.naturalHeight} px`;
}

function onImageError() {
  imgValid.value = false;
  imgDimensions.value = 'Invalid image data';
}

async function copyDataUri() {
  if (!resolvedDataUrl.value) return;
  await navigator.clipboard.writeText(resolvedDataUrl.value);
  ElMessage.success('Data URI copied to clipboard');
}

async function copyRawBase64() {
  if (!rawBase64Only.value) return;
  await navigator.clipboard.writeText(rawBase64Only.value);
  ElMessage.success('Raw Base64 copied to clipboard');
}

function downloadImage() {
  if (!resolvedDataUrl.value) return;
  const a = document.createElement('a');
  a.href = resolvedDataUrl.value;
  a.download = `decoded-image.${detectedExtension.value}`;
  a.click();
}

async function handleImageFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    base64Input.value = String(reader.result ?? '');
    ElMessage.success(`Encoded ${file.name} to Base64`);
  };
  reader.readAsDataURL(file);
  (e.target as HTMLInputElement).value = '';
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Base64 ↔ Image Converter"
    width="min(95vw, 860px)"
    class="b64-dialog"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="b64-toolbar">
      <div class="b64-toolbar-left">
        <el-select v-model="selectedMime" size="small" style="width: 175px">
          <el-option label="Auto-detect MIME" value="auto" />
          <el-option label="PNG (image/png)" value="image/png" />
          <el-option label="JPEG (image/jpeg)" value="image/jpeg" />
          <el-option label="WebP (image/webp)" value="image/webp" />
          <el-option label="GIF (image/gif)" value="image/gif" />
          <el-option label="SVG (image/svg+xml)" value="image/svg+xml" />
        </el-select>
        <el-button size="small" :icon="Upload" @click="fileInputRef?.click()">
          Upload Image → Base64
        </el-button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleImageFileUpload"
        />
      </div>

      <div class="b64-toolbar-right">
        <el-button
          size="small"
          plain
          :icon="Delete"
          :disabled="!base64Input"
          @click="base64Input = ''; imgDimensions = ''"
        >
          Clear
        </el-button>
        <el-button
          size="small"
          :icon="CopyDocument"
          :disabled="!rawBase64Only"
          @click="copyRawBase64"
        >
          Copy Base64
        </el-button>
        <el-button
          size="small"
          :icon="CopyDocument"
          :disabled="!resolvedDataUrl"
          @click="copyDataUri"
        >
          Copy Data URI
        </el-button>
        <el-button
          size="small"
          type="primary"
          :icon="Download"
          :disabled="!resolvedDataUrl || !imgValid"
          @click="downloadImage"
        >
          Download
        </el-button>
      </div>
    </div>

    <div class="b64-grid">
      <div class="b64-pane">
        <div class="b64-pane-head">
          <span>Base64 / Data URI Input</span>
          <el-tag v-if="base64Input" size="small" type="info" effect="plain">
            {{ base64Input.length.toLocaleString() }} chars
          </el-tag>
        </div>
        <el-input
          v-model="base64Input"
          type="textarea"
          :rows="12"
          spellcheck="false"
          class="code-area b64-textarea"
          placeholder="Paste Base64 string or data:image/png;base64,... here"
        />
      </div>

      <div class="b64-pane">
        <div class="b64-pane-head">
          <span>Image Preview</span>
          <div v-if="resolvedDataUrl" class="b64-meta-tags">
            <el-tag size="small" effect="plain">{{ detectedMimeLabel }}</el-tag>
            <el-tag v-if="imgDimensions" size="small" :type="imgValid ? 'success' : 'danger'" effect="plain">
              {{ imgDimensions }}
            </el-tag>
            <el-tag size="small" type="info" effect="plain">{{ estimatedSizeLabel }}</el-tag>
          </div>
        </div>

        <div v-if="resolvedDataUrl" class="b64-preview-stage">
          <img
            :src="resolvedDataUrl"
            alt="Decoded Base64 preview"
            class="b64-preview-img"
            @load="onImageLoad"
            @error="onImageError"
          />
        </div>
        <div v-else class="b64-empty-stage">
          <el-icon style="font-size: 32px; opacity: 0.45"><Picture /></el-icon>
          <span>Paste a Base64 string or upload an image</span>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.b64-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.b64-toolbar-left,
.b64-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.b64-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 720px) {
  .b64-grid {
    grid-template-columns: 1fr;
  }
}
.b64-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ao-border);
  border-radius: 8px;
  background: var(--ao-surface-2);
  padding: 10px;
  min-height: 300px;
}
.b64-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ao-text-muted);
  margin-bottom: 8px;
}
.b64-meta-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.b64-textarea :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: none;
}
.b64-preview-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px dashed var(--ao-border);
  padding: 14px;
  background-image:
    linear-gradient(45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.b64-preview-img {
  max-width: 100%;
  max-height: 260px;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  background: #ffffff;
  object-fit: contain;
}
.b64-empty-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ao-text-muted);
  border-radius: 6px;
  border: 1px dashed var(--ao-border);
}
</style>
