<script setup lang="ts">
import { computed } from 'vue';
import { Expand, Fold, Monitor, QuestionFilled } from '@element-plus/icons-vue';
import { useConsoleStore } from '../stores/console';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';

defineEmits<{
  (e: 'open-cookies'): void;
  (e: 'toggle-console'): void;
  (e: 'open-support'): void;
  (e: 'open-shortcuts'): void;
}>();

const settings = useSettingsStore();
const consoleStore = useConsoleStore();
const ws = useWorkspaceStore();

const isResponseHorizontal = computed(
  () =>
    settings.responsePosition === 'left' ||
    settings.responsePosition === 'right',
);
</script>

<template>
  <footer class="status-footer">
    <div class="footer-left">
      <button
        type="button"
        class="footer-btn"
        :title="
          settings.sidebarHidden
            ? 'Show Sidebar (Ctrl+B)'
            : 'Hide Sidebar (Ctrl+B)'
        "
        @click="settings.sidebarHidden = !settings.sidebarHidden"
      >
        <el-icon>
          <component :is="settings.sidebarHidden ? Expand : Fold" />
        </el-icon>
      </button>
      <button
        type="button"
        class="footer-status footer-btn"
        title="Interceptor Mode (click to toggle Proxy / Browser)"
        @click="
          settings.interceptor =
            settings.interceptor === 'proxy' ? 'browser' : 'proxy'
        "
      >
        <span class="status-dot" />
        <span>{{ settings.interceptor === 'proxy' ? 'Proxy' : 'Browser' }}</span>
      </button>
      <button
        type="button"
        class="footer-btn"
        title="Manage Cookies"
        @click="$emit('open-cookies')"
      >
        <span>Cookies</span>
      </button>
      <button
        type="button"
        class="footer-btn"
        title="Toggle Console"
        @click="$emit('toggle-console')"
      >
        <el-icon><Monitor /></el-icon>
        <span>
          Console{{
            consoleStore.logs.length ? ` (${consoleStore.logs.length})` : ''
          }}
        </span>
      </button>
      <span
        v-if="ws.isAuthenticated && ws.onlinePeers.length"
        class="footer-status"
        :title="ws.onlinePeers.map((p) => p.email).join(', ')"
      >
        <span class="status-dot" />
        <span>{{ ws.onlinePeers.length }} Online</span>
      </span>
    </div>

    <div class="footer-right">
      <button
        type="button"
        class="footer-btn"
        title="Support & Resources"
        @click="$emit('open-support')"
      >
        <el-icon><QuestionFilled /></el-icon>
        <span>Support</span>
      </button>
      <button
        type="button"
        class="footer-btn"
        title="Keyboard Shortcuts (Ctrl+/)"
        @click="$emit('open-shortcuts')"
      >
        <span>? Shortcuts</span>
      </button>
      <button
        type="button"
        class="footer-btn"
        title="Toggle Horizontal / Vertical Response Layout"
        @click="
          settings.responsePosition = isResponseHorizontal ? 'bottom' : 'right'
        "
      >
        <span>
          {{ isResponseHorizontal ? 'Vertical Layout' : 'Horizontal Layout' }}
        </span>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.status-footer {
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11.5px;
  background: var(--ao-surface);
  border-top: 1px solid var(--ao-border);
  color: var(--ao-text-muted);
}
.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--ao-text-muted);
  cursor: pointer;
  font-size: 11.5px;
  line-height: 1;
}
.footer-btn:hover {
  color: var(--ao-text);
  background: var(--ao-hover);
}
.footer-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
}
</style>
