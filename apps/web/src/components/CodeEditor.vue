<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { toggleCommentOnSelection } from '../utils/editorComments';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: 'json' | 'javascript' | 'xml' | 'html' | 'graphql' | 'yaml' | 'text';
    placeholder?: string;
    rows?: number;
    variables?: Record<string, string>;
    readonly?: boolean;
  }>(),
  {
    language: 'json',
    placeholder: '',
    rows: 8,
    variables: () => ({}),
    readonly: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const highlightRef = ref<HTMLElement | null>(null);
const gutterRef = ref<HTMLElement | null>(null);
const showAutocomplete = ref(false);
const acQuery = ref('');
const acMode = ref<'var' | 'pm'>('var');
const acSelectedIdx = ref(0);

const BUILTIN_DYNAMIC_VARS = [
  '$timestamp',
  '$isoTimestamp',
  '$guid',
  '$randomInt',
  '$randomEmail',
  '$randomFullName',
  '$randomUserName',
  '$randomBoolean',
  '$randomWord',
  '$randomHexColor',
  '$randomIP',
];

const PM_SNIPPETS = [
  { label: 'pm.test("name", () => { ... })', insert: 'pm.test("Status is 200", () => {\n  pm.expect(pm.response.code).to.equal(200);\n});' },
  { label: 'pm.expect(pm.response.code).to.equal(200)', insert: 'pm.expect(pm.response.code).to.equal(200);' },
  { label: 'pm.response.json()', insert: 'const data = pm.response.json();' },
  { label: 'pm.environment.set("key", "val")', insert: 'pm.environment.set("key", "value");' },
  { label: 'pm.environment.get("key")', insert: 'pm.environment.get("key")' },
];

const acSuggestions = computed(() => {
  const q = acQuery.value.toLowerCase();
  if (acMode.value === 'pm') {
    return PM_SNIPPETS.filter((s) => s.label.toLowerCase().includes(q));
  }
  const userKeys = Object.keys(props.variables ?? {}).map((k) => ({
    label: `{{${k}}}`,
    meta: props.variables[k] ? `= ${props.variables[k].slice(0, 24)}` : 'empty',
    insert: `${k}}}`,
  }));
  const dynKeys = BUILTIN_DYNAMIC_VARS.map((k) => ({
    label: `{{${k}}}`,
    meta: 'dynamic',
    insert: `${k}}}`,
  }));
  return [...userKeys, ...dynKeys]
    .filter((item) => item.label.toLowerCase().includes(q))
    .slice(0, 12);
});

const lineCount = computed(() => Math.max(1, (props.modelValue || '').split('\n').length));

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const highlightedHtml = computed(() => {
  const raw = props.modelValue || '';
  if (!raw) return '\n';
  let html = escapeHtml(raw);

  if (props.language === 'json') {
    html = html.replace(
      /(\/\/[^\n]*|"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        if (match.startsWith('//')) {
          return `<span class="hl-comment">${match}</span>`;
        }
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="hl-key">${match}</span>`;
          return `<span class="hl-str">${match}</span>`;
        }
        if (/true|false/.test(match)) return `<span class="hl-bool">${match}</span>`;
        if (/null/.test(match)) return `<span class="hl-null">${match}</span>`;
        return `<span class="hl-num">${match}</span>`;
      },
    );
  } else if (props.language === 'javascript') {
    html = html.replace(
      /(\/\/[^\n]*|'[^']*'|"[^"]*"|`[^`]*`|\b(?:const|let|var|function|return|if|else|for|await|async|try|catch|true|false|null|pm|console)\b)/g,
      (match) => {
        if (match.startsWith('//')) return `<span class="hl-comment">${match}</span>`;
        if (/^['"`]/.test(match)) return `<span class="hl-str">${match}</span>`;
        return `<span class="hl-kw">${match}</span>`;
      },
    );
  } else if (props.language === 'xml' || props.language === 'html') {
    html = html.replace(
      /(&lt;!--[\s\S]*?--&gt;|&lt;\/?[a-zA-Z0-9:_-]+[^&]*?&gt;)/g,
      (match) => {
        if (match.startsWith('&lt;!--')) {
          return `<span class="hl-comment">${match}</span>`;
        }
        return `<span class="hl-kw">${match}</span>`;
      },
    );
  } else if (props.language === 'yaml') {
    html = html.replace(/(^[ \t]*#[^\n]*)/gm, '<span class="hl-comment">$1</span>');
  } else if (props.language === 'graphql') {
    html = html.replace(
      /(^[ \t]*(?:#|\/\/)[^\n]*)/gm,
      '<span class="hl-comment">$1</span>',
    );
  } else {
    html = html.replace(
      /(^[ \t]*\/\/[^\n]*)/gm,
      '<span class="hl-comment">$1</span>',
    );
  }

  // Highlight {{variables}} across all languages
  html = html.replace(
    /(\{\{\s*\$?[a-zA-Z0-9_.-]+\s*\}\})/g,
    '<span class="hl-var">$1</span>',
  );

  return html + (raw.endsWith('\n') ? ' ' : '');
});

function syncScroll() {
  const ta = textareaRef.value;
  if (!ta) return;
  if (highlightRef.value) {
    highlightRef.value.scrollTop = ta.scrollTop;
    highlightRef.value.scrollLeft = ta.scrollLeft;
  }
  if (gutterRef.value) {
    gutterRef.value.scrollTop = ta.scrollTop;
  }
}

function handleInput(e: Event) {
  const ta = e.target as HTMLTextAreaElement;
  emit('update:modelValue', ta.value);

  const pos = ta.selectionStart ?? 0;
  const before = ta.value.slice(0, pos);
  const varMatch = before.match(/\{\{([a-zA-Z0-9_.$-]*)$/);
  if (varMatch) {
    acMode.value = 'var';
    acQuery.value = varMatch[1] || '';
    acSelectedIdx.value = 0;
    showAutocomplete.value = true;
    return;
  }
  if (props.language === 'javascript') {
    const pmMatch = before.match(/(pm\.[a-zA-Z0-9_.]*)$/);
    if (pmMatch) {
      acMode.value = 'pm';
      acQuery.value = pmMatch[1];
      acSelectedIdx.value = 0;
      showAutocomplete.value = true;
      return;
    }
  }
  showAutocomplete.value = false;
}

function applySuggestion(insertText: string) {
  const ta = textareaRef.value;
  if (!ta) return;
  const pos = ta.selectionStart ?? 0;
  const val = ta.value;
  const before = val.slice(0, pos);
  const after = val.slice(pos);

  let startIdx = pos;
  if (acMode.value === 'var') {
    const m = before.match(/\{\{([a-zA-Z0-9_.$-]*)$/);
    if (m) startIdx = pos - m[1].length;
  } else {
    const m = before.match(/(pm\.[a-zA-Z0-9_.]*)$/);
    if (m) startIdx = pos - m[1].length;
  }

  const nextVal = val.slice(0, startIdx) + insertText + after;
  emit('update:modelValue', nextVal);
  showAutocomplete.value = false;
  nextTick(() => {
    const nextPos = startIdx + insertText.length;
    ta.focus();
    ta.setSelectionRange(nextPos, nextPos);
  });
}

function handleKeydown(e: KeyboardEvent) {
  if (showAutocomplete.value && acSuggestions.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acSelectedIdx.value = (acSelectedIdx.value + 1) % acSuggestions.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      acSelectedIdx.value =
        (acSelectedIdx.value - 1 + acSuggestions.value.length) %
        acSuggestions.value.length;
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applySuggestion(acSuggestions.value[acSelectedIdx.value].insert);
      return;
    }
    if (e.key === 'Escape') {
      showAutocomplete.value = false;
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === '/' || e.code === 'Slash')) {
    if (props.readonly) return;
    e.preventDefault();
    e.stopPropagation();
    const ta = textareaRef.value;
    if (!ta) return;
    const { nextValue, nextStart, nextEnd } = toggleCommentOnSelection(
      ta.value,
      ta.selectionStart ?? 0,
      ta.selectionEnd ?? 0,
      props.language,
    );
    emit('update:modelValue', nextValue);
    nextTick(() => {
      ta.focus();
      ta.setSelectionRange(nextStart, nextEnd);
    });
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = textareaRef.value;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const nextVal =
      ta.value.slice(0, start) + '  ' + ta.value.slice(end);
    emit('update:modelValue', nextVal);
    nextTick(() => {
      ta.setSelectionRange(start + 2, start + 2);
    });
  }
}
function handleBlur() {
  window.setTimeout(() => {
    showAutocomplete.value = false;
  }, 150);
}
</script>

<template>
  <div class="ao-code-editor" :style="{ minHeight: `${rows * 20 + 16}px` }">
    <div ref="gutterRef" class="ao-code-gutter" aria-hidden="true">
      <div v-for="n in lineCount" :key="n" class="ao-code-line-num">{{ n }}</div>
    </div>
    <div class="ao-code-surface">
      <pre
        ref="highlightRef"
        class="ao-code-highlight"
        aria-hidden="true"
        v-html="highlightedHtml"
      />
      <textarea
        ref="textareaRef"
        :value="modelValue"
        :placeholder="placeholder"
        :readonly="readonly"
        spellcheck="false"
        autocomplete="off"
        class="ao-code-textarea"
        @input="handleInput"
        @scroll="syncScroll"
        @keydown="handleKeydown"
        @blur="handleBlur"
      />
    </div>

    <div
      v-if="showAutocomplete && acSuggestions.length"
      class="ao-code-ac"
    >
      <button
        v-for="(item, idx) in acSuggestions"
        :key="item.label"
        type="button"
        class="ao-code-ac-item"
        :class="{ active: idx === acSelectedIdx }"
        @mousedown.prevent="applySuggestion(item.insert)"
      >
        <span>{{ item.label }}</span>
        <span v-if="'meta' in item" class="ao-code-ac-meta">{{ item.meta }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ao-code-editor {
  position: relative;
  display: flex;
  border: 1px solid var(--ao-border);
  border-radius: 6px;
  background: var(--ao-code-bg);
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 20px;
}
.ao-code-gutter {
  width: 38px;
  flex-shrink: 0;
  padding: 8px 6px 8px 0;
  text-align: right;
  color: var(--ao-text-muted);
  opacity: 0.6;
  user-select: none;
  border-right: 1px solid var(--ao-border);
  overflow: hidden;
  font-size: 11px;
}
.ao-code-line-num {
  height: 20px;
  line-height: 20px;
}
.ao-code-surface {
  position: relative;
  flex: 1;
  min-width: 0;
}
.ao-code-highlight,
.ao-code-textarea {
  margin: 0;
  padding: 8px 10px;
  font-family: inherit;
  font-size: inherit;
  line-height: 20px;
  tab-size: 2;
  white-space: pre-wrap;
  word-break: break-word;
  border: none;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.ao-code-highlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--ao-text);
  overflow: hidden;
}
.ao-code-textarea {
  position: relative;
  background: transparent;
  color: transparent;
  caret-color: var(--ao-text);
  resize: vertical;
  outline: none;
  min-height: inherit;
}
.ao-code-textarea::placeholder {
  color: var(--ao-text-muted);
  opacity: 0.55;
}
.ao-code-highlight :deep(.hl-key) {
  color: #60a5fa;
}
.ao-code-highlight :deep(.hl-str) {
  color: #34d399;
}
.ao-code-highlight :deep(.hl-num) {
  color: #f59e0b;
}
.ao-code-highlight :deep(.hl-bool) {
  color: #c084fc;
}
.ao-code-highlight :deep(.hl-null) {
  color: #94a3b8;
}
.ao-code-highlight :deep(.hl-kw) {
  color: #c084fc;
  font-weight: 600;
}
.ao-code-highlight :deep(.hl-comment) {
  color: #6b7280;
  font-style: italic;
  opacity: 0.85;
}
.ao-code-highlight :deep(.hl-var) {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.16);
  border-radius: 3px;
}
.ao-code-ac {
  position: absolute;
  left: 44px;
  bottom: 8px;
  z-index: 20;
  min-width: 240px;
  max-width: 380px;
  max-height: 200px;
  overflow-y: auto;
  background: var(--ao-surface);
  border: 1px solid var(--ao-border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  padding: 4px;
}
.ao-code-ac-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ao-text);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.ao-code-ac-item:hover,
.ao-code-ac-item.active {
  background: color-mix(in srgb, var(--el-color-primary) 18%, transparent);
  color: var(--el-color-primary);
}
.ao-code-ac-meta {
  font-size: 11px;
  color: var(--ao-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
</style>
