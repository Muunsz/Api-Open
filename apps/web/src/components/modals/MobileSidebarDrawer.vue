<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus, Upload } from '@element-plus/icons-vue';
import { useSettingsStore } from '../../stores/settings';
import { useTabsStore } from '../../stores/tabs';
import {
  type CollectionTreeNode,
  useWorkspaceStore,
} from '../../stores/workspace';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
  (e: 'open-new-collection'): void;
  (e: 'trigger-postman-import'): void;
  (e: 'open-auth'): void;
}>();

const ws = useWorkspaceStore();
const store = useTabsStore();
const settings = useSettingsStore();

const sidebarTab = ref<'collections' | 'history'>('collections');
const mobileDrawerDirection = computed(() => {
  const map: Record<string, 'ltr' | 'rtl' | 'ttb' | 'btt'> = {
    left: 'ltr',
    right: 'rtl',
    top: 'ttb',
    bottom: 'btt',
  };
  return map[settings.sidebarPosition] ?? 'ltr';
});

function handleTreeNodeClick(node: CollectionTreeNode) {
  if (node.kind === 'request' && node.request) {
    store.openSavedRequest(node.request);
    emit('update:visible', false);
  }
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="Workspace"
    :direction="mobileDrawerDirection"
    size="290px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs v-model="sidebarTab" stretch>
      <el-tab-pane label="Collections" name="collections">
        <template v-if="ws.isAuthenticated">
          <div class="sidebar-toolbar">
            <el-text size="small" type="info">Collections</el-text>
            <div style="display: flex; gap: 4px; align-items: center">
              <el-button
                size="small"
                :icon="Upload"
                link
                type="primary"
                @click="emit('trigger-postman-import')"
              >
                Postman
              </el-button>
              <el-button
                size="small"
                :icon="Plus"
                link
                type="primary"
                @click="emit('open-new-collection')"
              >
                New
              </el-button>
            </div>
          </div>
          <el-tree
            v-if="ws.collectionTree.length"
            :data="ws.collectionTree"
            node-key="id"
            highlight-current
            @node-click="handleTreeNodeClick"
          />
          <el-empty v-else description="No collections yet" :image-size="54" />
        </template>
        <el-empty
          v-else
          description="Sign in to sync collections"
          :image-size="54"
        >
          <el-button
            type="primary"
            size="small"
            @click="
              emit('open-auth');
              emit('update:visible', false);
            "
          >
            Sign In
          </el-button>
        </el-empty>
      </el-tab-pane>
      <el-tab-pane label="History" name="history">
        <div v-if="store.history.length" class="history-list">
          <div
            v-for="item in store.history"
            :key="item.id"
            class="history-item"
            @click="
              store.addTab({
                method: item.method,
                url: item.url,
                name: item.url,
              });
              emit('update:visible', false);
            "
          >
            <el-tag size="small" effect="plain">{{ item.method }}</el-tag>
            <span class="history-url">{{ item.url }}</span>
          </div>
        </div>
        <el-empty v-else description="No history yet" :image-size="54" />
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>
