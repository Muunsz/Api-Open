<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { downloadWindowsLauncherScript } from '../../services/exportService';
import type { BeforeInstallPromptEvent } from '../../types/app';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const extensionInstalled = computed(
  () => Boolean((window as unknown as { __API_OPEN_EXTENSION__?: boolean }).__API_OPEN_EXTENSION__),
);

const deferredInstallPrompt = ref<BeforeInstallPromptEvent | null>(null);

function handleBeforeInstallPrompt(e: Event) {
  e.preventDefault();
  deferredInstallPrompt.value = e as BeforeInstallPromptEvent;
}

onMounted(() => {
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
});

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
});

async function installPwaApp() {
  if (deferredInstallPrompt.value) {
    await deferredInstallPrompt.value.prompt();
    const choice = await deferredInstallPrompt.value.userChoice;
    if (choice.outcome === 'accepted') {
      ElMessage.success('Api-Open installed to your device!');
      emit('update:visible', false);
    }
    deferredInstallPrompt.value = null;
    return;
  }
  ElMessage.info(
    'Use your browser menu (⋮ -> Cast, save, and share -> Install Api-Open) or download the Windows Launcher below.',
  );
}

function downloadWindowsLauncher() {
  downloadWindowsLauncherScript();
  ElMessage.success('Downloaded Api-Open-Windows.bat');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Download / Install Api-Open App"
    width="min(92vw, 460px)"
    align-center
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="download-app-cards">
      <div class="download-app-card">
        <div class="download-app-card-title">
          Install as Desktop App (Windows / Mac / Linux)
        </div>
        <div class="download-app-card-desc">
          Install directly via browser (PWA) so Api-Open runs in its own
          standalone window with Start Menu &amp; Desktop shortcut.
        </div>
        <el-button
          type="primary"
          size="small"
          :icon="Download"
          @click="installPwaApp"
        >
          {{
            deferredInstallPrompt ? 'Install App Now' : 'How to Install (PWA)'
          }}
        </el-button>
      </div>

      <div class="download-app-card">
        <div class="download-app-card-title">Windows App Launcher (.bat)</div>
        <div class="download-app-card-desc">
          Download a lightweight Windows launcher that opens Api-Open in
          standalone app window mode using Edge or Chrome.
        </div>
        <el-button
          size="small"
          :icon="Download"
          @click="downloadWindowsLauncher"
        >
          Download for Windows
        </el-button>
      </div>

      <div class="download-app-card">
        <div class="download-app-card-title" style="display: flex; align-items: center; gap: 8px">
          <span>Browser Agent Extension (CORS-Free Localhost)</span>
          <el-tag size="small" :type="extensionInstalled ? 'success' : 'info'">
            {{ extensionInstalled ? 'Connected' : 'Not Detected' }}
          </el-tag>
        </div>
        <div class="download-app-card-desc">
          Load unpacked <code>extensions/browser-agent</code> in Chrome/Edge
          (<code>chrome://extensions</code> &rarr; Developer mode) to send
          CORS-free requests to localhost and private APIs directly from the browser.
        </div>
      </div>
    </div>
  </el-dialog>
</template>
