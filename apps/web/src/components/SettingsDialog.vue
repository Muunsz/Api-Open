<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { resolveImageProxyUrl } from '../api/proxy';
import { supabase } from '../lib/supabase';
import { ACCENT_COLORS, useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{
  visible: boolean;
  initialTab?: 'layout' | 'profile';
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const settings = useSettingsStore();
const ws = useWorkspaceStore();

const activeTab = ref<'layout' | 'profile'>(props.initialTab ?? 'layout');
const profileName = ref('');
const profileAvatar = ref('');
const savingProfile = ref(false);
const uploadingAvatar = ref(false);
const avatarFileInput = ref<HTMLInputElement | null>(null);
const newPassword = ref('');
const savingPassword = ref(false);
const newCertHost = ref('');
const newCertPem = ref('');
const newKeyPem = ref('');
const newCaPem = ref('');
const newCertPass = ref('');

function addClientCert() {
  if (!newCertHost.value.trim() || !newCertPem.value.trim()) {
    ElMessage.warning('Host and Certificate PEM are required');
    return;
  }
  settings.clientCerts.push({
    host: newCertHost.value.trim(),
    certPem: newCertPem.value.trim(),
    keyPem: newKeyPem.value.trim() || undefined,
    caPem: newCaPem.value.trim() || undefined,
    passphrase: newCertPass.value || undefined,
  });
  newCertHost.value = '';
  newCertPem.value = '';
  newKeyPem.value = '';
  newCaPem.value = '';
  newCertPass.value = '';
  ElMessage.success('Client certificate added');
}

watch(
  () => props.visible,
  (open) => {
    if (open) {
      activeTab.value = props.initialTab ?? 'layout';
      profileName.value = ws.profile?.name ?? '';
      profileAvatar.value = ws.profile?.avatarUrl ?? '';
    }
  },
);

async function saveProfile() {
  savingProfile.value = true;
  try {
    await ws.updateProfile({
      name: profileName.value,
      avatarUrl: profileAvatar.value,
    });
    ElMessage.success('Profile updated');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Failed to update profile');
  } finally {
    savingProfile.value = false;
  }
}

function resizeImageToDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = () => resolve(String(reader.result));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

async function handleAvatarUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !ws.user) return;

  if (!file.type.startsWith('image/')) {
    ElMessage.warning('Please select an image file');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning('Max image size is 2 MB');
    return;
  }

  uploadingAvatar.value = true;
  try {
    let uploadedUrl = '';
    if (supabase) {
      try {
        const ext = file.name.split('.').pop() || 'png';
        const path = `${ws.user.id}/avatar-${Date.now()}.${ext}`;
        const { error } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: true });
        if (!error) {
          const { data } = supabase.storage.from('avatars').getPublicUrl(path);
          uploadedUrl = data.publicUrl;
        }
      } catch {
        // fallback to API DB avatar below
      }
    }

    if (!uploadedUrl) {
      uploadedUrl = await resizeImageToDataUrl(file, 256);
    }

    profileAvatar.value = uploadedUrl;
    await ws.updateProfile({
      name: profileName.value,
      avatarUrl: profileAvatar.value,
    });
    ElMessage.success('Avatar uploaded & saved');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Upload failed');
  } finally {
    uploadingAvatar.value = false;
    input.value = '';
  }
}

