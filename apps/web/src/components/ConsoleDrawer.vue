<script setup lang="ts">
import { ref, watch } from 'vue';
import { useConsoleStore } from '../stores/console';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const consoleStore = useConsoleStore();
const consoleDrawerHeight = ref(280);
const isResizingConsole = ref(false);

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      consoleStore.syncFromDb();
    }
  }
);

function startConsoleDrawerResize(e: MouseEvent) {
  e.preventDefault();
  const startY = e.clientY;
  const startHeight = consoleDrawerHeight.value;
  const maxHeight = Math.max(240, window.innerHeight - 40);
  isResizingConsole.value = true;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'ns-resize';

  const onMove = (ev: MouseEvent) => {
    const delta = startY - ev.clientY;
    consoleDrawerHeight.value = Math.round(
      Math.min(maxHeight, Math.max(140, startHeight + delta)),
    );
  };
  const onUp = () => {
    isResizingConsole.value = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function toggleConsoleDrawerMaximize() {
  const expanded = Math.round(window.innerHeight * 0.72);
  consoleDrawerHeight.value =
    consoleDrawerHeight.value >= expanded - 20 ? 280 : expanded;
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    direction="btt"
    :size="`${consoleDrawerHeight}px`"
    class="console-drawer"
    @update:model-value="emit('update:visible', $event)"
  >
    <template #header="{ titleId, titleClass }">
      <div
        class="console-drawer-resizer"
        title="Drag up or down to resize (double-click to expand)"
        @mousedown="startConsoleDrawerResize"
        @dblclick="toggleConsoleDrawerMaximize"
      />
      <span :id="titleId" :class="titleClass">Console &amp; Email Logs</span>
    </template>

    <el-tabs>
      <el-tab-pane :label="`Activity & HTTP (${consoleStore.logs.length})`">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          "
        >
          <el-text size="small" type="info">
            HTTP requests, script logs, errors, and workspace activity
          </el-text>
          <el-button
            size="small"
            link
            type="danger"
            @click="consoleStore.clearLogs"
          >
            Clear
          </el-button>
        </div>
        <div
          v-if="consoleStore.logs.length"
          style="
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-family: monospace;
            font-size: 12px;
          "
        >
          <div
            v-for="entry in consoleStore.logs"
            :key="entry.id"
            style="
              display: flex;
              gap: 8px;
              align-items: center;
              padding: 4px 6px;
              border-radius: 4px;
              background: var(--ao-surface-2);
            "
          >
            <span style="opacity: 0.6; white-space: nowrap">
              {{ entry.timestamp.slice(11, 19) }}
            </span>
            <el-tag
              size="small"
              :type="
                entry.type === 'error'
                  ? 'danger'
                  : entry.type === 'http'
                    ? 'success'
                    : entry.type === 'script'
                      ? 'warning'
                      : 'info'
              "
            >
              {{ entry.type.toUpperCase() }}
            </el-tag>
            <span style="word-break: break-all">{{ entry.message }}</span>
          </div>
        </div>
        <el-empty v-else description="Console is empty" :image-size="48" />
      </el-tab-pane>

      <el-tab-pane :label="`Email Logs (${consoleStore.emailLogs.length})`">
        <div
          v-if="consoleStore.emailLogs.length"
          style="
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-family: monospace;
            font-size: 12px;
          "
        >
          <div
            v-for="em in consoleStore.emailLogs"
            :key="em.id"
            style="
              display: flex;
              gap: 8px;
              align-items: center;
              padding: 4px 6px;
              border-radius: 4px;
              background: var(--ao-surface-2);
            "
          >
            <span style="opacity: 0.6; white-space: nowrap">
              {{ em.createdAt.slice(11, 19) }}
            </span>
            <el-tag
              size="small"
              :type="em.status === 'sent' ? 'success' : 'danger'"
            >
              {{ em.status.toUpperCase() }}
            </el-tag>
            <el-tag size="small" type="info">{{ em.category }}</el-tag>
            <span style="word-break: break-all">
              {{ em.to }} — {{ em.subject }}{{ em.error ? ` (${em.error})` : '' }}
            </span>
          </div>
        </div>
        <el-empty v-else description="No email logs yet" :image-size="48" />
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<style scoped>
.console-drawer-resizer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 7px;
  cursor: ns-resize;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.console-drawer-resizer::after {
  content: '';
  width: 44px;
  height: 3px;
  border-radius: 999px;
  background: var(--ao-border);
  transition: background 0.15s;
}
.console-drawer-resizer:hover {
  background: color-mix(in srgb, var(--ao-accent) 12%, transparent);
}
.console-drawer-resizer:hover::after {
  background: var(--ao-accent);
}
</style>
