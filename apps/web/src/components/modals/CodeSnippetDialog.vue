<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useTabsStore } from '../../stores/tabs';
import type { SnippetLang } from '../../utils/snippetGenerator';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const store = useTabsStore();
const snippetLang = ref<SnippetLang>('curl');

const generatedCode = computed(() => {
  if (!props.visible) return '';
  return store.getSnippet(snippetLang.value);
});

async function copyGeneratedCode() {
  await navigator.clipboard.writeText(generatedCode.value);
  ElMessage.success('Copied to clipboard');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Generate Code Snippet"
    width="min(94vw, 620px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="modal-toolbar">
      <el-select v-model="snippetLang" size="small" style="width: 200px">
        <el-option label="cURL" value="curl" />
        <el-option label="JavaScript (fetch)" value="fetch" />
        <el-option label="Axios" value="axios" />
        <el-option label="Go (net/http)" value="go" />
        <el-option label="Python (requests)" value="python" />
        <el-option label="PHP (cURL)" value="php" />
        <el-option label="Java (OkHttp)" value="java" />
        <el-option label="C# (HttpClient)" value="csharp" />
        <el-option label="Ruby (Net::HTTP)" value="ruby" />
        <el-option label="Rust (reqwest)" value="rust" />
        <el-option label="HTTPie" value="httpie" />
        <el-option label="PowerShell" value="powershell" />
      </el-select>
      <el-button size="small" type="primary" @click="copyGeneratedCode">
        Copy Code
      </el-button>
    </div>
    <pre class="modal-code-pre">{{ generatedCode }}</pre>
  </el-dialog>
</template>