async function handleChangePassword() {
  if (newPassword.value.length < 6) {
    ElMessage.warning('Password must be at least 6 characters');
    return;
  }
  savingPassword.value = true;
  try {
    await ws.updatePassword(newPassword.value);
    newPassword.value = '';
    ElMessage.success('Password updated');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Failed to update password');
  } finally {
    savingPassword.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="Settings & Profile"
    width="min(94vw, 560px)"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-tabs v-model="activeTab">
      <el-tab-pane label="Layout & Theme" name="layout">
        <el-form label-width="175px" label-position="left" size="small">
          <el-form-item label="Theme Mode">
            <el-radio-group v-model="settings.theme">
              <el-radio-button value="system">Auto (Chrome)</el-radio-button>
              <el-radio-button value="light">Light</el-radio-button>
              <el-radio-button value="dark">Dark</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Accent Color">
            <div class="accent-swatches">
              <button
                v-for="c in ACCENT_COLORS"
                :key="c.value"
                type="button"
                class="accent-dot"
                :class="{ active: settings.accentColor === c.value }"
                :style="{ backgroundColor: c.value }"
                :title="c.name"
                @click="settings.accentColor = c.value"
              />
            </div>
          </el-form-item>

          <el-form-item label="Request Interceptor">
            <el-radio-group v-model="settings.interceptor">
              <el-radio-button value="proxy">Proxy (Bypass CORS)</el-radio-button>
              <el-radio-button value="browser">Browser Direct</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Query Param Encoding">
            <el-radio-group v-model="settings.queryEncoding">
              <el-radio-button value="auto">Auto</el-radio-button>
              <el-radio-button value="enable">Enable</el-radio-button>
              <el-radio-button value="disable">Disable</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Top Bar Position">
            <el-radio-group v-model="settings.navbarPosition">
              <el-radio-button value="top">Top</el-radio-button>
              <el-radio-button value="bottom">Bottom</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Sidebar List Position">
            <el-radio-group v-model="settings.sidebarPosition">
              <el-radio-button value="left">Left</el-radio-button>
              <el-radio-button value="right">Right</el-radio-button>
              <el-radio-button value="top">Top</el-radio-button>
              <el-radio-button value="bottom">Bottom</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Show Sidebar">
            <el-switch
              :model-value="!settings.sidebarHidden"
              @update:model-value="(val: boolean) => (settings.sidebarHidden = !val)"
            />
          </el-form-item>

          <el-form-item
            v-if="settings.sidebarPosition === 'left' || settings.sidebarPosition === 'right'"
            :label="`Sidebar Width (${settings.sidebarWidth}px)`"
          >
            <el-slider
              v-model="settings.sidebarWidth"
              :min="200"
              :max="480"
              :step="10"
            />
          </el-form-item>

          <el-form-item
            v-else
            :label="`Sidebar Height (${settings.sidebarHeight}px)`"
          >
            <el-slider
              v-model="settings.sidebarHeight"
              :min="140"
              :max="420"
              :step="10"
            />
          </el-form-item>

          <el-form-item label="Response Position">
            <el-radio-group v-model="settings.responsePosition">
              <el-radio-button value="left">Left</el-radio-button>
              <el-radio-button value="right">Right</el-radio-button>
              <el-radio-button value="top">Top</el-radio-button>
              <el-radio-button value="bottom">Bottom</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item :label="`Response Size (${settings.responseSizePercent}%)`">
            <el-slider
              v-model="settings.responseSizePercent"
              :min="25"
              :max="75"
              :step="5"
            />
          </el-form-item>

          <el-form-item label="Custom Proxy / Agent URL">
            <el-input
              v-model="settings.customProxyUrl"
              size="small"
              placeholder="Default (/api) — or e.g. http://localhost:3001/api"
              clearable
            />
          </el-form-item>
        </el-form>

        <div style="display: flex; justify-content: flex-end; margin-top: 8px">
          <el-button size="small" @click="settings.resetDefaults">
            Reset to Defaults
          </el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Profile" name="profile">
        <template v-if="ws.isAuthenticated">
          <div class="profile-preview">
            <el-avatar :size="56" :src="resolveImageProxyUrl(profileAvatar)">
              {{ (profileName || ws.user?.email || 'U').slice(0, 1).toUpperCase() }}
            </el-avatar>
            <div style="flex: 1">
              <div style="font-weight: 600">
                {{ profileName || ws.user?.email }}
              </div>
              <el-text size="small" type="info">{{ ws.user?.email }}</el-text>
              <div style="margin-top: 6px">
                <el-button
                  size="small"
                  :loading="uploadingAvatar"
                  @click="avatarFileInput?.click()"
                >
                  Upload Photo
                </el-button>
                <input
                  ref="avatarFileInput"
                  type="file"
                  accept="image/*"
                  style="display: none"
                  @change="handleAvatarUpload"
                />
              </div>
            </div>
          </div>

          <el-form label-position="top" size="small">
            <el-form-item label="Display Name">
              <el-input v-model="profileName" placeholder="Your name" />
            </el-form-item>
            <el-form-item label="Avatar URL">
              <el-input
                v-model="profileAvatar"
                placeholder="https://example.com/avatar.png"
              />
            </el-form-item>
            <el-button
              type="primary"
              :loading="savingProfile"
              @click="saveProfile"
            >
              Save Profile
            </el-button>
          </el-form>

          <el-divider>Change Password</el-divider>
          <div style="display: flex; gap: 8px">
            <el-input
              v-model="newPassword"
              type="password"
              size="small"
              placeholder="New password (min 6 chars)"
              show-password
            />
            <el-button
              size="small"
              :loading="savingPassword"
              @click="handleChangePassword"
            >
              Update
            </el-button>
          </div>
        </template>
        <el-empty
          v-else
          description="Sign in to manage your profile"
          :image-size="60"
        />
      </el-tab-pane>

      <el-tab-pane label="Certificates (mTLS)" name="certs">
        <el-form label-position="top" size="small">
          <el-form-item label="Target Host (e.g. api.internal.com)">
            <el-input v-model="newCertHost" placeholder="api.example.com" />
          </el-form-item>
          <el-form-item label="Client Certificate (PEM)">
            <el-input
              v-model="newCertPem"
              type="textarea"
              :rows="3"
              placeholder="-----BEGIN CERTIFICATE-----"
            />
          </el-form-item>
          <el-form-item label="Private Key (PEM)">
            <el-input
              v-model="newCertPem"
              v-show="false"
            />
            <el-input
              v-model="newKeyPem"
              type="textarea"
              :rows="3"
              placeholder="-----BEGIN PRIVATE KEY-----"
            />
          </el-form-item>
          <el-form-item label="CA Certificate (Optional PEM)">
            <el-input
              v-model="newCaPem"
              type="textarea"
              :rows="2"
              placeholder="-----BEGIN CERTIFICATE-----"
            />
          </el-form-item>
          <el-form-item label="Passphrase (Optional)">
            <el-input v-model="newCertPass" type="password" show-password />
          </el-form-item>
          <el-button type="primary" size="small" @click="addClientCert">
            Add Client Certificate
          </el-button>
        </el-form>

        <el-divider v-if="settings.clientCerts.length">Configured Certificates</el-divider>
        <div
          v-for="(cert, idx) in settings.clientCerts"
          :key="`${cert.host}-${idx}`"
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 10px;
            border: 1px solid var(--ao-border);
            border-radius: 6px;
            margin-bottom: 6px;
          "
        >
          <span><strong>{{ cert.host }}</strong></span>
          <el-button
            size="small"
            type="danger"
            link
            @click="settings.clientCerts.splice(idx, 1)"
          >
            Remove
          </el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane label="AI Assistant" name="ai">
        <el-alert
          type="success"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
          title="Free Local Mode works 100% offline without any API key. Optionally connect your own free-tier API key or local Ollama."
        />
        <el-form label-width="130px" size="small">
          <el-form-item label="AI Provider">
            <el-select v-model="settings.aiConfig.provider" style="width: 100%">
              <el-option label="Free Local Generator (No API Key)" value="local" />
              <el-option label="Google Gemini (BYOK Free Tier)" value="gemini" />
              <el-option label="Groq (BYOK Free Tier)" value="groq" />
              <el-option label="OpenRouter (BYOK Free Models)" value="openrouter" />
              <el-option label="Local Ollama (http://localhost:11434)" value="ollama" />
            </el-select>
          </el-form-item>
          <el-form-item
            v-if="settings.aiConfig.provider !== 'local' && settings.aiConfig.provider !== 'ollama'"
            label="API Key"
          >
            <el-input
              v-model="settings.aiConfig.apiKey"
              show-password
              placeholder="Stored locally in your browser"
            />
          </el-form-item>
          <el-form-item v-if="settings.aiConfig.provider === 'ollama'" label="Ollama URL">
            <el-input v-model="settings.aiConfig.ollamaUrl" placeholder="http://localhost:11434" />
          </el-form-item>
          <el-form-item v-if="settings.aiConfig.provider !== 'local'" label="Model (optional)">
            <el-input
              v-model="settings.aiConfig.model"
              placeholder="Leave blank for default free model"
            />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Corporate Proxy / Tunnel" name="tunnel">
        <el-form label-width="130px" size="small">
          <el-form-item label="Proxy / Tunnel URL">
            <el-input
              v-model="settings.tunnelProxy.url"
              placeholder="http://proxy.corp:8080 or socks5://127.0.0.1:1080"
            />
          </el-form-item>
          <el-form-item label="Username">
            <el-input v-model="settings.tunnelProxy.username" placeholder="Optional" />
          </el-form-item>
          <el-form-item label="Password">
            <el-input v-model="settings.tunnelProxy.password" show-password placeholder="Optional" />
          </el-form-item>
          <el-divider />
          <el-form-item label="Language / Bahasa">
            <el-select v-model="settings.locale" style="width: 100%">
              <el-option label="English (EN)" value="en" />
              <el-option label="Bahasa Indonesia (ID)" value="id" />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.profile-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.accent-swatches {
  display: flex;
  align-items: center;
  gap: 8px;
}
.accent-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s;
}
.accent-dot:hover {
  transform: scale(1.1);
}
.accent-dot.active {
  outline: 2px solid var(--ao-text);
  outline-offset: 2px;
}
</style>
