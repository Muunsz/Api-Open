<script setup lang="ts">
import { ArrowRight } from '@element-plus/icons-vue';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'open-shortcuts': [];
  'open-team': [];
}>();

function openGithub() {
  window.open('https://github.com/Muunsz/Api-Open', '_blank', 'noopener');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Support & Resources"
    width="min(92vw, 420px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="support-list">
      <button
        type="button"
        class="support-item"
        @click="emit('update:visible', false); emit('open-shortcuts')"
      >
        <div>
          <div class="support-title">Keyboard shortcuts</div>
          <div class="support-sub">Browse app faster with Postman & Hoppscotch shortcuts</div>
        </div>
        <el-icon><ArrowRight /></el-icon>
      </button>

      <button type="button" class="support-item" @click="openGithub">
        <div>
          <div class="support-title">GitHub Repository</div>
          <div class="support-sub">github.com/Muunsz/Api-Open</div>
        </div>
        <el-icon><ArrowRight /></el-icon>
      </button>

      <button
        type="button"
        class="support-item"
        @click="emit('update:visible', false); emit('open-team')"
      >
        <div>
          <div class="support-title">Invite Team Members</div>
          <div class="support-sub">Collaborate on workspaces, collections & environments</div>
        </div>
        <el-icon><ArrowRight /></el-icon>
      </button>
    </div>
  </el-dialog>
</template>

<style scoped>
.support-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.support-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
  color: var(--ao-text);
  cursor: pointer;
}
.support-item:hover {
  background: var(--ao-hover);
  border-color: var(--ao-accent);
}
.support-title {
  font-weight: 600;
  font-size: 13.5px;
}
.support-sub {
  font-size: 12px;
  color: var(--ao-text-muted);
  margin-top: 2px;
}
</style>
