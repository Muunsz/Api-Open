<script setup lang="ts">
import { ref } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import { useCookiesStore } from '../stores/cookies';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const cookieStore = useCookiesStore();
const newDomain = ref('');
const newCookieName = ref<Record<string, string>>({});
const newCookieValue = ref<Record<string, string>>({});

function handleAddDomain() {
  if (!newDomain.value.trim()) return;
  cookieStore.addDomain(newDomain.value);
  newDomain.value = '';
}

function handleAddCookie(domain: string) {
  const name = newCookieName.value[domain] ?? '';
  const val = newCookieValue.value[domain] ?? '';
  if (!name.trim()) return;
  cookieStore.addCookie(domain, name, val);
  newCookieName.value[domain] = '';
  newCookieValue.value[domain] = '';
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Cookies Manager"
    width="min(94vw, 560px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="cookie-add-domain">
      <el-input
        v-model="newDomain"
        size="small"
        placeholder="New domain name (e.g. api.example.com)"
        @keyup.enter="handleAddDomain"
      />
      <el-button size="small" type="primary" @click="handleAddDomain">
        Add
      </el-button>
    </div>

    <el-empty
      v-if="!cookieStore.domains.length"
      description="No cookies stored yet"
      :image-size="54"
    />

    <div v-else class="cookie-domains-list">
      <div
        v-for="jar in cookieStore.domains"
        :key="jar.domain"
        class="cookie-domain-card"
      >
        <div class="cookie-domain-head">
          <strong>{{ jar.domain }}</strong>
          <el-button
            :icon="Delete"
            link
            type="danger"
            size="small"
            @click="cookieStore.removeDomain(jar.domain)"
          />
        </div>

        <div
          v-for="c in jar.cookies"
          :key="c.id"
          class="cookie-row"
        >
          <span class="cookie-pair">
            <b>{{ c.name }}</b> = {{ c.value }}
          </span>
          <el-button
            :icon="Delete"
            link
            type="danger"
            size="small"
            @click="cookieStore.removeCookie(jar.domain, c.id)"
          />
        </div>

        <div class="cookie-new-row">
          <el-input
            v-model="newCookieName[jar.domain]"
            size="small"
            placeholder="Cookie name"
          />
          <el-input
            v-model="newCookieValue[jar.domain]"
            size="small"
            placeholder="Value"
            @keyup.enter="handleAddCookie(jar.domain)"
          />
          <el-button
            size="small"
            :icon="Plus"
            @click="handleAddCookie(jar.domain)"
          >
            Add
          </el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div style="display: flex; justify-content: space-between; width: 100%">
        <el-button
          v-if="cookieStore.domains.length"
          type="danger"
          plain
          size="small"
          @click="cookieStore.clearAll()"
        >
          Clear All
        </el-button>
        <span v-else />
        <el-button size="small" @click="emit('update:visible', false)">
          Close
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.cookie-add-domain {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.cookie-domains-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
}
.cookie-domain-card {
  border: 1px solid var(--ao-border);
  background: var(--ao-surface-elevated);
  border-radius: 6px;
  padding: 10px 12px;
}
.cookie-domain-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.cookie-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--ao-border);
  margin-bottom: 6px;
  font-size: 12.5px;
}
.cookie-pair {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cookie-new-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
</style>
