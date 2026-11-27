<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import {
  downloadDesktopEditionScript,
  downloadLinuxLauncherScript,
  downloadMacLauncherScript,
  downloadWindowsLauncherScript,
} from '../../services/exportService';
import type { BeforeInstallPromptEvent } from '../../types/app';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

type OsKey = 'win' | 'mac' | 'linux';

const detectedOs = computed<OsKey>(() => {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'win';
});

const activeOs = ref<OsKey>(detectedOs.value);

watch(
  () => props.visible,
  (open) => {
    if (open) activeOs.value = detectedOs.value;
  },
);

const extensionInstalled = computed(() =>
  Boolean(
    (window as unknown as { __API_OPEN_EXTENSION__?: boolean })
      .__API_OPEN_EXTENSION__,
  ),
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
    'Use your browser menu (⋮ -> Cast, save, and share -> Install Api-Open) or download the desktop app below.',
  );
}

const downloadingTarget = ref<'desktop' | 'launcher' | null>(null);

function downloadLauncherFor(os: OsKey) {
  downloadingTarget.value = 'launcher';
  try {
    if (os === 'win') {
      downloadWindowsLauncherScript();
      ElMessage.success('Downloaded Api-Open-Windows.bat');
    } else if (os === 'mac') {
      downloadMacLauncherScript();
      ElMessage.success('Downloaded Api-Open-macOS.command');
    } else {
      downloadLinuxLauncherScript();
      ElMessage.success('Downloaded Api-Open-Linux.sh');
    }
  } finally {
    downloadingTarget.value = null;
  }
}

let cachedReleaseAssets: Map<string, string> | null = null;

async function getReleaseAssetsMap(): Promise<Map<string, string>> {
  if (cachedReleaseAssets) return cachedReleaseAssets;
  const map = new Map<string, string>();
  try {
    const res = await fetch(
      'https://api.github.com/repos/Muunsz/Api-Open/releases/latest',
    );
    if (res.ok) {
      const data = (await res.json()) as {
        assets?: Array<{ name: string; browser_download_url: string }>;
      };
      for (const a of data.assets ?? []) {
        map.set(a.name, a.browser_download_url);
      }
      cachedReleaseAssets = map;
    }
  } catch {
    // fallback to script launcher
  }
  return map;
}

const osMeta = computed(() => {
  if (activeOs.value === 'win') {
    return {
      title: 'Windows',
      badge: 'NSIS .exe',
      releaseAsset: 'Api-Open-Electron-Windows.exe',
      desktopDesc:
        'Standalone Electron desktop application for Windows with built-in CORS-free Local Agent, offline bundled UI, and window persistence.',
      launcherLabel: 'Download Launcher (.bat)',
      launcherHint: 'Opens Api-Open in a dedicated Edge or Chrome app window.',
    };
  }
  if (activeOs.value === 'mac') {
    return {
      title: 'macOS',
      badge: '.dmg',
      releaseAsset: 'Api-Open-Electron-macOS.dmg',
      desktopDesc:
        'Standalone Electron desktop application for macOS with built-in CORS-free Local Agent, offline bundled UI, and native menu.',
      launcherLabel: 'Download Launcher (.command)',
      launcherHint:
        'Run chmod +x Api-Open-macOS.command if macOS asks for permission.',
    };
  }
  return {
    title: 'Linux',
    badge: '.AppImage',
    releaseAsset: 'Api-Open-Electron-Linux.AppImage',
    desktopDesc:
      'Standalone Electron desktop application for Linux with built-in CORS-free Local Agent and offline bundled UI.',
    launcherLabel: 'Download Launcher (.sh)',
    launcherHint: 'Run chmod +x Api-Open-Linux.sh before launching.',
  };
});

