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
    'Use your browser menu (⋮ -> Cast, save, and share -> Install Api-Open) or download a launcher below.',
  );
}

function downloadLauncherFor(os: OsKey) {
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
}

interface DesktopEdition {
  id: 'electron' | 'csharp' | 'cpp' | 'java';
  name: string;
  badge: string;
  desc: string;
}

function downloadEdition(editionId: DesktopEdition['id']) {
  downloadDesktopEditionScript(editionId, activeOs.value);
  ElMessage.success(`Downloaded ${editionId.toUpperCase()} launcher`);
}

const osMeta = computed(() => {
  if (activeOs.value === 'win') {
    return {
      title: 'Windows',
      launcherLabel: 'Download Windows Launcher (.bat)',
      launcherHint: 'Opens Api-Open in a dedicated Edge or Chrome app window.',
      editions: [
        {
          id: 'electron',
          name: 'Electron Desktop',
          badge: 'NSIS .exe',
          desc: 'Node.js IPC Desktop Agent for CORS-free localhost & external APIs.',
        },
        {
          id: 'csharp',
          name: 'C# (.NET 8 WPF + WebView2)',
          badge: 'Native Win',
          desc: 'Lightweight native Windows executable with C# HttpClient agent.',
        },
        {
          id: 'cpp',
          name: 'C++17 (Win32 + WebView2)',
          badge: 'WinHTTP',
          desc: 'Zero-runtime C++ native desktop wrapper using WinHTTP.',
        },
        {
          id: 'java',
          name: 'Java 17 (JavaFX WebView)',
          badge: 'JVM',
          desc: 'Cross-platform Java desktop app with native HttpClient bridge.',
        },
      ] satisfies DesktopEdition[],
    };
  }
  if (activeOs.value === 'mac') {
    return {
      title: 'macOS',
      launcherLabel: 'Download macOS Launcher (.command)',
      launcherHint: 'Run chmod +x Api-Open-macOS.command if macOS asks for permission.',
      editions: [
        {
          id: 'electron',
          name: 'Electron Desktop',
          badge: '.dmg',
          desc: 'Universal macOS desktop app with built-in Node.js Local Agent.',
        },
        {
          id: 'java',
          name: 'Java 17 (JavaFX WebView)',
          badge: 'JVM',
          desc: 'Cross-platform Java desktop app with native HttpClient bridge.',
        },
      ] satisfies DesktopEdition[],
    };
  }
  return {
    title: 'Linux',
    launcherLabel: 'Download Linux Launcher (.sh)',
    launcherHint: 'Run chmod +x Api-Open-Linux.sh before launching.',
    editions: [
      {
        id: 'electron',
        name: 'Electron Desktop',
        badge: '.AppImage',
        desc: 'Linux desktop app with built-in Node.js Local Agent.',
      },
      {
        id: 'java',
        name: 'Java 17 (JavaFX WebView)',
        badge: 'JVM',
        desc: 'Cross-platform Java desktop app with native HttpClient bridge.',
      },
    ] satisfies DesktopEdition[],
  };
});
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Download / Install Api-Open App"
    width="min(94vw, 600px)"
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
      <!-- Quick Launcher for Selected OS -->
      <div class="download-hero-card">
        <div class="download-hero-info">
          <div class="download-app-card-title">
            {{ osMeta.title }} Quick Launcher
          </div>
          <div class="download-app-card-desc">
            {{ osMeta.launcherHint }}
          </div>
        </div>
        <el-button
          type="primary"
          size="small"
          :icon="Download"
          @click="downloadLauncherFor(activeOs)"
        >
          {{ osMeta.launcherLabel }}
        </el-button>
      </div>

      <!-- Native / Desktop Editions for Selected OS -->
      <div class="editions-header">
        Available Desktop Builds for {{ osMeta.title }} (CORS-Free Local Agent)
      </div>
      <div class="editions-grid">
        <div
          v-for="ed in osMeta.editions"
          :key="ed.id"
          class="download-app-card edition-card"
        >
          <div class="edition-top">
            <span class="download-app-card-title">{{ ed.name }}</span>
            <el-tag size="small" effect="plain">{{ ed.badge }}</el-tag>
          </div>
          <div class="download-app-card-desc">{{ ed.desc }}</div>
          <el-button
            type="primary"
            plain
            size="small"
            :icon="Download"
            style="width: 100%; margin-top: 6px"
            @click="downloadEdition(ed.id)"
          >
            Download
          </el-button>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 30%, var(--ao-border));
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--ao-surface-2));
}
.download-hero-info {
  flex: 1;
  min-width: 200px;
}
.editions-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--ao-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.editions-grid,
.extras-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.edition-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}
.edition-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
@media (max-width: 560px) {
  .editions-grid,
  .extras-grid {
    grid-template-columns: 1fr;
  }
}
</style>
