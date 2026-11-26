<script setup lang="ts">
import { ref } from 'vue';
import { Check } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '../../stores/settings';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'update:visible', val: boolean): void }>();

const settings = useSettingsStore();

const THEME_PRESETS = [
  { id: 'default', name: 'Api-Open Default', accent: '#3b82f6', desc: 'Clean blue developer theme' },
  { id: 'dracula', name: 'Dracula Pro', accent: '#bd93f9', desc: 'Vibrant purple & pink contrast' },
  { id: 'nord', name: 'Nordic Frost', accent: '#88c0d0', desc: 'Arctic calm cyan accent' },
  { id: 'emerald', name: 'Emerald Matrix', accent: '#10b981', desc: 'Crisp terminal green' },
  { id: 'amber', name: 'Solar Amber', accent: '#f59e0b', desc: 'Warm high-contrast amber' },
];

const installedPlugins = ref<string[]>(
  JSON.parse(localStorage.getItem('api_open_installed_plugins_v1') || '["universal-importer","graphql-builder","secret-scanner"]'),
);

const COMMUNITY_PLUGINS = [
  { id: 'universal-importer', name: 'Universal Collection Importer', desc: 'Postman, Insomnia, OpenAPI, Bruno, WSDL, HAR' },
  { id: 'graphql-builder', name: 'Visual GraphQL Query Builder', desc: 'Checkbox-driven GraphQL query generator' },
  { id: 'secret-scanner', name: 'Secret & Token Scanner', desc: 'Pre-export secret leak detector' },
  { id: 'har-waterfall', name: 'HAR 1.2 Waterfall Exporter', desc: 'Export detailed DNS/TCP/TLS timings to .har' },
];

function applyThemePreset(preset: { id: string; name: string; accent: string }) {
  settings.accentColor = preset.accent;
  settings.activeThemePlugin = preset.id;
  ElMessage.success(`Applied theme: ${preset.name}`);
}

function togglePlugin(id: string) {
  if (installedPlugins.value.includes(id)) {
    installedPlugins.value = installedPlugins.value.filter((p) => p !== id);
  } else {
    installedPlugins.value.push(id);
  }
  localStorage.setItem('api_open_installed_plugins_v1', JSON.stringify(installedPlugins.value));
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Plugin & Theme Marketplace"
    width="min(94vw, 680px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs class="compact-tabs">
      <el-tab-pane label="Themes">
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px">
          <div
            v-for="th in THEME_PRESETS"
            :key="th.id"
            style="border: 1px solid var(--ao-border); border-radius: 8px; padding: 10px"
          >
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
              <span :style="{ width: '12px', height: '12px', borderRadius: '50%', background: th.accent, display: 'inline-block' }" />
              <strong>{{ th.name }}</strong>
            </div>
            <div style="font-size: 12px; opacity: 0.75; margin-bottom: 8px">{{ th.desc }}</div>
            <el-button
              size="small"
              :type="settings.activeThemePlugin === th.id ? 'success' : 'primary'"
              plain
              :icon="settings.activeThemePlugin === th.id ? Check : undefined"
              @click="applyThemePreset(th)"
            >
              {{ settings.activeThemePlugin === th.id ? 'Active' : 'Apply' }}
            </el-button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Plugins">
        <div style="display: flex; flex-direction: column; gap: 8px">
          <div
            v-for="pl in COMMUNITY_PLUGINS"
            :key="pl.id"
            style="display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--ao-border); border-radius: 8px; padding: 10px"
          >
            <div>
              <strong>{{ pl.name }}</strong>
              <div style="font-size: 12px; opacity: 0.75">{{ pl.desc }}</div>
            </div>
            <el-button
              size="small"
              :type="installedPlugins.includes(pl.id) ? 'success' : 'default'"
              @click="togglePlugin(pl.id)"
            >
              {{ installedPlugins.includes(pl.id) ? 'Installed' : 'Install' }}
            </el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>
