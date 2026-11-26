<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { useTabsStore } from '../../stores/tabs';
import { useWorkspaceStore } from '../../stores/workspace';
import type { SearchableRequestItem } from '../../types/app';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const ws = useWorkspaceStore();
const store = useTabsStore();

const searchQuery = ref('');
const searchInputRef = ref<{ focus?: () => void } | null>(null);

watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      searchQuery.value = '';
      nextTick(() => {
        searchInputRef.value?.focus?.();
      });
    }
  },
);

const searchableRequests = computed<SearchableRequestItem[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const items: SearchableRequestItem[] = [];

  for (const col of ws.collections) {
    for (const req of col.requests ?? []) {
      items.push({
        kind: 'saved',
        id: req.id,
        name: `${col.name} / ${req.name}`,
        method: req.method,
        url: req.url,
        rawReq: req,
      });
    }
  }

  for (const h of store.history) {
    items.push({
      kind: 'history',
      id: h.id,
      name: 'History',
      method: h.method,
      url: h.url,
    });
  }

  if (!q) return items.slice(0, 20);
  return items
    .filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        item.method.toLowerCase().includes(q),
    )
    .slice(0, 20);
});

function selectSearchItem(item: SearchableRequestItem) {
  if (item.kind === 'saved' && item.rawReq) {
    store.openSavedRequest(item.rawReq);
  } else {
    store.addTab({ method: item.method, url: item.url, name: item.url });
  }
  emit('update:visible', false);
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Search API (Collections & History)"
    width="min(94vw, 560px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-input
      ref="searchInputRef"
      v-model="searchQuery"
      :prefix-icon="Search"
      placeholder="Search by endpoint name, URL, or method..."
      clearable
      @keyup.enter="
        searchableRequests[0] && selectSearchItem(searchableRequests[0])
      "
    />
    <div class="search-results-list">
      <el-empty
        v-if="!searchableRequests.length"
        description="No matching API requests"
        :image-size="50"
      />
      <div
        v-for="item in searchableRequests"
        :key="`${item.kind}-${item.id}`"
        class="history-item"
        @click="selectSearchItem(item)"
      >
        <span class="method-badge" :class="`method-${item.method}`">
          {{ item.method }}
        </span>
        <div style="overflow: hidden; flex: 1">
          <div style="font-size: 13px; font-weight: 600">{{ item.name }}</div>
          <div class="history-url">{{ item.url }}</div>
        </div>
        <el-tag size="small" effect="plain">
          {{ item.kind === 'saved' ? 'Saved' : 'History' }}
        </el-tag>
      </div>
    </div>
  </el-dialog>
</template>
