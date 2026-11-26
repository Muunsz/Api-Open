<script setup lang="ts">
import { computed, ref } from 'vue';
import { CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'update:visible', val: boolean): void }>();

const activeTab = ref('jwt');

// 1. JWT Decoder
const jwtInput = ref('');
const decodedJwt = computed(() => {
  const parts = jwtInput.value.trim().split('.');
  if (parts.length < 2) return null;
  try {
    const decodeB64 = (s: string) =>
      JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
    const header = decodeB64(parts[0]);
    const payload = decodeB64(parts[1]) as Record<string, unknown>;
    const exp = typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
    return {
      header: JSON.stringify(header, null, 2),
      payload: JSON.stringify(payload, null, 2),
      expired: exp ? exp.getTime() < Date.now() : false,
      expText: exp ? exp.toLocaleString() : 'No exp claim',
    };
  } catch {
    return null;
  }
});

// 2. JSON -> TypeScript / Zod
const jsonInput = ref('{\n  "id": 1,\n  "name": "Api-Open",\n  "active": true\n}');
const codegenTarget = ref<'ts' | 'zod'>('ts');

function inferTsType(val: unknown): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return val.length ? `${inferTsType(val[0])}[]` : 'unknown[]';
  if (typeof val === 'object') return 'Record<string, unknown>';
  return typeof val;
}

function inferZodType(val: unknown): string {
  if (val === null) return 'z.null()';
  if (Array.isArray(val)) return `z.array(${val.length ? inferZodType(val[0]) : 'z.unknown()'})`;
  if (typeof val === 'string') return 'z.string()';
  if (typeof val === 'number') return 'z.number()';
  if (typeof val === 'boolean') return 'z.boolean()';
  if (typeof val === 'object') return 'z.record(z.unknown())';
  return 'z.unknown()';
}

const generatedCode = computed(() => {
  try {
    const parsed = JSON.parse(jsonInput.value) as unknown;
    const obj = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown>) : (parsed as Record<string, unknown>);
    if (!obj || typeof obj !== 'object') return '// Provide a JSON object';
    if (codegenTarget.value === 'ts') {
      const lines = Object.entries(obj).map(([k, v]) => `  ${k}: ${inferTsType(v)};`);
      return `export interface RootResponse {\n${lines.join('\n')}\n}`;
    }
    const lines = Object.entries(obj).map(([k, v]) => `  ${k}: ${inferZodType(v)},`);
    return `import { z } from 'zod';\n\nexport const RootResponseSchema = z.object({\n${lines.join('\n')}\n});`;
  } catch {
    return '// Invalid JSON';
  }
});

// 3. UUID / Hash / Timestamp / URL
const generatedUuid = ref(crypto.randomUUID());
function regenerateUuid() {
  generatedUuid.value = crypto.randomUUID();
}
const hashInput = ref('hello-api-open');
const sha256Output = ref('');
const urlText = ref('https://api.example.com/search?q=hello world');

async function computeSha256() {
  const buf = new TextEncoder().encode(hashInput.value);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  sha256Output.value = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
computeSha256();

async function copyText(val: string) {
  await navigator.clipboard.writeText(val);
  ElMessage.success('Copied to clipboard');
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Developer Toolbox"
    width="min(94vw, 720px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs v-model="activeTab" class="compact-tabs">
      <el-tab-pane label="JWT Decoder" name="jwt">
        <el-input
          v-model="jwtInput"
          type="textarea"
          :rows="3"
          class="code-area"
          placeholder="Paste JWT token (eyJ...) here"
          style="margin-bottom: 10px"
        />
        <div v-if="decodedJwt" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <div>
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px">Header</div>
            <pre class="code-area" style="margin: 0; padding: 8px; border: 1px solid var(--ao-border); border-radius: 6px">{{ decodedJwt.header }}</pre>
          </div>
          <div>
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px">
              Payload
              <el-tag size="small" :type="decodedJwt.expired ? 'danger' : 'success'" style="margin-left: 6px">
                {{ decodedJwt.expired ? 'Expired' : 'Valid' }} ({{ decodedJwt.expText }})
              </el-tag>
            </div>
            <pre class="code-area" style="margin: 0; padding: 8px; border: 1px solid var(--ao-border); border-radius: 6px">{{ decodedJwt.payload }}</pre>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="JSON → TS / Zod" name="codegen">
        <div style="display: flex; gap: 8px; margin-bottom: 8px">
          <el-radio-group v-model="codegenTarget" size="small">
            <el-radio-button value="ts">TypeScript Interface</el-radio-button>
            <el-radio-button value="zod">Zod Schema</el-radio-button>
          </el-radio-group>
          <el-button size="small" :icon="CopyDocument" @click="copyText(generatedCode)">
            Copy Code
          </el-button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <el-input v-model="jsonInput" type="textarea" :rows="8" class="code-area" />
          <el-input :model-value="generatedCode" readonly type="textarea" :rows="8" class="code-area" />
        </div>
      </el-tab-pane>

      <el-tab-pane label="UUID / Hash / URL" name="utils">
        <el-form label-width="110px" size="small">
          <el-form-item label="UUID v4">
            <div style="display: flex; gap: 6px; width: 100%">
              <el-input :model-value="generatedUuid" readonly />
              <el-button @click="regenerateUuid">New</el-button>
              <el-button :icon="CopyDocument" @click="copyText(generatedUuid)" />
            </div>
          </el-form-item>
          <el-form-item label="SHA-256">
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%">
              <el-input v-model="hashInput" @input="computeSha256" />
              <el-input :model-value="sha256Output" readonly />
            </div>
          </el-form-item>
          <el-form-item label="URL Encode">
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%">
              <el-input v-model="urlText" />
              <el-input :model-value="encodeURIComponent(urlText)" readonly />
            </div>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>
