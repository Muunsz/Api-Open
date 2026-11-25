<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { supabase } from '../lib/supabase';
import { useSettingsStore } from '../stores/settings';
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

  if (!supabase) {
    ElMessage.error('Supabase client is not configured');
    return;
  }

  uploadingAvatar.value = true;
  try {
    const ext = file.name.split('.').pop() || 'png';
    const path = `${ws.user.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    profileAvatar.value = data.publicUrl;
    await ws.updateProfile({
      name: profileName.value,
      avatarUrl: profileAvatar.value,
    });
    ElMessage.success('Avatar uploaded & saved');
  } catch (err) {
    ElMessage.error(
      err instanceof Error
        ? `${err.message} (pastikan bucket "avatars" sudah dibuat Public di Supabase Storage)`
        : 'Upload failed',
    );
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
              <el-radio-button value="light">Light</el-radio-button>
              <el-radio-button value="dark">Dark</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Sidebar List Position">
            <el-radio-group v-model="settings.sidebarPosition">
              <el-radio-button value="left">Left</el-radio-button>
              <el-radio-button value="right">Right</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item :label="`Sidebar Width (${settings.sidebarWidth}px)`">
            <el-slider
              v-model="settings.sidebarWidth"
              :min="200"
              :max="480"
              :step="10"
            />
          </el-form-item>

          <el-form-item label="Response Position">
            <el-radio-group v-model="settings.responsePosition">
              <el-radio-button value="bottom">Bottom</el-radio-button>
              <el-radio-button value="right">Right</el-radio-button>
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
            <el-avatar :size="56" :src="profileAvatar || undefined">
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
</style>
