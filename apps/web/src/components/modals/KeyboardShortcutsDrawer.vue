<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import type { ShortcutGroup } from '../../types/app';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const shortcutSearch = ref('');
const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { keys: '?', desc: 'Help / Shortcuts' },
      { keys: 'Ctrl + K', desc: 'Search API & Commands' },
      { keys: 'Ctrl + Shift + /', desc: 'Keyboard Shortcuts' },
      { keys: 'Ctrl + /', desc: 'Toggle Comment in Editor / Input' },
      { keys: 'Ctrl + D', desc: 'Close Active Tab' },
      { keys: 'Ctrl + B', desc: 'Hide / Show Sidebar' },
    ],
  },
  {
    title: 'Request',
    items: [
      { keys: 'Ctrl + Enter', desc: 'Send Request' },
      { keys: 'Ctrl + S', desc: 'Save to Collections' },
      { keys: 'Ctrl + U', desc: 'Share Request (Copy JSON)' },
      { keys: 'Ctrl + L', desc: 'Focus URL Bar' },
      { keys: 'Alt + ↑ / ↓', desc: 'Next / Previous HTTP Method' },
      { keys: 'Alt + G', desc: 'Select GET Method' },
      { keys: 'Alt + H', desc: 'Select HEAD Method' },
      { keys: 'Alt + P', desc: 'Select POST Method' },
      { keys: 'Alt + U', desc: 'Select PUT Method' },
      { keys: 'Alt + X', desc: 'Select DELETE Method' },
    ],
  },
  {
    title: 'Response',
    items: [
      { keys: 'Ctrl + J', desc: 'Download Response as File' },
      { keys: 'Ctrl + .', desc: 'Copy Response to Clipboard' },
    ],
  },
  {
    title: 'Navigation & Team',
    items: [
      { keys: 'Alt + R', desc: 'Switch to HTTP / REST' },
      { keys: 'Alt + W', desc: 'Switch to WebSocket' },
      { keys: 'Alt + S', desc: 'Open Settings' },
      { keys: 'Alt + M', desc: 'Open Profile' },
      { keys: 'Ctrl + M', desc: 'Invite Team Member' },
    ],
  },
];

const filteredShortcutGroups = computed(() => {
  const q = shortcutSearch.value.trim().toLowerCase();
  if (!q) return shortcutGroups;
  return shortcutGroups
    .map((g) => ({
      title: g.title,
      items: g.items.filter(
        (i) =>
          i.desc.toLowerCase().includes(q) ||
          i.keys.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.items.length > 0);
});
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="Keyboard Shortcuts"
    direction="rtl"
    size="min(92vw, 360px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-input
      v-model="shortcutSearch"
      :prefix-icon="Search"
      size="small"
      placeholder="Search shortcuts..."
      clearable
      style="margin-bottom: 14px"
    />
    <div class="shortcuts-groups">
      <div
        v-for="group in filteredShortcutGroups"
        :key="group.title"
        class="shortcut-group"
      >
        <div class="shortcut-group-title">{{ group.title }}</div>
        <div
          v-for="item in group.items"
          :key="item.keys"
          class="shortcut-row"
        >
          <span class="shortcut-desc">{{ item.desc }}</span>
          <kbd class="kbd-key">{{ item.keys }}</kbd>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
