<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    name?: string;
    value: unknown;
    depth?: number;
  }>(),
  {
    name: undefined,
    depth: 0,
  },
);

const expanded = ref(props.depth < 2);

const isObject = computed(
  () => props.value !== null && typeof props.value === 'object',
);
const isArray = computed(() => Array.isArray(props.value));

const entries = computed(() => {
  if (!isObject.value) return [];
  if (isArray.value) {
    return (props.value as unknown[]).map((v, i) => [String(i), v] as const);
  }
  return Object.entries(props.value as Record<string, unknown>);
});

const valueClass = computed(() => {
  if (props.value === null) return 'jt-null';
  if (typeof props.value === 'string') return 'jt-str';
  if (typeof props.value === 'number') return 'jt-num';
  if (typeof props.value === 'boolean') return 'jt-bool';
  return '';
});

const formattedPrimitive = computed(() => {
  if (props.value === null) return 'null';
  if (typeof props.value === 'string') return JSON.stringify(props.value);
  return String(props.value);
});
</script>

<template>
  <div class="jt-node" :style="{ paddingLeft: depth > 0 ? '16px' : '0' }">
    <div class="jt-line">
      <button
        v-if="isObject"
        type="button"
        class="jt-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? '▼' : '▶' }}
      </button>
      <span v-else class="jt-spacer" />

      <span v-if="name !== undefined" class="jt-key">{{ name }}:</span>

      <template v-if="isObject">
        <span class="jt-bracket">
          {{ isArray ? '[' + entries.length + ']' : '{' + entries.length + '}' }}
        </span>
      </template>
      <span v-else :class="valueClass">{{ formattedPrimitive }}</span>
    </div>

    <div v-if="isObject && expanded" class="jt-children">
      <JsonTreeNode
        v-for="[k, v] in entries"
        :key="k"
        :name="k"
        :value="v"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<style scoped>
.jt-node {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
}
.jt-line {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.jt-toggle {
  border: none;
  background: transparent;
  color: var(--ao-text-muted);
  cursor: pointer;
  padding: 0;
  width: 14px;
  font-size: 10px;
}
.jt-spacer {
  display: inline-block;
  width: 14px;
}
.jt-key {
  color: #60a5fa;
}
.jt-bracket {
  color: var(--ao-text-muted);
}
.jt-str {
  color: #34d399;
  word-break: break-all;
}
.jt-num {
  color: #f59e0b;
}
.jt-bool {
  color: #c084fc;
}
.jt-null {
  color: #94a3b8;
}
</style>