async function downloadElectronApp() {
  downloadingTarget.value = 'desktop';
  try {
    const assets = await getReleaseAssetsMap();
    const binaryUrl = assets.get(osMeta.value.releaseAsset);
    if (binaryUrl) {
      const a = document.createElement('a');
      a.href = binaryUrl;
      a.download = osMeta.value.releaseAsset;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      ElMessage.success(`Downloading ${osMeta.value.releaseAsset}`);
      return;
    }

    const fileName = downloadDesktopEditionScript('electron', activeOs.value);
    ElMessage.success(`Downloaded ${fileName}`);
  } finally {
    downloadingTarget.value = null;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Download / Install Api-Open App"
    width="min(94vw, 540px)"
    align-center
    @update:model-value="emit('update:visible', $event)"
  >
    <!-- OS Logo Selector -->
    <div class="os-tabs" role="tablist" aria-label="Operating System">
      <button
        type="button"
        class="os-tab-btn"
        :class="{ active: activeOs === 'win' }"
        title="Windows"
        aria-label="Windows"
        @click="activeOs = 'win'"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M2 3.8 10.5 2.6v8.2H2V3.8zm9.6-1.3L22 1v9.8H11.6V2.5zM2 12.2h8.5v8.2L2 19.2v-7zm9.6 0H22V22l-10.4-1.5v-8.3z" />
        </svg>
        <span class="os-tab-name">Windows</span>
      </button>

      <button
        type="button"
        class="os-tab-btn"
        :class="{ active: activeOs === 'mac' }"
        title="macOS"
        aria-label="macOS"
        @click="activeOs = 'mac'"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M16.37 1.62c0 1.14-.42 2.22-1.16 3.04-.79.88-1.97 1.54-3.13 1.44-.12-1.08.37-2.2 1.1-2.98.76-.84 2.02-1.46 3.19-1.5zm3.43 15.17c-.56 1.24-.83 1.8-1.55 2.9-.99 1.52-2.38 3.41-4.1 3.43-1.53.02-1.93-.99-4.01-.98-2.08.01-2.52 1-4.05.98-1.72-.02-3.04-1.73-4.03-3.25C-.74 15.65-.45 10.67 1.98 8.07c1.22-1.31 2.84-2.07 4.35-2.07 1.62 0 2.64.99 3.98.99 1.3 0 2.09-.99 3.96-.99 1.37 0 2.82.75 3.86 2.04-3.39 1.86-2.84 6.72.67 8.75z" />
        </svg>
        <span class="os-tab-name">macOS</span>
      </button>

      <button
        type="button"
        class="os-tab-btn"
        :class="{ active: activeOs === 'linux' }"
        title="Linux"
        aria-label="Linux"
        @click="activeOs = 'linux'"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 2c-2.3 0-3.8 1.6-3.8 4.2 0 1.2.3 2.4.7 3.4-1.7 1.7-2.9 4.2-2.9 6.6 0 1.4.4 2.5 1.1 3.2-.5.4-.9.9-.9 1.5 0 .7.8 1.1 2 1.1 1.2 0 2.1-.4 2.5-1 .4.1.8.1 1.3.1s.9 0 1.3-.1c.4.6 1.3 1 2.5 1 1.2 0 2-.4 2-1.1 0-.6-.4-1.1-.9-1.5.7-.7 1.1-1.8 1.1-3.2 0-2.4-1.2-4.9-2.9-6.6.4-1 .7-2.2.7-3.4C15.8 3.6 14.3 2 12 2zm-1.4 3.5a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm2.8 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zM12 7.4c1 0 1.8.5 1.8 1.1 0 .5-.8 1.1-1.8 1.1s-1.8-.6-1.8-1.1c0-.6.8-1.1 1.8-1.1z" />
        </svg>
        <span class="os-tab-name">Linux</span>
      </button>
    </div>

    <div class="download-sections">
      <!-- Primary Standalone Electron Desktop Card -->
      <div class="download-hero-card">
        <div class="download-hero-info">
          <div class="edition-top">
            <span class="download-app-card-title">
              Api-Open Desktop ({{ osMeta.title }})
            </span>
            <el-tag size="small" type="primary" effect="light">
              {{ osMeta.badge }}
            </el-tag>
          </div>
          <div class="download-app-card-desc">
            {{ osMeta.desktopDesc }}
          </div>
        </div>
        <el-button
          type="primary"
          size="default"
          :icon="Download"
          :loading="downloadingTarget === 'desktop'"
          style="width: 100%; margin-top: 8px"
          @click="downloadElectronApp"
        >
          Download
        </el-button>
      </div>

      <!-- Quick Launcher -->
      <div class="download-app-card">
        <div class="edition-top">
          <span class="download-app-card-title">
            {{ osMeta.title }} Quick Launcher
          </span>
          <el-button
            size="small"
            :icon="Download"
            :loading="downloadingTarget === 'launcher'"
            @click="downloadLauncherFor(activeOs)"
          >
            {{ osMeta.launcherLabel }}
          </el-button>
        </div>
        <div class="download-app-card-desc" style="margin-top: 4px">
          {{ osMeta.launcherHint }}
        </div>
      </div>

      <!-- PWA & Extension -->
      <div class="extras-grid">
        <div class="download-app-card">
          <div class="download-app-card-title">Browser App (PWA)</div>
          <div class="download-app-card-desc">
            Install directly from browser for standalone window &amp; shortcut.
          </div>
          <el-button
            size="small"
            :icon="Download"
            @click="installPwaApp"
          >
            {{ deferredInstallPrompt ? 'Install App Now' : 'How to Install' }}
          </el-button>
        </div>

        <div class="download-app-card">
          <div class="edition-top">
            <span class="download-app-card-title">Browser Agent Extension</span>
            <el-tag size="small" :type="extensionInstalled ? 'success' : 'info'">
              {{ extensionInstalled ? 'Connected' : 'Not Detected' }}
            </el-tag>
          </div>
          <div class="download-app-card-desc">
            Load unpacked <code>extensions/browser-agent</code> in Chrome/Edge
            for CORS-free localhost requests in browser.
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.os-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.os-tab-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 8px;
  border-radius: 10px;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-2);
  color: var(--ao-text-muted);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.os-tab-btn:hover {
  color: var(--ao-text);
  border-color: var(--el-color-primary);
}
.os-tab-btn.active {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}
.os-tab-name {
  font-size: 12px;
  font-weight: 600;
}
.download-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.download-hero-card {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 35%, var(--ao-border));
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--ao-surface-2));
}
.extras-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.edition-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
@media (max-width: 560px) {
  .extras-grid {
    grid-template-columns: 1fr;
  }
}
</style>
